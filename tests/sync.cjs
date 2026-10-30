process.env.TZ='Europe/Belgrade';
const {boot}=require('./harness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const secret=Buffer.alloc(32,8).toString('base64url'),target='shared:'+secret,results=[];
const book=ids=>({budget:{transactions:ids.map(id=>({id,name:id,amount:100,type:'expense',currency:'RSD',date:'2026-10-29',category:'Продукты'})),categorySchema:'2026-10-v3'},tasks:[],events:{},imports:[],plans:{dream:[],next:[],done:[]},notes:[],shoppingLists:[{id:'main',name:'Мой список',items:[]}],activeShoppingListId:'main',health:{done:[],todo:[]},archive:[]});
const enc=async state=>{const iv=webcrypto.getRandomValues(new Uint8Array(12)),key=await webcrypto.subtle.importKey('raw',Buffer.from(secret,'base64url'),{name:'AES-GCM'},false,['encrypt']);return {iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(state)))).toString('base64url')}};
const delay=()=>new Promise(r=>setTimeout(r,40));
async function setup(opts={}){
 let server=await enc({...book(opts.remote??['old']),...(opts.remoteState || {})}),reads=0,writes=0,gate,release;const remoteCalls=[];
 if(opts.hold)gate=new Promise(r=>release=r);
 const client={auth:{getSession:async()=>({data:{session:opts.session?{user:{id:'test-user'}}:null}}),onAuthStateChange:fn=>{if(opts.authEvent)setTimeout(()=>fn('INITIAL_SESSION',null),0);}},rpc:async(name,args)=>{remoteCalls.push(name);if(name==='get_shared_notebook'){reads++;if(gate)await gate;return opts.failRead?{error:new Error('offline')}:{data:server};}writes++;if(opts.failWrite)return {error:new Error('offline')};server=args.p_payload;return {};},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{payload:book([])}})})}),upsert:async()=>({})})};
 const h=await boot({client,query:opts.cookie?'':'?sync='+secret,cookie:opts.cookie?'night_notes_install_v1='+secret:null,storage:opts.storage||{},standalone:true});
 return Object.assign(h,{release,counts:()=>({reads,writes}),serverIDs:async()=>Array.from((await h.w.audit.decryptSharedState(secret,server)).budget.transactions,t=>t.id),remoteCalls});
}
async function test(name,fn,opts){const h=await setup(opts);try{await fn(h);assert.equal(h.errors.length,0,h.errors.join('\n'));results.push({area:'sync',name,status:'PASS'});}catch(e){results.push({area:'sync',name,status:'FAIL',detail:e.message});}finally{h.release?.();await delay();h.close();}}
(async()=>{
await test('Fresh installation downloads existing data without upload',async h=>{await delay();assert.equal(h.w.audit.state.budget.transactions[0].id,'old');assert.equal(h.counts().writes,0);});
await test('Fresh browser loads renamed default shopping list without a false conflict',async h=>{
 await delay();assert.equal(h.w.audit.state.budget.transactions[0].id,'old');
 assert.equal(h.w.audit.state.shoppingLists[0].name,'QA renamed list');
 assert.equal(h.w.localStorage.getItem('night-notes-sync-conflict-v1'),null);
 assert.equal(h.counts().writes,0);assert(h.$('#syncAccount').classList.contains('is-synced'));
},{remoteState:{dailyInspirationArchiveStart:'2001-01-01',shoppingLists:[{id:'main',name:'QA renamed list',items:[]}]}});
await test('Home-screen cookie reconnects without URL or localStorage',async h=>{await delay();assert.equal(h.w.audit.state.budget.transactions[0].id,'old');assert.equal(h.$('#installRecovery').hidden,true);},{cookie:true});
await test('Pending offline save survives reload and uploads',async h=>{await delay();assert.deepEqual(await h.serverIDs(),['old','new']);assert.equal(h.w.localStorage.getItem('night-notes-pending-sync-v1'),null);},{storage:{'night-notes-v1':JSON.stringify(book(['old','new'])),'night-notes-pending-sync-v1':JSON.stringify({target,revision:1})}});
await test('Failed upload keeps durable pending marker and local data',async h=>{await delay();assert(h.w.localStorage.getItem('night-notes-pending-sync-v1'));assert.equal(h.w.audit.state.budget.transactions.length,2);},{failWrite:true,storage:{'night-notes-v1':JSON.stringify(book(['old','new'])),'night-notes-pending-sync-v1':JSON.stringify({target,revision:1})}});
await test('Failed download must not overwrite server',async h=>{await delay();assert.equal(h.counts().writes,0);assert.deepEqual(await h.serverIDs(),['old']);},{failRead:true});
await test('Authentication callback must not claim success after failed download',async h=>{await delay();assert(!h.$('#syncAccount').classList.contains('is-synced'));},{failRead:true,authEvent:true});
await test('First-download race preserves previous remote entries',async h=>{h.w.audit.state.budget.transactions.push(book(['new']).budget.transactions[0]);h.w.audit.save();h.release();await delay();assert.deepEqual(await h.serverIDs(),['old','new']);},{hold:true});
await test('Empty pending snapshot cannot erase server data',async h=>{await delay();assert.deepEqual(await h.serverIDs(),['old']);},{storage:{'night-notes-v1':JSON.stringify(book([])),'night-notes-pending-sync-v1':JSON.stringify({target,revision:1})}});
await test('Empty remote cannot silently erase nonempty local data',async h=>{await delay();assert.equal(h.w.audit.state.budget.transactions.length,1);},{remote:[],storage:{'night-notes-v1':JSON.stringify(book(['old']))}});
await test('Private URL opens its notebook despite unrelated email session',async h=>{await delay();assert.equal(h.w.audit.state.budget.transactions[0]?.id,'old');},{session:true});
await test('Different-target pending data is protected',async h=>{await delay();assert.equal(h.counts().writes,0);assert.equal(h.w.audit.state.budget.transactions[0].id,'local');assert.match(h.$('#syncAccount').title,/другого блокнота/);},{storage:{'night-notes-v1':JSON.stringify(book(['local'])),'night-notes-pending-sync-v1':JSON.stringify({target:'shared:other',revision:1})}});
await test('Background event on clean device does not upload stale snapshot',async h=>{await delay();Object.defineProperty(h.w.document,'visibilityState',{value:'hidden'});h.event(h.w.document,'visibilitychange');await delay();assert.equal(h.counts().writes,0);});
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;fs.writeFileSync(__dirname+'/sync-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})();
