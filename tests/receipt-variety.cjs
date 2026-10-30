const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await boot();try{
 for(const [raw,expected] of [['2,000.00',2000],['2.000,00',2000],['2.000.00',2000],['0,02',.02],['-20,272.50',-20272.5]])assert.equal(h.w.receiptDecimal(raw),expected);
 assert.equal(h.w.receiptDecimal('11.60675'),null);assert.equal(h.w.receiptMonthDate('30 Октябрь 2026'),'2026-10-30');
 const row={name:'Coffee Shop',amount:1.99,currency:'EUR',date:'2026-10-29',type:'expense',selected:true};
 let rows=h.w.markReceiptDuplicates([{...row},{...row}],[]);assert(rows[0].selected);assert(!rows[1].selected);assert.match(rows[1].warning,/повтор/);
 rows=h.w.markReceiptDuplicates([{...row}],[{...row,name:'COFFEE SHOP'}]);assert(!rows[0].selected);
 rows=h.w.markReceiptDuplicates([{...row,time:'09:00'},{...row,time:'10:00'},{...row,date:'2026-10-28'},{...row,type:'income'}],[]);assert(rows.every(x=>x.selected));
 const word=(text,x0,y0,x1,y1)=>({text,bbox:{x0,y0,x1,y1}});
 const d={text:'Mastercard EUR\n30 Октябрь 2026',lines:[{text:'30 Октябрь 2026',bbox:{y0:600}}],words:[word('Shop',245,800,400,840),word('-2,000.00',840,800,1040,842),word('€',1055,800,1080,840),word('Незавершенные',780,880,1080,920)]};
 rows=h.w.extractReceiptOcr(d);assert.equal(rows.length,1);assert.equal(rows[0].amount,2000);assert.equal(rows[0].date,'2026-10-30');assert(!rows[0].selected);assert(!rows[0].word);assert(!rows[0].crop);
 assert.deepEqual(h.errors,[]);console.log('PASS number formats, date headers, pending operations, duplicate warnings, distinct times and safe record fields');
}finally{h.close()}})().catch(e=>{console.error(e);process.exitCode=1});
