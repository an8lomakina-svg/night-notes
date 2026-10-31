const {boot}=require('./harness.cjs'),assert=require('node:assert/strict');
(async()=>{const h=await boot();try{
 assert.equal(h.$('#budgetPeriod').value,'salary-current');assert.equal(h.w.selectedBudgetPeriod().from,'');
 const tx=h.w.audit.state.budget.transactions;const add=(id,date,type,category,amount=100)=>tx.push({id,name:id,date,type,category,amount,currency:'RSD'});
 add('salary1','2020-01-28','income','Зарплата');add('early','2020-01-27','expense','Такси');add('first','2020-01-28','expense','Такси');add('end','2020-02-26','expense','Продукты');add('salary2','2020-02-27','income','Зарплата');add('new','2020-02-27','expense','Такси');add('refund','2020-03-01','income','Возврат');h.w.audit.renderBudget();
 assert.equal(h.w.selectedBudgetPeriod().from,'2020-02-27');assert.equal(h.w.budgetTransactionsForSelectedPeriod().length,3);
 h.set('#chartPeriod','salary:2020-01-28');assert.equal(h.w.selectedBudgetPeriod().to,'2020-02-26');assert.equal(h.w.budgetTransactionsForSelectedPeriod().length,3);
 h.set('#chartPeriod','salary-current');add('salary3','2020-03-05','income','Зарплата');h.w.audit.renderBudget();assert.equal(h.w.selectedBudgetPeriod().from,'2020-03-05');
 tx.splice(tx.findIndex(x=>x.id==='salary3'),1);h.w.audit.renderBudget();assert.equal(h.w.selectedBudgetPeriod().from,'2020-02-27');
 add('same-day','2020-02-27','income','Зарплата');assert.equal(h.w.salaryPeriods().length,2);
 h.$('[data-budget-pane="expenses"]').click();assert.equal(h.$('#budget').dataset.budgetPane,'expenses');const visible=[...h.w.document.querySelectorAll('#transactionList .transaction')].filter(r=>!r.hidden);assert.equal(visible.length,1);assert.match(visible[0].textContent,/new/);
 h.$('[data-budget-pane="overview"]').click();assert.equal(h.$('#budget').dataset.budgetPane,'overview');assert.equal(tx.length,8);assert.deepEqual(h.errors,[]);
 console.log('PASS salary default, variable pay dates, previous period boundaries, refunds, same-day salary, additions/deletion and expense pane');
}finally{h.close()}})().catch(e=>{console.error(e);process.exitCode=1});
