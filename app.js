import * as data from './data.js';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const root = document.getElementById('app');
const status = document.getElementById('status');

const state = {
  view: 'month', // 'month' | 'day'
  year: 0,
  month: 0, // 0-based
  date: '', // 'YYYY-MM-DD' in day view
  byDate: new Map(), // 'YYYY-MM-DD' -> events, all-day first, then by time
  loaded: new Set(), // 'YYYY-MM' months whose whole grid has been fetched
  loadedDays: new Set(), // single days fetched on their own
  loading: false,
  loadError: false,
  openedFromMonth: false, // the day view sits on top of the month in history
  highlight: null, // id of an event that was just saved, animated once where it lands
  started: false,
};
let loadToken = 0;

// ---------- dates (always local 'YYYY-MM-DD' strings, never UTC)

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const monthKey = (year, month) => `${year}-${pad(month + 1)}`;
const todayISO = () => toISO(new Date());
const formatDate = (iso) => iso.split('-').reverse().join('/');
const formatLong = (iso) => `יום ${DAY_NAMES[fromISO(iso).getDay()]}, ${formatDate(iso)}`;
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(year, month, 1 - first.getDay() + i); // weeks start on Sunday
    cells.push({ iso: toISO(d), day: d.getDate(), weekday: d.getDay(), month: d.getMonth(), inMonth: d.getMonth() === month });
  }
  return cells;
}

const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eventCount = (n) => (n === 0 ? 'אין אירועים' : n === 1 ? 'אירוע אחד' : `${n} אירועים`);
const byTime = (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'he');

const icon = {
  // Arrows point the way the page moves in right-to-left: back is right, forward is left.
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

const sheet = createSheet();

// ---------- start

start();

async function start() {
  data.onSignedOut(renderLogin);
  if (await data.hasSession()) enterApp();
  else renderLogin();
}

function enterApp() {
  if (!state.started) {
    state.started = true;
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && root.querySelector('.shell')) load({ quiet: true });
    });
  }
  route();
}

// ---------- routing: #/2026-11 is a month, #/2026-11-01 is a day

function parseRoute() {
  const day = location.hash.match(/^#\/(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return { view: 'day', date: toISO(d), year: d.getFullYear(), month: d.getMonth() };
  }
  const month = location.hash.match(/^#\/(\d{4})-(\d{2})$/);
  if (month) return { view: 'month', year: Number(month[1]), month: Number(month[2]) - 1 };
  const t = new Date();
  return { view: 'month', year: t.getFullYear(), month: t.getMonth() };
}

function route() {
  const next = parseRoute();
  const sameView = next.view === state.view && root.querySelector(`.shell[data-view="${next.view}"]`);
  let direction = 0;
  if (sameView && next.view === 'month') direction = Math.sign(next.year * 12 + next.month - (state.year * 12 + state.month));
  if (sameView && next.view === 'day') direction = Math.sign(next.date.localeCompare(state.date));
  const returningTo = state.view === 'day' && next.view === 'month' ? state.date : null;
  if (next.view === 'month') state.openedFromMonth = false;

  Object.assign(state, next);
  if (state.view === 'day') renderDay(direction);
  else renderMonth(direction, returningTo);
  load();
}

function go(hash, { push = false } = {}) {
  history[push ? 'pushState' : 'replaceState'](null, '', hash);
  route();
}

function shiftMonth(delta) {
  const d = new Date(state.year, state.month + delta, 1);
  go(`#/${monthKey(d.getFullYear(), d.getMonth())}`);
  status.textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function shiftDay(delta) {
  const date = addDays(state.date, delta);
  go(`#/${date}`);
  status.textContent = dayTitle(date) + ', ' + formatDate(date);
}

function openDay(date) {
  state.openedFromMonth = true;
  go(`#/${date}`, { push: true });
}

function backToMonth() {
  if (state.openedFromMonth) history.back(); // keeps the phone's back button in step
  else go(`#/${monthKey(state.year, state.month)}`);
}

function goToday() {
  const t = new Date();
  if (state.view === 'day') go(`#/${toISO(t)}`);
  else go(`#/${monthKey(t.getFullYear(), t.getMonth())}`);
}

// ---------- data

function isKnown(date) {
  const d = fromISO(date);
  return state.loadedDays.has(date) || state.loaded.has(monthKey(d.getFullYear(), d.getMonth()));
}

async function fetchRange(from, to) {
  const events = await data.listEvents(from, to);
  for (const date of [...state.byDate.keys()]) if (date >= from && date <= to) state.byDate.delete(date);
  for (const ev of events) {
    if (!state.byDate.has(ev.date)) state.byDate.set(ev.date, []);
    state.byDate.get(ev.date).push(ev);
  }
  for (const list of state.byDate.values()) list.sort(byTime);
}

const rangeSignature = (from, to) => JSON.stringify([...state.byDate].filter(([date]) => date >= from && date <= to).sort());

async function load({ quiet = false } = {}) {
  const token = ++loadToken;
  const isDay = state.view === 'day';
  const cells = monthCells(state.year, state.month);
  const [from, to] = isDay ? [state.date, state.date] : [cells[0].iso, cells[cells.length - 1].iso];
  const known = isDay ? isKnown(state.date) : state.loaded.has(monthKey(state.year, state.month));
  const before = rangeSignature(from, to);
  const hadError = state.loadError;

  if (!known && !quiet) {
    state.loading = true;
    renderContent();
  }
  try {
    await fetchRange(from, to);
    if (isDay) state.loadedDays.add(state.date);
    else state.loaded.add(monthKey(state.year, state.month));
    if (token !== loadToken) return;
    state.loadError = false;
  } catch (error) {
    if (token !== loadToken) return;
    if (data.isAuthError(error)) return renderLogin();
    state.loadError = true;
  }
  const changed = state.loading || state.loadError !== hadError || rangeSignature(from, to) !== before;
  state.loading = false;
  if (changed) renderContent(); // nothing new: keep the screen as is, so nothing flickers
}

function findEvent(id) {
  for (const list of state.byDate.values()) {
    const ev = list.find((x) => x.id === id);
    if (ev) return ev;
  }
  return null;
}

function removeFromCache(id) {
  for (const [date, list] of state.byDate) {
    const i = list.findIndex((x) => x.id === id);
    if (i !== -1) {
      list.splice(i, 1);
      if (!list.length) state.byDate.delete(date);
    }
  }
}

// Put a saved event into the cache, wherever it was before.
function placeEvent(ev) {
  removeFromCache(ev.id);
  if (!state.byDate.has(ev.date)) state.byDate.set(ev.date, []);
  state.byDate.get(ev.date).push(ev);
  state.byDate.get(ev.date).sort(byTime);
}

// After saving, show the event where it landed: its day in day view, its month in month view.
function showSaved(ev) {
  state.highlight = ev.id;
  const d = fromISO(ev.date);
  if (state.view === 'day' && ev.date !== state.date) go(`#/${ev.date}`);
  else if (state.view === 'month' && (d.getFullYear() !== state.year || d.getMonth() !== state.month)) go(`#/${monthKey(d.getFullYear(), d.getMonth())}`);
  else renderContent();
}

// The day a new event starts on: the day on screen, or today, or the 1st of the month on screen.
function defaultDate() {
  if (state.view === 'day') return state.date;
  const today = todayISO();
  return today.startsWith(monthKey(state.year, state.month)) ? today : `${monthKey(state.year, state.month)}-01`;
}

// ---------- screens

root.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'prev') shiftMonth(-1);
  else if (action === 'next') shiftMonth(1);
  else if (action === 'prev-day') shiftDay(-1);
  else if (action === 'next-day') shiftDay(1);
  else if (action === 'open-day') openDay(target.dataset.date);
  else if (action === 'to-month') backToMonth();
  else if (action === 'today') goToday();
  else if (action === 'retry') load();
  else if (action === 'add') sheet.open({ date: defaultDate() });
  else if (action === 'edit') {
    const ev = findEvent(target.dataset.id);
    if (ev) sheet.open({ event: ev });
  }
});

// After deleting, the row slides away before the list closes the gap.
function showDeleted(id) {
  const row = root.querySelector(`.row[data-id="${id}"]`);
  if (!row) return renderContent();
  row.classList.add('is-leaving');
  setTimeout(renderContent, 240);
}

const renderContent = () => (state.view === 'day' ? renderAgenda() : renderGrid());
const dayTitle = (date) => `יום ${DAY_NAMES[fromISO(date).getDay()]}`;

const dockHTML = `
  <nav class="dock" aria-label="פעולות">
    <button class="btn btn-primary btn-add" data-action="add">${icon.plus}הוסף אירוע</button>
    <button class="btn btn-soft" data-action="today">היום</button>
  </nav>`;

const topActionsHTML = `
  <button class="btn btn-primary btn-top" data-action="add">${icon.plus}הוסף</button>
  <button class="btn btn-soft btn-top" data-action="today">היום</button>`;

const bannerHTML = `
  <div class="banner" hidden>
    <span>לא הצלחנו לטעון את האירועים.</span>
    <button data-action="retry">נסה שוב</button>
  </div>`;

function renderLogin() {
  const now = new Date();
  root.innerHTML = `
    <section class="login">
      <div class="login-card">
        <div class="login-mark" aria-hidden="true">
          <span>${MONTHS[now.getMonth()]}</span>
          <strong class="display">${now.getDate()}</strong>
        </div>
        <h1 class="display">לוח השנה שלי</h1>
        <p class="login-date">${dayTitle(todayISO())}, ${formatDate(todayISO())}</p>
        <form id="login-form" novalidate>
          <input class="sr-only" type="text" name="username" autocomplete="username" value="tal" tabindex="-1" aria-hidden="true">
          <label for="password">סיסמה</label>
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
          <p class="field-error" id="login-error" role="alert"></p>
          <button class="btn btn-primary btn-block" type="submit">כניסה</button>
        </form>
      </div>
    </section>`;

  const form = root.querySelector('#login-form');
  const input = root.querySelector('#password');
  const error = root.querySelector('#login-error');
  const button = form.querySelector('button');
  const showError = (message) => {
    error.textContent = message;
    input.classList.toggle('is-invalid', Boolean(message));
  };
  input.addEventListener('input', () => showError(''));
  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value) return showError('הקלד סיסמה');
    button.disabled = true;
    button.textContent = 'נכנס…';
    try {
      await data.signIn(input.value);
      enterApp();
    } catch (err) {
      if (err instanceof data.WrongPasswordError) {
        showError('הסיסמה שגויה');
        input.value = '';
      } else {
        showError('אין חיבור לאינטרנט. נסה שוב');
      }
      button.disabled = false;
      button.textContent = 'כניסה';
      input.focus();
    }
  });
}

// ----- month

function renderMonth(direction, returningTo) {
  if (!root.querySelector('.shell[data-view="month"]')) {
    root.innerHTML = `
      <div class="shell" data-view="month">
        <header class="topbar">
          <h1 class="display month-title"></h1>
          <div class="topbar-actions">
            ${topActionsHTML}
            <button class="icon-btn" data-action="prev" aria-label="החודש הקודם">${icon.back}</button>
            <button class="icon-btn" data-action="next" aria-label="החודש הבא">${icon.forward}</button>
          </div>
        </header>
        ${bannerHTML}
        <section class="month-card view-enter">
          <div class="weekdays" aria-hidden="true">${DAY_LETTERS.map((l) => `<span>${l}</span>`).join('')}</div>
          <div class="grid"></div>
        </section>
        ${dockHTML}
      </div>`;
  }
  root.querySelector('.month-title').innerHTML = `${MONTHS[state.month]} <span class="year">${state.year}</span>`;
  renderGrid(direction);
  if (returningTo) root.querySelector(`.day[data-date="${returningTo}"]`)?.focus({ preventScroll: true });
}

function renderGrid(direction = 0) {
  const grid = root.querySelector('.grid');
  if (!grid) return;
  const focused = document.activeElement?.dataset?.date;
  const today = todayISO();
  const skeleton = state.loading && !state.loaded.has(monthKey(state.year, state.month));

  grid.innerHTML = monthCells(state.year, state.month).map((cell) => {
    const events = state.byDate.get(cell.iso) ?? [];
    const isToday = cell.iso === today;
    const label = `${isToday ? 'היום, ' : ''}יום ${DAY_NAMES[cell.weekday]}, ${cell.day} ב${MONTHS[cell.month]}, ${eventCount(events.length)}`;
    const shown = events.length > 3 ? events.slice(0, 2) : events;
    const isNew = (ev) => (ev.id === state.highlight ? ' is-new' : '');
    const marks = skeleton && cell.inMonth
      ? '<span class="skel"></span>'
      : events.slice(0, 3).map((ev) => `<i class="${isNew(ev)}"></i>`).join('');
    const chips = skeleton && cell.inMonth
      ? '<span class="skel"></span>'
      : shown.map((ev) => `
          <span class="chip${ev.time ? '' : ' is-allday'}${isNew(ev)}">
            ${ev.time ? `<span class="t">${ev.time}</span>` : ''}<span class="n">${escapeHTML(ev.title)}</span>
          </span>`).join('') + (events.length > shown.length ? `<span class="more">+${events.length - shown.length} נוספים</span>` : '');
    return `
      <button class="day${cell.inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}" data-action="open-day" data-date="${cell.iso}" aria-label="${label}">
        <span class="num">${cell.day}</span>
        <span class="marks" aria-hidden="true">${marks}</span>
        <span class="chips" aria-hidden="true">${chips}</span>
      </button>`;
  }).join('');

  root.querySelector('.banner').hidden = !state.loadError;
  animate(grid, direction);
  if (focused) grid.querySelector(`[data-date="${focused}"]`)?.focus();
  if (!skeleton) state.highlight = null;
}

// ----- day

function renderDay(direction) {
  if (!root.querySelector('.shell[data-view="day"]')) {
    root.innerHTML = `
      <div class="shell" data-view="day">
        <header class="topbar">
          <button class="back-link" data-action="to-month">${icon.back}<span class="back-label"></span></button>
          <div class="topbar-actions">
            ${topActionsHTML}
            <button class="icon-btn" data-action="prev-day" aria-label="יום קודם">${icon.back}</button>
            <button class="icon-btn" data-action="next-day" aria-label="יום הבא">${icon.forward}</button>
          </div>
        </header>
        <div class="day-head view-enter">
          <h1 class="display day-title" tabindex="-1"></h1>
          <p class="day-date"></p>
        </div>
        ${bannerHTML}
        <section class="agenda-card view-enter" aria-label="האירועים של היום"><div class="agenda"></div></section>
        ${dockHTML}
      </div>`;
    root.querySelector('.day-title').focus({ preventScroll: true });
  }
  const isToday = state.date === todayISO();
  root.querySelector('.back-label').textContent = MONTHS[state.month];
  root.querySelector('.back-link').setAttribute('aria-label', `חזרה ל${MONTHS[state.month]} ${state.year}`);
  root.querySelector('.day-title').innerHTML = `${dayTitle(state.date)}${isToday ? ' <span class="today-pill">היום</span>' : ''}`;
  root.querySelector('.day-date').textContent = formatDate(state.date);
  animate(root.querySelector('.day-head'), direction);
  renderAgenda(direction);
}

function renderAgenda(direction = 0) {
  const agenda = root.querySelector('.agenda');
  if (!agenda) return;
  const events = state.byDate.get(state.date) ?? [];

  const skeleton = state.loading && !isKnown(state.date);
  if (skeleton) {
    agenda.innerHTML = [72, 54, 64].map((w) => `
      <div class="row" aria-hidden="true"><span class="skel when-skel"></span><span class="skel" style="width:${w}%"></span></div>`).join('');
  } else if (events.length === 0) {
    agenda.innerHTML = `
      <div class="agenda-empty">
        <p>אין אירועים ביום הזה</p>
        <button class="btn btn-primary" data-action="add">${icon.plus}הוסף</button>
      </div>`;
  } else {
    agenda.innerHTML = `<ol class="rows">${events.map((ev) => `
      <li>
        <button class="row${ev.time ? '' : ' is-allday'}${ev.id === state.highlight ? ' is-new' : ''}" data-action="edit" data-id="${ev.id}"
          aria-label="עריכת ${escapeHTML(ev.title)}, ${ev.time ?? 'כל היום'}">
          <span class="when">${ev.time ?? 'כל היום'}</span>
          <span class="what">${escapeHTML(ev.title)}</span>
        </button>
      </li>`).join('')}</ol>`;
  }

  root.querySelector('.banner').hidden = !state.loadError;
  animate(agenda, direction);
  if (!skeleton) state.highlight = null;
}

function animate(el, direction) {
  if (!direction) return;
  el.classList.remove('enter-next', 'enter-prev');
  void el.offsetWidth; // restart the animation
  el.classList.add(direction > 0 ? 'enter-next' : 'enter-prev');
}

// ---------- event sheet: add (and later edit) an event

function createSheet() {
  const el = document.createElement('dialog');
  el.className = 'sheet';
  el.setAttribute('aria-labelledby', 'sheet-title');
  el.innerHTML = `
    <form class="sheet-form" novalidate>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 class="display sheet-title" id="sheet-title" tabindex="-1">אירוע חדש</h2>
        <button type="button" class="link-btn is-danger" data-delete>מחק</button>
      </div>
      <div class="field">
        <label for="ev-title">שם</label>
        <input class="input" id="ev-title" name="title" maxlength="200" autocomplete="off" enterkeyhint="done" aria-describedby="ev-title-error">
        <p class="field-error" id="ev-title-error"></p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="ev-date">תאריך</label>
          <div class="picker"><span class="picker-value" data-show="date"></span><input id="ev-date" name="date" type="date" required></div>
        </div>
        <div class="field">
          <div class="label-row">
            <label for="ev-time">שעה (לא חובה)</label>
            <button type="button" class="link-btn" data-clear-time>בלי שעה</button>
          </div>
          <div class="picker"><span class="picker-value" data-show="time"></span><input id="ev-time" name="time" type="time"></div>
        </div>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions" data-main-actions>
        <button type="submit" class="btn btn-primary" data-save>שמור</button>
        <button type="button" class="btn btn-ghost" data-cancel>ביטול</button>
      </div>
      <div class="confirm" data-confirm hidden>
        <p>למחוק את האירוע?</p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-danger" data-confirm-delete>מחק</button>
          <button type="button" class="btn btn-ghost" data-keep>ביטול</button>
        </div>
      </div>
    </form>`;
  document.body.append(el);

  const form = el.querySelector('form');
  const titleInput = el.querySelector('#ev-title');
  const dateInput = el.querySelector('#ev-date');
  const timeInput = el.querySelector('#ev-time');
  const titleError = el.querySelector('#ev-title-error');
  const formError = el.querySelector('.form-error');
  const saveButton = el.querySelector('[data-save]');
  const clearTime = el.querySelector('[data-clear-time]');
  const deleteButton = el.querySelector('[data-delete]');
  const mainActions = el.querySelector('[data-main-actions]');
  const confirmBox = el.querySelector('[data-confirm]');
  const confirmButton = el.querySelector('[data-confirm-delete]');
  let editing = null;
  let closing = false;

  const askToDelete = (asking) => {
    confirmBox.hidden = !asking;
    mainActions.hidden = asking;
    formError.textContent = '';
    if (asking) el.querySelector('[data-keep]').focus();
  };

  deleteButton.addEventListener('click', () => askToDelete(true));
  el.querySelector('[data-keep]').addEventListener('click', () => { askToDelete(false); deleteButton.focus(); });
  confirmButton.addEventListener('click', async () => {
    confirmButton.disabled = true;
    confirmButton.textContent = 'מוחק…';
    const { id } = editing;
    try {
      await data.deleteEvent(id);
      removeFromCache(id);
      close();
      status.textContent = 'האירוע נמחק';
      showDeleted(id);
    } catch (err) {
      if (data.isAuthError(err)) {
        close();
        renderLogin();
        return;
      }
      formError.textContent = 'המחיקה נכשלה, נסה שוב';
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = 'מחק';
    }
  });

  // Date and time are shown in Israeli format by us; the phone's own picker opens on tap.
  const sync = () => {
    el.querySelector('[data-show="date"]').textContent = dateInput.value ? formatLong(dateInput.value) : 'בחר תאריך';
    const shownTime = el.querySelector('[data-show="time"]');
    shownTime.textContent = timeInput.value || 'כל היום';
    shownTime.classList.toggle('is-placeholder', !timeInput.value);
    clearTime.hidden = !timeInput.value;
  };
  const setTitleError = (message) => {
    titleError.textContent = message;
    titleInput.classList.toggle('is-invalid', Boolean(message));
    titleInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const setBusy = (busy) => {
    saveButton.disabled = busy;
    saveButton.textContent = busy ? 'שומר…' : 'שמור';
  };

  for (const input of [dateInput, timeInput]) {
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* the browser opens its own */ } });
  }
  clearTime.addEventListener('click', () => { timeInput.value = ''; sync(); timeInput.focus(); });
  titleInput.addEventListener('input', () => setTitleError(''));
  el.querySelector('[data-cancel]').addEventListener('click', close);
  el.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  el.addEventListener('click', (e) => { if (e.target === el) close(); }); // tap outside the sheet

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      setTitleError('חסר שם לאירוע');
      titleInput.focus();
      return;
    }
    if (!dateInput.value) {
      formError.textContent = 'חסר תאריך';
      return;
    }
    formError.textContent = '';
    setBusy(true);
    const fields = { title, date: dateInput.value, time: timeInput.value || null };
    try {
      const saved = editing ? await data.updateEvent(editing.id, fields) : await data.addEvent(fields);
      placeEvent(saved);
      close();
      status.textContent = 'האירוע נשמר';
      showSaved(saved);
    } catch (err) {
      setBusy(false);
      if (data.isAuthError(err)) {
        close();
        renderLogin();
        return;
      }
      formError.textContent = 'השמירה נכשלה, נסה שוב'; // what was typed stays in the form
    }
  });

  // On phones the keyboard covers the bottom of the screen; lift the sheet above it.
  const vv = window.visualViewport;
  const onViewport = () => el.style.setProperty('--keyboard', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  const trackKeyboard = (on) => {
    if (!vv) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    vv[method]('resize', onViewport);
    vv[method]('scroll', onViewport);
    if (on) onViewport();
    else el.style.removeProperty('--keyboard');
  };

  function open({ date, event = null }) {
    editing = event;
    el.querySelector('#sheet-title').textContent = event ? 'עריכת אירוע' : 'אירוע חדש';
    titleInput.value = event?.title ?? '';
    dateInput.value = event?.date ?? date;
    timeInput.value = event?.time ?? '';
    setTitleError('');
    askToDelete(false);
    deleteButton.hidden = !event;
    setBusy(false);
    sync();
    closing = false;
    el.classList.remove('is-closing');
    el.showModal();
    trackKeyboard(true);
    // A new event starts with typing; an existing one may just be deleted, so don't pop the keyboard.
    if (event) el.querySelector('#sheet-title').focus();
    else titleInput.focus();
  }

  function close() {
    if (!el.open || closing) return;
    closing = true;
    el.classList.add('is-closing');
    const onEnd = (e) => { if (e.target === el) done(); };
    const done = () => {
      if (!closing) return;
      closing = false;
      el.removeEventListener('animationend', onEnd);
      el.classList.remove('is-closing');
      el.close();
      trackKeyboard(false);
    };
    el.addEventListener('animationend', onEnd);
    setTimeout(done, 260);
  }

  return { open };
}
