const {boot}=require('./harness.cjs');
const assert=require('node:assert/strict');
const secret=Buffer.alloc(32,23).toString('base64url');
const book={focus:'Фокус из браузера',budget:{transactions:[{id:'one',name:'Покупка',amount:10,type:'expense',currency:'EUR',date:'2026-10-30'}]},events:{},tasks:[],notes:[]};
const pause=()=>new Promise(r=>setTimeout(r,80));
const snapshot=w=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return [k,w.localStorage.getItem(k)];}));
(async()=>{
 let sharedReads=0,sharedWrites=0,remote;
 const client={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async(name,args)=>{if(name==='get_shared_notebook'){sharedReads++;return {data:remote};}sharedWrites++;remote=args.p_payload;return {};}};
 const h=await boot({client,standalone:true});
 try {
  assert(h.$('#recoveryDialog').open);
  remote=await h.w.audit.encryptSharedState(secret,book);
  h.set('#existingNotebookLink','https://example.test/night-notes/?sync='+secret);
  h.$('#connectExistingNotebook').click();await pause();
  assert.equal(h.w.audit.state.budget.transactions[0].id,'one');
  assert.equal(h.$('#focusInput').value,book.focus);
  assert(!h.$('#recoveryDialog').open);
  assert.equal(sharedWrites,0);
  const next=await boot({client,standalone:true,storage:snapshot(h.w)});
  try{await pause();assert.equal(next.w.audit.state.budget.transactions[0].id,'one');assert.equal((await next.w.audit.decryptSharedState(secret,remote)).budget.transactions[0].id,'one');assert.deepEqual(next.errors,[]);}finally{next.close();}
  assert.deepEqual(h.errors,[]);
  console.log('PASS existing shortcut connects without reload/upload and retains identity after restart');
 }finally{h.close();}
 let account=JSON.parse(JSON.stringify(book));
 const email={auth:{getSession:async()=>({data:{session:{user:{id:'u',email:'test@example.test'}}}}),onAuthStateChange(){}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{payload:account}})})}),upsert:async row=>{account=row.payload;return {};}}),rpc:async()=>{throw Error('Old private copy must not be used');}};
 const migrated=await boot({client:email,query:'?sync='+secret,cookie:'night_notes_install_v1='+secret,storage:{'night-notes-email-migration-v1':'1','night-notes-shared-secret-v1':secret}});
 try {
  await pause();
  assert.equal(migrated.w.localStorage.getItem('night-notes-shared-secret-v1'),null);
  assert(!migrated.w.location.search.includes('sync='));
  assert(!migrated.w.document.cookie.includes('night_notes_install_v1'));
  assert.equal(migrated.w.localStorage.getItem('night-notes-email-migration-v1'),null);
  const next=await boot({client:email,storage:snapshot(migrated.w),standalone:true});
  try{await pause();assert.equal(next.w.audit.state.budget.transactions[0].id,'one');next.$('#createShareLink').click();await pause();assert(!next.w.location.search.includes('sync='));assert.equal(next.w.localStorage.getItem('night-notes-shared-secret-v1'),null);assert.deepEqual(next.errors,[]);}finally{next.close();}
  assert.deepEqual(migrated.errors,[]);
  console.log('PASS email migration survives restart and copy-link cannot fork the account');
 }finally{migrated.close();}
 const missing=await boot({client:{...client,rpc:async()=>({data:null})},query:'?sync='+secret,standalone:true});
 try{await pause();assert(!missing.$('#syncAccount').classList.contains('is-synced'));assert.match(missing.$('#notebookSaveStatus').textContent,/нет записей/);console.log('PASS missing cloud copy is not reported as synchronized');}finally{missing.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
