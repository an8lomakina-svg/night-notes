const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await boot();try{
 const parse=text=>h.w.extractReceiptTransactions(text);
 const rows=parse('29.10.2026 RSD\nTaxi 123456 RS 1.234,50\n(T) 29.10.2026 RSD\nShop 2000 - NOVI 4.500,00\n(S) SAD RS RSD\n28.10.2026\nTaxi RS 75,10\n28.10.2026 RSD');
 assert.equal(rows.length,3);assert.deepEqual(Array.from(rows,x=>x.amount),[1234.5,4500,75.1]);assert.deepEqual(Array.from(rows,x=>x.date),['2026-10-29','2026-10-28','2026-10-28']);assert.equal(rows[1].name,'Shop 2000 - NOVI SAD RS');assert(rows.every(x=>x.currency==='RSD'));
 assert.equal(parse('29.10.2026 RSD').length,0);
 assert.equal(parse('Taxi RS 75,10\n28.10.2026 RSD\nTaxi RS 75,10\n28.10.2026 RSD').length,2);
 assert.equal(parse('Coffee -10 EUR')[0].amount,10);
 assert.equal(parse('Coffee -10 EUR')[0].type,'expense');
 assert.equal(parse('Salary +2000 EUR')[0].type,'income');
 assert.equal(parse('Taxi 123456 RS 75,10').length,0);
 assert.equal(parse('Taxi RS 75,10\n28.10.2026 RSD\nCoffee -10 EUR').length,2);
 assert.deepEqual(h.errors,[]);console.log('PASS multiline bank rows, dates, thousands, merchant digits, repeated payments and legacy format');
}finally{h.close();}})().catch(e=>{console.error(e);process.exitCode=1});
