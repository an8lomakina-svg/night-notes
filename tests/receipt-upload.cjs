const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{
 const h=await boot();try{
  const input=h.$('#receiptImportImage'),button=h.$('#receiptImportButton');
  assert.equal(input.hasAttribute('capture'),false);
  assert.equal(input.accept,'image/*');
  let clicks=0;input.click=()=>clicks++;button.click();assert.equal(clicks,1);
  let calls=0;h.w.Tesseract={recognize:async()=>{calls++;return {data:{text:'Coffee -10 EUR'}}}};
  const choose=async(file)=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});h.event(input,'change');await new Promise(r=>setTimeout(r,10));};
  const photo=new h.w.File(['image'],'screenshot.PNG',{type:'image/png'});
  await choose(photo);assert.equal(calls,1);assert.equal(h.w.document.querySelectorAll('.receipt-import-row').length,1);
  assert.equal(h.w.audit.state.budget.transactions.length,0);
  await choose(photo);assert.equal(calls,2);
  await choose(new h.w.File(['image'],'screenshot.png'));assert.equal(calls,3);
  await choose(new h.w.File(['text'],'notes.txt'));assert.equal(calls,3);assert(h.$('#receiptImportSave').disabled);
  h.$('#receiptImportSave').click();assert.equal(h.w.audit.state.budget.transactions.length,0);
  delete h.w.Tesseract;
  const load=h.w.loadReceiptOcr();h.w.document.querySelector('script[src*=tesseract]').dispatchEvent(new h.w.Event('error'));
  await assert.rejects(load);assert.equal(h.w.receiptOcrLoading,null);
  const retry=h.w.loadReceiptOcr();const scripts=h.w.document.querySelectorAll('script[src*=tesseract]');assert.equal(scripts.length,2);
  h.w.Tesseract={recognize:async()=>({data:{text:'Coffee -10 EUR'}})};scripts[1].dispatchEvent(new h.w.Event('load'));await retry;
  await choose(photo);h.$('#receiptImportSave').click();assert.equal(h.w.audit.state.budget.transactions.length,1);
  assert.deepEqual(h.errors,[]);
  console.log('PASS screenshot picker, repeated selection, missing MIME, invalid-file safety, OCR retry, reviewed import');
 }finally{h.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
