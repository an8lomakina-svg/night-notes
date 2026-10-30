const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{
const h=await boot();try{
 const choose=(from,to)=>{h.set('#transactionType','transfer');h.set('#transferFrom',from);h.set('#transferTo',to);h.set('#transactionAmount','100');};
 const submit=()=>h.event(h.$('#budgetForm'),'submit');
 const records=()=>h.w.audit.state.budget.transactions;
 choose('am-eur','rs-rsd');assert(h.$('#budgetConverter').hidden);assert(!h.$('#transferRateField').hidden);h.set('#transferRate','117,5');assert.match(h.$('#transferRatePreview').textContent,/11.*750/);submit();
 assert.equal(records().length,1);assert.equal(records()[0].exchangeRate,117.5);assert.equal(records()[0].toAmount,11750);assert.equal(records()[0].currency,'EUR');assert.equal(records()[0].toCurrency,'RSD');assert.equal(records()[0].type,'transfer');
 assert.equal(h.$('#expenseTotal').textContent,h.$('#incomeTotal').textContent);
 assert.match(h.$('.transaction-conversion').textContent,/117.5/);
 let ed=h.$('.transaction-editor');ed.elements.amount.value='200';ed.elements.exchangeRate.value='118';h.event(ed,'submit');assert.equal(records()[0].toAmount,23600);
 ed=h.$('.transaction-editor');ed.elements.exchangeRate.value='';h.event(ed,'submit');assert.equal(records()[0].toAmount,undefined);assert.equal(records()[0].exchangeRate,undefined);
 choose('rs-rsd','am-amd');assert.equal(h.$('#transferTo').value,'am-amd');h.set('#transferRate','');submit();assert.equal(records().length,2);assert.equal(records()[1].exchangeRate,undefined);assert.equal(records()[1].toAmount,undefined);
 choose('am-eur','rs-rsd');for(const bad of ['0','-1','NaN','1e999','abc']){h.set('#transferRate',bad);submit();assert.equal(records().length,2);}
 h.set('#transferRate','117.5');h.set('#transferTo','am-amd');assert.equal(h.$('#transferRate').value,'');
 choose('am-eur','rs-eur');assert(h.$('#transferRateField').hidden);submit();assert.equal(records().length,3);assert.equal(records()[2].toAmount,100);assert.equal(records()[2].exchangeRate,undefined);
 h.set('#transactionType','expense');assert(h.$('#transferRateField').hidden);
 const saved=JSON.parse(h.w.localStorage.getItem('night-notes-v1'));assert.equal(saved.budget.transactions.length,3);assert.deepEqual(h.errors,[]);
 const next=await boot({storage:{'night-notes-v1':JSON.stringify(saved)}});try{assert.equal(next.w.audit.state.budget.transactions.length,3);assert.deepEqual(next.errors,[]);}finally{next.close();}
 console.log('PASS optional exchange rate, decimal comma, cross-currency targets, editing, validation, unchanged totals and reload');
}finally{h.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
