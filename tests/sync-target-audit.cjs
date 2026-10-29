const {boot}=require('./harness.cjs');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');
const secret=Buffer.alloc(32,17).toString('base64url');
const tx=id=>({id,name:id,amount:10,type:'expense',currency:'EUR',date:'2026-10-29',category:'Продукты'});
const book=ids=>({budget:{transactions:ids.map(tx),categorySchema:'2026-10-v3'},events:{},imports:[],notes:[],tasks:[],archive:[],shoppingLists:[{id:'main',name:'QA',items:[]}],plans:{dream:[],next:[],done:[]},health:{done:[],todo:[]}});
async function encrypt(state){const iv=webcrypto.getRandomValues(new Uint8Array(12)),key=await webcrypto.subtle.importKey('raw',Buffer.from(secret,'base64url'),{name:'AES-GCM'},false,['encrypt']);return {iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(state)))).toString('base64url')};}
(async()=>{
let remote=await encrypt(book(['B-remote'])),writes=0;
const client={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},rpc:async(name,args)=>{if(name==='get_shared_notebook')return {data:remote};writes++;remote=args.p_payload;return {};}};
const h=await boot({client,query:'?sync='+secret,storage:{'night-notes-v1':JSON.stringify(book(['A-unsent-private'])),'night-notes-pending-sync-v1':JSON.stringify({target:'shared:ANOTHER-NOTEBOOK',revision:1})}});
try{await new Promise(r=>setTimeout(r,150));const server=await h.w.audit.decryptSharedState(secret,remote);const result={writesToNotebookB:writes,serverBIDs:Array.from(server.budget.transactions,t=>t.id),localIDs:Array.from(h.w.audit.state.budget.transactions,t=>t.id),status:h.$('#notebookSaveStatus').textContent,errors:h.errors};require('node:assert/strict').equal(writes,0);require('node:assert/strict').deepEqual(result.serverBIDs,['B-remote']);console.log('Notebook isolation regression passed');fs.writeFileSync(__dirname+'/sync-target-audit-results.json',JSON.stringify(result,null,2));}finally{h.close();}
})();
