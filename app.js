const $ = (s) => document.querySelector(s);
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
state.selfCareDaily ??= {};
const SYNC_CONFIG = { url: 'https://ucwiohxqtmdzlsboveie.supabase.co', key: 'sb_publishable_MACL1sYFp5rUQAkB26M4kQ_Bys6WsD1' };
let cloudClient = null, cloudUser = null, cloudSyncTimer = null, cloudHydrating = false;
let sharedSync = null, sharedSyncTimer = null, sharedHydrating = false;
let selectedDate = new Date(); selectedDate.setHours(0,0,0,0); let month = new Date(selectedDate);
const save = () => { localStorage.setItem('night-notes-v1', JSON.stringify(state)); renderArchive(); queueCloudSave(); queueSharedSave(); };
function setSyncStatus(message, synced = false) { const button = $('#syncAccount'); if (!button) return; button.classList.toggle('is-synced', synced); button.title = message; button.setAttribute('aria-label', message); }
function queueCloudSave() { if (!cloudClient || !cloudUser || cloudHydrating) return; clearTimeout(cloudSyncTimer); cloudSyncTimer = setTimeout(pushCloudState, 650); }
async function pushCloudState() { if (!cloudClient || !cloudUser) return; const { error } = await cloudClient.from('notebook_state').upsert({ user_id: cloudUser.id, payload: state, updated_at: new Date().toISOString() }); if (error) setSyncStatus('Ошибка синхронизации'); else setSyncStatus(`Синхронизировано: ${cloudUser.email || 'твой аккаунт'}`, true); }

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
  if (!cloudClient || !sharedSync || sharedHydrating) return;
  const payload = await encryptSharedState(sharedSync.secret, state);
  const { error } = await cloudClient.rpc('save_shared_notebook', { p_sync_id: sharedSync.id, p_payload: payload });
  if (error) setSyncStatus('Ошибка приватной синхронизации');
  else setSyncStatus('Приватная ссылка синхронизирована', true);
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
  if (remoteState && hasNotebookEntries(localSnapshot) && !hasNotebookEntries(remoteState)) {
    await pushSharedState();
  } else if (remoteState) {
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
      const archive=document.createElement('button'); archive.type='button'; archive.className='archive-action'; archive.textContent='↙'; archive.setAttribute('aria-label',`Архивировать: ${text}`); archive.onclick=()=>{const value=input.value.trim()||text;archiveRecord({type:'ПЛАН',text:value,source:'plan',payload:{key,text:value}});state.plans[key].splice(i,1);save();renderPlans()};
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
function allEvents(key){return [
  ...(state.events[key]||[]).map((event,index)=>({...event,source:'local',index})),
  ...state.imports.map((event,index)=>event.date===key?{...event,source:'import',index}:null).filter(Boolean)
]}
function renderCalendar(){ const y=month.getFullYear(),m=month.getMonth();$('#monthTitle').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(month);const grid=$('#calendarGrid');grid.innerHTML=''; const start=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate(); for(let i=0;i<start;i++){let e=document.createElement('span');e.className='day empty';grid.append(e)} for(let d=1;d<=days;d++){const date=new Date(y,m,d),k=dateKey(date),b=document.createElement('button');b.className='day'+(dateKey(new Date())===k?' today':'')+(dateKey(selectedDate)===k?' selected':'')+(allEvents(k).length?' has-event':'');b.textContent=d;b.onclick=()=>{selectedDate=date;renderCalendar();renderAgenda()};grid.append(b)} renderAgenda();}
function renderAgenda(){const k=dateKey(selectedDate), events=allEvents(k);$('#agendaLabel').textContent=niceDate(selectedDate).toUpperCase();$('#agendaTitle').textContent=dateKey(selectedDate)===dateKey(new Date())?'Сегодня':'На этот день';const box=$('#agendaItems');box.innerHTML=events.length?'':'<p class="empty">Пока здесь свободно. В этом тоже есть свой ритм.</p>';events.forEach(e=>{const x=document.createElement('div');x.className='event';x.innerHTML=`<span class="event-time">${e.time||'ВЕСЬ ДЕНЬ'}</span><span class="event-title"></span><button class="archive-action" type="button" aria-label="Архивировать событие">↙</button><button class="delete" type="button" aria-label="Удалить событие">×</button>`;x.querySelector('.event-title').textContent=e.title;const remove=()=>{if(e.source==='local'){state.events[k].splice(e.index,1);if(!state.events[k].length)delete state.events[k]}else{state.imports.splice(e.index,1)}};x.querySelector('.archive-action').onclick=()=>{archiveRecord({type:'СОБЫТИЕ',text:e.title,source:'event',payload:{date:k,time:e.time||'ВЕСЬ ДЕНЬ',title:e.title}});remove();save();renderCalendar()};x.querySelector('.delete').onclick=()=>{remove();save();renderCalendar()};box.append(x)})}
$('#prevMonth').onclick=()=>{month.setMonth(month.getMonth()-1);renderCalendar()};$('#nextMonth').onclick=()=>{month.setMonth(month.getMonth()+1);renderCalendar()}; $('#eventForm').addEventListener('submit',e=>{e.preventDefault();const x=$('#eventInput');if(!x.value.trim())return;const k=dateKey(selectedDate);(state.events[k]??=[]).push({title:x.value.trim(),time:'МОЙ ПЛАН'});x.value='';save();renderCalendar()});
$('#importCalendar').onclick=()=>$('#icsInput').click();$('#icsInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;const raw=await f.text();let added=0;raw.split('BEGIN:VEVENT').slice(1).forEach(block=>{const val=(name)=>block.match(new RegExp(name+'(?:;[^:]*)?:(.+)'))?.[1]?.trim();const dt=val('DTSTART'),title=val('SUMMARY');if(dt&&title){const date=`${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;const time=dt.includes('T')?`${dt.slice(9,11)}:${dt.slice(11,13)}`:'ВЕСЬ ДЕНЬ';state.imports.push({date,title,time});added++}});save();renderCalendar();alert(`Импортировано событий: ${added}`);e.target.value=''};
function restoreArchive(entry){const payload=entry.payload||{};if(entry.source==='task')state.tasks.push(payload);if(entry.source==='plan')state.plans[payload.key].push(payload.text);if(entry.source==='focus'){state.focus=payload.text||entry.text;$('#focusInput').value=state.focus}if(entry.source==='event'){(state.events[payload.date]??=[]).push({title:payload.title,time:payload.time})}if(entry.source==='shopping-item'){const list=state.shoppingLists.find(x=>x.id===payload.listId)||{id:payload.listId||Date.now(),name:payload.listName||'Мой список',items:[]};if(!state.shoppingLists.includes(list))state.shoppingLists.push(list);list.items.push(payload.item)}if(entry.source==='shopping-list'){state.shoppingLists.push(payload.list)}if(entry.source==='budget')state.budget.transactions.push(payload.item);if(entry.source==='health')state.health[payload.kind].push(payload.item);state.archive=state.archive.filter(x=>x.id!==entry.id);save();renderTasks();renderPlans();renderCalendar();renderShopping();renderBudget();renderHealth('done');renderHealth('todo')}
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
if (state.budget.categorySchema !== '2026-10-v2') {
  state.budget.transactions.forEach(entry => entry.category = categoryFor(entry.name, entry.category));
  state.budget.categorySchema = '2026-10-v2';
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
  active.items.forEach(item=>{const row=document.createElement('div');row.className='shopping-item'+(item.done?' done':'');row.innerHTML='<button class="checkbox" aria-label="Отметить покупку выполненной"></button><input class="shopping-item-input" aria-label="Редактировать покупку"/><button class="archive-action" aria-label="Архивировать покупку">↙</button><button class="delete" aria-label="Удалить покупку">×</button>';const input=row.querySelector('input');input.value=item.text;input.onchange=()=>{const text=input.value.trim();if(!text)active.items=active.items.filter(x=>x.id!==item.id);else item.text=text;save();renderShopping()};row.querySelector('.checkbox').onclick=()=>{item.done=!item.done;save();renderShopping()};row.querySelector('.archive-action').onclick=()=>{archiveRecord({type:'ПОКУПКА',text:item.text,source:'shopping-item',payload:{listId:active.id,listName:active.name,item:{...item}}});active.items=active.items.filter(x=>x.id!==item.id);save();renderShopping()};row.querySelector('.delete').onclick=()=>{removeItem(active.items,item.id);renderShopping()};box.append(row)});
  const left=active.items.filter(item=>!item.done).length;
  $('#shoppingCount').textContent=`${left} / ${active.items.length}`;
}
$('#shoppingListForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#shoppingListInput');if(!input.value.trim())return;const list={id:Date.now(),name:input.value.trim(),items:[]};state.shoppingLists.push(list);state.activeShoppingListId=list.id;input.value='';save();renderShopping()});
$('#shoppingItemForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#shoppingInput'),active=activeShoppingList();if(!input.value.trim())return;active.items.push({id:Date.now(),text:input.value.trim(),done:false});input.value='';save();renderShopping()});
$('#archiveShoppingList').onclick=()=>{const active=activeShoppingList();archiveRecord({type:'СПИСОК ПОКУПОК',text:active.name,source:'shopping-list',payload:{list:{...active,items:active.items.map(item=>({...item}))}}});state.shoppingLists=state.shoppingLists.filter(list=>list.id!==active.id);if(!state.shoppingLists.length)state.shoppingLists.push({id:'main',name:'Мой список',items:[]});state.activeShoppingListId=state.shoppingLists[0].id;save();renderShopping()};
$('#deleteShoppingList').onclick=()=>{const active=activeShoppingList();state.shoppingLists=state.shoppingLists.filter(list=>list.id!==active.id);if(!state.shoppingLists.length)state.shoppingLists.push({id:'main',name:'Мой список',items:[]});state.activeShoppingListId=state.shoppingLists[0].id;save();renderShopping()};
function renderBudget(){ const tx=state.budget.transactions;const code=x=>x.currency||'RUB';const totals=type=>{const result={};tx.filter(x=>x.type===type).forEach(x=>result[code(x)]=(result[code(x)]||0)+x.amount);return result};const moneySet=values=>Object.entries(values).map(([c,v])=>currency(v,c)).join(' · ')||'—';const income=totals('income'),expense=totals('expense'),balance={};new Set([...Object.keys(income),...Object.keys(expense)]).forEach(c=>balance[c]=(income[c]||0)-(expense[c]||0));$('#incomeTotal').textContent=moneySet(income);$('#expenseTotal').textContent=moneySet(expense);$('#balanceTotal').textContent=moneySet(balance);const selected=$('#budgetCurrencyFilter').value;const filtered=tx.filter(x=>x.type==='expense'&&code(x)===selected);const parts={};filtered.forEach(x=>parts[x.category]=(parts[x.category]||0)+x.amount);const sum=list=>list.reduce((total,item)=>total+item.amount,0);const byCategory=category=>filtered.filter(item=>item.category===category);const food=[...byCategory('Доставка еды'),...byCategory('Рестораны и кофе')];const rides=byCategory('Такси');const pending=filtered.filter(item=>/в обработке/i.test(item.name));const insights=[['ЕДА ВНЕ ДОМА',currency(sum(food),selected),`${food.length} ${food.length===1?'операция':'операций'}`],['ТАКСИ',currency(sum(rides),selected),`${rides.length} ${rides.length===1?'поездка':'поездок'}`],['В ОБРАБОТКЕ',currency(sum(pending),selected),pending.length?`${pending.length} ${pending.length===1?'операция':'операций'}`:'всё подтверждено']];const insightBox=$('#budgetInsights');insightBox.innerHTML='';insights.forEach(([label,value,note])=>{const item=document.createElement('article');item.className='budget-insight';item.innerHTML='<small></small><strong></strong><span></span>';item.querySelector('small').textContent=label;item.querySelector('strong').textContent=value;item.querySelector('span').textContent=note;insightBox.append(item)});const colors=['#c87532','#ddb06b','#9aa881','#b9765e','#9f8aa0','#7f9eab','#b8a596'];const total=filtered.reduce((s,x)=>s+x.amount,0);let offset=0,stops=[];Object.entries(parts).forEach(([key,value],i)=>{const p=value/total*100;stops.push(`${colors[i%colors.length]} ${offset}% ${offset+p}%`);offset+=p});$('#budgetChart').style.background=total?`conic-gradient(${stops.join(',')})`:'conic-gradient(#eadfce 0 100%)';$('#budgetChart').innerHTML=`<span>${currency(total,selected)}<small>расходы</small></span>`;const legend=$('#chartLegend');legend.innerHTML='';Object.entries(parts).forEach(([key,value],i)=>{const row=document.createElement('div');row.innerHTML=`<i style="background:${colors[i%colors.length]}"></i><span>${key}</span><strong>${currency(value,selected)}</strong>`;legend.append(row)});const list=$('#transactionList');list.innerHTML=tx.length?'':'<p class="empty">Добавьте первую запись — диаграмма появится здесь.</p>';[...tx].reverse().forEach(item=>{const row=document.createElement('div');row.className='transaction';row.innerHTML='<div><strong></strong><small></small></div><span></span><button class="archive-action" aria-label="Архивировать запись">↙</button><button class="delete" aria-label="Удалить запись">×</button>';row.querySelector('strong').textContent=item.name;const route=item.type==='transfer'&&item.fromAccount&&item.toAccount?`${item.fromAccount} → ${item.toAccount} · `:'';row.querySelector('small').textContent=`${route}${item.category} · ${item.date||'без даты'}`;row.querySelector('span').textContent=(item.type==='income'?'+ ':item.type==='transfer'?'↔ ':'− ')+currency(item.amount,code(item));row.querySelector('span').className=item.type;row.querySelector('.archive-action').onclick=()=>{archiveRecord({type:item.type==='income'?'ДОХОД':item.type==='transfer'?'ПЕРЕВОД':'РАСХОД',text:`${item.name} · ${currency(item.amount,code(item))}`,source:'budget',payload:{item:{...item}}});state.budget.transactions=state.budget.transactions.filter(x=>x.id!==item.id);save();renderBudget()};row.querySelector('.delete').onclick=()=>{removeItem(tx,item.id);renderBudget()};list.append(row)});}
$('#transactionDate').value=new Date().toISOString().slice(0,10);
$('#budgetCurrencyFilter').onchange=renderBudget;
const expenseCategories=['Доставка еды','Рестораны и кофе','Продукты','Такси','Авиабилеты','Дом и аренда','Стоматолог','Аптека и здоровье','Массаж и уход','Связь и подписки','Мобильный кэш · Катя','Красота','Досуг','Прочее'];
const incomeCategories=['Зарплата','Перевод от себя','Возврат','Подарок','Другое'];
const transactionType=$('#transactionType'), transactionCategory=$('#transactionCategory'), transferFrom=$('#transferFrom'), transferTo=$('#transferTo');
function refreshTransactionForm(){
  const type=transactionType.value;
  const categories=type==='income'?incomeCategories:type==='transfer'?['Перевод между своими картами']:expenseCategories;
  const previous=transactionCategory.value;
  transactionCategory.innerHTML=categories.map(category=>`<option>${category}</option>`).join('');
  transactionCategory.value=categories.includes(previous)?previous:categories[0];
  const isTransfer=type==='transfer';
  transferFrom.hidden=transferTo.hidden=!isTransfer;
  transferFrom.required=transferTo.required=isTransfer;
  transactionCategory.disabled=isTransfer;
}
transactionType.onchange=refreshTransactionForm;
refreshTransactionForm();
$('#budgetForm').addEventListener('submit',e=>{
  e.preventDefault();
  const name=$('#transactionName'), amount=$('#transactionAmount'), type=transactionType.value;
  if(!name.value.trim()||!Number(amount.value)||(type==='transfer'&&(!transferFrom.value.trim()||!transferTo.value.trim())))return;
  state.budget.transactions.push({id:Date.now(),name:name.value.trim(),amount:Number(amount.value),type,category:transactionCategory.value,currency:$('#transactionCurrency').value,date:$('#transactionDate').value,fromAccount:type==='transfer'?transferFrom.value.trim():'',toAccount:type==='transfer'?transferTo.value.trim():''});
  name.value='';amount.value='';transferFrom.value='';transferTo.value='';save();renderBudget();
});
function renderHealth(kind){const box=$(kind==='done'?'#healthDone':'#healthTodo'), list=state.health[kind];box.innerHTML=list.length?'':'<p class="empty">Пока ничего. Можно начать с одного маленького пункта.</p>';list.forEach(item=>{const row=document.createElement('div');row.className='health-item';row.innerHTML='<span>✦</span><span></span><button class="archive-action" aria-label="Архивировать заметку">↙</button><button class="delete" aria-label="Удалить заметку">×</button>';row.querySelectorAll('span')[1].textContent=item.text;row.querySelector('.archive-action').onclick=()=>{archiveRecord({type:'ЗДОРОВЬЕ',text:item.text,source:'health',payload:{kind,item:{...item}}});removeItem(list,item.id);renderHealth(kind)};row.querySelector('.delete').onclick=()=>{removeItem(list,item.id);renderHealth(kind)};box.append(row)});}
[['done','healthDoneForm','healthDoneInput'],['todo','healthTodoForm','healthTodoInput']].forEach(([kind,form,input])=>{$('#'+form).addEventListener('submit',e=>{e.preventDefault();const field=$('#'+input);if(!field.value.trim())return;state.health[kind].push({id:Date.now(),text:field.value.trim()});field.value='';save();renderHealth(kind)})});
$('#askChatGpt').onclick=()=>{const shopping=state.shoppingLists.flatMap(list=>list.items.filter(item=>!item.done).map(item=>`— ${list.name}: ${item.text}`)).join('\n')||'— пока нет';const tasks=state.tasks.filter(t=>!t.done).map(t=>`— ${t.text}`).join('\n')||'— пока нет';const tx=state.budget.transactions;const income=tx.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0),expense=tx.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0);const health=state.health.todo.map(x=>`— ${x.text}`).join('\n')||'— пока нет';const context=`Помоги мне мягко спланировать ближайшие дни.\n\nФокус дня: ${state.focus||'ещё не записан'}\n\nДела:\n${tasks}\n\nПокупки:\n${shopping}\n\nБюджет: доходы ${currency(income)}, расходы ${currency(expense)}.\n\nЗапланировать по здоровью:\n${health}\n\nПредложи реалистичный следующий шаг и бережный план без перегруза.`;window.open('https://chatgpt.com/','_blank','noopener');navigator.clipboard?.writeText(context).then(()=>{const label=$('.chatgpt-label');label.textContent='Контекст скопирован';setTimeout(()=>label.textContent='Спросить ChatGPT',1800)}).catch(()=>{});};
addDailySelfCare();
renderTasks();
renderShopping();renderBudget();renderHealth('done');renderHealth('todo');
$('#quickChatGpt').onclick=()=>$('#askChatGpt').click();

// Budget notes: comments can be added to new and existing entries without changing their amounts.
const budgetCommentStyles=document.createElement('style');
budgetCommentStyles.textContent=`.budget-form textarea{grid-column:span 2;padding:10px 9px;border:1px solid rgba(91,61,38,.2);background:#fffaf2;color:#493125;outline:0;font-size:12px;resize:vertical;min-height:48px}.budget-form textarea:focus,.comment-editor:focus{border-color:#c87532}.transaction{align-items:start;padding:10px 0}.transaction-copy{flex:1;display:grid;gap:2px}.transaction>span{padding-top:4px;white-space:nowrap}.transaction-comment{margin:5px 0 1px;color:#684c39;font:italic 12px/1.4 "Playfair Display",serif}.comment-action,.comment-save{width:max-content;padding:3px 0;border:0;background:transparent;color:#a85e2c;font:10px "DM Mono",monospace;letter-spacing:.02em}.comment-action:hover,.comment-save:hover{color:#704020;text-decoration:underline}.comment-editor,.comment-save{display:none}.transaction.is-editing .comment-editor,.transaction.is-editing .comment-save{display:block}.comment-editor{width:100%;margin-top:5px;padding:7px 8px;border:1px solid rgba(91,61,38,.2);background:#fffaf2;color:#493125;resize:vertical;font-size:12px}`;
document.head.append(budgetCommentStyles);
const renderBudgetBase=renderBudget;
renderBudget=()=>{renderBudgetBase();const entries=[...state.budget.transactions].reverse();document.querySelectorAll('#transactionList .transaction').forEach((row,index)=>{const item=entries[index],copy=row.querySelector('div');copy.classList.add('transaction-copy');const comment=document.createElement('p'),action=document.createElement('button'),editor=document.createElement('textarea'),saveComment=document.createElement('button');comment.className='transaction-comment';comment.textContent=item.comment||'';comment.hidden=!item.comment;action.className='comment-action';action.type='button';action.textContent=item.comment?'Изменить комментарий':'+ Комментарий';editor.className='comment-editor';editor.rows=2;editor.value=item.comment||'';editor.setAttribute('aria-label','Комментарий к операции');saveComment.className='comment-save';saveComment.type='button';saveComment.textContent='Сохранить';action.onclick=()=>{row.classList.toggle('is-editing');if(row.classList.contains('is-editing'))editor.focus()};saveComment.onclick=()=>{item.comment=editor.value.trim();save();renderBudget()};copy.append(comment,action,editor,saveComment)})};
let budgetCommentDraft=null;
$('#budgetForm').addEventListener('submit',()=>{const name=$('#transactionName').value.trim(),amount=Number($('#transactionAmount').value);budgetCommentDraft=name&&amount?$('#transactionComment').value.trim():null},true);
$('#budgetForm').addEventListener('submit',()=>{if(budgetCommentDraft===null)return;const item=state.budget.transactions.at(-1);if(item&&budgetCommentDraft)item.comment=budgetCommentDraft;budgetCommentDraft=null;$('#transactionComment').value='';save();renderBudget()});
renderBudget();

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
    // First signed-in device seeds the private row from its local notebook.
    await pushCloudState();
  }
  cloudHydrating = false;
  if (syncMessage) syncMessage.textContent = `Синхронизировано для ${cloudUser.email || 'твоего аккаунта'}.`;
  setSyncStatus(`Синхронизировано: ${cloudUser.email || 'твой аккаунт'}`, true);
}

async function initCloudSync() {
  if (!window.supabase?.createClient) {
    setSyncStatus('Синхронизация недоступна');
    return;
  }
  cloudClient = window.supabase.createClient(SYNC_CONFIG.url, SYNC_CONFIG.key);
  await ensureSharedSync();
  await hydrateSharedState();
  const { data: { session } } = await cloudClient.auth.getSession();
  cloudUser = session?.user || null;
  if (syncSignOut) syncSignOut.hidden = !cloudUser;
  if (cloudUser) await hydrateCloudState();
  else setSyncStatus(sharedSync ? 'Приватная ссылка синхронизирована' : 'Создать приватную ссылку', Boolean(sharedSync));
  cloudClient.auth.onAuthStateChange((_event, nextSession) => {
    cloudUser = nextSession?.user || null;
    if (syncSignOut) syncSignOut.hidden = !cloudUser;
    if (cloudUser) setTimeout(() => hydrateCloudState(), 0);
    else setSyncStatus(sharedSync ? 'Приватная ссылка синхронизирована' : 'Создать приватную ссылку', Boolean(sharedSync));
  });
}

$('#syncAccount').onclick = () => {
  if (!syncDialog) return;
  if (cloudUser) {
    syncMessage.textContent = `Синхронизировано для ${cloudUser.email || 'твоего аккаунта'}.`;
    syncSignOut.hidden = false;
  } else {
    syncMessage.textContent = sharedSync ? 'Приватный блокнот подключён. Создай ссылку, чтобы открыть его на телефоне.' : 'Создай приватную ссылку для телефона.';
    syncSignOut.hidden = true;
  }
  syncDialog.showModal();
};

$('#createShareLink')?.addEventListener('click', async () => {
  const sync = await ensureSharedSync();
  if (!sync) return;
  await pushSharedState();
  const link = new URL(window.location.href);
  link.hash = `sync=${encodeURIComponent(sync.secret)}`;
  try { await navigator.clipboard.writeText(link.toString()); } catch {}
  syncMessage.textContent = 'Приватная ссылка скопирована. Открой её на телефоне — блокнот загрузится автоматически.';
});

syncSignOut?.addEventListener('click', async () => {
  await cloudClient?.auth.signOut();
  syncDialog?.close();
});

initCloudSync();

