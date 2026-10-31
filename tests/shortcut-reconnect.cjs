const {boot}=require('./harness.cjs');
const assert=require('node:assert/strict');
const secret=Buffer.alloc(32,37).toString('base64url');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const seed=await boot();
 const book={focus:'Общий блокнот',tasks:[{id:'task',text:'Задача',done:false}],notes:[{id:'note',title:'Заметка',body:'Текст',updatedAt:1793318400000}],events:{},budget:{transactions:[{id:'tx',name:'Покупка',amount:10,type:'expense',currency:'EUR',date:'2026-10-30'}]}};
 const payload=await seed.w.audit.encryptSharedState(secret,{...seed.w.audit.state,...book,budget:{...seed.w.audit.state.budget,...book.budget}});seed.close();
 let reads=0,writes=0,offline=true;
 const fetch=async(url,opts)=>{
  assert.equal(opts.method,'POST');assert(opts.signal);
  if(!url.endsWith('/get_shared_notebook')){writes++;throw Error('Unexpected write');}
  reads++;
  if(offline)throw Error('Temporary network failure');
  return {ok:true,text:async()=>JSON.stringify(payload)};
 };
 const h=await boot({query:'?sync='+secret,standalone:true,fetch});
 try {
  assert.equal(h.w.localStorage.getItem('night-notes-shared-secret-v1'),secret);
  assert.equal(h.w.audit.state.budget.transactions.length,0);
  offline=false;
  await pause(2200);
  assert.equal(h.w.audit.state.budget.transactions[0].id,'tx');
  assert.equal(h.w.audit.state.tasks[0].id,'task');
  assert.equal(h.w.audit.state.notes[0].id,'note');
  assert.equal(h.$('#focusInput').value,'Общий блокнот');
  assert(h.$('#syncAccount').classList.contains('is-synced'));
  assert(reads>=2);assert.equal(writes,0);assert.deepEqual(h.errors,[]);
  console.log('PASS standalone loads every section without SDK after temporary network failure, without writes');
 } finally {h.close();}
 const restored=await boot({standalone:true,fetch,storage:{'night-notes-sync-target-v1':'shared:'+secret}});
 try {
  await pause(80);assert.equal(restored.w.audit.state.budget.transactions[0].id,'tx');
  assert.equal(restored.w.localStorage.getItem('night-notes-shared-secret-v1'),secret);
  const before=reads;restored.w.dispatchEvent(new restored.w.Event('pageshow'));await pause(80);
  assert(reads>before);assert.equal(writes,0);assert.deepEqual(restored.errors,[]);
  console.log('PASS existing local sync identity recovers without query/cookie and refreshes on pageshow');
 }finally{restored.close();}
 let savedPayload=payload,encryptedWrites=0;
 const editable=await boot({query:'?sync='+secret,standalone:true,fetch:async(url,opts)=>{
   const args=JSON.parse(opts.body);
   if(url.endsWith('/save_shared_notebook')){
     assert(args.p_payload.ciphertext);assert(!opts.body.includes('Изменено без SDK'));
     savedPayload=args.p_payload;encryptedWrites++;
     return {ok:true,text:async()=>''};
   }
   return {ok:true,text:async()=>JSON.stringify(savedPayload)};
 }});
 try {
   await pause(80);editable.w.audit.state.focus='Изменено без SDK';editable.w.audit.save();await pause(450);
   assert.equal((await editable.w.audit.decryptSharedState(secret,savedPayload)).focus,'Изменено без SDK');
   assert.equal(editable.w.localStorage.getItem('night-notes-pending-sync-v1'),null);
   assert.equal(encryptedWrites,1);assert.deepEqual(editable.errors,[]);
   console.log('PASS fallback encrypts edits and acknowledges only after read-back verification');
 }finally{editable.close();}
 const before=reads;
 const blank=await boot({standalone:true,fetch});
 try {await pause(80);assert.equal(reads,before);assert.equal(blank.w.localStorage.getItem('night-notes-shared-secret-v1'),null);console.log('PASS anonymous shortcut does not guess or create a notebook');}finally{blank.close();}
 const late=await boot({standalone:true});
 try {
  late.w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}}})};
  late.w.dispatchEvent(new late.w.Event('online'));await pause(80);
  assert.match(late.$('#notebookSaveStatus').textContent,/синхронизация не подключена/);
  assert.deepEqual(late.errors,[]);console.log('PASS reconnect initializes a previously unavailable SDK');
 }finally{late.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
