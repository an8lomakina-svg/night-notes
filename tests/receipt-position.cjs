const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await boot();try{
 const word=(text,x0,y0,x1,y1)=>({text,bbox:{x0,y0,x1,y1}});
 const words=[word('Taxi',150,100,240,130),word('Go',250,100,290,130),word('123456',450,100,580,130),word('1.234,50',950,100,1150,145),word('29.10.2026',150,155,340,185),word('RSD',1080,160,1150,190),word('(T)',30,100,130,190),word('Shop',150,250,240,280),word('2000',250,250,330,280),word('450,00',990,250,1150,295),word('NOVI',150,300,240,330),word('SAD',250,300,320,330),word('RSD',1080,310,1150,340),word('(S)',30,250,130,340),word('28.10.2026',150,350,340,380)];
 const data={text:'Taxi Go 123456 1.234,50\n29.10.2026 RSD\nShop 2000 450,00\nNOVI SAD RSD\n28.10.2026',words};
 const rows=h.w.extractReceiptOcr(data);assert.equal(rows.length,2);assert.equal(rows[0].name,'Taxi Go');assert.equal(rows[1].name,'Shop 2000 NOVI SAD');assert.equal(rows[0].amount,1234.5);assert.equal(rows[1].date,'2026-10-28');
 assert.equal(h.w.extractReceiptOcr({text:'Coffee -10 EUR'}).length,1);
 assert.equal(h.w.extractReceiptOcr({text:'Coffee -10 EUR',words:[{text:'bad',bbox:{}}]}).length,1);
 assert.deepEqual(h.errors,[]);console.log('PASS OCR coordinates separate icons, terminal codes, multiline merchant names and preserve legacy imports');
}finally{h.close()}})().catch(e=>{console.error(e);process.exitCode=1});
