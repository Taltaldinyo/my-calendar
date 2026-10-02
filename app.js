import * as data from './data.js?v=22';
import { holidayOn } from './holidays.js?v=22';

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
  openedFrom: null, // 'YYYY-MM' of the month the day view was opened from, which sits under it in history
  highlight: null, // id of an event that was just saved, animated once where it lands
  highlightDot: false, // its day had nothing on it before, so the phone's dot for that day pops in
  openTasks: [], // every task not done yet, whatever its day (few, so always fetched whole)
  doneByDate: new Map(), // 'YYYY-MM-DD' -> tasks marked done on that day
  doneOpen: false, // the folded "N done" row is opened on the day on screen
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
const taskCount = (n) => (n === 1 ? 'משימה אחת' : `${n} משימות`);
const byTime = (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'he');

// Tasks: very urgent first, then urgent, then regular; within each, in the order written.
const PRIORITY_NAMES = ['רגיל', 'דחוף', 'דחוף מאוד'];
const byPriority = (a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt);
// The day a task shows on: the day it was marked done; while open, its own day - or today, once
// that day has passed. Nothing is rewritten at night; an open task simply shows on today.
const shownOn = (task, today = todayISO()) => task.doneOn ?? (task.date < today ? today : task.date);

// Kinds are told apart by symbol and word, never by color alone.
const KIND_NAMES = { meeting: 'פגישה', work: 'עבודה', study: 'לימודים', fun: 'בילוי', medical: 'רפואי', workout: 'אימון', other: 'אחר' };

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
  workout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/></svg>',
  other: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  // Holidays: a star for a festival (and its eves and chol hamoed), a candle for the memorial day - told apart by shape, not color.
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.4 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/></svg>',
  candle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c1.6 2 2.2 3 2.2 4.1a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.1 2.2-4.1z"/><rect x="8.5" y="11" width="7" height="10.5" rx="1.2"/></svg>',
  circle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
};

const sheet = createSheet();
const taskSheet = createTaskSheet();

// A short note that rises above the bottom bar after saving or deleting, then goes away.
const toast = document.createElement('div');
toast.className = 'toast';
toast.setAttribute('role', 'status');
document.body.append(toast);
let toastTimer;

function showToast(text, { ok = true } = {}) {
  toast.innerHTML = `${ok ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}${text}`;
  replay(toast, 'is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2200);
}

// ---------- start

start();

async function start() {
  // Safari on the iPhone only shows the pressed look of buttons when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });
  registerServiceWorker();
  data.onSignedOut(renderLogin);
  if (await data.hasSession()) enterApp();
  else renderLogin();
  root.removeAttribute('aria-busy'); // the skeleton in index.html is gone by now
}

// sw.js keeps the app's files on the phone, so it opens without waiting for the network (and offline).
// Registered once the page has loaded, so on a first visit its downloads never compete with the page's own.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((registration) => {
    // A home-screen app is usually resumed, not reopened: look for a new version each time it comes back.
    // The new version is used the next time the app opens from scratch, never in the middle of a session.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function enterApp() {
  if (!state.started) {
    state.started = true;
    syncPush().catch(() => {}).finally(renderPushCard);
    window.addEventListener('hashchange', route);
    // Days turn with a sideways swipe anywhere on the screen, empty space under a short day included.
    enableDayPaging(root);
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

// The day-open / day-close transition while it runs (a second transition would cut it short).
let routeTransition = null;

// The day's real lists replacing their loading placeholders: a short cross-fade of the whole screen
// instead of a hard swap. The lists are rarely as tall as the placeholders, so a hard swap moves
// everything below them in one jump (the cards, the "events" title). Without view-transition
// support, with reduced motion, or while the day is still opening, it just swaps.
function swapIn(draw) {
  if (!document.startViewTransition || reducedMotion() || routeTransition) return draw();
  document.documentElement.classList.add('vt-swap');
  const transition = document.startViewTransition(draw);
  transition.ready.catch(() => {}); // skipped (e.g. the page isn't being drawn): the screen still updates
  transition.finished.finally(() => document.documentElement.classList.remove('vt-swap'));
}

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
    // The transition is the entrance. Left in place, the screen's own fade-in (`rise`) would start the moment
    // the transition ends, and the whole screen would blink: transparent, then back (opening or leaving a day).
    skipEntrance();
    if (next.view === 'month') nameSquare();
  });
  transition.ready.catch(() => {}); // skipped (e.g. the page isn't being drawn): the screen still switches, just without motion
  routeTransition = transition;
  transition.finished.finally(() => {
    if (routeTransition === transition) routeTransition = null;
    root.querySelectorAll('.day[style]').forEach((el) => el.style.removeProperty('view-transition-name'));
  });
}

function applyRoute(next) {
  resetPaging(); // a half-finished slide never outlives the screen it belonged to
  const sameView = next.view === state.view && root.querySelector(`.shell[data-view="${next.view}"]`);
  let direction = 0;
  if (sameView && next.view === 'month') direction = Math.sign(next.year * 12 + next.month - (state.year * 12 + state.month));
  if (sameView && next.view === 'day') direction = Math.sign(next.date.localeCompare(state.date));
  const returningTo = state.view === 'day' && next.view === 'month' ? state.date : null;
  if (next.view === 'month') state.openedFrom = null;

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
  if (pager.busy) { pager.queued += delta; return; } // a tap during a slide goes on after it lands
  goToDay(addDays(state.date, delta));
}

// Another day: slides in from the side when the day screen is up (arrows, "today"), else just switches.
function goToDay(date) {
  if (date !== state.date && canSlide()) return slideTo(date);
  go(`#/${date}`);
  status.textContent = dayTitle(date) + ', ' + formatDate(date);
}

function openDay(date) {
  state.openedFrom = monthKey(state.year, state.month);
  go(`#/${date}`, { push: true });
}

// Always back to the month of the day on screen - the month named on the button - even after
// moving to another month's day (arrows, a gray square, saving an event on another date).
function backToMonth() {
  const month = monthKey(state.year, state.month);
  if (state.openedFrom === month) history.back(); // that month is right under us: keeps the phone's back button in step
  else go(`#/${month}`);
}

function goToday() {
  const t = new Date();
  if (state.view === 'day') goToDay(toISO(t));
  else go(`#/${monthKey(t.getFullYear(), t.getMonth())}`);
}

// ---------- data

function isKnown(date) {
  const d = fromISO(date);
  return state.loadedDays.has(date) || state.loaded.has(monthKey(d.getFullYear(), d.getMonth()));
}

async function fetchRange(from, to) {
  const version = taskVersion;
  const [events, tasks] = await Promise.all([data.listEvents(from, to), data.listTasks(from, to)]);
  for (const date of [...state.byDate.keys()]) if (date >= from && date <= to) state.byDate.delete(date);
  for (const ev of events) {
    if (!state.byDate.has(ev.date)) state.byDate.set(ev.date, []);
    state.byDate.get(ev.date).push(ev);
  }
  for (const list of state.byDate.values()) list.sort(byTime);
  // A task was changed on screen while this was on its way: the answer may be older than the
  // screen, so the tasks in it are dropped and fetched again once the change is saved.
  if (version !== taskVersion) tasksStale = true;
  else placeTasks(tasks, from, to);
  for (let date = from; date <= to; date = addDays(date, 1)) state.loadedDays.add(date);
}

function placeTasks(tasks, from, to) {
  state.openTasks = tasks.filter((t) => !t.doneOn);
  for (const date of [...state.doneByDate.keys()]) if (date >= from && date <= to) state.doneByDate.delete(date);
  for (const task of tasks) if (task.doneOn) putTask(task);
}

const inRange = (from, to) => ([date]) => date >= from && date <= to;
const rangeSignature = (from, to) => JSON.stringify([
  todayISO(), // after midnight, open tasks move on to the new today
  state.openTasks,
  [...state.byDate].filter(inRange(from, to)).sort(),
  [...state.doneByDate].filter(inRange(from, to)).sort(),
]);

async function load({ quiet = false } = {}) {
  const token = ++loadToken;
  const isDay = state.view === 'day';
  const day = state.date; // what this load asked for, even if the screen moves on meanwhile
  const month = monthKey(state.year, state.month);
  const cells = monthCells(state.year, state.month);
  // A day is fetched together with its whole month, so the days around it open at once - no loading
  // screen on every arrow or swipe after the app was opened straight into a day (the 07:00 reminder).
  const [from, to] = [cells[0].iso, cells[cells.length - 1].iso];
  const known = isDay ? isKnown(day) : state.loaded.has(month);
  const before = rangeSignature(from, to);
  const hadError = state.loadError;

  if (!known && !quiet) {
    state.loading = true;
    renderContent();
  }
  try {
    await fetchRange(from, to);
    state.loaded.add(month);
    if (token !== loadToken) return;
    state.loadError = false;
  } catch (error) {
    if (token !== loadToken) return;
    if (data.isAuthError(error)) return renderLogin();
    state.loadError = true;
  }
  const changed = state.loading || state.loadError !== hadError || rangeSignature(from, to) !== before;
  const replacesSkeleton = state.loading;
  state.loading = false;
  if (changed && replacesSkeleton && isDay) swapIn(renderContent);
  else if (changed) renderContent(); // nothing new: keep the screen as is, so nothing flickers
  if (!isDay && !state.loadError) prefetchAround();
}

// Fetch the months on either side quietly, so the next page turn shows its events at once.
const prefetching = new Map(); // 'YYYY-MM' -> the fetch on its way
function prefetchMonth(year, month) {
  const key = monthKey(year, month);
  if (state.loaded.has(key)) return Promise.resolve();
  if (prefetching.has(key)) return prefetching.get(key);
  const cells = monthCells(year, month);
  const fetching = fetchRange(cells[0].iso, cells[cells.length - 1].iso)
    .then(() => state.loaded.add(key))
    .catch(() => {}) // not needed yet; the month loads normally when opened
    .finally(() => prefetching.delete(key));
  prefetching.set(key, fetching);
  return fetching;
}

function prefetchAround() {
  for (const delta of [-1, 1]) {
    const d = new Date(state.year, state.month + delta, 1);
    prefetchMonth(d.getFullYear(), d.getMonth());
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

// Put a saved event into the cache, wherever it was before. Returns whether its day was free
// until now (checked before the event itself is moved, so editing it in place doesn't count).
function placeEvent(ev) {
  const dayWasFree = !state.byDate.get(ev.date)?.length && !openTaskCounts().get(ev.date);
  removeFromCache(ev.id);
  if (!state.byDate.has(ev.date)) state.byDate.set(ev.date, []);
  state.byDate.get(ev.date).push(ev);
  state.byDate.get(ev.date).sort(byTime);
  return dayWasFree;
}

// After saving, show the event where it landed: its day in day view, its month in month view.
function showSaved(ev, dayWasFree = false) {
  state.highlight = ev.id;
  state.highlightDot = dayWasFree;
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

// ---------- tasks in the cache

// Every change to a task counts up before and after it's saved; a fetch that started in between
// is older than the screen (see fetchRange).
let taskVersion = 0;
let taskWrites = 0;
let tasksStale = false;

async function taskWrite(write) {
  taskVersion++;
  taskWrites++;
  try {
    return await write();
  } finally {
    taskVersion++;
    taskWrites--;
    if (!taskWrites && tasksStale) {
      tasksStale = false;
      load({ quiet: true });
    }
  }
}

function findTask(id) {
  return state.openTasks.find((t) => t.id === id)
    ?? [...state.doneByDate.values()].flat().find((t) => t.id === id) ?? null;
}

function removeTask(id) {
  state.openTasks = state.openTasks.filter((t) => t.id !== id);
  for (const [date, list] of state.doneByDate) {
    const kept = list.filter((t) => t.id !== id);
    if (kept.length) state.doneByDate.set(date, kept);
    else state.doneByDate.delete(date);
  }
}

// Put a task where it belongs now: with the open ones, or under the day it was done on.
function putTask(task) {
  removeTask(task.id);
  if (!task.doneOn) state.openTasks.push(task);
  else {
    if (!state.doneByDate.has(task.doneOn)) state.doneByDate.set(task.doneOn, []);
    state.doneByDate.get(task.doneOn).push(task);
  }
}

function tasksOn(date) {
  const today = todayISO();
  return {
    open: state.openTasks.filter((t) => shownOn(t, today) === date).sort(byPriority),
    done: [...(state.doneByDate.get(date) ?? [])].sort(byPriority),
  };
}

// How many open tasks each day shows (only today and the days ahead can have any).
function openTaskCounts() {
  const today = todayISO();
  const counts = new Map();
  for (const t of state.openTasks) {
    const day = shownOn(t, today);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
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
  else if (action === 'toggle-task') toggleTask(target);
  else if (action === 'edit-task') {
    const task = findTask(target.dataset.id);
    if (task && !isUnsaved(task)) taskSheet.open(task);
  }
  else if (action === 'fold-done') {
    state.doneOpen = !state.doneOpen;
    renderTasks();
  }
});

// After deleting, the row slides away before the list closes the gap.
function showDeleted(id) {
  const row = root.querySelector(`.row[data-id="${id}"]`);
  if (!row) return renderContent();
  row.classList.add('is-leaving');
  setTimeout(renderContent, 240);
}

const renderContent = () => (state.view === 'day' ? (renderTasks(), renderAgenda()) : renderGrid());
const dayTitle = (date) => `יום ${DAY_NAMES[fromISO(date).getDay()]}`;

// index.html starts with a static skeleton (.boot). The first screen takes its place without the usual
// fade-in from nothing, which would flash the plain background between the two.
const cameFromBoot = () => Boolean(root.querySelector('.boot'));
const skipEntrance = () => root.querySelectorAll('.view-enter').forEach((el) => el.classList.remove('view-enter'));

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
    const fromBoot = cameFromBoot();
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
    if (fromBoot) skipEntrance();
    enableSwipe(root.querySelector('.month-card'), shiftMonth);
    renderPushCard();
    gridSize.disconnect();
    gridSize.observe(root.querySelector('.grid'));
  }
  const title = root.querySelector('.month-title');
  title.innerHTML = `${MONTHS[state.month]} <span class="year">${state.year}</span>`;
  if (direction) replay(title, 'title-in');
  renderGrid(direction);
  if (returningTo) root.querySelector(`.day[data-date="${returningTo}"]`)?.focus({ preventScroll: true });
}

const holIcon = (hol) => (hol.type === 'memorial' ? icon.candle : icon.star);

function renderGrid(direction = 0) {
  const grid = root.querySelector('.grid');
  if (!grid) return;
  const focused = document.activeElement?.dataset?.date;
  const today = todayISO();
  const skeleton = state.loading && !state.loaded.has(monthKey(state.year, state.month));
  const openCounts = openTaskCounts();

  const html = monthCells(state.year, state.month).map((cell) => {
    const events = state.byDate.get(cell.iso) ?? [];
    const tasks = skeleton && cell.inMonth ? 0 : openCounts.get(cell.iso) ?? 0;
    const isToday = cell.iso === today;
    const hol = holidayOn(cell.iso);
    const label = `${isToday ? 'היום, ' : ''}יום ${DAY_NAMES[cell.weekday]}, ${cell.day} ב${MONTHS[cell.month]}${hol ? `, ${hol.name}` : ''}, ${eventCount(events.length)}`
      + (tasks ? `, ${tasks === 1 ? 'משימה פתוחה אחת' : `${tasks} משימות פתוחות`}` : '');
    const isNew = (ev) => (ev.id === state.highlight ? ' is-new' : '');
    // On the phone a single dot says the day isn't free, however many events it has. It pops in
    // only when the day has just stopped being free; a second event doesn't move it.
    const dotIsNew = state.highlightDot && events.some((ev) => ev.id === state.highlight);
    const marks = skeleton && cell.inMonth
      ? '<span class="skel"></span>'
      : events.length || tasks ? `<i class="${dotIsNew ? 'is-new' : ''}"></i>` : ''; // an open task makes the day busy too
    const chips = skeleton && cell.inMonth
      ? '<span class="skel"></span>'
      : events.map((ev) => `
          <span class="chip${ev.time ? '' : ' is-allday'}${isNew(ev)}">
            ${ev.kind ? `<span class="k">${icon[ev.kind]}</span>` : ''}${ev.time ? `<span class="t">${ev.time}</span>` : ''}<span class="n">${escapeHTML(ev.title)}</span>
          </span>`).join(''); // all of them; fitChips keeps what fits the square
    return `
      <button class="day${cell.inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}" data-action="open-day" data-date="${cell.iso}" aria-label="${label}">
        <span class="day-top"><span class="num">${cell.day}</span>${hol ? `<span class="hol-mark is-${hol.type}" aria-hidden="true">${holIcon(hol)}</span>` : ''}${tasks ? `<span class="tmark" aria-hidden="true">${icon.circle}${taskCount(tasks)}</span>` : ''}</span>
        <span class="marks" aria-hidden="true">${marks}</span>
        <span class="chips" aria-hidden="true">${hol ? `<span class="hol-row is-${hol.type}">${holIcon(hol)}<span class="n">${hol.name}</span></span>` : ''}${chips}</span>
      </button>`;
  }).join('');

  turnPage(grid, direction, () => { grid.innerHTML = html; });
  root.querySelector('.banner').hidden = !state.loadError;
  fitChips(grid);
  if (focused) grid.querySelector(`[data-date="${focused}"]`)?.focus();
  if (!skeleton) state.highlight = null;
}

// On the computer the squares take their height from the window. Each shows the events that
// fit, and the rest as "+N more" - never an event cut off without a sign.
const wide = matchMedia('(min-width: 768px)');
let fittedHeight = 0;

function fitChips(grid) {
  fittedHeight = grid.offsetHeight;
  if (!wide.matches) return; // on the phone the squares show dots, not names
  const crowded = [...grid.querySelectorAll('.chips')].filter((box) => box.scrollHeight > box.clientHeight + 1);
  for (const box of crowded) {
    const chips = box.querySelectorAll('.chip');
    let shown = chips.length;
    let more = null;
    while (shown && box.scrollHeight > box.clientHeight + 1) {
      chips[--shown].remove();
      more ??= box.appendChild(Object.assign(document.createElement('span'), { className: 'more' }));
      more.textContent = shown ? `+${chips.length - shown} נוספים` : eventCount(chips.length);
    }
  }
}

// When the window's height changes, the squares change with it, so the events are fitted again.
const gridSize = new ResizeObserver(([entry]) => {
  if (wide.matches && Math.abs(entry.contentRect.height - fittedHeight) >= 1) renderGrid();
});

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
// A quick sideways swipe turns to the next or previous page: months on the month view, days on the
// day view. Right to left, so a swipe to the right goes forward. Not from inside a text field,
// where a sideways drag moves the cursor.
function enableSwipe(el, shift) {
  let start = null;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && !e.target.closest('input, textarea') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = Date.now() - start.at < 800;
    start = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx > 0 ? 1 : -1);
  }, { passive: true });
}

// ----- day paging
// A day follows the finger like a page on the iPhone's home screen. Beside the real day (.day-body) sits a
// static copy of the neighbouring day (.day-ghost: aria-hidden, inert, no handlers). The copies are drawn
// ahead of time, a moment after the day itself is drawn (zero height until used), so a drag starts with nothing
// to build. While the finger moves, the only work is one transform on .day-track; landing is a transform
// animation too (compositor, no layout). At the end the real day is switched to the new date and the copies
// removed in the same task, so the same frame shows the finished page.
// Only the day moves: the top bar and the bottom bar stay put (they are outside .day-track).

const pager = { busy: false, landing: false, adopted: false, stale: false, anim: null, timer: 0, prep: 0, spare: new Map(), live: null, from: '', queued: 0 };
const SLIDE_EASE = 'cubic-bezier(.22, 1, .36, 1)';
const dayTrack = () => root.querySelector('.shell[data-view="day"] .day-track');
const canSlide = () => state.view === 'day' && !reducedMotion() && !pager.busy && Boolean(dayTrack());
const shiftX = (px) => `translate3d(${px}px, 0, 0)`;

// Back to rest: nothing moving, no ghost, no leftover transform.
function resetPaging() {
  clearTimeout(pager.timer);
  clearTimeout(pager.prep);
  if (pager.anim) pager.anim.cancel();
  pager.anim = null;
  for (const { el } of pager.spare.values()) el.remove();
  pager.spare.clear();
  pager.live = null;
  pager.stale = false;
  pager.busy = false;
  pager.queued = 0;
  const track = dayTrack();
  if (track) { track.style.transform = ''; track.style.willChange = ''; }
}

// A slide that was let go of short of the middle: the day stays, the prepared neighbours stay for the next try.
function restPaging() {
  clearTimeout(pager.timer);
  if (pager.anim) pager.anim.cancel();
  pager.anim = null;
  pager.busy = false;
  parkGhost();
  const track = dayTrack();
  if (track) { track.style.transform = ''; track.style.willChange = ''; }
}

function parkGhost() {
  if (!pager.live) return;
  pager.live.classList.remove('is-live');
  pager.live.style.transform = '';
  pager.live = null;
}

function fillGhost(ghost, date) {
  fillDayHead(ghost, date);
  renderTasks(0, null, ghost, date);
  renderAgenda(0, ghost, date);
  ghost.querySelectorAll('.view-enter, .enter-next, .enter-prev, .is-new').forEach((el) => el.classList.remove('view-enter', 'enter-next', 'enter-prev', 'is-new'));
}

// The neighbouring day as a still picture of what the real day will show once it gets there. Not shown (zero height)
// until a drag needs it.
function buildGhost(track, sign, date) {
  const ghost = track.querySelector('.day-body').cloneNode(true);
  ghost.className = 'day-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.querySelectorAll('[tabindex]').forEach((el) => el.removeAttribute('tabindex'));
  ghost.querySelector('.quick-add').outerHTML = quickAddHTML; // the real one is emptied when the day changes
  fillGhost(ghost, date);
  track.append(ghost);
  pager.spare.get(sign)?.el.remove();
  pager.spare.set(sign, { el: ghost, date });
  if (!isKnown(date)) { // not fetched yet (beyond the month's grid): placeholders now, the real thing as soon as it arrives
    const d = fromISO(date);
    prefetchMonth(d.getFullYear(), d.getMonth()).then(() => { if (pager.spare.get(sign)?.el === ghost) fillGhost(ghost, date); });
  }
  return ghost;
}

// Put the neighbour beside the day, ready to slide in (the next day waits on the left, the previous on the right).
function showGhost(track, sign, date, width) {
  let held = pager.spare.get(sign);
  if (!held || held.date !== date) held = { el: buildGhost(track, sign, date), date }; // not prepared in time: build it now
  if (pager.live && pager.live !== held.el) parkGhost();
  held.el.style.transform = shiftX(-sign * width);
  held.el.classList.add('is-live');
  pager.live = held.el;
  pager.stale = false;
}

// A moment after the day is drawn, with nothing going on: draw both neighbours, one per task so none runs long.
// Anything that redraws the real day (a task ticked, data arriving) makes them out of date: they are dropped and redrawn.
function dropSpareGhosts() {
  clearTimeout(pager.prep);
  if (pager.live) pager.stale = true; // the day was redrawn while its neighbour is in use: that picture may be out of date
  for (const [sign, { el }] of pager.spare) if (el !== pager.live) { el.remove(); pager.spare.delete(sign); }
}

function prepareGhosts() {
  clearTimeout(pager.prep);
  if (state.view !== 'day' || reducedMotion() || !isPhone()) return;
  pager.prep = setTimeout(() => {
    const track = dayTrack();
    if (!track || pager.busy || pager.live || document.visibilityState !== 'visible') return;
    const make = (sign, then) => {
      const date = addDays(state.date, sign);
      if (pager.spare.get(sign)?.date !== date) buildGhost(track, sign, date);
      if (then) pager.prep = setTimeout(() => { if (!pager.busy && !pager.live && dayTrack() === track) make(-1); }, 30);
    };
    make(1, true);
  }, 150);
}

// Let go (or tap an arrow): finish the slide to the neighbour, or come back. Moves nothing but the transform.
function settle(track, from, commit, sign, date) {
  const width = track.parentElement.offsetWidth;
  const to = commit ? sign * width : 0;
  const ms = Math.round(150 + 150 * Math.abs(to - from) / width); // about 0.3s for the whole way
  pager.busy = true;
  pager.from = state.date;
  const anim = track.animate([{ transform: shiftX(from) }, { transform: shiftX(to) }], { duration: ms, easing: SLIDE_EASE, fill: 'forwards' });
  pager.anim = anim;
  const done = () => {
    if (pager.anim !== anim) return;
    if (commit) land(track, date, sign);
    else restPaging();
  };
  anim.onfinish = done;
  pager.timer = setTimeout(done, ms + 250); // if the page was put to sleep mid-slide, never leave a half page behind
}

// The neighbour that slid in is already drawn, laid out and on screen. Rather than draw the same day again, it
// takes the place of the old one: only the live "new task" line (with its handlers) moves over from the old day.
// Not done if the real day was redrawn during the slide (the picture may be out of date): then the day is drawn as usual.
function adoptGhost(track, sign) {
  const ghost = pager.live;
  if (!ghost || pager.stale || pager.spare.get(sign)?.el !== ghost) return false;
  const body = track.querySelector('.day-body');
  const form = body.querySelector('.quick-add');
  const stillForm = ghost.querySelector('.quick-add');
  form.hidden = stillForm.hidden;
  stillForm.replaceWith(form);
  ghost.className = 'day-body';
  ghost.inert = false;
  ghost.removeAttribute('aria-hidden');
  ghost.style.transform = '';
  ghost.querySelector('.tasks-block .section-label').id = 'tasks-label';
  ghost.querySelector('.day-title').tabIndex = -1;
  body.replaceWith(ghost);
  pager.spare.delete(sign);
  pager.live = null;
  return true;
}

function land(track, date, sign) {
  const queued = pager.queued;
  const stillHere = track.isConnected && state.view === 'day' && state.date === pager.from;
  if (!stillHere) return resetPaging();
  pager.landing = true; // no fade-in for the new day: it is already in place
  pager.adopted = adoptGhost(track, sign); // when true, drawing the lists again is skipped (renderTasks / renderAgenda)
  try {
    // An entrance animation (.view-enter, enter-next/prev) that restarts after the slide would blink the screen.
    root.querySelectorAll('.view-enter, .enter-next, .enter-prev').forEach((el) => el.classList.remove('view-enter', 'enter-next', 'enter-prev'));
    go(`#/${date}`); // draws the new day for real and, first of all, removes the ghost and the transform
  } finally {
    pager.landing = false;
    pager.adopted = false;
    if (pager.anim || pager.live) resetPaging(); // normally the new day's drawing has already cleared everything
  }
  status.textContent = dayTitle(date) + ', ' + formatDate(date);
  if (queued) requestAnimationFrame(() => shiftDay(queued));
}

// Arrows and "today": the same slide, without a finger.
function slideTo(date) {
  const track = dayTrack();
  const sign = date.localeCompare(state.date) > 0 ? 1 : -1;
  showGhost(track, sign, date, track.parentElement.offsetWidth);
  settle(track, 0, true, sign, date);
}

function enableDayPaging(el) {
  let g = null; // the touch being followed: { x, y, axis, ox, dx, sign, width, track, samples }
  const velocity = (samples, now) => { // px per ms over the last ~80ms; 0 if the finger rested before lifting
    const last = samples[samples.length - 1];
    if (now - last.t > 90) return 0;
    const first = samples.find((p) => last.t - p.t <= 80);
    return last.t - first.t > 4 ? (last.x - first.x) / (last.t - first.t) : 0;
  };
  const release = (cur, now, cancelled) => {
    const { dx, width, track } = cur;
    if (!dx) return restPaging();
    const sign = dx > 0 ? 1 : -1;
    const v = cancelled ? 0 : velocity(cur.samples, now) * sign; // speed in the direction of the drag
    const far = Math.abs(dx + cur.lead); // the whole way the finger went, including the first few pixels before the page took hold
    const commit = !cancelled && ((v > 0.3 && far > 24) || (far > width / 3 && v > -0.2));
    settle(track, dx, commit, sign, addDays(state.date, sign));
  };

  el.addEventListener('touchstart', (e) => {
    if (g?.axis === 'x') { release(g, e.timeStamp, true); g = null; return; } // a second finger: let go of the page
    g = null;
    if (!pager.busy && pager.live) restPaging(); // left over from a drag that never ended
    if (pager.busy || state.view !== 'day' || e.touches.length !== 1 || e.target.closest('input, textarea')) return;
    const track = dayTrack();
    if (!track) return;
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, axis: '', ox: t.clientX, dx: 0, sign: 0, width: 0, track, reduced: reducedMotion(), at: e.timeStamp, samples: [{ x: t.clientX, t: e.timeStamp }] };
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!g) return;
    if (e.touches.length > 1) { if (g.axis === 'x') release(g, e.timeStamp, true); g = null; return; }
    const t = e.touches[0];
    g.samples.push({ x: t.clientX, t: e.timeStamp });
    g.lx = t.clientX;
    g.ly = t.clientY; // where the finger was last seen: touchend's own position isn't always reported
    if (g.samples.length > 8) g.samples.shift();
    if (g.reduced) return; // reduced motion: no following the finger, the day just switches when it is let go
    if (!g.axis) {
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy)) { g = null; return; } // up/down: the page scrolls as usual
      g.axis = 'x';
      g.ox = t.clientX;
      g.lead = dx; // the page starts moving from here, not with a jump
      g.width = g.track.parentElement.offsetWidth;
      g.sign = dx > 0 ? 1 : -1;
      g.track.style.willChange = 'transform';
      showGhost(g.track, g.sign, addDays(state.date, g.sign), g.width); // in place now, before the page starts to move
      return;
    }
    g.dx = Math.max(-g.width, Math.min(g.width, t.clientX - g.ox));
    const sign = g.dx > 0 ? 1 : g.dx < 0 ? -1 : g.sign;
    if (sign !== g.sign) { g.sign = sign; showGhost(g.track, sign, addDays(state.date, sign), g.width); } // dragged back past the start: the other neighbour
    g.track.style.transform = shiftX(g.dx);
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    const cur = g;
    g = null;
    if (!cur) return;
    if (cur.reduced) { // the old rule: a quick sideways flick of 50px or more
      const dx = (cur.lx ?? cur.x) - cur.x;
      const dy = (cur.ly ?? cur.y) - cur.y;
      if (e.timeStamp - cur.at < 800 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftDay(dx > 0 ? 1 : -1);
      return;
    }
    if (cur.axis === 'x') release(cur, e.timeStamp, false);
  }, { passive: true });

  el.addEventListener('touchcancel', (e) => {
    const cur = g;
    g = null;
    if (cur?.axis === 'x') release(cur, e.timeStamp, true);
  }, { passive: true });
}

// ----- day

function renderDay(direction) {
  if (!root.querySelector('.shell[data-view="day"]')) {
    const fromBoot = cameFromBoot();
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
        <div class="day-clip"><div class="day-track"><div class="day-body">
          <div class="day-head view-enter">
            <h1 class="display day-title" tabindex="-1"></h1>
            <p class="day-date"></p>
            <p class="day-holiday" hidden></p>
          </div>
          ${bannerHTML}
          <div class="push-card" hidden></div>
          <div class="tasks-block view-enter">
            <h2 class="section-label" id="tasks-label">משימות<span class="tasks-count"></span></h2>
            <section class="tasks-card" aria-labelledby="tasks-label">
              <ol class="task-list"></ol>
              ${quickAddHTML}
            </section>
            <h2 class="section-label">אירועים</h2>
          </div>
          <section class="agenda-card view-enter" aria-label="האירועים של היום"><div class="agenda"></div></section>
        </div></div></div>
        ${dockHTML}
      </div>`;
    if (fromBoot) skipEntrance();
    root.querySelector('.day-title').focus({ preventScroll: true });
    renderPushCard();
    quickAdd = setupQuickAdd(root.querySelector('.quick-add'));
    tasksDay = state.date;
  }
  // Another day: what was half typed for the previous one doesn't come along.
  if (tasksDay !== state.date) {
    tasksDay = state.date;
    state.doneOpen = false;
    quickAdd.clear();
  }
  root.querySelector('.back-label').textContent = MONTHS[state.month];
  root.querySelector('.back-link').setAttribute('aria-label', `חזרה ל${MONTHS[state.month]} ${state.year}`);
  fillDayHead(root, state.date);
  animate(root.querySelector('.day-head'), direction);
  renderTasks(direction);
  renderAgenda(direction);
}

function fillDayHead(scope, date) {
  scope.querySelector('.day-title').innerHTML = `${dayTitle(date)}${date === todayISO() ? ' <span class="today-pill">היום</span>' : ''}`;
  scope.querySelector('.day-date').textContent = formatDate(date);
  const hol = holidayOn(date);
  const line = scope.querySelector('.day-holiday');
  line.hidden = !hol;
  line.innerHTML = hol ? `${holIcon(hol)}<span>${hol.name}</span>` : '';
  line.classList.toggle('is-memorial', hol?.type === 'memorial');
}

// ----- tasks in the day view

let quickAdd = null; // the "new task" line; built once with the day screen, never redrawn
let tasksDay = null; // the day the tasks section was last set up for
let settleTimer;
let unsavedIds = 0;
const busyTasks = new Set(); // marked done or undone, still on its way to the server
const isUnsaved = (task) => task.id.startsWith('new-');

const quickAddHTML = `
  <form class="quick-add" novalidate>
    <div class="qa-line">
      <span class="qa-plus" aria-hidden="true">${icon.plus}</span>
      <input class="qa-input" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="משימה חדשה…" aria-label="משימה חדשה">
      <button type="submit" class="btn btn-primary btn-small qa-add" hidden>הוסף</button>
    </div>
    <div class="qa-picks" role="group" aria-label="דחיפות" hidden>
      <button type="button" class="kp qp" data-priority="1" aria-pressed="false"><span class="pick-check">${icon.check}</span>דחוף</button>
      <button type="button" class="kp qp" data-priority="2" aria-pressed="false"><span class="pick-check">${icon.check}</span>דחוף מאוד</button>
    </div>
    <p class="qa-error" role="alert"></p>
  </form>`;

// Write and confirm, no window. The urgency buttons show up once something is typed; none
// chosen means regular. After adding, the line empties and stays ready for the next one.
function setupQuickAdd(form) {
  const input = form.querySelector('.qa-input');
  const addButton = form.querySelector('.qa-add');
  const picksBox = form.querySelector('.qa-picks');
  const picks = [...form.querySelectorAll('.qp')];
  const error = form.querySelector('.qa-error');
  const picked = () => Number(picks.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.priority ?? 0);
  const setPicked = (priority) => picks.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.priority) === priority)));
  const sync = () => {
    const typing = Boolean(input.value.trim());
    addButton.hidden = !typing;
    picksBox.hidden = !typing;
    if (!typing) setPicked(0);
  };

  input.addEventListener('input', () => {
    error.textContent = '';
    sync();
  });
  // Enter while the phone is still settling a word only settles the word.
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); });
  // Tapping these must not take the typing away from the line, so the keyboard stays open.
  for (const button of [...picks, addButton]) button.addEventListener('mousedown', (e) => e.preventDefault());
  picks.forEach((b) => b.addEventListener('click', () => {
    const priority = Number(b.dataset.priority);
    setPicked(priority === picked() ? 0 : priority);
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    addTask(title, picked());
    input.value = '';
    sync();
  });

  return {
    clear() {
      input.value = '';
      error.textContent = '';
      sync();
    },
    // Saving failed: what was typed comes back, unless something new is already being typed.
    restore(title, priority, message) {
      if (!input.value.trim()) {
        input.value = title;
        sync();
        setPicked(priority);
      }
      error.textContent = message;
    },
  };
}

// Shown at once; saved on the way. If saving fails the row goes and the text returns to the line.
function addTask(title, priority) {
  const date = state.date;
  const unsaved = { id: `new-${++unsavedIds}`, title, date, priority, doneOn: null, createdAt: new Date().toISOString() };
  state.openTasks.push(unsaved);
  renderTasks(0, unsaved.id);
  taskWrite(() => data.addTask({ title, date, priority }))
    .then((saved) => {
      removeTask(unsaved.id);
      putTask(saved);
      // Swap the id in place rather than redrawing, so the row's settling motion isn't cut short.
      root.querySelectorAll(`[data-id="${unsaved.id}"]`).forEach((el) => { el.dataset.id = saved.id; });
    })
    .catch((error) => {
      removeTask(unsaved.id);
      if (data.isAuthError(error)) return renderLogin();
      renderTasks();
      if (state.view === 'day' && state.date === date) quickAdd?.restore(title, priority, 'המשימה לא נשמרה. נסה שוב');
      else showToast('המשימה לא נשמרה', { ok: false });
    });
}

// The check and the line show at once, where the task is; it moves to its place a moment later,
// so the next task doesn't slide under the finger.
function toggleTask(button) {
  const task = findTask(button.dataset.id);
  if (!task || isUnsaved(task) || busyTasks.has(task.id)) return;
  const before = task;
  const after = { ...task, doneOn: task.doneOn ? null : shownOn(task) };
  busyTasks.add(task.id);
  putTask(after);
  button.closest('.task')?.classList.toggle('is-done', Boolean(after.doneOn));
  button.setAttribute('aria-checked', String(Boolean(after.doneOn)));
  renderTaskCount();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => renderTasks(), 700);
  if (!after.doneOn && shownOn(after) !== state.date) showToast('המשימה חזרה להיום');

  taskWrite(() => data.updateTask(task.id, { doneOn: after.doneOn }))
    .catch((error) => {
      if (data.isAuthError(error)) return renderLogin();
      putTask(before);
      renderTasks();
      showToast('לא נשמר. נסה שוב', { ok: false });
    })
    .finally(() => busyTasks.delete(task.id));
}

function taskCountText(date) {
  const { open, done } = tasksOn(date);
  const total = open.length + done.length;
  if (!total) return '';
  if (open.length) return ` · ${open.length} מתוך ${total} פתוחות`;
  if (date >= todayISO()) return ' · הכל בוצע';
  return done.length === 1 ? ' · אחת בוצעה' : ` · ${done.length} בוצעו`;
}

// `scope` and `date` are only given for the page waiting beside the day during a slide (see "day paging"):
// the same drawing code aimed at that page, which shows placeholders for a day not fetched yet.
function renderTaskCount(scope = root, date = state.date, waiting = false) {
  const label = scope.querySelector('.tasks-count');
  if (label) label.textContent = (waiting || state.loading) && !isKnown(date) ? '' : taskCountText(date);
}

function taskRow(task, fresh, day = state.date) {
  const done = Boolean(task.doneOn);
  const title = escapeHTML(task.title);
  const from = task.date !== day ? `מ-${formatDate(task.date).slice(0, 5)}` : ''; // carried on from an earlier day
  const priority = task.priority ? PRIORITY_NAMES[task.priority] : '';
  return `
    <li class="task${done ? ' is-done' : ''}${task.id === fresh ? ' is-new' : ''}" data-id="${task.id}">
      <button class="task-check" data-action="toggle-task" data-id="${task.id}" role="checkbox" aria-checked="${done}" aria-label="בוצע: ${title}">
        <span class="ring">${icon.check}</span>
      </button>
      <button class="task-name" data-action="edit-task" data-id="${task.id}" aria-label="עריכת משימה: ${title}${priority ? `, ${priority}` : ''}${from ? `, ${from}` : ''}">
        <span class="task-text"><span class="task-title">${title}</span>${from ? `<small class="task-from">${from}</small>` : ''}</span>
        ${priority ? `<span class="prio${task.priority === 2 ? ' is-top' : ''}">${priority}</span>` : ''}
      </button>
    </li>`;
}

function renderTasks(direction = 0, fresh = null, scope = root, date = state.date) {
  const block = scope.querySelector('.tasks-block');
  if (!block) return;
  const waiting = scope !== root;
  if (!waiting && pager.adopted) return; // the lists just slid in already drawn
  if (!waiting) { clearTimeout(settleTimer); dropSpareGhosts(); }
  const list = block.querySelector('.task-list');
  const past = date < todayISO();
  const skeleton = (waiting || state.loading) && !isKnown(date);
  const { open, done } = tasksOn(date);

  // A past day takes no new tasks - they would move to today at once. It keeps what was done on it.
  block.hidden = past && (skeleton || !done.length);
  block.querySelector('.quick-add').hidden = past;
  renderTaskCount(scope, date, waiting);

  const focused = !waiting && document.activeElement?.closest?.('.task-list [data-action]');
  const refocus = focused && `[data-action="${focused.dataset.action}"]${focused.dataset.id ? `[data-id="${focused.dataset.id}"]` : ''}`;
  if (skeleton) {
    list.innerHTML = [58, 42].map((w) => `
      <li class="task" aria-hidden="true"><span class="task-check"><span class="ring"></span></span><span class="skel" style="width:${w}%"></span></li>`).join('');
  } else {
    // More than three done fold into one row, which opens on a tap.
    const folded = done.length > 3 && (waiting || !state.doneOpen);
    const rows = open.map((t) => taskRow(t, fresh, date));
    if (done.length > 3) {
      rows.push(`
        <li class="task-fold">
          <button data-action="fold-done" aria-expanded="${!folded}">
            <span class="ring is-filled">${icon.check}</span>${done.length} בוצעו<span class="fold-arrow">${icon.chevron}</span>
          </button>
        </li>`);
    }
    if (!folded) rows.push(...done.map((t) => taskRow(t, fresh, date)));
    list.innerHTML = rows.join('');
  }
  if (refocus) list.querySelector(refocus)?.focus();
  animate(list, direction);
}

// After deleting, the row slides away before the list closes the gap.
function showTaskDeleted(id) {
  const row = root.querySelector(`.task[data-id="${id}"]`);
  if (!row) return renderTasks();
  row.classList.add('is-leaving');
  setTimeout(() => renderTasks(), 240);
}

function renderAgenda(direction = 0, scope = root, date = state.date) {
  const agenda = scope.querySelector('.agenda');
  if (!agenda) return;
  const waiting = scope !== root;
  if (!waiting && pager.adopted) return prepareGhosts();
  if (!waiting) dropSpareGhosts();
  const events = state.byDate.get(date) ?? [];

  const skeleton = (waiting || state.loading) && !isKnown(date);
  if (skeleton) {
    agenda.innerHTML = [72, 54, 64].map((w) => `
      <div class="row" aria-hidden="true"><span class="skel when-skel"></span><span class="skel" style="width:${w}%"></span></div>`).join('');
  } else if (events.length === 0) {
    agenda.innerHTML = `
      <div class="agenda-empty">
        <p>אין אירועים ביום הזה</p>
        <button class="btn btn-primary" data-action="add">${icon.plus}הוסף אירוע</button>
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

  if (waiting) return;
  root.querySelector('.banner').hidden = !state.loadError;
  animate(agenda, direction);
  if (!skeleton) state.highlight = null;
  prepareGhosts();
}

function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // restart the animation
  el.classList.add(className);
}

function animate(el, direction) {
  if (!direction || pager.landing) return;
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

// ---------- what both sheets share: a question in place of the buttons, a save that keeps what
// was typed when it fails, staying above the phone's keyboard, and sliding away when closed

function sheetKit(el, { setBusy }) {
  const $ = (selector) => el.querySelector(selector);
  const formError = $('.form-error');
  const mainActions = $('[data-main-actions]');
  const choiceBox = $('[data-choice]');
  const choiceButtons = $('[data-choice-buttons]');
  let closing = false;
  let settleChoice = null;

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
      formError.textContent = failMessage;
    }
  }

  // On phones the keyboard covers the bottom of the screen; lift the sheet above it.
  const vv = window.visualViewport;
  const onViewport = () => {
    const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    el.style.setProperty('--keyboard', `${keyboard}px`);
    el.classList.toggle('has-keyboard', keyboard > 120); // a real keyboard covers the home bar: the buttons can sit lower
  };
  const trackKeyboard = (on) => {
    if (!vv) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    vv[method]('resize', onViewport);
    vv[method]('scroll', onViewport);
    if (on) onViewport();
    else {
      el.style.removeProperty('--keyboard');
      el.classList.remove('has-keyboard');
    }
  };

  function show() {
    closing = false;
    el.classList.remove('is-closing');
    el.showModal();
    trackKeyboard(true);
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

  el.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  el.addEventListener('click', (e) => { if (e.target === el) close(); }); // tap outside the sheet

  return { ask, hideChoice, perform, show, close };
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
      <div class="sheet-footer">
        <p class="form-error" role="alert"></p>
        <div class="sheet-actions" data-main-actions>
          <button type="submit" class="btn btn-primary" data-save>שמור</button>
          <button type="button" class="btn btn-ghost" data-cancel>ביטול</button>
        </div>
        <div class="confirm" data-choice hidden>
          <p data-choice-text></p>
          <div class="choice-buttons" data-choice-buttons></div>
        </div>
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
  const choiceButtons = $('[data-choice-buttons]');
  const picks = [...el.querySelectorAll('[data-wd]')];
  const kindPicks = [...el.querySelectorAll('[data-kind]')];
  const pickedKind = () => kindPicks.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.kind ?? null;
  const setKind = (kind) => kindPicks.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  let editing = null;

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
  const { ask, hideChoice, perform, show: showSheet, close } = sheetKit(el, { setBusy });

  for (const input of [inputs.date, inputs.time, inputs.end, inputs.until]) {
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* the browser opens its own */ } });
  }
  $('[data-clear-time]').addEventListener('click', () => { inputs.time.value = ''; sync(); inputs.time.focus(); });
  inputs.repeat.addEventListener('change', () => {
    if (inputs.repeat.checked && !pickedDays().length && inputs.date.value) setPick(picks[fromISO(inputs.date.value).getDay()], true);
    sync();
    // The days and end date open under the pinned buttons; bring them into view.
    if (inputs.repeat.checked) $('[data-recur]').scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  picks.forEach((b) => b.addEventListener('click', () => setPick(b, b.getAttribute('aria-pressed') !== 'true')));
  // One kind at most; tapping the chosen one again clears it.
  kindPicks.forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind === pickedKind() ? null : b.dataset.kind)));
  inputs.title.addEventListener('input', () => setTitleError(''));
  $('[data-cancel]').addEventListener('click', close);

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

  const finish = (toastText, ev, dayWasFree) => {
    close();
    showToast(toastText);
    showSaved(ev, dayWasFree);
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
        const wasFree = saved.map((ev) => placeEvent(ev));
        finish(`האירוע הקבוע נשמר, ${saved.length} פעמים`, saved[0], wasFree[0]);
      }, 'השמירה נכשלה, נסה שוב');
      return;
    }
    if (!editing) {
      perform(async () => {
        const saved = await data.addEvent(fields);
        finish('האירוע נשמר', saved, placeEvent(saved));
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
      finish(scope === 'all' ? 'הסדרה עודכנה' : 'האירוע נשמר', saved, placeEvent(saved));
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
    showSheet();
    // A new event starts with typing; an existing one may just be deleted, so don't pop the keyboard.
    if (event) $('#sheet-title').focus();
    else inputs.title.focus();
  }

  return { open };
}

// ---------- task sheet: rename, move to another day, change urgency, delete

function createTaskSheet() {
  const el = document.createElement('dialog');
  el.className = 'sheet';
  el.setAttribute('aria-labelledby', 'task-sheet-title');
  el.innerHTML = `
    <form class="sheet-form" novalidate>
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 class="display sheet-title" id="task-sheet-title" tabindex="-1">עריכת משימה</h2>
        <button type="button" class="link-btn is-danger" data-delete>מחק</button>
      </div>
      <p class="series-note" data-done-note hidden></p>
      <div class="field">
        <label for="task-title">שם</label>
        <input class="input" id="task-title" maxlength="200" autocomplete="off" enterkeyhint="done" aria-describedby="task-title-error">
        <p class="field-error" id="task-title-error"></p>
      </div>
      <div class="field" data-date-field>
        <label for="task-date">יום</label>
        <div class="picker"><span class="picker-value" data-show="date"></span><input id="task-date" type="date" required></div>
      </div>
      <div class="field">
        <span class="field-label" id="task-priority-label">דחיפות</span>
        <div class="kind-picks" role="group" aria-labelledby="task-priority-label">
          ${PRIORITY_NAMES.map((name, i) => `<button type="button" class="kp" data-priority="${i}" aria-pressed="false"><span class="pick-check">${icon.check}</span>${name}</button>`).join('')}
        </div>
      </div>
      <div class="sheet-footer">
        <p class="form-error" role="alert"></p>
        <div class="sheet-actions" data-main-actions>
          <button type="submit" class="btn btn-primary" data-save>שמור</button>
          <button type="button" class="btn btn-ghost" data-cancel>ביטול</button>
        </div>
        <div class="confirm" data-choice hidden>
          <p data-choice-text></p>
          <div class="choice-buttons" data-choice-buttons></div>
        </div>
      </div>
    </form>`;
  document.body.append(el);

  const $ = (selector) => el.querySelector(selector);
  const titleInput = $('#task-title');
  const dateInput = $('#task-date');
  const titleError = $('#task-title-error');
  const formError = $('.form-error');
  const saveButton = $('[data-save]');
  const deleteButton = $('[data-delete]');
  const priorityPicks = [...el.querySelectorAll('[data-priority]')];
  const picked = () => Number(priorityPicks.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.priority ?? 0);
  const setPicked = (priority) => priorityPicks.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.priority) === priority)));
  const setBusy = (busy) => {
    saveButton.disabled = busy;
    saveButton.textContent = busy ? 'שומר…' : 'שמור';
    $('[data-choice-buttons]').querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  };
  const { ask, hideChoice, perform, show: showSheet, close } = sheetKit(el, { setBusy });
  let editing = null;
  let shownDate = null; // the day the task shows on now; the date is sent only when it changes

  const showDate = () => {
    const span = $('[data-show="date"]');
    span.textContent = dateInput.value ? formatLong(dateInput.value) : 'בחר יום';
    span.classList.toggle('is-placeholder', !dateInput.value);
  };
  const setTitleError = (message) => {
    titleError.textContent = message;
    titleInput.classList.toggle('is-invalid', Boolean(message));
    titleInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const fail = (message) => { formError.textContent = message; };

  dateInput.addEventListener('input', showDate);
  dateInput.addEventListener('change', showDate);
  dateInput.addEventListener('click', () => { try { dateInput.showPicker?.(); } catch { /* the browser opens its own */ } });
  priorityPicks.forEach((b) => b.addEventListener('click', () => setPicked(Number(b.dataset.priority)))); // always exactly one
  titleInput.addEventListener('input', () => setTitleError(''));
  $('[data-cancel]').addEventListener('click', close);

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    formError.textContent = '';
    const title = titleInput.value.trim();
    if (!title) {
      setTitleError('חסר שם למשימה');
      titleInput.focus();
      return;
    }
    const fields = { title, priority: picked() };
    // A done task stays where it was done; only an open one moves, and only to today or later.
    if (!editing.doneOn && dateInput.value !== shownDate) {
      if (!dateInput.value) return fail('חסר יום');
      if (dateInput.value < todayISO()) return fail('אפשר להעביר רק להיום או ליום שעוד לא עבר');
      fields.date = dateInput.value;
    }
    const { id } = editing;
    perform(async () => {
      const saved = await taskWrite(() => data.updateTask(id, fields));
      putTask(saved);
      close();
      const moved = shownOn(saved) !== state.date;
      showToast(moved ? `המשימה הועברה ל${formatLong(shownOn(saved))}` : 'המשימה נשמרה');
      if (moved) showTaskDeleted(id); // it leaves this day
      else renderTasks(0, id);
    }, 'השמירה נכשלה, נסה שוב');
  });

  deleteButton.addEventListener('click', async () => {
    const { id } = editing;
    const sure = await ask('למחוק את המשימה?', [
      { label: 'מחק', value: true, kind: 'danger' },
      { label: 'ביטול', value: null, kind: 'ghost' },
    ]);
    if (!sure) {
      deleteButton.focus();
      return;
    }
    perform(async () => {
      await taskWrite(() => data.deleteTask(id));
      removeTask(id);
      close();
      showToast('המשימה נמחקה');
      showTaskDeleted(id);
    }, 'המחיקה נכשלה, נסה שוב');
  });

  function open(task) {
    editing = task;
    shownDate = task.doneOn ? null : shownOn(task);
    titleInput.value = task.title;
    dateInput.value = shownDate ?? '';
    dateInput.min = todayISO();
    showDate();
    $('[data-date-field]').hidden = Boolean(task.doneOn);
    const note = $('[data-done-note]');
    note.hidden = !task.doneOn;
    if (task.doneOn) note.innerHTML = `${icon.check}בוצעה ב-${formatDate(task.doneOn).slice(0, 5)}`;
    setPicked(task.priority);
    setTitleError('');
    formError.textContent = '';
    hideChoice();
    setBusy(false);
    showSheet();
    $('#task-sheet-title').focus(); // it may just be deleted or moved, so don't pop the keyboard
  }

  return { open };
}
