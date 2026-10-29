process.env.TZ='Europe/Belgrade';
const {boot}=require('./harness.cjs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const secret=Buffer.alloc(32,12).toString('base64url');
const tx=(id,name=id)=>({id,name,type:'expense',amount:10,currency:'RSD',category:'Продукты',date:'2026-10-29'});
const initial={budget:{transactions:[tx('a')],categorySchema:'2026-10-v3'},events:{},tasks:[],imports:[],notes:[],plans:{dream:[],next:[],done:[]},health:{done:[],todo:[]}};
async function encrypt(value){const iv=webcrypto.getRandomValues(new Uint8Array(12)),key=await webcrypto.subtle.importKey('raw',Buffer.from(secret,'base64url'),{name:'AES-GCM'},false,['encrypt']);return {iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)))).toString('base64url')}}
(async()=>{let remote=await encrypt(initial),count=0;const client={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async(name,args)=>name==='get_shared_notebook'?{data:remote}:(remote=args.p_payload,{})};
const a=await boot({client,query:'?sync='+secret}),b=await boot({client,query:'?sync='+secret});
try{
 await Promise.all([a.w.audit.hydrateSharedState(),b.w.audit.hydrateSharedState()]);
 a.w.audit.state.budget.transactions.push(tx('b'));a.w.audit.save();
 b.w.audit.state.budget.transactions.push(tx('c'));b.w.audit.save();
 await Promise.all([a.w.audit.hydrateSharedState(),b.w.audit.hydrateSharedState()]);
 await a.w.audit.hydrateSharedState();await b.w.audit.hydrateSharedState();
 const server=await a.w.audit.decryptSharedState(secret,remote);assert.deepEqual(Array.from(server.budget.transactions,t=>t.id).sort(),['a','b','c']);console.log('PASS concurrent device additions reconcile without dropping records');count++;
 a.w.audit.state.budget.transactions=a.w.audit.state.budget.transactions.filter(t=>t.id!=='a');a.w.audit.save();await a.w.audit.hydrateSharedState();await b.w.audit.hydrateSharedState();assert(!b.w.audit.state.budget.transactions.some(t=>t.id==='a'));console.log('PASS intentional deletion propagates and does not resurrect');count++;
 a.w.audit.state.budget.transactions.find(t=>t.id==='b').name='From A';a.w.audit.save();await a.w.audit.hydrateSharedState();
 b.w.audit.state.budget.transactions.find(t=>t.id==='b').name='From B';b.w.audit.save();await b.w.audit.hydrateSharedState();
 assert(!b.$('#syncConflict').hidden);assert(!b.$('#syncAccount').classList.contains('is-synced'));assert.equal(b.w.audit.state.budget.transactions.find(t=>t.id==='b').name,'From B');const preserved=await a.w.audit.decryptSharedState(secret,remote);assert.equal(preserved.budget.transactions.find(t=>t.id==='b').name,'From A');console.log('PASS conflicting same-record edits pause, retaining both versions');count++;
 b.$('#resolveSyncRemote').click();await b.w.audit.hydrateSharedState();assert.equal(b.w.audit.state.budget.transactions.find(t=>t.id==='b').name,'From A');assert(b.$('#syncConflict').hidden);console.log('PASS explicit conflict resolution keeps selected version');count++;
 assert.equal(a.errors.length+b.errors.length,0);
}finally{a.close();b.close();}
let cloud=JSON.parse(JSON.stringify(initial));const email={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}}),onAuthStateChange(){}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{payload:cloud}})})}),upsert:async row=>{cloud=row.payload;return {}}})};
const h=await boot({client:email});try{await h.w.audit.hydrateCloudState();assert.equal(h.w.audit.state.budget.transactions[0].id,'a');h.w.audit.state.budget.transactions.push(tx('email'));h.w.audit.save();await h.w.audit.hydrateCloudState();assert.deepEqual(Array.from(cloud.budget.transactions,t=>t.id).sort(),['a','email']);assert(h.$('#syncAccount').classList.contains('is-synced'));console.log('PASS email-only notebook read/merge/write/verification');count++;}finally{h.close()}
remote=await encrypt(initial);let hold=false,unblock,started;
const waiting=new Promise(r=>started=r),gate=new Promise(r=>unblock=r);
const delayed={...client,rpc:async(name,args)=>{if(name==='get_shared_notebook' && hold){hold=false;const captured=remote;started();await gate;return {data:captured};}return client.rpc(name,args)}};
const c=await boot({client,query:'?sync='+secret}),d=await boot({client:delayed,query:'?sync='+secret});
try{
  await c.w.audit.hydrateSharedState();await d.w.audit.hydrateSharedState();
  hold=true;d.w.audit.state.budget.transactions[0].name='Delayed D';d.w.audit.save();const pending=d.w.audit.hydrateSharedState();await waiting;
  c.w.audit.state.budget.transactions[0].name='Committed C';c.w.audit.save();await c.w.audit.hydrateSharedState();
  unblock();await pending;await c.w.audit.hydrateSharedState();
  assert(!c.$('#syncConflict').hidden);assert.equal(c.w.audit.state.budget.transactions[0].name,'Committed C');
  assert.equal((await c.w.audit.decryptSharedState(secret,remote)).budget.transactions[0].name,'Delayed D');
  console.log('PASS delayed stale write is detected as parallel history, both edits retained');count++;
}finally{unblock();c.close();d.close();}
console.log(count+' multidevice checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
