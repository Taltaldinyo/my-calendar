import * as data from './data.js?v=8';

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
  pushReady: false, // this phone is set up to receive reminders
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
  const cells = [];
  // Always six weeks, so the month keeps the same height and turning a page doesn't jump.
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - first.getDay() + i); // weeks start on Sunday
    cells.push({ iso: toISO(d), day: d.getDate(), weekday: d.getDay(), month: d.getMonth(), inMonth: d.getMonth() === month });
  }
  return cells;
}

const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eventCount = (n) => (n === 0 ? 'אין אירועים' : n === 1 ? 'אירוע אחד' : `${n} אירועים`);
const byTime = (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'he');

// Kinds are told apart by symbol and word, never by color alone.
const KIND_NAMES = { meeting: 'פגישה', work: 'עבודה', study: 'לימודים', fun: 'בילוי', medical: 'רפואי', other: 'אחר' };

const icon = {
  // Arrows point the way the page moves in right-to-left: back is right, forward is left.
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  work: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  study: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  fun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/></svg>',
  medical: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z"/></svg>',
  other: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
};

const sheet = createSheet();

// A short note that rises above the bottom bar after saving or deleting, then goes away.
const toast = document.createElement('div');
toast.className = 'toast';
toast.setAttribute('role', 'status');
document.body.append(toast);
let toastTimer;

function showToast(text) {
  toast.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${text}`;
  replay(toast, 'is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2200);
}

// ---------- start

start();

async function start() {
  // Safari on the iPhone only shows the pressed look of buttons when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  data.onSignedOut(renderLogin);
  if (await data.hasSession()) enterApp();
  else renderLogin();
}

function enterApp() {
  if (!state.started) {
    state.started = true;
    syncPush().catch(() => {}).finally(renderPushCard);
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Opening a day grows it out of the tapped square; going back shrinks it into the square again.
function route() {
  const next = parseRoute();
  const switching = next.view !== state.view && root.querySelector('.shell');
  if (!switching || !document.startViewTransition || reducedMotion()) return applyRoute(next);

  const date = next.view === 'day' ? next.date : state.date;
  const nameSquare = () => {
    const square = root.querySelector(`.day[data-date="${date}"]`);
    if (square) square.style.viewTransitionName = 'day';
  };
  if (next.view === 'day') nameSquare();
  const transition = document.startViewTransition(() => {
    applyRoute(next);
    if (next.view === 'month') nameSquare();
  });
  transition.ready.catch(() => {}); // skipped (e.g. the page isn't being drawn): the screen still switches, just without motion
  transition.finished.finally(() => {
    root.querySelectorAll('.day[style]').forEach((el) => el.style.removeProperty('view-transition-name'));
  });
}

function applyRoute(next) {
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
  const day = state.date; // what this load asked for, even if the screen moves on meanwhile
  const month = monthKey(state.year, state.month);
  const cells = monthCells(state.year, state.month);
  const [from, to] = isDay ? [day, day] : [cells[0].iso, cells[cells.length - 1].iso];
  const known = isDay ? isKnown(day) : state.loaded.has(month);
  const before = rangeSignature(from, to);
  const hadError = state.loadError;

  if (!known && !quiet) {
    state.loading = true;
    renderContent();
  }
  try {
    await fetchRange(from, to);
    if (isDay) state.loadedDays.add(day);
    else state.loaded.add(month);
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
  if (!isDay && !state.loadError) prefetchAround();
}

// Fetch the months on either side quietly, so the next page turn shows its events at once.
const prefetching = new Set();
function prefetchAround() {
  for (const delta of [-1, 1]) {
    const d = new Date(state.year, state.month + delta, 1);
    const key = monthKey(d.getFullYear(), d.getMonth());
    if (state.loaded.has(key) || prefetching.has(key)) continue;
    prefetching.add(key);
    const cells = monthCells(d.getFullYear(), d.getMonth());
    fetchRange(cells[0].iso, cells[cells.length - 1].iso)
      .then(() => state.loaded.add(key))
      .catch(() => {}) // not needed yet; the month loads normally when opened
      .finally(() => prefetching.delete(key));
  }
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

function removeSeriesFromCache(seriesId) {
  for (const [date, list] of state.byDate) {
    const kept = list.filter((x) => x.seriesId !== seriesId);
    if (kept.length) state.byDate.set(date, kept);
    else state.byDate.delete(date);
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
  else if (action === 'enable-push') enablePush(target);
  else if (action === 'dismiss-push') {
    try { localStorage.setItem('reminders-card-dismissed', '1'); } catch { /* private mode: the card just comes back */ }
    renderPushCard();
  }
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
        <div class="push-card" hidden></div>
        <section class="month-card view-enter">
          <div class="weekdays" aria-hidden="true">${DAY_LETTERS.map((l) => `<span>${l}</span>`).join('')}</div>
          <div class="grid"></div>
        </section>
        ${dockHTML}
      </div>`;
    enableSwipe(root.querySelector('.month-card'));
    renderPushCard();
  }
  const title = root.querySelector('.month-title');
  title.innerHTML = `${MONTHS[state.month]} <span class="year">${state.year}</span>`;
  if (direction) replay(title, 'title-in');
  renderGrid(direction);
  if (returningTo) root.querySelector(`.day[data-date="${returningTo}"]`)?.focus({ preventScroll: true });
}

function renderGrid(direction = 0) {
  const grid = root.querySelector('.grid');
  if (!grid) return;
  const focused = document.activeElement?.dataset?.date;
  const today = todayISO();
  const skeleton = state.loading && !state.loaded.has(monthKey(state.year, state.month));

  const html = monthCells(state.year, state.month).map((cell) => {
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
            ${ev.kind ? `<span class="k">${icon[ev.kind]}</span>` : ''}${ev.time ? `<span class="t">${ev.time}</span>` : ''}<span class="n">${escapeHTML(ev.title)}</span>
          </span>`).join('') + (events.length > shown.length ? `<span class="more">+${events.length - shown.length} נוספים</span>` : '');
    return `
      <button class="day${cell.inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}" data-action="open-day" data-date="${cell.iso}" aria-label="${label}">
        <span class="num">${cell.day}</span>
        <span class="marks" aria-hidden="true">${marks}</span>
        <span class="chips" aria-hidden="true">${chips}</span>
      </button>`;
  }).join('');

  turnPage(grid, direction, () => { grid.innerHTML = html; });
  root.querySelector('.banner').hidden = !state.loadError;
  if (focused) grid.querySelector(`[data-date="${focused}"]`)?.focus();
  if (!skeleton) state.highlight = null;
}

// Changing month turns a page, like a book read right to left: going forward, the current
// page lifts from its left edge and turns over to the right; going back, the previous page
// turns back over from the right and lies down on top.
function turnPage(grid, direction, paint) {
  if (!direction || reducedMotion()) return paint(); // e.g. events arriving mid-turn: the turn goes on
  const card = grid.parentElement;
  card.querySelectorAll('.page-ghost').forEach((ghost) => ghost.remove());
  grid.classList.remove('turn-back');

  const ghost = grid.cloneNode(true);
  ghost.classList.add('page-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    top: `${grid.offsetTop}px`,
    left: `${grid.offsetLeft}px`,
    width: `${grid.offsetWidth}px`,
    height: `${grid.offsetHeight}px`,
  });
  paint();
  card.append(ghost);

  const moving = direction > 0 ? ghost : grid;
  if (direction > 0) ghost.classList.add('turn-away');
  else {
    ghost.classList.add('lie-under');
    replay(grid, 'turn-back');
  }
  // Only the page's own turn counts; a dot or a skeleton animating inside it must not end it early.
  const onEnd = (e) => {
    if (e.target !== moving) return;
    moving.removeEventListener('animationend', onEnd);
    ghost.remove();
    grid.classList.remove('turn-back');
  };
  moving.addEventListener('animationend', onEnd);
}

// On the phone, swiping the month turns the page too. Right to left: a swipe to the right
// brings the next month, the same way the arrows point.
function enableSwipe(el) {
  let start = null;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = Date.now() - start.at < 800;
    start = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx > 0 ? 1 : -1);
  }, { passive: true });
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
        <div class="push-card" hidden></div>
        <section class="agenda-card view-enter" aria-label="האירועים של היום"><div class="agenda"></div></section>
        ${dockHTML}
      </div>`;
    root.querySelector('.day-title').focus({ preventScroll: true });
    renderPushCard();
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
    agenda.innerHTML = `<ol class="rows">${events.map((ev) => {
      const hours = ev.time ? (ev.endTime ? `${ev.time} עד ${ev.endTime}` : ev.time) : 'כל היום';
      return `
      <li>
        <button class="row${ev.time ? '' : ' is-allday'}${ev.id === state.highlight ? ' is-new' : ''}" data-action="edit" data-id="${ev.id}"
          aria-label="עריכת ${escapeHTML(ev.title)}, ${hours}${ev.kind ? `, ${KIND_NAMES[ev.kind]}` : ''}${ev.seriesId ? ', אירוע קבוע' : ''}">
          <span class="when">${ev.time ?? 'כל היום'}${ev.endTime ? `<small>${ev.endTime}</small>` : ''}</span>
          <span class="what">${escapeHTML(ev.title)}${ev.seriesId ? `<span class="repeat">${icon.repeat}</span>` : ''}${ev.remindMinutes ? `<span class="repeat">${icon.bell}</span>` : ''}${ev.kind ? `<small class="kind">${icon[ev.kind]}${KIND_NAMES[ev.kind]}</small>` : ''}</span>
        </button>
      </li>`;
    }).join('')}</ol>`;
  }

  root.querySelector('.banner').hidden = !state.loadError;
  animate(agenda, direction);
  if (!skeleton) state.highlight = null;
}

function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // restart the animation
  el.classList.add(className);
}

function animate(el, direction) {
  if (!direction) return;
  el.classList.remove('enter-next', 'enter-prev');
  replay(el, direction > 0 ? 'enter-next' : 'enter-prev');
}

// ---------- reminders on this phone

const isPhone = () => matchMedia('(pointer: coarse)').matches;
const isHomeScreenApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function base64UrlToBytes(text) {
  const base64 = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Once allowed, make sure the server knows where to send this phone's reminders.
async function syncPush() {
  if (data.isDemo || !canPush() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(await data.pushPublicKey()),
    });
  }
  await data.savePushSubscription(subscription);
  state.pushReady = true;
}

async function enablePush(button) {
  button.disabled = true;
  try {
    const permission = await Notification.requestPermission(); // must be the first thing after the tap
    if (permission === 'granted') {
      await syncPush();
      await data.sendTestPush();
      showToast('התזכורות הופעלו');
    }
  } catch {
    showToast('לא הצלחנו להפעיל תזכורות. נסה שוב');
  }
  renderPushCard();
}

// A quiet card at the top of the screen, only on the phone, until reminders are on.
function renderPushCard() {
  const card = root.querySelector('.push-card');
  if (!card) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem('reminders-card-dismissed') === '1'; } catch { /* no storage: show it */ }
  let message = null;
  let action = '';
  if (data.isDemo || !isPhone() || dismissed || state.pushReady) message = null;
  else if (!canPush()) {
    if (!isHomeScreenApp()) message = 'כדי לקבל תזכורות, פתח את לוח השנה מהאייקון במסך הבית.';
  } else if (Notification.permission === 'denied') {
    message = 'התזכורות חסומות. אפשר להפעיל אותן בהגדרות של הטלפון, תחת התראות ← לוח השנה.';
  } else if (Notification.permission !== 'granted') {
    message = 'תזכורת יומית ב-07:00, ותזכורות לאירועים שתבחר.';
    action = '<button class="btn btn-primary btn-small" data-action="enable-push">הפעל</button>';
  }
  card.hidden = !message;
  if (!message) return;
  card.innerHTML = `
    <span class="push-icon">${icon.bell}</span>
    <p><strong>תזכורות בטלפון</strong>${message}</p>
    ${action}
    <button class="card-close" data-action="dismiss-push" aria-label="לא עכשיו">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`;
}

// ---------- event sheet: add or edit an event, one-off or weekly

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
      <p class="series-note" data-series-note hidden>${icon.repeat}חלק מאירוע קבוע</p>
      <div class="field">
        <label for="ev-title">שם</label>
        <input class="input" id="ev-title" name="title" maxlength="200" autocomplete="off" enterkeyhint="done" aria-describedby="ev-title-error">
        <p class="field-error" id="ev-title-error"></p>
      </div>
      <div class="field">
        <span class="field-label" id="ev-kind-label">סוג (לא חובה)</span>
        <div class="kind-picks" role="group" aria-labelledby="ev-kind-label">
          ${Object.entries(KIND_NAMES).map(([kind, name]) => `<button type="button" class="kp" data-kind="${kind}" aria-pressed="false">${icon[kind]}${name}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="ev-date">תאריך</label>
        <div class="picker"><span class="picker-value" data-show="date"></span><input id="ev-date" type="date" required></div>
      </div>
      <div class="field">
        <div class="label-row">
          <label for="ev-time">שעה (לא חובה)</label>
          <button type="button" class="link-btn" data-clear-time>בלי שעה</button>
        </div>
        <div class="time-row">
          <div class="picker"><span class="picker-value" data-show="time"></span><input id="ev-time" type="time"></div>
          <div class="picker" data-end-field><span class="picker-value" data-show="end"></span><input id="ev-end" type="time" aria-label="עד שעה (לא חובה)"></div>
        </div>
      </div>
      <div class="field" data-remind-field>
        <label for="ev-remind">תזכורת בטלפון</label>
        <div class="picker picker-select">
          <select id="ev-remind">
            <option value="">בלי תזכורת</option>
            <option value="5">5 דקות לפני</option>
            <option value="10">10 דקות לפני</option>
            <option value="15">15 דקות לפני</option>
            <option value="30">30 דקות לפני</option>
            <option value="60">שעה לפני</option>
            <option value="120">שעתיים לפני</option>
            <option value="1440">יום לפני</option>
          </select>
        </div>
      </div>
      <div class="field" data-repeat-field>
        <label class="switch">
          <input type="checkbox" id="ev-repeat">
          <span class="switch-track" aria-hidden="true"></span>
          חוזר כל שבוע
        </label>
        <div class="recur" data-recur>
          <div class="weekday-picks" role="group" aria-label="באילו ימים">
            ${DAY_LETTERS.map((letter, i) => `<button type="button" class="wd" data-wd="${i}" aria-pressed="false" aria-label="יום ${DAY_NAMES[i]}">${letter}</button>`).join('')}
          </div>
          <label for="ev-until">עד תאריך</label>
          <div class="picker"><span class="picker-value" data-show="until"></span><input id="ev-until" type="date"></div>
        </div>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions" data-main-actions>
        <button type="submit" class="btn btn-primary" data-save>שמור</button>
        <button type="button" class="btn btn-ghost" data-cancel>ביטול</button>
      </div>
      <div class="confirm" data-choice hidden>
        <p data-choice-text></p>
        <div class="choice-buttons" data-choice-buttons></div>
      </div>
    </form>`;
  document.body.append(el);

  const $ = (selector) => el.querySelector(selector);
  const form = $('form');
  const inputs = { title: $('#ev-title'), date: $('#ev-date'), time: $('#ev-time'), end: $('#ev-end'), repeat: $('#ev-repeat'), until: $('#ev-until'), remind: $('#ev-remind') };
  const titleError = $('#ev-title-error');
  const formError = $('.form-error');
  const saveButton = $('[data-save]');
  const deleteButton = $('[data-delete]');
  const mainActions = $('[data-main-actions]');
  const choiceBox = $('[data-choice]');
  const choiceButtons = $('[data-choice-buttons]');
  const picks = [...el.querySelectorAll('[data-wd]')];
  const kindPicks = [...el.querySelectorAll('[data-kind]')];
  const pickedKind = () => kindPicks.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.kind ?? null;
  const setKind = (kind) => kindPicks.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  let editing = null;
  let closing = false;
  let settleChoice = null;

  const pickedDays = () => picks.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.wd));
  const setPick = (button, on) => button.setAttribute('aria-pressed', String(on));

  // Dates and times are shown in Israeli format by us; the phone's own picker opens on tap.
  const show = (key, text, placeholder) => {
    const span = $(`[data-show="${key}"]`);
    span.textContent = text || placeholder;
    span.classList.toggle('is-placeholder', !text);
  };
  const sync = () => {
    if (!inputs.time.value) inputs.end.value = ''; // an end time only makes sense after a start time
    show('date', inputs.date.value && formatLong(inputs.date.value), 'בחר תאריך');
    show('time', inputs.time.value, 'כל היום');
    show('end', inputs.end.value && `עד ${inputs.end.value}`, 'עד שעה');
    show('until', inputs.until.value && formatLong(inputs.until.value), 'בחר תאריך');
    $('[data-end-field]').hidden = !inputs.time.value;
    $('[data-clear-time]').hidden = !inputs.time.value;
    $('[data-recur]').hidden = !inputs.repeat.checked;
    if (!inputs.time.value) inputs.remind.value = ''; // all-day events have no reminder
    $('[data-remind-field]').hidden = !inputs.time.value;
  };
  const setTitleError = (message) => {
    titleError.textContent = message;
    inputs.title.classList.toggle('is-invalid', Boolean(message));
    inputs.title.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const fail = (message) => {
    formError.textContent = message;
    return null;
  };
  const setBusy = (busy) => {
    saveButton.disabled = busy;
    saveButton.textContent = busy ? 'שומר…' : 'שמור';
    choiceButtons.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  };

  for (const input of [inputs.date, inputs.time, inputs.end, inputs.until]) {
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* the browser opens its own */ } });
  }
  $('[data-clear-time]').addEventListener('click', () => { inputs.time.value = ''; sync(); inputs.time.focus(); });
  inputs.repeat.addEventListener('change', () => {
    if (inputs.repeat.checked && !pickedDays().length && inputs.date.value) setPick(picks[fromISO(inputs.date.value).getDay()], true);
    sync();
  });
  picks.forEach((b) => b.addEventListener('click', () => setPick(b, b.getAttribute('aria-pressed') !== 'true')));
  // One kind at most; tapping the chosen one again clears it.
  kindPicks.forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind === pickedKind() ? null : b.dataset.kind)));
  inputs.title.addEventListener('input', () => setTitleError(''));
  $('[data-cancel]').addEventListener('click', close);
  el.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  el.addEventListener('click', (e) => { if (e.target === el) close(); }); // tap outside the sheet

  // A question inside the sheet, in place of the save/cancel buttons. Resolves with the value
  // of the chosen button, or null for cancel.
  function ask(text, options) {
    $('[data-choice-text]').textContent = text;
    choiceButtons.innerHTML = options.map((o, i) => `<button type="button" class="btn btn-${o.kind}" data-i="${i}">${o.label}</button>`).join('');
    choiceButtons.classList.toggle('is-stacked', options.length > 2);
    formError.textContent = '';
    mainActions.hidden = true;
    choiceBox.hidden = false;
    choiceButtons.querySelector('.btn-ghost')?.focus();
    return new Promise((resolve) => {
      settleChoice = resolve;
      choiceButtons.onclick = (e) => {
        const button = e.target.closest('[data-i]');
        if (!button) return;
        const { value } = options[button.dataset.i];
        settleChoice = null;
        if (value === null) hideChoice();
        resolve(value);
      };
    });
  }
  function hideChoice() {
    choiceBox.hidden = true;
    mainActions.hidden = false;
    settleChoice?.(null);
    settleChoice = null;
  }

  // Runs a save or delete; on failure what was typed stays, with a message.
  async function perform(task, failMessage) {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      if (data.isAuthError(err)) {
        close();
        renderLogin();
        return;
      }
      hideChoice();
      setBusy(false);
      fail(failMessage);
    }
  }

  function readFields() {
    formError.textContent = '';
    const title = inputs.title.value.trim();
    if (!title) {
      setTitleError('חסר שם לאירוע');
      inputs.title.focus();
      return null;
    }
    if (!inputs.date.value) return fail('חסר תאריך');
    const time = inputs.time.value || null;
    const endTime = time && inputs.end.value ? inputs.end.value : null;
    if (endTime && endTime <= time) return fail('שעת הסיום לפני שעת ההתחלה');
    const remindMinutes = time && inputs.remind.value ? Number(inputs.remind.value) : null;
    return { title, date: inputs.date.value, time, endTime, remindMinutes, kind: pickedKind() };
  }

  // Every chosen weekday from the first date up to "until", at most a year ahead.
  function readRepeatDates(date) {
    const days = pickedDays();
    if (!days.length) return fail('בחר לפחות יום אחד בשבוע');
    const until = inputs.until.value;
    if (!until) return fail('חסר תאריך סיום לאירוע הקבוע');
    if (until < date) return fail('תאריך הסיום לפני תאריך ההתחלה');
    const limit = fromISO(date);
    limit.setFullYear(limit.getFullYear() + 1);
    if (until > toISO(limit)) return fail('אירוע קבוע יכול לחזור עד שנה קדימה');
    const dates = [];
    for (let d = date; d <= until; d = addDays(d, 1)) if (days.includes(fromISO(d).getDay())) dates.push(d);
    if (!dates.length) return fail('אין אף יום מהימים שבחרת בטווח הזה');
    return dates;
  }

  const finish = (toastText, ev) => {
    close();
    showToast(toastText);
    showSaved(ev);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = readFields();
    if (!fields) return;

    if (!editing && inputs.repeat.checked) {
      const dates = readRepeatDates(fields.date);
      if (!dates) return;
      perform(async () => {
        const saved = await data.addSeries({ ...fields, dates });
        saved.forEach(placeEvent);
        finish(`האירוע הקבוע נשמר, ${saved.length} פעמים`, saved[0]);
      }, 'השמירה נכשלה, נסה שוב');
      return;
    }
    if (!editing) {
      perform(async () => {
        const saved = await data.addEvent(fields);
        placeEvent(saved);
        finish('האירוע נשמר', saved);
      }, 'השמירה נכשלה, נסה שוב');
      return;
    }

    const scope = editing.seriesId
      ? await ask('לשנות רק את האירוע הזה, או את כל הסדרה?', [
        { label: 'רק האירוע הזה', value: 'one', kind: 'primary' },
        { label: 'כל הסדרה', value: 'all', kind: 'primary' },
        { label: 'ביטול', value: null, kind: 'ghost' },
      ])
      : 'one';
    if (!scope) return;
    const { id, seriesId, date: oldDate } = editing;
    perform(async () => {
      let saved;
      if (scope === 'all') {
        (await data.updateSeries(seriesId, fields)).forEach(placeEvent); // name, hours and kind, everywhere
        saved = findEvent(id);
      }
      if (scope === 'one' || fields.date !== oldDate) saved = await data.updateEvent(id, fields);
      placeEvent(saved);
      finish(scope === 'all' ? 'הסדרה עודכנה' : 'האירוע נשמר', saved);
    }, 'השמירה נכשלה, נסה שוב');
  });

  deleteButton.addEventListener('click', async () => {
    const { id, seriesId } = editing;
    const scope = await ask('למחוק את האירוע?', seriesId
      ? [
        { label: 'רק האירוע הזה', value: 'one', kind: 'danger' },
        { label: 'כל הסדרה', value: 'all', kind: 'danger' },
        { label: 'ביטול', value: null, kind: 'ghost' },
      ]
      : [
        { label: 'מחק', value: 'one', kind: 'danger' },
        { label: 'ביטול', value: null, kind: 'ghost' },
      ]);
    if (!scope) {
      deleteButton.focus();
      return;
    }
    perform(async () => {
      if (scope === 'all') {
        await data.deleteSeries(seriesId);
        removeSeriesFromCache(seriesId);
      } else {
        await data.deleteEvent(id);
        removeFromCache(id);
      }
      close();
      showToast(scope === 'all' ? 'הסדרה נמחקה' : 'האירוע נמחק');
      showDeleted(id);
    }, 'המחיקה נכשלה, נסה שוב');
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
    $('#sheet-title').textContent = event ? 'עריכת אירוע' : 'אירוע חדש';
    inputs.title.value = event?.title ?? '';
    inputs.date.value = event?.date ?? date;
    inputs.time.value = event?.time ?? '';
    inputs.end.value = event?.endTime ?? '';
    inputs.remind.value = event?.remindMinutes ? String(event.remindMinutes) : '';
    setKind(event?.kind ?? null);
    inputs.repeat.checked = false;
    inputs.until.value = '';
    picks.forEach((b) => setPick(b, false));
    // A weekly event is set up when it's created; later only its name, hours and kind change.
    $('[data-repeat-field]').hidden = Boolean(event);
    $('[data-series-note]').hidden = !event?.seriesId;
    deleteButton.hidden = !event;
    setTitleError('');
    formError.textContent = '';
    hideChoice();
    setBusy(false);
    sync();
    closing = false;
    el.classList.remove('is-closing');
    el.showModal();
    trackKeyboard(true);
    // A new event starts with typing; an existing one may just be deleted, so don't pop the keyboard.
    if (event) $('#sheet-title').focus();
    else inputs.title.focus();
  }

  function close() {
    if (!el.open || closing) return;
    closing = true;
    hideChoice();
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
