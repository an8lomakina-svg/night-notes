/* Shared by the browser and regression tests. No network or browser dependencies. */
(function (root) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const key = value => object(value) && value.id != null ? 'id:' + value.id
    : object(value) && value.uid ? 'uid:' + value.uid : 'value:' + JSON.stringify(canonical(value));
  const token = (path, id) => JSON.stringify([path, id]);
  function deletions(before, after, existing = {}) {
    const removed = {...existing};
    function walk(a, b, path) {
      if (Array.isArray(a) || Array.isArray(b)) {
        const old = new Map((Array.isArray(a) ? a : []).map(v => [key(v),v]));
        const next = new Map((Array.isArray(b) ? b : []).map(v => [key(v),v]));
        for (const [id, item] of old) {
          if (!next.has(id)) removed[token(path,id)] = true;
          else walk(item,next.get(id),path.concat(id));
        }
        for (const id of next.keys()) if (!old.has(id)) delete removed[token(path,id)];
      } else if (object(a) || object(b)) {
        for (const name of new Set([...Object.keys(a || {}),...Object.keys(b || {})])) {
          if (name !== '_sync' && !['__proto__','constructor','prototype'].includes(name)) walk(a?.[name],b?.[name],path.concat(name));
        }
      }
    }
    walk(before,after,[]);return removed;
  }
  function merge(base, local, remote, preference = 'local') {
    const conflicts = [];
    const bd=base?._sync?.deleted || {},ld=local?._sync?.deleted || {},rd=remote?._sync?.deleted || {};
    const deleted = {};
    for (const id of new Set([...Object.keys(bd),...Object.keys(ld),...Object.keys(rd)])) {
      const value = equal(ld[id],bd[id]) ? rd[id] : ld[id];
      if (value) deleted[id] = true;
    }
    function walk(b,l,r,path) {
      if (Array.isArray(l) || Array.isArray(r)) {
        const lm=new Map((Array.isArray(l)?l:[]).map(v=>[key(v),v]));
        const rm=new Map((Array.isArray(r)?r:[]).map(v=>[key(v),v]));
        const bm=new Map((Array.isArray(b)?b:[]).map(v=>[key(v),v]));
        return [...new Set([...rm.keys(),...lm.keys()])].filter(id=>{
          const t=token(path,id);
          if(!deleted[t])return true;
          const old=bm.get(id),l=lm.get(id),r=rm.get(id);
          const localDelete=!l && old!==undefined,remoteDelete=!r && old!==undefined;
          if((localDelete && r && !equal(old,r)) || (remoteDelete && l && !equal(old,l)) || (old===undefined && Boolean(l)!==Boolean(r))) {
            conflicts.push(path.concat(id).join('.')+' (удаление/изменение)');
            const keep=preference==='remote' ? r : l;
            if(keep){delete deleted[t];return true;}
          }
          return false;
        }).map(id=>walk(bm.get(id),lm.get(id),rm.get(id),path.concat(id)));
      }
      if (l === undefined) return clone(r);
      if (r === undefined) return clone(l);
      if (equal(l,r)) return clone(l);
      if (object(l) && object(r)) {
        const out={};
        for (const name of new Set([...Object.keys(r),...Object.keys(l)])) {
          if (name === '_sync' || ['__proto__','constructor','prototype'].includes(name)) continue;
          out[name]=walk(b?.[name],l[name],r[name],path.concat(name));
        }
        return out;
      }
      if (equal(l,b)) return clone(r);
      if (equal(r,b)) return clone(l);
      if (l === '' || l === null) return clone(r);
      if (r === '' || r === null) return clone(l);
      // UI preferences and generated artwork are not conflicting user records.
      if (!['activeShoppingListId','inspirationArchive','dailyInspiration','categorySchema','selfCareDaily'].some(p=>path.includes(p))) conflicts.push(path.join('.'));
      return clone(preference === 'remote' ? r : l);
    }
    const state=walk(base,local,remote,[]);
    state._sync={version:1,deleted};return {state,conflicts};
  }
  function valid(state) {
    if (!object(state) || !object(state.budget) || !Array.isArray(state.budget.transactions) || !object(state.events)) return false;
    for(const name of ['tasks','imports','archive','notes','shoppingLists']) if(state[name] !== undefined && !Array.isArray(state[name])) return false;
    if (state.budget.transactions.some(t=>!object(t)||!Number.isFinite(t.amount)||t.amount<0||typeof t.name!=='string')) return false;
    if(Object.values(state.events).some(day=>!Array.isArray(day) || day.some(e=>!object(e)||typeof e.title!=='string'||(e.time!==undefined && e.time!=='' && e.time!=='ВЕСЬ ДЕНЬ' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)))))return false;
    if(state.shoppingLists?.some(list=>!object(list)||!Array.isArray(list.items)||list.items.some(item=>!object(item)||typeof item.text!=='string')))return false;
    if(state.notes?.some(note=>!object(note)||(note.updatedAt && !Number.isFinite(new Date(note.updatedAt).getTime()))))return false;
    if(state.plans && (!object(state.plans)||Object.values(state.plans).some(list=>!Array.isArray(list))))return false;
    if(state.health && (!object(state.health)||['done','todo'].some(k=>state.health[k]!==undefined&&!Array.isArray(state.health[k]))))return false;
    return true;
  }
  const api={clone,equal,deletions,merge,valid};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.NotebookSync=api;
})(typeof globalThis==='object'?globalThis:this);

