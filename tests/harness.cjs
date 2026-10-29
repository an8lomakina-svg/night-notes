process.env.TZ='Europe/Belgrade';
const {JSDOM,VirtualConsole}=require('jsdom');
const fs=require('node:fs'),{webcrypto}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8'),app=fs.readFileSync(__dirname+'/../app.js','utf8');
async function boot(opts={}){
 const errors=[],alerts=[],downloads=[],external=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://example.test/night-notes/'+(opts.query||'')+'#budget',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.matchMedia=q=>({matches:q.includes('760')||q.includes('pointer:coarse')||q.includes('pointer: coarse')||(opts.standalone && q.includes('standalone')),addEventListener(){},removeEventListener(){}});
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};
 w.alert=s=>alerts.push(s);w.confirm=()=>true;w.prompt=()=>null;w.open=(...a)=>external.push(a);
 w.URL.createObjectURL=b=>{downloads.push(b);return 'blob:test'};w.URL.revokeObjectURL=()=>{};
 const anchorClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(!this.download)anchorClick.call(this)};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async t=>external.push(t)}});
 w.fetch=async()=>{throw Error('External network blocked by test harness')};
 if(opts.storage)for(const[k,v]of Object.entries(opts.storage))w.localStorage.setItem(k,v);
 if(opts.cookie)w.document.cookie=opts.cookie;
 if(opts.client)w.supabase={createClient:()=>opts.client};
 w.addEventListener('error',e=>errors.push(e.error?.stack||e.message));
 let source='';for(const s of w.document.scripts){if(s.src){if(s.src.includes('/app.js'))source+='\n'+app;else if(/\/(sync-core|calendar-import)\.js/.test(s.src))source+='\n'+fs.readFileSync(__dirname+'/../'+new URL(s.src).pathname.split('/').pop(),'utf8');}else source+='\n'+s.textContent;}
 source+='\nwindow.audit={state,save,activateView,renderBudget,renderShopping,renderNotes,renderCalendar,restoreArchive,budgetCategoriesFor,downloadBackup,hydrateSharedState,hydrateCloudState,initCloudSync,encryptSharedState,decryptSharedState,sharedId,ensureSharedSync};';
 try{w.eval(source)}catch(e){errors.push(e.stack)}
 await new Promise(r=>setTimeout(r,30));
 const $=s=>w.document.querySelector(s),event=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 const set=(sel,value)=>{const e=$(sel);e.value=value;event(e,e.tagName==='SELECT'?'change':'input');return e;};
 return {dom,w,$,set,event,errors,alerts,downloads,external,close:()=>w.close()};
}
module.exports={boot};
if(require.main===module)boot().then(h=>{console.log(h.errors);console.log(!!h.w.audit);h.close()});
