const $ = (s) => document.querySelector(s);
// Google Finance quotes: units of each currency per 1 EUR. Quote dates are explicit.
const generalChartRates = { EUR: 1, RSD: 117.5, RUB: 91.3471, AMD: 407 };
const generalChartQuoteDates = { RSD: '23.10.2026', RUB: '24.10.2026', AMD: '16.10.2026' };
function budgetChartIncludes(item, selected) {
  return item.type === 'expense' && (selected === 'ALL' || (item.currency || 'RUB') === selected);
}
function budgetChartExpenses(transactions, selected) {
  return transactions.filter(item => budgetChartIncludes(item, selected)).map(item => ({
    ...item, amount: selected === 'ALL' ? item.amount / generalChartRates[item.currency || 'RUB'] : item.amount
  }));
}
function renderGeneralChartNote(selected) {
  let note = $('#budgetGeneralRateNote');
  if (!note) {
    note = document.createElement('p');
    note.id = 'budgetGeneralRateNote';
    note.className = 'budget-euro-overview-note';
    $('#budgetCurrencyFilter').closest('.utility-heading').after(note);
  }
  note.hidden = selected !== 'ALL';
  note.textContent = 'Все расходы в EUR · сохранённые котировки Google Finance. 1 € = ' +
    ['RSD', 'RUB', 'AMD'].map(code => `${generalChartRates[code]} ${code} (${generalChartQuoteDates[code]})`).join(' · ');
}

const state = JSON.parse(localStorage.getItem('night-notes-v1') || 'null') || {
  focus: '', tasks: [{ id: 1, text: 'Прогуляться без наушников', done: false }, { id: 2, text: 'Разобрать одну важную вещь', done: false }],
  plans: { dream: ['Увидеть осенний Нью-Йорк'], next: ['Собрать блокнот под себя'], done: [] }, events: {}, imports: []
};
const BACKUP_FORMAT = 'night-notes-backup-v1';
const downloadBackup = () => {
  const payload = { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `night-notes-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
};
$('#exportData')?.addEventListener('click', downloadBackup);
$('#importData')?.addEventListener('click', () => $('#dataFileInput')?.click());
$('#dataFileInput')?.addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parsed?.format === BACKUP_FORMAT ? parsed.state : parsed;
    if (!imported || typeof imported !== 'object' || !imported.budget || !Array.isArray(imported.budget.transactions) || !imported.events || typeof imported.events !== 'object') throw new Error('invalid');
    if (!confirm('Загрузить данные из файла? Текущие записи на этом устройстве будут заменены.')) return;
    localStorage.setItem('night-notes-v1', JSON.stringify(imported)); location.reload();
  } catch { alert('Не удалось прочитать файл блокнота. Выбери JSON, скачанный кнопкой ⇩.'); }
  event.target.value = '';
});
state.focus ??= '';
state.tasks ??= [];
state.plans ??= { dream: [], next: [], done: [] };
state.plans.dream ??= [];
state.plans.next ??= [];
state.plans.done ??= [];
state.events ??= {};
state.imports ??= [];
state.archive ??= [];
state.notes ??= [];
state.hiddenGoogleEvents ??= [];
state.selfCareDaily ??= {};
const SYNC_CONFIG = { url: 'https://ucwiohxqtmdzlsboveie.supabase.co', key: 'sb_publishable_MACL1sYFp5rUQAkB26M4kQ_Bys6WsD1' };
let cloudClient = null, cloudUser = null, cloudSyncTimer = null, cloudHydrating = false;
let sharedSync = null, sharedSyncTimer = null, sharedHydrating = false;
let selectedDate = new Date(); selectedDate.setHours(0,0,0,0); let month = new Date(selectedDate);
const save = () => { localStorage.setItem('night-notes-v1', JSON.stringify(state)); renderArchive(); queueCloudSave(); queueSharedSave(); };
function setSyncStatus(message, synced = false) { const button = $('#syncAccount'); if (!button) return; button.classList.toggle('is-synced', synced); button.title = message; button.setAttribute('aria-label', message); }
function queueCloudSave() { if (!cloudClient || !cloudUser || cloudHydrating) return; clearTimeout(cloudSyncTimer); cloudSyncTimer = setTimeout(pushCloudState, 650); }
async function pushCloudState() { if (!cloudClient || !cloudUser) return; const { error } = await cloudClient.from('notebook_state').upsert({ user_id: cloudUser.id, payload: state, updated_at: new Date().toISOString() }); if (error) setSyncStatus('Ошибка синхронизации'); else setSyncStatus(`Автосинхронизация включена: ${cloudUser.email || 'твой аккаунт'}`, true); }

const SHARED_SECRET_KEY = 'night-notes-shared-secret-v1';
const bytesToBase64 = bytes => btoa(String.fromCharCode(...bytes));
const base64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const base64UrlEncode = bytes => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64UrlDecode = value => base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
const newSharedSecret = () => base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
async function sharedId(secret) {
  const digest = await crypto.subtle.digest('SHA-256', base64UrlDecode(secret));
  return base64UrlEncode(new Uint8Array(digest));
}
async function sharedKey(secret) {
  return crypto.subtle.importKey('raw', base64UrlDecode(secret), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptSharedState(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sharedKey(secret), new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(new Uint8Array(encrypted)), updatedAt: new Date().toISOString() };
}
async function decryptSharedState(secret, payload) {
  if (!payload?.ciphertext || !payload?.iv) return null;
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(payload.iv) }, await sharedKey(secret), base64UrlDecode(payload.ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted));
}
function sharedSecretFromLocation() {
  // Home-screen web apps on iOS can drop the URL fragment when they are
  // created from Safari. Keep the secret in the query string as the primary
  // transport, while retaining hash links for backwards compatibility.
  const querySecret = new URLSearchParams(window.location.search).get('sync');
  if (querySecret) return querySecret;
  const match = window.location.hash.match(/(?:^#|&)sync=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : localStorage.getItem(SHARED_SECRET_KEY);
}
async function ensureSharedSync() {
  if (!cloudClient) return null;
  if (!sharedSync) {
    const secret = sharedSecretFromLocation() || newSharedSecret();
    localStorage.setItem(SHARED_SECRET_KEY, secret);
    sharedSync = { secret, id: await sharedId(secret) };
  }
  return sharedSync;
}
function queueSharedSave() {
  if (!cloudClient || !sharedSync || sharedHydrating) return;
  clearTimeout(sharedSyncTimer);
  sharedSyncTimer = setTimeout(pushSharedState, 700);
}
async function pushSharedState() {
  if (!cloudClient || !sharedSync || sharedHydrating) return false;
  const payload = await encryptSharedState(sharedSync.secret, state);
  const { error } = await cloudClient.rpc('save_shared_notebook', { p_sync_id: sharedSync.id, p_payload: payload });
  if (error) {
    setSyncStatus('Ошибка приватной синхронизации');
    return false;
  }
  setSyncStatus('Приватная ссылка синхронизирована', true);
  return true;
}
async function hydrateSharedState() {
  if (!cloudClient || !sharedSync) return;
  sharedHydrating = true;
  setSyncStatus('Загружаю общий блокнот…');
  const { data, error } = await cloudClient.rpc('get_shared_notebook', { p_sync_id: sharedSync.id });
  if (error) {
    sharedHydrating = false;
    setSyncStatus('Ошибка приватной синхронизации');
    if (syncMessage) syncMessage.textContent = 'Не удалось открыть приватную ссылку. Попробуй обновить страницу.';
    return;
  }
  const localSnapshot = JSON.parse(JSON.stringify(state));
  let remoteState = null;
  try { remoteState = data ? await decryptSharedState(sharedSync.secret, data) : null; } catch { remoteState = null; }
  // A private link represents one shared notebook. Its remote copy is always
  // authoritative, including when it is intentionally empty after a cleanup.
  // This prevents an older browser cache from restoring deleted entries.
  if (remoteState) {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, remoteState);
    normalizeCloudState();
    localStorage.setItem('night-notes-v1', JSON.stringify(state));
    renderCloudState();
  } else {
    await pushSharedState();
  }
  sharedHydrating = false;
  setSyncStatus('Приватная ссылка синхронизирована', true);
  if (syncMessage) syncMessage.textContent = 'Общий блокнот подключён. Все изменения шифруются в браузере.';
}
const archiveRecord=(record)=>state.archive.unshift({id:`archive-${Date.now()}-${Math.random().toString(16).slice(2)}`,archivedAt:new Date().toISOString(),...record});
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const niceDate = (d) => new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(d);
const selfCareTips={
  mind:[
    '3 минуты без экрана: спокойно подыши и назови 3 вещи, которые видишь вокруг.',
    'Запиши одну тревожную мысль и один маленький шаг, который сегодня в твоих силах.',
    'Выйди на свет и пройдись 5–10 минут без телефона.',
    'Проверь базу: вода, еда, сон — выбери одну вещь, которой сейчас не хватает.'
  ],
  body:[
    'Проверь экран: верх монитора примерно на уровне глаз, плечи мягко опущены.',
    'Сделай 5 спокойных кругов плечами и встань на 2 минуты — только без боли.',
    'Отведи взгляд от экрана на 20 секунд и расслабь челюсть.',
    'Поставь таймер на 45 минут: встань, пройдись и налей воды.'
  ]
};
const addDailySelfCare=()=>{
  const key=dateKey(new Date());
  if(state.selfCareDaily[key]||state.tasks.some(task=>task.selfCareDate===key))return;
  const pick=list=>list[Math.floor(Math.random()*list.length)];
  const tips=[pick(selfCareTips.mind),pick(selfCareTips.body)];
  tips.forEach((tip,index)=>state.tasks.push({id:`self-care-${key}-${index}-${Date.now()}`,text:`Забота о себе · ${tip}`,done:false,selfCareDate:key}));
  state.selfCareDaily[key]=true;
  save();
};
$('#dateLine').textContent = niceDate(new Date()).toUpperCase();
$('#focusInput').value = state.focus;
$('#focusInput').addEventListener('input', e => { state.focus = e.target.value; save(); $('#focusState').textContent = 'СОХРАНЕНО'; setTimeout(()=>$('#focusState').textContent='СОХРАНЯЕТСЯ АВТОМАТИЧЕСКИ', 1400); });
$('#archiveFocus').onclick=()=>{const text=state.focus.trim();if(!text)return;archiveRecord({type:'ФОКУС ДНЯ',text,source:'focus',payload:{text}});state.focus='';$('#focusInput').value='';save();$('#focusState').textContent='В АРХИВЕ';setTimeout(()=>$('#focusState').textContent='СОХРАНЯЕТСЯ АВТОМАТИЧЕСКИ',1400)};
$('#clearFocus').onclick=()=>{state.focus='';$('#focusInput').value='';save();$('#focusState').textContent='ФОКУС УДАЛЁН';setTimeout(()=>$('#focusState').textContent='СОХРАНЯЕТСЯ АВТОМАТИЧЕСКИ',1400)};
function renderTasks(){ const list=$('#taskList'); list.innerHTML=''; const tpl=$('#taskTemplate'); state.tasks.forEach(task=>{const n=tpl.content.cloneNode(true);const el=n.querySelector('.task');el.classList.toggle('done',task.done);n.querySelector('.task-text').textContent=task.text;n.querySelector('.checkbox').onclick=()=>{task.done=!task.done;save();renderTasks()};n.querySelector('.archive-action').onclick=()=>{archiveRecord({type:'ЗАДАЧА',text:task.text,source:'task',payload:{...task}});state.tasks=state.tasks.filter(t=>t.id!==task.id);save();renderTasks()};n.querySelector('.delete').onclick=()=>{state.tasks=state.tasks.filter(t=>t.id!==task.id);save();renderTasks()};list.append(n)}); $('#taskProgress').textContent=`${state.tasks.filter(t=>t.done).length} / ${state.tasks.length}`; }
$('#addTaskForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#taskInput');if(!input.value.trim())return;state.tasks.push({id:Date.now(),text:input.value.trim(),done:false});input.value='';save();renderTasks()});renderTasks();
function renderPlans(){
  document.querySelectorAll('.plan-column').forEach(col=>{
    const key=col.dataset.plan, box=col.querySelector('.plan-items'), form=col.querySelector('.plan-compose'), field=form?.querySelector('input');
    box.innerHTML='';
    state.plans[key].forEach((text,i)=>{
      const el=document.createElement('div'); el.className='plan-item';
      const input=document.createElement('input'); input.value=text; input.className='plan-item-input'; input.setAttribute('aria-label',`Редактировать: ${text}`);
      const commit=()=>{const value=input.value.trim(); if(!value)state.plans[key].splice(i,1); else state.plans[key][i]=value; save(); renderPlans()};
      input.onblur=commit; input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();input.blur()}};
      const archive=document.createElement('button'); archive.type='button'; archive.className='archive-action'; archive.textContent='В архив'; archive.setAttribute('aria-label',`Архивировать: ${text}`); archive.onclick=()=>{const value=input.value.trim()||text;archiveRecord({type:'ПЛАН',text:value,source:'plan',payload:{key,text:value}});state.plans[key].splice(i,1);save();renderPlans()};
      const del=document.createElement('button'); del.type='button'; del.className='delete'; del.textContent='×'; del.setAttribute('aria-label',`Удалить: ${text}`); del.onclick=()=>{state.plans[key].splice(i,1);save();renderPlans()};
      el.append(input,archive,del); box.append(el);
    });
    if(form&&field) form.onsubmit=e=>{e.preventDefault();const text=field.value.trim();if(!text)return;state.plans[key].push(text);field.value='';save();renderPlans()};
    else {
      const legacy=col.querySelector('.plan-add');
      if(legacy){
        const inlineForm=document.createElement('form');inlineForm.className='plan-compose';
        const inlineField=document.createElement('input');inlineField.autocomplete='off';inlineField.placeholder=key==='dream'?'Добавить мысль…':key==='next'?'Добавить шаг…':'Отметить победу…';inlineField.setAttribute('aria-label',inlineField.placeholder);
        const inlineButton=document.createElement('button');inlineButton.type='submit';inlineButton.className='add-button';inlineButton.setAttribute('aria-label','Добавить запись');inlineButton.textContent='+';
        inlineForm.append(inlineField,inlineButton);legacy.replaceWith(inlineForm);
        inlineForm.onsubmit=e=>{e.preventDefault();const text=inlineField.value.trim();if(!text)return;state.plans[key].push(text);inlineField.value='';save();renderPlans()};
      }
    }
  });
}
renderPlans();
const activateView = (viewName, shouldScroll = false) => {
  const view = document.getElementById(viewName) ? viewName : 'today';
  document.querySelectorAll('.nav-link,.view').forEach(element => element.classList.remove('active'));
  document.querySelector(`.nav-link[data-view="${view}"]`)?.classList.add('active');
  $(`#${view}`)?.classList.add('active');
  if (view === 'calendar') renderCalendar();
  if (shouldScroll) window.scrollTo({top:0,behavior:'smooth'});
};
document.querySelectorAll('.nav-link').forEach(button => button.onclick = () => activateView(button.dataset.view, true));
activateView(window.location.hash.slice(1));
window.addEventListener('hashchange', () => activateView(window.location.hash.slice(1)));

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const googleCalendar = { clientId: localStorage.getItem('night-notes-google-client-id') || '', accessToken: null, tokenClient: null, syncing: false };
const clientIdInput = $('#googleCalendarClientId');
const connectGoogleCalendar = $('#connectGoogleCalendar');
const refreshGoogleCalendar = $('#refreshGoogleCalendar');
const calendarSyncState = $('#calendarSyncState');
if (clientIdInput) clientIdInput.value = googleCalendar.clientId;

const setGoogleStatus = (message, isError = false) => {
  if (!calendarSyncState) return;
  calendarSyncState.textContent = message;
  calendarSyncState.classList.toggle('is-error', isError);
};
const isGoogleConnected = () => Boolean(googleCalendar.accessToken);
const showGoogleError = error => {
  console.error(error);
  setGoogleStatus(`Не удалось синхронизировать календарь: ${error?.message || 'попробуйте ещё раз'}`, true);
};
const dateAfter = date => dateKey(new Date(new Date(`${date}T12:00:00`).getTime() + 86400000));
const localDateTime = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`;

function googleEventPayload(title, date, time) {
  if (!time || time === 'ВЕСЬ ДЕНЬ') return { summary: title, start: { date }, end: { date: dateAfter(date) } };
  const start = new Date(`${date}T${time}:00`), end = new Date(start.getTime() + 60 * 60 * 1000);
  return { summary: title, start: { dateTime: localDateTime(start), timeZone: 'Europe/Belgrade' }, end: { dateTime: localDateTime(end), timeZone: 'Europe/Belgrade' } };
}
async function googleApi(path, options = {}) {
  if (!isGoogleConnected()) throw new Error('Сначала подключите Google Calendar');
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...options, headers: { Authorization: `Bearer ${googleCalendar.accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Google Calendar вернул код ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}
function findNotebookGoogleEvent(googleId) {
  for (const [date, events] of Object.entries(state.events)) {
    const index = events.findIndex(event => event.googleId === googleId);
    if (index >= 0) return { date, index, event: events[index] };
  }
  return null;
}
function removeNotebookEvent(date, index) {
  state.events[date].splice(index, 1);
  if (!state.events[date].length) delete state.events[date];
}
function upsertGoogleEvent(remote) {
  const date = remote.start?.dateTime?.slice(0, 10) || remote.start?.date;
  if (!date) return;
  const time = remote.start?.dateTime?.slice(11, 16) || 'ВЕСЬ ДЕНЬ';
  const existing = findNotebookGoogleEvent(remote.id);
  const event = { title: remote.summary || 'Без названия', time, googleId: remote.id, googleUpdated: remote.updated || new Date().toISOString() };
  if (existing) {
    if (existing.date !== date) removeNotebookEvent(existing.date, existing.index);
    else state.events[existing.date][existing.index] = event;
  }
  if (!existing || existing.date !== date) (state.events[date] ??= []).push(event);
}
async function syncNotebookEventsToGoogle() {
  const pending = [];
  Object.entries(state.events).forEach(([date, events]) => events.forEach(event => {
    if (!event.googleId) pending.push({ date, event });
  }));
  for (const item of pending) {
    const created = await googleApi('/calendars/primary/events', { method: 'POST', body: JSON.stringify(googleEventPayload(item.event.title, item.date, item.event.time)) });
    item.event.googleId = created.id;
    item.event.googleUpdated = created.updated || new Date().toISOString();
  }
  return pending.length;
}
async function refreshGoogleEvents() {
  if (!isGoogleConnected() || googleCalendar.syncing) return;
  googleCalendar.syncing = true;
  try {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: first.toISOString(), timeMax: last.toISOString(), maxResults: '2500' });
    const data = await googleApi(`/calendars/primary/events?${query}`);
    const remoteEvents = (data.items || []).filter(event => event.status !== 'cancelled');
    const remoteIds = new Set(remoteEvents.map(event => event.id));
    const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    Object.entries(state.events).forEach(([date, events]) => {
      if (!date.startsWith(monthPrefix)) return;
      for (let index = events.length - 1; index >= 0; index -= 1) if (events[index].googleId && !remoteIds.has(events[index].googleId)) events.splice(index, 1);
      if (!events.length) delete state.events[date];
    });
    remoteEvents.forEach(upsertGoogleEvent);
    save();
    renderCalendar();
    if (refreshGoogleCalendar) refreshGoogleCalendar.hidden = false;
    setGoogleStatus('Google Calendar синхронизирован. Изменения здесь и в Google появятся в обоих календарях после синхронизации.');
  } finally { googleCalendar.syncing = false; }
}
function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить Google OAuth')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Не удалось загрузить Google OAuth'));
    document.head.append(script);
  });
}
function allEvents(key) { return [
  ...(state.events[key] || []).filter(event => !event.googleId || !state.hiddenGoogleEvents.includes(event.googleId)).map((event, index) => ({ ...event, source: event.googleId ? 'google' : 'local', index })),
  ...state.imports.map((event, index) => event.date === key ? { ...event, source: 'import', index } : null).filter(Boolean)
] }
function renderCalendar(){ const y=month.getFullYear(),m=month.getMonth();$('#monthTitle').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(month);const grid=$('#calendarGrid');grid.innerHTML=''; const start=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate(); for(let i=0;i<start;i++){let e=document.createElement('span');e.className='day empty';grid.append(e)} for(let d=1;d<=days;d++){const date=new Date(y,m,d),k=dateKey(date),count=allEvents(k).length,b=document.createElement('button');b.className='day'+(dateKey(new Date())===k?' today':'')+(dateKey(selectedDate)===k?' selected':'')+(count?' has-event':'');b.textContent=d;b.setAttribute('aria-label',`${niceDate(date)}${count ? `, событий: ${count}` : ''}`);b.onclick=()=>{selectedDate=date;renderCalendar();renderAgenda()};grid.append(b)} renderAgenda();}
function promptEventChange(event) {
  const title = prompt('Название события:', event.title);
  if (title === null || !title.trim()) return null;
  const time = prompt('Время в формате ЧЧ:ММ. Оставьте пустым для события на весь день:', event.time === 'ВЕСЬ ДЕНЬ' ? '' : event.time);
  if (time === null || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim()))) {
    if (time !== null) alert('Введите время в формате ЧЧ:ММ.');
    return null;
  }
  return { title: title.trim(), time: time.trim() || 'ВЕСЬ ДЕНЬ' };
}
async function updateCalendarEvent(event, date) {
  const change = promptEventChange(event);
  if (!change) return;
  try {
    if (event.googleId) await googleApi(`/calendars/primary/events/${encodeURIComponent(event.googleId)}`, { method: 'PATCH', body: JSON.stringify(googleEventPayload(change.title, date, change.time)) });
    if (event.source === 'import') Object.assign(state.imports[event.index], change);
    else Object.assign(state.events[date][event.index], change);
    save();
    await refreshGoogleEvents();
    renderCalendar();
  } catch (error) { showGoogleError(error); }
}
async function deleteCalendarEvent(event, date) {
  if (!confirm(`Удалить «${event.title}»${event.googleId ? ' и из Google Calendar' : ''}?`)) return;
  try {
    if (event.googleId) await googleApi(`/calendars/primary/events/${encodeURIComponent(event.googleId)}`, { method: 'DELETE' });
    if (event.source === 'import') state.imports.splice(event.index, 1);
    else removeNotebookEvent(date, event.index);
    save();
    await refreshGoogleEvents();
    renderCalendar();
  } catch (error) { showGoogleError(error); }
}
function archiveCalendarEvent(event, date) {
  if (event.source === 'google') {
    archiveRecord({ type:'СОБЫТИЕ GOOGLE', text:event.title, source:'google-event', payload:{ googleId:event.googleId } });
    state.hiddenGoogleEvents.push(event.googleId);
  } else if (event.source === 'import') {
    archiveRecord({ type:'СОБЫТИЕ', text:event.title, source:'calendar-import', payload:{ item:{ ...state.imports[event.index] } } });
    state.imports.splice(event.index, 1);
  } else {
    archiveRecord({ type:'СОБЫТИЕ', text:event.title, source:'event', payload:{ date, time:event.time || 'ВЕСЬ ДЕНЬ', title:event.title } });
    removeNotebookEvent(date, event.index);
  }
  save(); renderCalendar();
}
function renderAgenda(){const k=dateKey(selectedDate), events=allEvents(k);$('#agendaLabel').textContent=niceDate(selectedDate).toUpperCase();$('#agendaTitle').textContent=dateKey(selectedDate)===dateKey(new Date())?'Сегодня':'На этот день';const box=$('#agendaItems');box.innerHTML=events.length?'':'<p class="empty">Пока здесь свободно. В этом тоже есть свой ритм.</p>';events.forEach(e=>{const x=document.createElement('div');x.className='event';x.innerHTML=`<span class="event-time">${e.time||'ВЕСЬ ДЕНЬ'}</span><span class="event-title"></span><span class="event-actions"><button class="event-edit" type="button">Изменить</button>${e.googleId ? '<span class="event-source">Google</span>' : ''}<button class="archive-action" type="button" aria-label="Архивировать событие">В архив</button><button class="delete" type="button" aria-label="Удалить событие">×</button></span>`;x.querySelector('.event-title').textContent=e.title;x.querySelector('.event-edit').onclick=()=>updateCalendarEvent(e,k);x.querySelector('.archive-action').onclick=()=>archiveCalendarEvent(e,k);x.querySelector('.delete').onclick=()=>deleteCalendarEvent(e,k);box.append(x)})}
$('#prevMonth').onclick=()=>{month.setMonth(month.getMonth()-1);renderCalendar();refreshGoogleEvents().catch(showGoogleError)};$('#nextMonth').onclick=()=>{month.setMonth(month.getMonth()+1);renderCalendar();refreshGoogleEvents().catch(showGoogleError)};$('#calendarToday').onclick=()=>{selectedDate=new Date();selectedDate.setHours(0,0,0,0);month=new Date(selectedDate);renderCalendar();refreshGoogleEvents().catch(showGoogleError)}; $('#eventForm').addEventListener('submit',async e=>{e.preventDefault();const x=$('#eventInput'),time=$('#eventTime');if(!x.value.trim())return;const k=dateKey(selectedDate);const event={title:x.value.trim(),time:time.value||'ВЕСЬ ДЕНЬ'};try{if(isGoogleConnected()){const created=await googleApi('/calendars/primary/events',{method:'POST',body:JSON.stringify(googleEventPayload(event.title,k,event.time))});event.googleId=created.id;event.googleUpdated=created.updated||new Date().toISOString()}(state.events[k]??=[]).push(event);x.value='';time.value='';save();await refreshGoogleEvents();renderCalendar()}catch(error){showGoogleError(error)}});
connectGoogleCalendar?.addEventListener('click', async () => {
  const clientId = clientIdInput?.value.trim();
  if (!clientId) { setGoogleStatus('Введите OAuth Client ID из Google Cloud.', true); return; }
  try {
    setGoogleStatus('Открываю вход в Google…');
    await loadGoogleIdentity();
    localStorage.setItem('night-notes-google-client-id', clientId);
    googleCalendar.clientId = clientId;
    googleCalendar.tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: GOOGLE_CALENDAR_SCOPE, callback: async response => {
      if (response.error) { showGoogleError(new Error(response.error)); return; }
      googleCalendar.accessToken = response.access_token;
      try {
        const uploaded = await syncNotebookEventsToGoogle();
        await refreshGoogleEvents();
        if (uploaded) setGoogleStatus(`Google Calendar подключён. В него добавлено событий Night Notes: ${uploaded}.`);
      } catch (error) { showGoogleError(error); }
    } });
    googleCalendar.tokenClient.requestAccessToken({ prompt: 'consent' });
  } catch (error) { showGoogleError(error); }
});
refreshGoogleCalendar?.addEventListener('click', () => refreshGoogleEvents().catch(showGoogleError));
window.addEventListener('focus', () => refreshGoogleEvents().catch(showGoogleError));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshGoogleEvents().catch(showGoogleError);
});
$('#importCalendar').onclick=()=>$('#icsInput').click();$('#icsInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;const raw=await f.text();let added=0;raw.split('BEGIN:VEVENT').slice(1).forEach(block=>{const val=(name)=>block.match(new RegExp(name+'(?:;[^:]*)?:(.+)'))?.[1]?.trim();const dt=val('DTSTART'),title=val('SUMMARY');if(dt&&title){const date=`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;const time=dt.includes('T')?`${dt.slice(9,11)}:${dt.slice(11,13)}`:'ВЕСЬ ДЕНЬ';state.imports.push({date,title,time});added++}});save();renderCalendar();alert(`Импортировано событий: ${added}`);e.target.value=''};
function restoreArchive(entry){const payload=entry.payload||{};if(entry.source==='task')state.tasks.push(payload);if(entry.source==='plan')state.plans[payload.key].push(payload.text);if(entry.source==='focus'){state.focus=payload.text||entry.text;$('#focusInput').value=state.focus}if(entry.source==='event'){(state.events[payload.date]??=[]).push({title:payload.title,time:payload.time})}if(entry.source==='google-event')state.hiddenGoogleEvents=state.hiddenGoogleEvents.filter(id=>id!==payload.googleId);if(entry.source==='calendar-import')state.imports.push(payload.item);if(entry.source==='shopping-item'){const list=state.shoppingLists.find(x=>x.id===payload.listId)||{id:payload.listId||Date.now(),name:payload.listName||'Мой список',items:[]};if(!state.shoppingLists.includes(list))state.shoppingLists.push(list);list.items.push(payload.item)}if(entry.source==='shopping-list'){state.shoppingLists.push(payload.list)}if(entry.source==='budget')state.budget.transactions.push(payload.item);if(entry.source==='health')state.health[payload.kind].push(payload.item);state.archive=state.archive.filter(x=>x.id!==entry.id);save();renderTasks();renderPlans();renderCalendar();renderShopping();renderBudget();renderHealth('done');renderHealth('todo')}
function renderArchive(){const entries=state.archive;const b=$('#archiveList');b.innerHTML=entries.length?'':'<p class="empty">Здесь появятся записи, которые ты отправишь в архив.</p>';entries.forEach(entry=>{const el=document.createElement('article');el.className='archive-entry';const date=entry.archivedAt?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(entry.archivedAt)).toUpperCase():'АРХИВ';el.innerHTML=`<time>${entry.type} · ${date}</time><p></p><div class="archive-actions"><button class="restore-action" type="button">Вернуть</button><button class="delete" type="button" aria-label="Удалить запись из архива">×</button></div>`;el.querySelector('p').textContent=entry.text;el.querySelector('.restore-action').onclick=()=>restoreArchive(entry);el.querySelector('.delete').onclick=()=>{state.archive=state.archive.filter(x=>x.id!==entry.id);save()};b.append(el)})} renderArchive();
const setHint=(x)=>{const h=$('#voiceHint');h.hidden=!x;h.textContent=x}; const SR=window.SpeechRecognition||window.webkitSpeechRecognition; $('#voiceTask').onclick=async()=>{if(!window.isSecureContext){setHint('Голосовой ввод работает в опубликованном блокноте по HTTPS — открой ссылку GitHub Pages.');return}if(!SR){setHint('Этот браузер не поддерживает голосовой ввод. Открой блокнот в Chrome или Safari и нажми значок микрофона в поле.');return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop())}catch{setHint('Разреши доступ к микрофону для этого сайта — затем нажми кнопку ещё раз.');return}const r=new SR();r.lang='ru-RU';r.interimResults=false;r.maxAlternatives=1;$('#voiceTask').classList.add('listening');setHint('Слушаю… скажи задачу.');r.start();r.onresult=e=>{$('#taskInput').value=e.results[0][0].transcript;setHint('Готово — можно добавить задачy кнопкой +.');};r.onerror=e=>setHint(e.error==='not-allowed'?'Разреши микрофон для этого сайта и попробуй ещё раз.':'Не удалось распознать речь. Попробуй ещё раз.');r.onend=()=>$('#voiceTask').classList.remove('listening')};
function speak(text){if(!('speechSynthesis'in window)||!text.trim())return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='ru-RU';u.rate=.93;window.speechSynthesis.speak(u)} $('#listenFocus').onclick=()=>speak(state.focus||'Пока фокус дня не записан.');$('#soundToggle').onclick=()=>speak(state.focus||'Добро пожаловать в Night Notes.');const themeToggle=$('#themeToggle');const syncThemeToggle=()=>{const dimmed=document.body.classList.contains('night');themeToggle.setAttribute('aria-pressed',String(dimmed));themeToggle.setAttribute('aria-label',dimmed?'Включить яркий свет':'Приглушить свет');themeToggle.textContent=dimmed?'◑ включить яркий свет':'◐ приглушить свет'};themeToggle.onclick=()=>{document.body.classList.toggle('night');syncThemeToggle()};syncThemeToggle();
$('#askChatGpt').onclick=()=>{const openTasks=state.tasks.filter(t=>!t.done).map(t=>`— ${t.text}`).join('\n')||'— пока нет';const context=`Помоги мне мягко распланировать день.\n\nМой фокус: ${state.focus||'ещё не записан'}\n\nОткрытые дела:\n${openTasks}\n\nПредложи реалистичный следующий шаг и бережный план без перегруза.`;window.open('https://chatgpt.com/','_blank','noopener');navigator.clipboard?.writeText(context).then(()=>{const label=$('.chatgpt-label');label.textContent='Контекст скопирован';setTimeout(()=>label.textContent='Спросить ChatGPT',1800)}).catch(()=>{});};
renderCalendar();
// Remove old offline caches so every device receives the current interface.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))).catch(() => {});
}
if ('caches' in window) {
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('night-notes-')).map(key => caches.delete(key)))).catch(() => {});
}

state.shopping ??= [];
state.budget ??= { transactions: [] };
state.health ??= { done: [], todo: [] };
if (!Array.isArray(state.shoppingLists)) {
  state.shoppingLists = [{ id: 'main', name: 'Мой список', items: state.shopping }];
  state.activeShoppingListId = 'main';
}
state.shoppingLists = state.shoppingLists.filter(list => list && Array.isArray(list.items));
if (!state.shoppingLists.length) state.shoppingLists.push({ id: 'main', name: 'Мой список', items: [] });
state.activeShoppingListId ??= state.shoppingLists[0].id;
const categoryFor = (name, current) => {
  const label = String(name || '');
  if (label.match(/зарплата|salary|myameria/i)) return 'Зарплата';
  if (label.match(/займ|одолж/i)) return 'Займ';
  if (/ALTA GROUP\*BALANS|ИВАН ХРИСТОВ|IVAN HRISTOV/i.test(label)) return /ALTA GROUP\*BALANS/i.test(label) ? 'Массаж и уход' : 'Стоматолог';
  if (/FLYDUBAI/i.test(label)) return 'Авиабилеты';
  if (/YANDEX|Yandex Go|PS_YANDEX/i.test(label) || current === 'Транспорт') return 'Такси';
  if (/WOLT|GLOVO/i.test(label)) return 'Доставка еды';
  if (/SUSHI SAN|HAN TIAN|BARISTROCATIA|COFFEE DREAM|ETNO KATUN|PIETRA|WALTER/i.test(label)) return 'Рестораны и кофе';
  if (/MAXI|MARKET 31|TRGOCENTAR|PEKARA/i.test(label)) return 'Продукты';
  if (/APOTEKA/i.test(label) || current === 'Здоровье') return 'Аптека и здоровье';
  if (/YETTEL|A1 Srbija|YouTubePremium/i.test(label)) return 'Связь и подписки';
  if (/MOBI(?:LE)?\s*CASH|МОБИЛЬН.*КЭШ/i.test(label)) return 'Мобильный кэш · Катя';
  if (/Аренда квартиры/i.test(label) || current === 'Дом') return 'Дом и аренда';
  return current === 'Другое' ? 'Прочее' : current;
};
function migrateBudgetCategories() {
  if (state.budget.categorySchema === '2026-10-v3') return;
  state.budget.transactions.forEach(entry => entry.category = categoryFor(entry.name, entry.category));
  state.budget.categorySchema = '2026-10-v3';
  localStorage.setItem('night-notes-v1', JSON.stringify(state));
}
if (state.budget.categorySchema !== '2026-10-v3') {
  state.budget.transactions.forEach(entry => entry.category = categoryFor(entry.name, entry.category));
  state.budget.categorySchema = '2026-10-v3';
  localStorage.setItem('night-notes-v1', JSON.stringify(state));
}
const currency = (n, code='RSD') => new Intl.NumberFormat('ru-RU',{style:'currency',currency:code,maximumFractionDigits:code==='EUR'?2:0}).format(n||0);
function removeItem(list, id){ const i=list.findIndex(x=>x.id===id); if(i>-1) list.splice(i,1); save(); }
const activeShoppingList=()=>state.shoppingLists.find(list=>list.id===state.activeShoppingListId)||state.shoppingLists[0];
function renderShopping(){
  const active=activeShoppingList();
  state.activeShoppingListId=active.id;
  const listsBox=$('#shoppingLists');
  listsBox.innerHTML='';
  state.shoppingLists.forEach(list=>{const button=document.createElement('button');const left=list.items.filter(item=>!item.done).length;button.type='button';button.className='shopping-list-choice'+(list.id===active.id?' active':'');button.innerHTML='<span></span><small></small>';button.querySelector('span').textContent=list.name;button.querySelector('small').textContent=`${left} из ${list.items.length}`;button.onclick=()=>{state.activeShoppingListId=list.id;save();renderShopping()};listsBox.append(button)});
  const title=$('#shoppingListTitle');title.textContent=active.name;title.contentEditable='true';title.setAttribute('role','textbox');title.setAttribute('aria-label','Название списка покупок — можно изменить');title.onblur=()=>{const name=title.textContent.trim();if(!name){title.textContent=active.name;return}active.name=name;save();renderShopping()};title.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();title.blur()}};
  const box=$('#shoppingList');box.innerHTML=active.items.length?'':'<p class="empty">Список пока пуст — добавь первую покупку.</p>';
  active.items.forEach(item=>{const row=document.createElement('div');row.className='shopping-item'+(item.done?' done':'');row.innerHTML='<button class="checkbox" aria-label="Отметить покупку выполненной"></button><input class="shopping-item-input" aria-label="Редактировать покупку"/><button class="archive-action" aria-label="Архивировать покупку">В архив</button><button class="delete" aria-label="Удалить покупку">×</button>';const input=row.querySelector('input');input.value=item.text;input.onchange=()=>{const text=input.value.trim();if(!text)active.items=active.items.filter(x=>x.id!==item.id);else item.text=text;save();renderShopping()};row.querySelector('.checkbox').onclick=()=>{item.done=!item.done;save();renderShopping()};row.querySelector('.archive-action').onclick=()=>{archiveRecord({type:'ПОКУПКА',text:item.text,source:'shopping-item',payload:{listId:active.id,listName:active.name,item:{...item}}});active.items=active.items.filter(x=>x.id!==item.id);save();renderShopping()};row.querySelector('.delete').onclick=()=>{removeItem(active.items,item.id);renderShopping()};box.append(row)});
  const left=active.items.filter(item=>!item.done).length;
  $('#shoppingCount').textContent=`${left} / ${active.items.length}`;
}
$('#shoppingListForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#shoppingListInput');if(!input.value.trim())return;const list={id:Date.now(),name:input.value.trim(),items:[]};state.shoppingLists.push(list);state.activeShoppingListId=list.id;input.value='';save();renderShopping()});
$('#shoppingItemForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#shoppingInput'),active=activeShoppingList();if(!input.value.trim())return;active.items.push({id:Date.now(),text:input.value.trim(),done:false});input.value='';save();renderShopping()});
$('#archiveShoppingList').onclick=()=>{const active=activeShoppingList();archiveRecord({type:'СПИСОК ПОКУПОК',text:active.name,source:'shopping-list',payload:{list:{...active,items:active.items.map(item=>({...item}))}}});state.shoppingLists=state.shoppingLists.filter(list=>list.id!==active.id);if(!state.shoppingLists.length)state.shoppingLists.push({id:'main',name:'Мой список',items:[]});state.activeShoppingListId=state.shoppingLists[0].id;save();renderShopping()};
$('#deleteShoppingList').onclick=()=>{const active=activeShoppingList();state.shoppingLists=state.shoppingLists.filter(list=>list.id!==active.id);if(!state.shoppingLists.length)state.shoppingLists.push({id:'main',name:'Мой список',items:[]});state.activeShoppingListId=state.shoppingLists[0].id;save();renderShopping()};
const budgetEntryCreatedAt = item => {
  const explicit = Date.parse(item.createdAt || '');
  if (Number.isFinite(explicit)) return explicit;
  const legacyId = Number(item.id);
  return Number.isFinite(legacyId) && legacyId > 946684800000 ? legacyId : null;
};
const budgetEntriesByDate = (entries = state.budget.transactions) => [...entries].sort((left, right) => {
  const timestamp = item => {
    const value = Date.parse(`${item.date || ''}T12:00:00`);
    return Number.isFinite(value) ? value : Infinity;
  };
  const byDate = timestamp(left) - timestamp(right);
  if (byDate) return byDate;
  const leftCreated = budgetEntryCreatedAt(left), rightCreated = budgetEntryCreatedAt(right);
  if (leftCreated !== null && rightCreated !== null) return leftCreated - rightCreated;
  return 0;
});
function renderBudget(){ const tx=state.budget.transactions;const code=x=>x.currency||'RUB';const totals=type=>{const result={};tx.filter(x=>x.type===type).forEach(x=>result[code(x)]=(result[code(x)]||0)+x.amount);return result};const moneySet=values=>Object.entries(values).map(([c,v])=>currency(v,c)).join(' · ')||'—';const income=totals('income'),expense=totals('expense'),balance={};new Set([...Object.keys(income),...Object.keys(expense)]).forEach(c=>balance[c]=(income[c]||0)-(expense[c]||0));$('#incomeTotal').textContent=moneySet(income);$('#expenseTotal').textContent=moneySet(expense);$('#balanceTotal').textContent=moneySet(balance);const selected=$('#budgetCurrencyFilter').value;const displayCurrency=selected==='ALL'?'EUR':selected;renderGeneralChartNote(selected);const filtered=budgetChartExpenses(tx,selected);const parts={};filtered.forEach(x=>parts[x.category]=(parts[x.category]||0)+x.amount);const colors=['#c87532','#ddb06b','#9aa881','#b9765e','#9f8aa0','#7f9eab','#b8a596'];const total=filtered.reduce((s,x)=>s+x.amount,0);let offset=0,stops=[];Object.entries(parts).forEach(([key,value],i)=>{const p=value/total*100;stops.push(`${colors[i%colors.length]} ${offset}% ${offset+p}%`);offset+=p});$('#budgetChart').style.background=total?`conic-gradient(${stops.join(',')})`:'conic-gradient(#eadfce 0 100%)';$('#budgetChart').innerHTML=`<span>${currency(total,displayCurrency)}<small>расходы</small></span>`;const legend=$('#chartLegend');legend.innerHTML='';Object.entries(parts).forEach(([key,value],i)=>{const row=document.createElement('div');row.innerHTML=`<i style="background:${colors[i%colors.length]}"></i><span>${key}</span><strong>${currency(value,displayCurrency)}</strong>`;legend.append(row)});const list=$('#transactionList');list.innerHTML=tx.length?'':'<p class="empty">В истории пока нет операций.</p>';budgetEntriesByDate(tx).forEach(item=>{const row=document.createElement('div');row.className='transaction';row.innerHTML='<div><strong></strong><small></small></div><span></span><button class="archive-action" aria-label="Архивировать запись">В архив</button><button class="delete" aria-label="Удалить запись">×</button>';row.querySelector('strong').textContent=item.name;const route=item.type==='transfer'&&item.fromAccount&&item.toAccount?`${item.fromAccount} → ${item.toAccount} · `:'';row.querySelector('small').textContent=`${route}${item.category} · ${item.date||'без даты'}`;row.querySelector('span').textContent=(item.type==='income'?'+ ':item.type==='transfer'?'↔ ':'− ')+currency(item.amount,code(item));row.querySelector('span').className=item.type;row.querySelector('.archive-action').onclick=()=>{archiveRecord({type:item.type==='income'?'ДОХОД':item.type==='transfer'?'ПЕРЕВОД':'РАСХОД',text:`${item.name} · ${currency(item.amount,code(item))}`,source:'budget',payload:{item:{...item}}});state.budget.transactions=state.budget.transactions.filter(x=>x.id!==item.id);save();renderBudget()};row.querySelector('.delete').onclick=()=>{removeItem(tx,item.id);renderBudget()};list.append(row)});}
$('#transactionDate').value=new Date().toISOString().slice(0,10);
$('#budgetCurrencyFilter').onchange=renderBudget;
const expenseCategories=['Доставка еды','Рестораны и кофе','Продукты','Такси','Авиабилеты','Дом и аренда','Стоматолог','Аптека и здоровье','Массаж и уход','Связь и подписки','Мобильный кэш · Катя','Красота','Досуг','Прочее'];
const incomeCategories=['Зарплата','Займ','Перевод от себя','Возврат','Подарок','Другое'];
const transactionType=$('#transactionType'), transactionCategory=$('#transactionCategory'), transferFrom=$('#transferFrom'), transferTo=$('#transferTo');
transactionType.querySelector('option[value="transfer"]')?.remove();
function refreshTransactionForm(){
  if (transactionType.value === 'transfer') transactionType.value = 'expense';
  const type=transactionType.value;
  const categories=type==='income'?incomeCategories:expenseCategories;
  const previous=transactionCategory.value;
  transactionCategory.required=true;
  transactionCategory.innerHTML=`<option value="" disabled>Выберите категорию</option>${categories.map(category=>`<option>${category}</option>`).join('')}`;
  transactionCategory.value=categories.includes(previous)?previous:'';
  transferFrom.hidden=transferTo.hidden=true;
  transferFrom.required=transferTo.required=false;
  transactionCategory.disabled=false;
}
transactionType.onchange=refreshTransactionForm;
refreshTransactionForm();
$('#budgetForm').addEventListener('submit',e=>{
  e.preventDefault();
  const name=$('#transactionName'), amount=$('#transactionAmount'), type=transactionType.value;
  if(!name.value.trim()||!Number(amount.value)||!transactionCategory.value)return;
  const recordedAt = new Date();
  state.budget.transactions.push({id:recordedAt.getTime(),createdAt:recordedAt.toISOString(),name:name.value.trim(),amount:Number(amount.value),type,category:transactionCategory.value,currency:$('#transactionCurrency').value,date:$('#transactionDate').value,account:$('#transactionAccount')?.value||'',fromAccount:'',toAccount:''});
  name.value='';amount.value='';transferFrom.value='';transferTo.value='';save();renderBudget();
});
const HEALTH_FILE_LIMIT = 1 * 1024 * 1024;
const HEALTH_TOTAL_FILE_LIMIT = Math.floor(1.5 * 1024 * 1024);
let healthDraftFiles = [];
let healthDraftStatus = 'done';
let healthEditing = null;
const healthDateToday = () => dateKey(new Date());
const healthFileSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
function normalizeHealthItem(item) {
  if (!item || typeof item !== 'object') return { id: Date.now(), text: String(item || ''), date: '', kind: 'Другое', note: '', attachments: [] };
  item.text ??= '';
  item.date ??= '';
  item.kind ??= 'Другое';
  item.note ??= '';
  item.attachments = Array.isArray(item.attachments) ? item.attachments : [];
  return item;
}
function normalizeHealthState() {
  state.health ??= { done: [], todo: [] };
  state.health.done = (Array.isArray(state.health.done) ? state.health.done : []).map(normalizeHealthItem);
  state.health.todo = (Array.isArray(state.health.todo) ? state.health.todo : []).map(normalizeHealthItem);
}
function renderHealthDraftFiles() {
  const box = $('#healthFileList');
  if (!box) return;
  box.innerHTML = '';
  healthDraftFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'health-file-chip';
    chip.innerHTML = '<span>📎</span><strong></strong><small></small><button type="button" aria-label="Убрать прикреплённый файл">×</button>';
    chip.querySelector('strong').textContent = file.name;
    chip.querySelector('small').textContent = healthFileSize(file.size);
    chip.querySelector('button').onclick = () => { healthDraftFiles.splice(index, 1); renderHealthDraftFiles(); };
    box.append(chip);
  });
}
function setHealthComposerOpen(open) {
  $('#healthEntryForm').hidden = !open;
  $('#healthQuickActions').hidden = open;
}
function resetHealthComposer(close = true) {
  healthEditing = null;
  healthDraftFiles = [];
  healthDraftStatus = 'done';
  $('#healthEntryForm')?.reset();
  $('#healthDate').value = healthDateToday();
  $('#healthKind').value = 'Анализ';
  $('#healthCancelEdit').hidden = close;
  $('#healthCancelEdit').textContent = 'Назад';
  $('#healthEntryTitle').textContent = 'Добавить без лишнего';
  $('#healthEntryForm').querySelector('.health-save').textContent = 'Сохранить запись';
  document.querySelectorAll('[data-health-status]').forEach(button => button.classList.toggle('active', button.dataset.healthStatus === healthDraftStatus));
  renderHealthDraftFiles();
  setHealthComposerOpen(!close);
}
function editHealthRecord(kind, item) {
  healthEditing = { kind, id: item.id };
  healthDraftStatus = kind;
  healthDraftFiles = (item.attachments || []).map(file => ({ ...file }));
  $('#healthDate').value = item.date || healthDateToday();
  $('#healthKind').value = item.kind || 'Другое';
  $('#healthTitle').value = item.text || '';
  $('#healthNote').value = item.note || '';
  setHealthComposerOpen(true);
  $('#healthCancelEdit').hidden = false;
  $('#healthCancelEdit').textContent = 'Отменить редактирование';
  $('#healthEntryTitle').textContent = 'Скорректировать запись';
  $('#healthEntryForm').querySelector('.health-save').textContent = 'Сохранить изменения';
  document.querySelectorAll('[data-health-status]').forEach(button => button.classList.toggle('active', button.dataset.healthStatus === healthDraftStatus));
  renderHealthDraftFiles();
  $('#healthEntryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderHealthList(kind) {
  const box = $(kind === 'done' ? '#healthDone' : '#healthTodo');
  const count = $(kind === 'done' ? '#healthDoneCount' : '#healthTodoCount');
  const list = state.health[kind];
  count.textContent = list.length ? `${list.length}` : '';
  box.innerHTML = list.length ? '' : `<p class="empty">${kind === 'done' ? 'Здесь появятся анализы, визиты и документы.' : 'Добавь то, о чём важно не забыть.'}</p>`;
  [...list].sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).forEach(item => {
    const row = document.createElement('article');
    row.className = 'health-record';
    row.innerHTML = '<div class="health-record-top"><span class="health-record-type"></span><time></time><div class="health-record-actions"><button type="button" class="health-edit">Изменить</button><button type="button" class="archive-action" aria-label="Архивировать запись">В архив</button><button type="button" class="delete" aria-label="Удалить запись">×</button></div></div><h3></h3><p class="health-record-note"></p><div class="health-record-files"></div>';
    row.querySelector('.health-record-type').textContent = item.kind || 'Запись';
    row.querySelector('time').textContent = item.date ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${item.date}T12:00:00`)) : 'Без даты';
    row.querySelector('h3').textContent = item.text;
    const note = row.querySelector('.health-record-note');
    note.textContent = item.note || '';
    note.hidden = !item.note;
    const files = row.querySelector('.health-record-files');
    (item.attachments || []).forEach(file => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'health-file-link';
      button.innerHTML = '<span>📎</span><strong></strong><small></small>';
      button.querySelector('strong').textContent = file.name;
      button.querySelector('small').textContent = healthFileSize(file.size || 0);
      button.onclick = () => file.data ? window.open(file.data, '_blank', 'noopener') : alert('Этот файл был добавлен в старой версии записи. Прикрепи его заново, чтобы открыть.');
      files.append(button);
    });
    row.querySelector('.health-edit').onclick = () => editHealthRecord(kind, item);
    row.querySelector('.archive-action').onclick = () => {
      archiveRecord({ type:'ЗДОРОВЬЕ', text:item.text, source:'health', payload:{ kind, item:{ ...item, attachments:(item.attachments || []).map(file => ({...file})) } } });
      state.health[kind] = state.health[kind].filter(entry => entry.id !== item.id);
      save(); renderHealth();
    };
    row.querySelector('.delete').onclick = () => {
      state.health[kind] = state.health[kind].filter(entry => entry.id !== item.id);
      save(); renderHealth();
    };
    box.append(row);
  });
}
function renderHealth() {
  normalizeHealthState();
  renderHealthList('done');
  renderHealthList('todo');
}
$('#healthEntryForm').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('#healthTitle').value.trim();
  if (!text) { $('#healthTitle').focus(); return; }
  normalizeHealthState();
  const record = {
    id: healthEditing?.id || `health-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    date: $('#healthDate').value || healthDateToday(),
    kind: $('#healthKind').value,
    note: $('#healthNote').value.trim(),
    attachments: healthDraftFiles.map(file => ({ ...file }))
  };
  if (healthEditing) {
    state.health[healthEditing.kind] = state.health[healthEditing.kind].filter(item => item.id !== healthEditing.id);
  }
  state.health[healthDraftStatus].unshift(record);
  save(); renderHealth(); resetHealthComposer();
});
document.querySelectorAll('[data-health-status]').forEach(button => button.addEventListener('click', () => {
  healthDraftStatus = button.dataset.healthStatus;
  document.querySelectorAll('[data-health-status]').forEach(choice => choice.classList.toggle('active', choice === button));
}));
$('#healthFiles').addEventListener('change', async event => {
  const selected = [...event.target.files];
  let total = healthDraftFiles.reduce((sum, file) => sum + (file.size || 0), 0);
  const rejected = [];
  for (const file of selected) {
    if (file.size > HEALTH_FILE_LIMIT || total + file.size > HEALTH_TOTAL_FILE_LIMIT) { rejected.push(file.name); continue; }
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    healthDraftFiles.push({ id:`file-${Date.now()}-${Math.random().toString(16).slice(2)}`, name:file.name, type:file.type, size:file.size, data });
    total += file.size;
  }
  event.target.value = '';
  $('#healthFileHint').textContent = rejected.length ? `Не добавлено: ${rejected.join(', ')}. Можно до 1 МБ на файл и до 1,5 МБ всего.` : (healthDraftFiles.length ? 'Готово: файлы прикреплены к этой записи.' : 'Файл будет виден внутри этой записи и сохранится в твоём приватном блокноте.');
  renderHealthDraftFiles();
});
$('#healthQuickNote').addEventListener('click', () => {
  resetHealthComposer(false);
  $('#healthTitle').focus();
});
$('#healthQuickFiles').addEventListener('change', async event => {
  const accepted = [];
  const rejected = [];
  for (const file of [...event.target.files]) {
    if (file.size > HEALTH_FILE_LIMIT) { rejected.push(file.name); continue; }
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    accepted.push({ id:`file-${Date.now()}-${Math.random().toString(16).slice(2)}`, name:file.name, type:file.type, size:file.size, data });
  }
  event.target.value = '';
  if (accepted.length) {
    normalizeHealthState();
    accepted.forEach(file => state.health.done.unshift({
      id:`health-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text:file.name.replace(/\.[^.]+$/, '') || 'Документ',
      date:healthDateToday(), kind:'Документ', note:'', attachments:[file]
    }));
    save(); renderHealth();
  }
  const hint = $('#healthQuickHint');
  hint.textContent = accepted.length
    ? `Готово: добавлено ${accepted.length} ${accepted.length === 1 ? 'вложение' : 'вложения'} в «Уже произошло».`
    : (rejected.length ? `Не добавлено: ${rejected.join(', ')}. Файл должен быть до 1 МБ.` : 'Файл можно выбрать из «Фото», «Файлы» или снять камерой на телефоне.');
});
$('#healthCancelEdit').addEventListener('click', () => resetHealthComposer());
resetHealthComposer();

$('#askChatGpt').onclick=()=>{const shopping=state.shoppingLists.flatMap(list=>list.items.filter(item=>!item.done).map(item=>`— ${list.name}: ${item.text}`)).join('\n')||'— пока нет';const tasks=state.tasks.filter(t=>!t.done).map(t=>`— ${t.text}`).join('\n')||'— пока нет';const tx=state.budget.transactions;const income=tx.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0),expense=tx.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0);const health=state.health.todo.map(x=>`— ${x.text}`).join('\n')||'— пока нет';const context=`Помоги мне мягко спланировать ближайшие дни.\n\nФокус дня: ${state.focus||'ещё не записан'}\n\nДела:\n${tasks}\n\nПокупки:\n${shopping}\n\nБюджет: доходы ${currency(income)}, расходы ${currency(expense)}.\n\nЗапланировать по здоровью:\n${health}\n\nПредложи реалистичный следующий шаг и бережный план без перегруза.`;window.open('https://chatgpt.com/','_blank','noopener');navigator.clipboard?.writeText(context).then(()=>{const label=$('.chatgpt-label');label.textContent='Контекст скопирован';setTimeout(()=>label.textContent='Спросить ChatGPT',1800)}).catch(()=>{});};
// Legacy tasks stay in saved data but are not auto-created on the start page.
renderTasks();
renderShopping();renderBudget();renderHealth('done');renderHealth('todo');
$('#quickChatGpt').onclick=()=>$('#askChatGpt').click();

// Budget notes: comments can be added to new and existing entries without changing their amounts.
const budgetCommentStyles=document.createElement('style');
budgetCommentStyles.textContent=`.budget-form textarea{grid-column:span 2;padding:10px 9px;border:1px solid rgba(91,61,38,.2);background:#fffaf2;color:#493125;outline:0;font-size:12px;resize:vertical;min-height:48px}.budget-form textarea:focus,.comment-editor:focus{border-color:#c87532}.transaction{align-items:start;padding:10px 0}.transaction-copy{flex:1;display:grid;gap:2px}.transaction>span{padding-top:4px;white-space:nowrap}.transaction-comment{margin:5px 0 1px;color:#684c39;font:italic 12px/1.4 "Playfair Display",serif}.comment-action,.comment-save{width:max-content;padding:3px 0;border:0;background:transparent;color:#a85e2c;font:10px "DM Mono",monospace;letter-spacing:.02em}.comment-action:hover,.comment-save:hover{color:#704020;text-decoration:underline}.comment-editor,.comment-save{display:none}.transaction.is-editing .comment-editor,.transaction.is-editing .comment-save{display:block}.comment-editor{width:100%;margin-top:5px;padding:7px 8px;border:1px solid rgba(91,61,38,.2);background:#fffaf2;color:#493125;resize:vertical;font-size:12px}`;
document.head.append(budgetCommentStyles);
const renderBudgetBase=renderBudget;
renderBudget=()=>{renderBudgetBase();const entries=budgetEntriesByDate();document.querySelectorAll('#transactionList .transaction').forEach((row,index)=>{const item=entries[index],copy=row.querySelector('div');copy.classList.add('transaction-copy');const comment=document.createElement('p'),action=document.createElement('button'),editor=document.createElement('textarea'),saveComment=document.createElement('button');comment.className='transaction-comment';comment.textContent=item.comment||'';comment.hidden=!item.comment;action.className='comment-action';action.type='button';action.textContent=item.comment?'Изменить комментарий':'+ Комментарий';editor.className='comment-editor';editor.rows=2;editor.value=item.comment||'';editor.setAttribute('aria-label','Комментарий к операции');saveComment.className='comment-save';saveComment.type='button';saveComment.textContent='Сохранить';action.onclick=()=>{row.classList.toggle('is-editing');if(row.classList.contains('is-editing'))editor.focus()};saveComment.onclick=()=>{item.comment=editor.value.trim();save();renderBudget()};copy.append(comment,action,editor,saveComment)})};
let budgetCommentDraft=null;
$('#budgetForm').addEventListener('submit',()=>{const name=$('#transactionName').value.trim(),amount=Number($('#transactionAmount').value);budgetCommentDraft=name&&amount?$('#transactionComment').value.trim():null},true);
$('#budgetForm').addEventListener('submit',()=>{if(budgetCommentDraft===null)return;const item=state.budget.transactions.at(-1);if(item&&budgetCommentDraft)item.comment=budgetCommentDraft;budgetCommentDraft=null;$('#transactionComment').value='';save();renderBudget()});
renderBudget();

const renderBudgetWithEmptyState = renderBudget;
renderBudget = () => {
  renderBudgetWithEmptyState();
  const insightSection = document.querySelector('#budget .budget-insights');
  if (insightSection) insightSection.hidden = state.budget.transactions.length === 0;
};
renderBudget();

const budgetAccounts = [
  { id: 'am-eur', label: 'Армянский · EUR', currency: 'EUR' },
  { id: 'am-amd', label: 'Армянский · AMD', currency: 'AMD' },
  { id: 'rs-eur', label: 'Сербский · EUR', currency: 'EUR' },
  { id: 'rs-rsd', label: 'Сербский · RSD', currency: 'RSD' }
];
const accountById = id => budgetAccounts.find(account => account.id === id);

// Editing a journal row keeps the original operation and its sync identifier.
const renderBudgetWithComments = renderBudget;
renderBudget = () => {
  renderBudgetWithComments();
  const categoryListFor = item => item.type === 'income' ? incomeCategories : item.type === 'transfer' ? ['Перевод между своими картами'] : expenseCategories;
  const escapeOption = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const entries = budgetEntriesByDate();
  document.querySelectorAll('#transactionList .transaction').forEach((row, index) => {
    const item = entries[index];
    if (!item || row.querySelector('.transaction-edit-action')) return;
    const copy = row.querySelector('.transaction-copy') || row.querySelector('div');
    const account = accountById(item.account);
    if (account) {
      const accountNote = document.createElement('small');
      accountNote.className = 'transaction-account';
      accountNote.textContent = account.label;
      copy.append(accountNote);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'transaction-edit-action';
    edit.textContent = '✎ Изменить запись';
    const editor = document.createElement('form');
    editor.className = 'transaction-editor';
    const categories = categoryListFor(item);
    editor.innerHTML = `<label>Тип<select name="type" aria-label="Тип операции"><option value="expense"${item.type === 'expense' ? ' selected' : ''}>Расход</option><option value="income"${item.type === 'income' ? ' selected' : ''}>Доход</option>${item.type === 'transfer' ? '<option value="transfer" selected>Перевод</option>' : ''}</select></label><label>Валюта<select name="currency" aria-label="Валюта операции">${['RSD','EUR','RUB','AMD'].map(code => `<option${(item.currency || 'RUB') === code ? ' selected' : ''}>${code}</option>`).join('')}</select></label><label class="transaction-edit-wide">Название<input name="name" aria-label="Название операции" required value="${escapeOption(item.name)}"></label><label>Сумма<input name="amount" aria-label="Сумма операции" type="number" min="0" step="0.01" required value="${item.amount}"></label><label>Дата<input name="date" aria-label="Дата операции" type="date" value="${item.date || ''}"></label><label class="transaction-edit-wide">Счёт<select name="account" aria-label="Счёт операции"><option value="">Без счёта</option>${budgetAccounts.map(account => `<option value="${account.id}"${item.account === account.id ? ' selected' : ''}>${account.label}</option>`).join('')}</select></label><label class="transaction-edit-wide">Категория<select name="category" aria-label="Категория операции"></select></label><label class="transaction-edit-wide">Комментарий<textarea name="comment" aria-label="Комментарий к операции" rows="2" placeholder="Необязательно">${escapeOption(item.comment || '')}</textarea></label><button type="submit">Сохранить изменения</button><button type="button" class="transaction-edit-cancel">Отмена</button>`;
    const typeField = editor.querySelector('[name="type"]');
    const categoryField = editor.querySelector('[name="category"]');
    const setCategories = (selectedCategory = item.category) => {
      const available = categoryListFor({ type: typeField.value });
      categoryField.innerHTML = available.map(category => `<option${category === selectedCategory ? ' selected' : ''}>${escapeOption(category)}</option>`).join('');
    };
    setCategories();
    typeField.onchange = () => setCategories();
    edit.onclick = () => row.classList.toggle('is-editing-transaction');
    editor.querySelector('.transaction-edit-cancel').onclick = () => row.classList.remove('is-editing-transaction');
    editor.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(editor);
      const amount = Number(data.get('amount'));
      const name = String(data.get('name') || '').trim();
      if (!name || !Number.isFinite(amount) || amount <= 0) return;
      item.name = name;
      item.amount = amount;
      item.type = String(data.get('type'));
      item.currency = String(data.get('currency'));
      item.date = String(data.get('date'));
      item.account = String(data.get('account'));
      item.category = String(data.get('category'));
      item.comment = String(data.get('comment') || '').trim();
      save();
      renderBudget();
    };
    copy.append(edit, editor);
  });
};
renderBudget();

// The overview is always one number in EUR; the round chart stays in the chosen currency.
const BUDGET_RATES_KEY = 'night-notes-budget-eur-rates-v1';
const defaultBudgetRates = { EUR: 1, RSD: 117.518516, RUB: 91.064623, AMD: 404.78625 };
let budgetEurRates = { ...defaultBudgetRates };
let budgetRatesUpdatedAt = '';
try {
  const cachedRates = JSON.parse(localStorage.getItem(BUDGET_RATES_KEY) || 'null');
  if (cachedRates?.rates?.EUR && cachedRates?.rates?.RSD && cachedRates?.rates?.RUB && cachedRates?.rates?.AMD) {
    budgetEurRates = cachedRates.rates;
    budgetRatesUpdatedAt = cachedRates.updatedAt || '';
  }
} catch {}
function renderBudgetEuroOverview() {
  const total = type => state.budget.transactions
    .filter(item => item.type === type)
    .reduce((sum, item) => sum + item.amount / (budgetEurRates[item.currency || 'RUB'] || 1), 0);
  const income = total('income');
  const expense = total('expense');
  $('#incomeTotal').textContent = currency(income, 'EUR');
  $('#expenseTotal').textContent = currency(expense, 'EUR');
  $('#balanceTotal').textContent = currency(income - expense, 'EUR');

}
const renderBudgetWithEuroOverview = renderBudget;
renderBudget = () => { renderBudgetWithEuroOverview(); renderBudgetEuroOverview(); };
async function refreshBudgetEurRates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/EUR', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.result !== 'success' || !['RSD','RUB','AMD'].every(code => Number(data.rates?.[code]) > 0)) throw new Error('rates_unavailable');
    budgetEurRates = { EUR: 1, RSD: data.rates.RSD, RUB: data.rates.RUB, AMD: data.rates.AMD };
    budgetRatesUpdatedAt = data.time_last_update_utc ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(data.time_last_update_utc)) : 'сегодня';
    localStorage.setItem(BUDGET_RATES_KEY, JSON.stringify({ rates: budgetEurRates, updatedAt: budgetRatesUpdatedAt }));
    renderBudget();
  } catch { renderBudgetEuroOverview(); }
}
renderBudget();
refreshBudgetEurRates();

const radioButton = $('#soundToggle');
const autumnJazzRadio = $('#autumnJazzRadio');
const autumnJazzStreams = [
  'https://jazzfm91.streamb.live/SB00023',
  'https://jazzfm91.streamb.live/SB00009'
];
let radioSourceIndex = 0;
let radioIsOn = false;
let radioIsStarting = false;
const setRadioButton = (isPlaying, message) => {
  radioButton.textContent = isPlaying ? '❚❚' : '📻';
  const label = message || (isPlaying ? 'Поставить осенний джаз на паузу' : 'Включить осенний джаз · Oscar Peterson');
  radioButton.title = label;
  radioButton.setAttribute('aria-label', label);
};
const startAutumnJazz = async () => {
  if (radioIsStarting) return;
  radioIsStarting = true;
  for (let attempt = 0; attempt < autumnJazzStreams.length; attempt += 1) {
    const sourceIndex = (radioSourceIndex + attempt) % autumnJazzStreams.length;
    autumnJazzRadio.src = autumnJazzStreams[sourceIndex];
    try {
      await autumnJazzRadio.play();
      radioSourceIndex = sourceIndex;
      radioIsOn = true;
      radioIsStarting = false;
      setRadioButton(true);
      return;
    } catch {
      // Переключаемся на второй официальный сервер SomaFM.
    }
  }
  radioIsStarting = false;
  radioIsOn = false;
  setRadioButton(false, 'Не удалось включить радио — попробуйте ещё раз');
};
setRadioButton(false);
radioButton.onclick = () => {
  if (radioIsOn) {
    radioIsOn = false;
    autumnJazzRadio.pause();
    setRadioButton(false);
    return;
  }
  setRadioButton(false, 'Подключаю осенний джаз');
  startAutumnJazz();
};
autumnJazzRadio.addEventListener('error', () => {
  if (!radioIsOn || radioIsStarting) return;
  radioIsOn = false;
  radioSourceIndex = (radioSourceIndex + 1) % autumnJazzStreams.length;
  startAutumnJazz();
});
autumnJazzRadio.addEventListener('ended', () => { radioIsOn = false; setRadioButton(false); });

// One private source: the same notebook can be opened on desktop and phone.
const syncDialog = $('#syncDialog');
const syncMessage = $('#syncMessage');
const syncEmail = $('#syncEmail');
const shareLink = $('#shareLink');
const syncSignOut = $('#syncSignOut');
const sendSyncLink = $('#sendSyncLink');
const googleSync = $('#googleSync');

function normalizeCloudState() {
  state.focus ??= '';
  state.tasks ??= [];
  state.plans ??= { dream: [], next: [], done: [] };
  state.plans.dream ??= [];
  state.plans.next ??= [];
  state.plans.done ??= [];
  state.events ??= {};
  state.imports ??= [];
  state.archive ??= [];
  state.selfCareDaily ??= {};
  state.shopping ??= [];
  state.budget ??= { transactions: [] };
  state.budget.transactions ??= [];
  state.health ??= { done: [], todo: [] };
  state.health.done ??= [];
  state.health.todo ??= [];
  if (!Array.isArray(state.shoppingLists)) {
    state.shoppingLists = [{ id: 'main', name: 'Мой список', items: state.shopping }];
    state.activeShoppingListId = 'main';
  }
  state.shoppingLists = state.shoppingLists.filter(list => list && Array.isArray(list.items));
  if (!state.shoppingLists.length) state.shoppingLists.push({ id: 'main', name: 'Мой список', items: [] });
  state.activeShoppingListId ??= state.shoppingLists[0].id;
  migrateBudgetCategories();
}

function renderCloudState() {
  normalizeCloudState();
  renderTasks();
  renderPlans();
  renderCalendar();
  renderArchive();
  renderShopping();
  renderBudget();
  renderHealth('done');
  renderHealth('todo');
}

function hasNotebookEntries(source) {
  const budget = source?.budget?.transactions?.length || 0;
  const events = Object.values(source?.events || {}).reduce((count, day) => count + (Array.isArray(day) ? day.length : 0), 0);
  const imports = source?.imports?.length || 0;
  const shopping = (source?.shoppingLists || []).reduce((count, list) => count + (list?.items?.length || 0), 0);
  const health = (source?.health?.done?.length || 0) + (source?.health?.todo?.length || 0);
  const archive = source?.archive?.length || 0;
  const customTasks = (source?.tasks || []).filter(task => !['Прогуляться без наушников', 'Разобрать одну важную вещь'].includes(task?.text) && !String(task?.text || '').startsWith('Забота о себе ·')).length;
  const focus = String(source?.focus || '').trim().length;
  const defaultPlans = ['Увидеть осенний Нью-Йорк', 'Собрать блокнот под себя'];
  const plans = Object.values(source?.plans || {}).reduce((count, list) => count + (Array.isArray(list) ? list.filter(item => !defaultPlans.includes(item)).length : 0), 0);
  return budget + events + imports + shopping + health + archive + customTasks + focus + plans > 0;
}

async function hydrateCloudState() {
  if (!cloudClient || !cloudUser) return;
  cloudHydrating = true;
  setSyncStatus('Загружаю синхронизированные данные…');
  const { data, error } = await cloudClient.from('notebook_state').select('payload').eq('user_id', cloudUser.id).maybeSingle();
  if (error) {
    cloudHydrating = false;
    setSyncStatus('Ошибка синхронизации');
    if (syncMessage) syncMessage.textContent = 'Не удалось загрузить данные. Попробуй ещё раз.';
    return;
  }
  const localSnapshot = JSON.parse(JSON.stringify(state));
  const remotePayload = data?.payload && typeof data.payload === 'object' ? data.payload : null;
  if (remotePayload && hasNotebookEntries(localSnapshot) && !hasNotebookEntries(remotePayload)) {
    // Do not let a newly signed-in empty device erase the filled notebook.
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, localSnapshot);
    normalizeCloudState();
    localStorage.setItem('night-notes-v1', JSON.stringify(state));
    renderCloudState();
    await pushCloudState();
    if (syncMessage) syncMessage.textContent = 'Данные с этого устройства сохранены в общий блокнот.';
  } else if (remotePayload) {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, remotePayload);
    normalizeCloudState();
    localStorage.setItem('night-notes-v1', JSON.stringify(state));
    renderCloudState();
  } else {
    // The first signed-in device may be a freshly installed phone. Never let
    // that empty local store overwrite the filled notebook on the desktop.
    if (hasNotebookEntries(localSnapshot)) {
      await pushCloudState();
    } else if (syncMessage) {
      syncMessage.textContent = 'Аккаунт подключён, но записей пока нет. Сначала войди на устройстве, где открыт заполненный блокнот.';
    }
  }
  cloudHydrating = false;
  if (syncMessage) syncMessage.textContent = `Автосинхронизация включена для ${cloudUser.email || 'твоего аккаунта'}.`;
  setSyncStatus(`Автосинхронизация включена: ${cloudUser.email || 'твой аккаунт'}`, true);
}

async function initCloudSync() {
  if (!window.supabase?.createClient) {
    setSyncStatus('Синхронизация недоступна');
    return;
  }
  cloudClient = window.supabase.createClient(SYNC_CONFIG.url, SYNC_CONFIG.key);
  const { data: { session } } = await cloudClient.auth.getSession();
  cloudUser = session?.user || null;
  if (syncSignOut) syncSignOut.hidden = !cloudUser;
  if (cloudUser) {
    await hydrateCloudState();
  } else if (new URLSearchParams(window.location.search).has('sync') || window.location.hash.includes('sync=')) {
    // Keep old private-link notebooks working, but do not create a new
    // anonymous notebook for a fresh home-screen installation.
    await ensureSharedSync();
    await hydrateSharedState();
  } else {
    setSyncStatus('Войти по email, чтобы включить автосинхронизацию');
  }
  cloudClient.auth.onAuthStateChange((_event, nextSession) => {
    cloudUser = nextSession?.user || null;
    if (syncSignOut) syncSignOut.hidden = !cloudUser;
    if (cloudUser) setTimeout(() => hydrateCloudState(), 0);
    else if (sharedSync) setSyncStatus('Приватная ссылка синхронизирована', true);
    else setSyncStatus('Войти по email, чтобы включить автосинхронизацию');
  });
}

// A browser with an active session always refreshes when the notebook becomes
// visible again. This keeps devices in step without any manual export or link.
function refreshCloudStateWhenVisible() {
  if (!cloudUser || cloudHydrating || cloudSyncTimer) return;
  hydrateCloudState();
}
function refreshSharedStateWhenVisible() {
  if (!sharedSync || sharedHydrating || cloudUser) return;
  hydrateSharedState();
}
window.addEventListener('focus', () => {
  refreshCloudStateWhenVisible();
  refreshSharedStateWhenVisible();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshCloudStateWhenVisible();
    refreshSharedStateWhenVisible();
  }
});

const requestSyncCode = $('#requestSyncCode');
requestSyncCode?.addEventListener('click', async () => {
  const email = syncEmail?.value.trim().toLowerCase();
  if (!email || !cloudClient) return;
  requestSyncCode.disabled = true;
  const { error } = await cloudClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
  requestSyncCode.disabled = false;
  if (error) {
    syncMessage.textContent = `Не удалось отправить ссылку: ${error.message}`;
    return;
  }
  syncMessage.textContent = 'Проверь почту и подтверди вход. После этого этот браузер будет загружать и сохранять блокнот автоматически.';
});

$('#syncAccount').onclick = () => {
  if (!syncDialog) return;
  if (cloudUser) {
    syncMessage.textContent = `Автосинхронизация включена для ${cloudUser.email || 'твоего аккаунта'}.`;
    syncSignOut.hidden = false;
  } else {
    syncMessage.textContent = sharedSync ? 'Приватный блокнот подключён. Открывай эту же ссылку в других браузерах.' : 'Создай приватную ссылку и открывай её в любом браузере — там будет тот же блокнот. Вход по email остаётся альтернативой.';
    syncSignOut.hidden = true;
  }
  syncDialog.showModal();
};

$('#createShareLink')?.addEventListener('click', async () => {
  const button = $('#createShareLink');
  if (!cloudClient) {
    syncMessage.textContent = 'Синхронизация ещё запускается. Подожди секунду и попробуй снова.';
    return;
  }
  button.disabled = true;
  try {
    const sync = await ensureSharedSync();
    if (!sync || !await pushSharedState()) throw new Error('save_failed');
    const link = new URL(window.location.href);
    // Put the key in the query string as well as the hash. The query survives
    // more reliably when a user adds the page to the iOS Home Screen.
    link.searchParams.set('sync', sync.secret);
    const currentView = window.location.hash && !window.location.hash.includes('sync=') ? window.location.hash : '#today';
    link.hash = currentView;
    shareLink.value = link.toString();
    shareLink.hidden = false;
    let copied = true;
    try { await navigator.clipboard.writeText(link.toString()); } catch { copied = false; }
    syncMessage.textContent = copied
      ? 'Приватная ссылка скопирована. Открой именно её в каждом браузере — изменения будут появляться при возвращении к вкладке.'
      : 'Скопируй ссылку ниже и открой именно её в каждом браузере — изменения будут появляться при возвращении к вкладке.';
  } catch {
    syncMessage.textContent = 'Не удалось создать приватную ссылку. Проверь подключение и попробуй ещё раз.';
  } finally {
    button.disabled = false;
  }
});

syncSignOut?.addEventListener('click', async () => {
  await cloudClient?.auth.signOut();
  syncDialog?.close();
});

setTimeout(mountBudgetJourney, 0);
initCloudSync();

// Budget journey: start with an intent, then keep the long journal easy to scan.
function mountBudgetJourney() {
  const section = $('#budget');
  const summary = section?.querySelector('.budget-summary');
  const form = $('#budgetForm');
  const list = $('#transactionList');
  if (!section || !summary || !form || !list || section.dataset.journeyMounted) return;
  section.dataset.journeyMounted = 'true';
  let categoryFilter = null;

  const quick = document.createElement('div');
  quick.className = 'budget-quick-actions';
  quick.setAttribute('aria-label', 'Быстрые действия бюджета');
  quick.innerHTML = '<button type="button" class="budget-quick-action is-active" data-budget-action="expense"><span>−</span><strong>Расход</strong><small>покупка или услуга</small></button><button type="button" class="budget-quick-action" data-budget-action="income"><span>＋</span><strong>Доход</strong><small>зарплата, возврат или перевод</small></button>';
  form.before(quick);
  const entryHeading = section.querySelector('.budget-entry-heading h2');
  if (entryHeading) entryHeading.textContent = 'Добавить запись';

  const formHint = document.createElement('p');
  formHint.className = 'budget-flow-hint';
  formHint.textContent = 'Начни с названия и суммы — дополнительные детали можно уточнить ниже.';
  form.before(formHint);
  const addButton = form.querySelector('[aria-label="Добавить операцию"]');
  if (addButton) addButton.textContent = 'Добавить';

  const ledgerHead = document.createElement('div');
  ledgerHead.className = 'budget-ledger-head';
  ledgerHead.innerHTML = '<div><p class="eyebrow">ИСТОРИЯ</p><h3>Операции</h3></div><span id="budgetTransactionCount" class="progress"></span>';
  list.before(ledgerHead);
  const tools = document.createElement('div');
  tools.className = 'budget-ledger-tools';
  tools.innerHTML = '<select id="budgetLedgerFilter" aria-label="Показать операции"><option value="all">Все операции</option><option value="expense">Только расходы</option><option value="income">Только доходы</option><option value="transfer">Только переводы</option></select><input id="budgetLedgerSearch" type="search" placeholder="Найти в журнале…" aria-label="Поиск по операциям" />';
  list.before(tools);

  const chartWrap = section.querySelector('.chart-wrap');
  const chartEmpty = document.createElement('p');
  chartEmpty.className = 'budget-chart-empty';
  chartEmpty.hidden = true;
  chartEmpty.textContent = 'Добавьте расход в выбранной валюте — здесь появится диаграмма.';
  chartWrap?.after(chartEmpty);
  const chartCard = section.querySelector('.budget-chart-card');
  const layout = section.querySelector('.budget-layout');
  const mobileLayout = window.matchMedia('(max-width: 760px)');
  const placeChartForViewport = () => {
    if (!chartCard || !layout) return;
    if (mobileLayout.matches) form.after(chartCard);
    else if (chartCard.parentElement !== layout) layout.prepend(chartCard);
  };
  placeChartForViewport();
  mobileLayout.addEventListener?.('change', placeChartForViewport);
  const updateChartEmptyState = () => {
    const selectedCurrency = $('#budgetCurrencyFilter')?.value;
    const hasExpenses = state.budget.transactions.some(item => budgetChartIncludes(item, selectedCurrency));
    if (chartWrap) chartWrap.hidden = !hasExpenses;
    chartEmpty.hidden = hasExpenses;
    chartEmpty.textContent = selectedCurrency === 'ALL' ? 'Добавьте расход в любой валюте — здесь появится общий график в евро.' : 'Добавьте расход в выбранной валюте — здесь появится диаграмма.';
  };

  const typeSelect = $('#transactionType');
  const nameInput = $('#transactionName');
  quick.querySelectorAll('[data-budget-action]').forEach(button => {
    button.addEventListener('click', () => {
      const type = button.dataset.budgetAction;
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event('change'));
      quick.querySelectorAll('.budget-quick-action').forEach(item => item.classList.toggle('is-active', item === button));
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInput?.focus({ preventScroll: true });
    });
  });

  const applyLedgerView = () => {
    const mode = $('#budgetLedgerFilter')?.value || 'all';
    const needle = ($('#budgetLedgerSearch')?.value || '').trim().toLocaleLowerCase('ru');
    const entries = budgetEntriesByDate();
    let shown = 0;
    list.querySelectorAll('.transaction').forEach((row, index) => {
      const item = entries[index];
      if (!item) return;
      const haystack = `${item.name} ${item.category} ${item.date} ${item.comment || ''}`.toLocaleLowerCase('ru');
    const categoryMatches = !categoryFilter || (item.category === categoryFilter && budgetChartIncludes(item, $('#budgetCurrencyFilter')?.value));
    const visible = (mode === 'all' || item.type === mode) && categoryMatches && (!needle || haystack.includes(needle));
      row.hidden = !visible;
      if (visible) shown += 1;
    });
    const count = $('#budgetTransactionCount');
    if (count) count.textContent = categoryFilter ? `${shown} · ${categoryFilter}` : needle || mode !== 'all' ? `${shown} найдено` : `${shown} записей`;
    section.querySelectorAll('#chartLegend > div').forEach(row => row.classList.toggle('is-selected', row.dataset.category === categoryFilter));
  };
  const bindCategoryFilter = () => {
    const chart = $('#budgetChart');
    const legend = $('#chartLegend');
    const selectedCurrency = $('#budgetCurrencyFilter')?.value;
    const parts = {};
    budgetChartExpenses(state.budget.transactions, selectedCurrency)
      .forEach(item => { parts[item.category] = (parts[item.category] || 0) + item.amount; });
    const segments = Object.entries(parts).map(([category, amount]) => ({ category, amount }));
    const choose = category => { categoryFilter = categoryFilter === category ? null : category; applyLedgerView(); };
    legend.querySelectorAll(':scope > div').forEach((row, index) => {
      const segment = segments[index];
      if (!segment) return;
      row.dataset.category = segment.category;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-pressed', String(categoryFilter === segment.category));
      row.title = `Показать операции: ${segment.category}`;
      row.onclick = () => choose(segment.category);
      row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(segment.category); } };
    });
    if (!segments.length) { chart.onclick = null; chart.removeAttribute('title'); return; }
    chart.title = 'Нажмите на сектор, чтобы показать операции этой категории';
    chart.tabIndex = 0;
    chart.setAttribute('role', 'button');
    chart.setAttribute('aria-label', 'Диаграмма расходов: нажмите на сектор, чтобы отфильтровать операции');
    chart.onclick = event => {
      const rect = chart.getBoundingClientRect();
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      if (Math.hypot(dx, dy) < rect.width * .2) return;
      const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
      const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
      let edge = 0;
      const segment = segments.find(item => { edge += item.amount / total * 360; return angle < edge; });
      if (segment) choose(segment.category);
    };
  };
  const baseBudgetRender = renderBudget;
  renderBudget = () => { baseBudgetRender(); updateChartEmptyState(); bindCategoryFilter(); applyLedgerView(); };
  $('#budgetCurrencyFilter').onchange = renderBudget;
  $('#budgetLedgerFilter').addEventListener('change', applyLedgerView);
  $('#budgetLedgerSearch').addEventListener('input', applyLedgerView);
  applyLedgerView();
}
const budgetStylesheet = document.querySelector('link[href*="styles.css"]');
if (budgetStylesheet && !budgetStylesheet.href.includes('v=51')) budgetStylesheet.href = 'styles.css?v=51&journey=1';
mountBudgetJourney();
renderBudget();

// Accounts belong to income and expense, rather than being a separate kind of record.
function mountBudgetAccounts() {
  const form = $('#budgetForm');
  const amount = $('#transactionAmount');
  const currencySelect = $('#transactionCurrency');
  if (!form || !amount || !currencySelect || $('#budgetAccountControl')) return;
  const control = document.createElement('div');
  control.id = 'budgetAccountControl';
  control.className = 'budget-account-control';
  control.innerHTML = `<button type="button" id="toggleTransactionAccount" class="budget-account-toggle">＋ счёт</button><label id="transactionAccountLabel" hidden><span></span><select id="transactionAccount" aria-label="Счёт операции"><option value="">Без счёта</option>${budgetAccounts.map(account => `<option value="${account.id}">${account.label}</option>`).join('')}</select></label>`;
  amount.after(control);
  const toggle = $('#toggleTransactionAccount');
  const label = $('#transactionAccountLabel');
  const select = $('#transactionAccount');
  const labelText = label.querySelector('span');
  const updateLabel = () => { labelText.textContent = transactionType.value === 'income' ? 'Счёт зачисления' : 'Счёт списания'; };
  toggle.onclick = () => {
    label.hidden = !label.hidden;
    toggle.classList.toggle('is-open', !label.hidden);
    toggle.textContent = label.hidden ? '＋ счёт' : '− счёт';
    if (!label.hidden) select.focus();
  };
  select.onchange = () => {
    const account = accountById(select.value);
    if (!account) return;
    currencySelect.value = account.currency;
    currencySelect.dispatchEvent(new Event('change'));
  };
  transactionType.addEventListener('change', updateLabel);
  updateLabel();
}
mountBudgetAccounts();

// Optional conversion stays in the current draft: it never creates a second record.
function mountBudgetConverter() {
  const amount = $('#transactionAmount');
  const currencySelect = $('#transactionCurrency');
  const form = $('#budgetForm');
  if (!amount || !currencySelect || !form || form.querySelector('#budgetConverter')) return;
  const converter = document.createElement('div');
  converter.id = 'budgetConverter';
  converter.className = 'budget-converter';
  converter.hidden = true;
  converter.innerHTML = '<label><span id="budgetRateLabel">Курс → RSD</span><input id="budgetEurRate" type="number" min="0" step="0.0001" inputmode="decimal" placeholder="Необязательно" aria-label="Курс валюты в RSD" /></label><output id="budgetConversionPreview" aria-live="polite"></output><button type="button" id="convertTransactionToRsd">Подставить RSD</button>';
  amount.after(converter);
  const rate = $('#budgetEurRate');
  const rateLabel = $('#budgetRateLabel');
  const preview = $('#budgetConversionPreview');
  const convert = $('#convertTransactionToRsd');
  const amountFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const refresh = () => {
    const value = Number(amount.value);
    const rateValue = Number(rate.value);
    const foreignCurrency = currencySelect.value !== 'RSD';
    const hasAmount = Number.isFinite(value) && value > 0;
    const canConvert = foreignCurrency && hasAmount && Number.isFinite(rateValue) && rateValue > 0;
    converter.hidden = !(foreignCurrency && hasAmount);
    rateLabel.textContent = `Курс ${currencySelect.value} → RSD`;
    preview.textContent = canConvert
      ? `${amountFormatter.format(value)} ${currencySelect.value} = ${amountFormatter.format(value * rateValue)} RSD`
      : foreignCurrency && hasAmount ? 'Курс необязателен — добавьте запись как есть или укажите его для пересчёта' : '';
    convert.disabled = !canConvert;
  };
  amount.addEventListener('input', refresh);
  currencySelect.addEventListener('change', refresh);
  rate.addEventListener('input', refresh);
  convert.addEventListener('click', () => {
    const value = Number(amount.value);
    const rateValue = Number(rate.value);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(rateValue) || rateValue <= 0 || currencySelect.value === 'RSD') return;
    amount.value = String(Math.round(value * rateValue * 100) / 100);
    currencySelect.value = 'RSD';
    refresh();
    amount.focus();
  });
  refresh();
}
mountBudgetConverter();

// Make the reversible archive action explicit everywhere a record can be moved.
function labelArchiveActions(root = document) {
  root.querySelectorAll('.archive-action').forEach(button => { button.textContent = 'В архив'; });
}
const renderTasksWithArchiveLabels = renderTasks;
renderTasks = () => { renderTasksWithArchiveLabels(); labelArchiveActions($('#taskList')); };
const renderPlansWithArchiveLabels = renderPlans;
renderPlans = () => { renderPlansWithArchiveLabels(); labelArchiveActions($('#plans')); };
const renderShoppingWithArchiveLabels = renderShopping;
renderShopping = () => { renderShoppingWithArchiveLabels(); labelArchiveActions($('#shopping')); };
const renderHealthWithArchiveLabels = renderHealth;
renderHealth = kind => { renderHealthWithArchiveLabels(kind); labelArchiveActions(kind === 'done' ? $('#healthDone') : $('#healthTodo')); };
const renderBudgetWithArchiveLabels = renderBudget;
renderBudget = () => { renderBudgetWithArchiveLabels(); labelArchiveActions($('#budget')); };
renderTasks(); renderPlans(); renderShopping(); renderHealth('done'); renderHealth('todo'); renderBudget();


// Notes are the landing space: lightweight, editable, and reversible through Archive.
let editingNoteId = null;
function resetNoteEditor() {
  editingNoteId = null;
  $('#noteForm')?.reset();
  $('#noteFormLabel').textContent = 'НОВАЯ ЗАМЕТКА';
  $('#noteSubmit').textContent = 'Сохранить заметку';
  $('#noteCancel').hidden = true;
}
function openNoteEditor(note) {
  editingNoteId = note.id;
  $('#noteFormLabel').textContent = 'РЕДАКТИРОВАНИЕ ЗАМЕТКИ';
  $('#noteTitle').value = note.title || '';
  $('#noteBody').value = note.body || '';
  $('#noteSubmit').textContent = 'Сохранить изменения';
  $('#noteCancel').hidden = false;
  $('#noteForm').scrollIntoView({ behavior:'smooth', block:'start' });
  $('#noteTitle').focus();
}
function insertNoteMarker(marker) {
  const body = $('#noteBody');
  const caret = body.selectionStart || 0;
  const lineStart = body.value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  if (!body.value.slice(lineStart).startsWith(marker)) body.setRangeText(marker, lineStart, lineStart, 'end');
  body.focus();
}
function renderNotes() {
  const list = $('#notesList');
  if (!list) return;
  state.notes ??= [];
  state.notes = state.notes.filter(note => note && typeof note === 'object').map(note => ({ ...note, title:String(note.title || ''), body:String(note.body || ''), updatedAt:note.updatedAt || Date.now() }));
  list.innerHTML = state.notes.length ? '' : '<p class="empty">Здесь можно оставить мысль, ссылку или важную деталь дня.</p>';
  [...state.notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(note => {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.innerHTML = '<header><time></time><div class="note-card-actions"><button class="note-edit" type="button">Изменить</button><button class="archive-action" type="button" aria-label="Архивировать заметку">В архив</button><button class="delete" type="button" aria-label="Удалить заметку">×</button></div></header><h3></h3><div class="note-card-body"></div>';
    card.querySelector('time').textContent = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short' }).format(new Date(note.updatedAt)).toUpperCase();
    card.querySelector('h3').textContent = note.title || 'Без названия';
    const body = card.querySelector('.note-card-body');
    body.textContent = note.body || 'Без текста';
    body.hidden = !note.body;
    card.querySelector('.note-edit').onclick = () => openNoteEditor(note);
    card.querySelector('.archive-action').onclick = () => {
      archiveRecord({ type:'ЗАМЕТКА', text:note.title || note.body || 'Заметка без текста', source:'note', payload:{ ...note } });
      state.notes = state.notes.filter(item => item.id !== note.id);
      save(); renderNotes();
    };
    card.querySelector('.delete').onclick = () => {
      state.notes = state.notes.filter(item => item.id !== note.id);
      save(); renderNotes();
    };
    list.append(card);
  });
}
$('#noteForm')?.addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#noteTitle'), body = $('#noteBody');
  if (!title.value.trim() && !body.value.trim()) return;
  state.notes ??= [];
  const current = editingNoteId ? state.notes.find(note => note.id === editingNoteId) : null;
  if (current) {
    current.title = title.value.trim();
    current.body = body.value.trim();
    current.updatedAt = Date.now();
  } else {
    state.notes.unshift({ id:`note-${Date.now()}-${Math.random().toString(16).slice(2)}`, title:title.value.trim(), body:body.value.trim(), updatedAt:Date.now() });
  }
  save(); renderNotes(); resetNoteEditor();
});
document.querySelectorAll('[data-note-marker]').forEach(button => button.addEventListener('click', () => insertNoteMarker(button.dataset.noteMarker)));
$('#noteCancel')?.addEventListener('click', resetNoteEditor);
resetNoteEditor();
const restoreArchiveWithNotes = restoreArchive;
restoreArchive = entry => { if (entry.source !== 'note') { restoreArchiveWithNotes(entry); renderNotes(); return; } state.notes.push(entry.payload); state.archive = state.archive.filter(item => item.id !== entry.id); save(); renderNotes(); };
const renderCloudStateWithNotes = renderCloudState;
renderCloudState = () => { renderCloudStateWithNotes(); renderNotes(); };
renderNotes();

// A same-day journal is ordered and labelled down to the second it was recorded.
const renderBudgetWithRecordedTime = renderBudget;
renderBudget = () => {
  renderBudgetWithRecordedTime();
  const entries = budgetEntriesByDate();
  document.querySelectorAll('#transactionList .transaction').forEach((row, index) => {
    const recordedAt = budgetEntryCreatedAt(entries[index]);
    if (!recordedAt) return;
    const meta = row.querySelector('.transaction-copy small') || row.querySelector('small');
    if (!meta || meta.dataset.recordedTime) return;
    meta.dataset.recordedTime = 'true';
    const time = new Intl.DateTimeFormat('ru-RU', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(recordedAt));
    meta.textContent += ` · ${time}`;
  });
};
renderBudget();


// A daily artwork and quotation replace the old task-focused landing screen.
const inspirationCatalog = [
  { quote:'В середине зимы я наконец понял, что во мне живёт непобедимое лето.', author:'Альбер Камю', title:'Звёздная ночь', artist:'Винсент ван Гог, 1889', info:'Одна из самых узнаваемых картин Ван Гога: ночное небо над Сен-Реми, написанное в 1889 году.', source:'https://en.wikipedia.org/wiki/The_Starry_Night', image:'https://commons.wikimedia.org/wiki/Special:FilePath/The%20Starry%20Night.jpg?width=1200' },
  { quote:'Нет ничего невозможного для того, кто пробует.', author:'Александр Македонский', title:'Большая волна в Канагава', artist:'Кацусика Хокусай, ок. 1831', info:'Гравюра из серии «Тридцать шесть видов Фудзи» — о силе моря и хрупкости лодок перед ним.', source:'https://en.wikipedia.org/wiki/The_Great_Wave_off_Kanagawa', image:'https://commons.wikimedia.org/wiki/Special:FilePath/The%20Great%20Wave%20off%20Kanagawa.jpg?width=1200' },
  { quote:'Будущее зависит от того, что ты делаешь сегодня.', author:'Махатма Ганди', title:'Впечатление. Восход солнца', artist:'Клод Моне, 1872', info:'Гавань Гавра на рассвете. Название этой картины дало имя импрессионизму.', source:'https://en.wikipedia.org/wiki/Impression,_Sunrise', image:'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/59/Monet_-_Impression%2C_Sunrise.jpg/1280px-Monet_-_Impression%2C_Sunrise.jpg' },
  { quote:'Красота спасёт мир.', author:'Фёдор Достоевский', title:'Рождение Венеры', artist:'Сандро Боттичелли, ок. 1485', info:'Богиня Венера выходит из моря на берег Кипра — один из символов флорентийского Возрождения.', source:'https://en.wikipedia.org/wiki/The_Birth_of_Venus', image:'https://commons.wikimedia.org/wiki/Special:FilePath/The%20Birth%20of%20Venus%20%28Botticelli%29%201.jpg?width=1200' }
];
function dailyInspirationIndex(key) { return [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % inspirationCatalog.length; }
function normalizeInspirationArchive() {
  const byDate = new Map();
  (Array.isArray(state.inspirationArchive) ? state.inspirationArchive : []).forEach(item => {
    if (item?.date && !byDate.has(item.date)) byDate.set(item.date, item);
  });
  state.inspirationArchive = [...byDate.values()].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  state.inspirationArchive.forEach(item => Object.assign(item, { date:item.date, ...inspirationCatalog[dailyInspirationIndex(item.date)] }));
}
function renderDailyInspiration() {
  const artwork = $('#dailyArtwork'); if (!artwork) return;
  state.inspirationArchive ??= [];
  normalizeInspirationArchive();
  const key = dateKey(new Date());
  const dailyArtwork = inspirationCatalog[dailyInspirationIndex(key)];
  let entry = state.inspirationArchive.find(item => item.date === key);
  let changed = false;
  if (!entry) {
    entry = { date:key, archivedAt:new Date().toISOString(), ...dailyArtwork };
    state.inspirationArchive.unshift(entry);
    changed = true;
  } else {
    const before = JSON.stringify(entry);
    Object.assign(entry, { date:key, ...dailyArtwork });
    changed = changed || before !== JSON.stringify(entry);
  }
  if (changed) save();
  $('#inspirationDate').textContent = niceDate(new Date()).toUpperCase();
  const showArtwork = (node, fallback) => {
    node.onerror = () => { node.onerror = null; node.src = fallback; };
    node.src = entry.image;
    node.alt = `${entry.title} — ${entry.artist}`;
  };
  showArtwork(artwork, 'assets-central-park-daylight.png');
  const reflection = $('#dailyArtworkReflection');
  if (reflection) showArtwork(reflection, 'assets-central-park-daylight.png');
  $('#dailyArtworkTitle').textContent = entry.title;
  $('#dailyArtworkArtist').textContent = entry.artist;
  $('#dailyArtworkInfo').textContent = entry.info;
  $('#dailyArtworkSource').href = entry.source;
  $('#dailyQuote').textContent = `«${entry.quote}»`;
  $('#dailyAuthor').textContent = `— ${entry.author}`;
  const archive = $('#inspirationArchive'); archive.innerHTML = '';
  state.inspirationArchive.forEach(item => {
    const row = document.createElement('article');
    row.innerHTML = '<time></time><p></p><small></small>';
    row.querySelector('time').textContent = item.date;
    row.querySelector('p').textContent = `«${item.quote}»`;
    row.querySelector('small').textContent = `${item.title} · ${item.artist}`;
    archive.append(row);
  });
}
const renderCloudStateWithInspiration = renderCloudState;
renderCloudState = () => { renderCloudStateWithInspiration(); renderDailyInspiration(); };
renderDailyInspiration();