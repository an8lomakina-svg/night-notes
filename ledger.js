(() => {
  const form = document.querySelector('#budgetForm');
  if (!form) return;
  const $ = (selector) => document.querySelector(selector);
  const storageKey = 'night-notes-v1';
  const read = () => JSON.parse(localStorage.getItem(storageKey) || 'null') || {};
  const write = (value) => localStorage.setItem(storageKey, JSON.stringify(value));
  const today = () => new Date().toISOString().slice(0, 10);
  const money = (amount, code) => new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: code, maximumFractionDigits: code === 'EUR' ? 2 : 0
  }).format(amount || 0);
  const type = $('#transactionType');
  const name = $('#transactionName');
  const amount = $('#transactionAmount');
  const category = $('#transactionCategory');
  amount.placeholder = 'Сумма';
  amount.step = '0.01';

  const currency = document.createElement('select');
  currency.id = 'transactionCurrency';
  currency.setAttribute('aria-label', 'Валюта');
  currency.innerHTML = '<option value="RSD">RSD · динары</option><option value="EUR">EUR · евро</option><option value="RUB">RUB · рубли</option>';
  const date = document.createElement('input');
  date.id = 'transactionDate';
  date.type = 'date';
  date.setAttribute('aria-label', 'Дата операции');
  date.value = today();
  category.insertAdjacentElement('afterend', currency);
  currency.insertAdjacentElement('afterend', date);

  const chartPanel = $('#budgetChart').closest('.utility-card');
  const filter = document.createElement('select');
  filter.id = 'budgetCurrencyFilter';
  filter.className = 'budget-filter';
  filter.setAttribute('aria-label', 'Валюта диаграммы');
  filter.innerHTML = '<option value="RSD">RSD · динары</option><option value="EUR">EUR · евро</option><option value="RUB">RUB · рубли</option>';
  chartPanel.querySelector('.utility-heading').append(filter);

  const colors = ['#c87532','#ddb06b','#9aa881','#b9765e','#9f8aa0','#7f9eab','#b8a596'];
  const refresh = () => {
    const state = read();
    const entries = state.budget?.transactions || [];
    const code = (entry) => entry.currency || 'RUB';
    const sums = (kind) => entries.filter(entry => entry.type === kind).reduce((all, entry) => {
      all[code(entry)] = (all[code(entry)] || 0) + Number(entry.amount || 0);
      return all;
    }, {});
    const show = (values) => Object.entries(values).map(([key, value]) => money(value, key)).join(' · ') || '—';
    const income = sums('income');
    const expense = sums('expense');
    const balance = {};
    new Set([...Object.keys(income), ...Object.keys(expense)]).forEach(key => balance[key] = (income[key] || 0) - (expense[key] || 0));
    $('#incomeTotal').textContent = show(income);
    $('#expenseTotal').textContent = show(expense);
    $('#balanceTotal').textContent = show(balance);

    const selected = filter.value;
    const spending = entries.filter(entry => entry.type === 'expense' && code(entry) === selected);
    const pieces = spending.reduce((all, entry) => {
      all[entry.category || 'Другое'] = (all[entry.category || 'Другое'] || 0) + Number(entry.amount || 0);
      return all;
    }, {});
    const total = spending.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    let position = 0;
    const stops = Object.entries(pieces).map(([label, value], index) => {
      const part = total ? value / total * 100 : 0;
      const result = colors[index % colors.length] + ' ' + position + '% ' + (position + part) + '%';
      position += part;
      return result;
    });
    const chart = $('#budgetChart');
    chart.style.background = total ? 'conic-gradient(' + stops.join(',') + ')' : 'conic-gradient(#eadfce 0 100%)';
    chart.innerHTML = '<span>' + money(total, selected) + '<small>расходы</small></span>';
    const legend = $('#chartLegend');
    legend.innerHTML = '';
    Object.entries(pieces).forEach(([label, value], index) => {
      const row = document.createElement('div');
      row.innerHTML = '<i></i><span></span><strong></strong>';
      row.querySelector('i').style.background = colors[index % colors.length];
      row.querySelector('span').textContent = label;
      row.querySelector('strong').textContent = money(value, selected);
      legend.append(row);
    });

    const list = $('#transactionList');
    list.innerHTML = entries.length ? '' : '<p class="empty">Здесь появятся отдельные операции по всем счетам.</p>';
    [...entries].reverse().forEach(entry => {
      const row = document.createElement('div');
      row.className = 'transaction';
      row.innerHTML = '<div><strong></strong><small></small></div><span></span><button class="delete" aria-label="Удалить запись">×</button>';
      row.querySelector('strong').textContent = entry.name;
      row.querySelector('small').textContent = (entry.date || 'без даты') + ' · ' + (entry.category || 'Другое');
      const value = row.querySelector('span');
      value.textContent = (entry.type === 'income' ? '+ ' : '− ') + money(entry.amount, code(entry));
      value.className = entry.type;
      row.querySelector('.delete').onclick = () => {
        const fresh = read();
        fresh.budget.transactions = (fresh.budget?.transactions || []).filter(item => item.id !== entry.id);
        write(fresh);
        refresh();
      };
      list.append(row);
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!name.value.trim() || !Number(amount.value)) return;
    const state = read();
    state.budget ??= { transactions: [] };
    state.budget.transactions.push({
      id: Date.now(), name: name.value.trim(), amount: Number(amount.value), type: type.value,
      category: category.value, currency: currency.value, date: date.value
    });
    write(state);
    name.value = '';
    amount.value = '';
    date.value = today();
    refresh();
  }, true);
  filter.addEventListener('change', refresh);
  refresh();
})();