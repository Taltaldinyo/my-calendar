// Everything that reads or writes events and tasks. The screens never talk to Supabase directly.
// The Supabase library is a copy kept in vendor/ (version 2.117.0), loaded by index.html.
// Not from a public CDN on purpose: nothing outside the repo can change what runs here.
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_EMAIL } from './config.js?v=34';

// Demo mode: sample events kept in memory, no sign-in. Only on this computer (localhost),
// so the screens can be checked without the real password.
export const isDemo = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('demo');

const supabase = isDemo ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

export class WrongPasswordError extends Error {}

const COLUMNS = 'id,title,date,time,end_time,series_id,remind_minutes,kind';
const hhmm = (t) => (t ? t.slice(0, 5) : null);
const clean = (row) => ({
  id: row.id,
  title: row.title,
  date: row.date,
  time: hhmm(row.time),
  endTime: hhmm(row.end_time),
  seriesId: row.series_id ?? null, // set when the event is one occurrence of a weekly event
  remindMinutes: row.remind_minutes ?? null, // reminder on the phone, this many minutes before
  kind: row.kind ?? null, // meeting / work / study / fun / medical / workout / other, or none
});
const toRow = ({ title, date, time, endTime, remindMinutes, kind }) =>
  ({ title, date, time, end_time: endTime ?? null, remind_minutes: remindMinutes ?? null, kind: kind ?? null });

export async function hasSession() {
  if (isDemo) return true;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export async function signIn(password) {
  const { error } = await supabase.auth.signInWithPassword({ email: LOGIN_EMAIL, password });
  if (!error) return;
  if (error.status === 400) throw new WrongPasswordError();
  throw error;
}

export function onSignedOut(callback) {
  if (isDemo) return;
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback();
  });
}

// Signed out or expired: bad/expired token, or the request arrived without one (guests have no access at all).
const AUTH_CODES = ['PGRST301', 'PGRST302', 'PGRST303', '42501'];
export const isAuthError = (error) => error?.status === 401 || AUTH_CODES.includes(error?.code);

export async function listEvents(from, to) {
  if (isDemo) return demo.list(from, to);
  const { data, error } = await supabase.from('events').select(COLUMNS)
    .gte('date', from).lte('date', to)
    .order('date').order('time', { nullsFirst: true });
  if (error) throw error;
  return data.map(clean);
}

export async function addEvent(fields) {
  if (isDemo) return (await demo.add([toRow(fields)]))[0];
  const { data, error } = await supabase.from('events').insert(toRow(fields)).select(COLUMNS).single();
  if (error) throw error;
  return clean(data);
}

// A weekly event is stored as one row per occurrence, all sharing one series id.
export async function addSeries({ dates, ...fields }) {
  const seriesId = crypto.randomUUID();
  const rows = dates.map((date) => ({ ...toRow({ ...fields, date }), series_id: seriesId }));
  if (isDemo) return demo.add(rows);
  const { data, error } = await supabase.from('events').insert(rows).select(COLUMNS);
  if (error) throw error;
  return data.map(clean);
}

export async function updateEvent(id, fields) {
  if (isDemo) return (await demo.update((e) => e.id === id, toRow(fields)))[0];
  const { data, error } = await supabase.from('events').update(toRow(fields)).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return clean(data);
}

// Name, hours and kind change in every occurrence; each keeps its own date.
export async function updateSeries(seriesId, { title, time, endTime, remindMinutes, kind }) {
  const fields = { title, time, end_time: endTime ?? null, remind_minutes: remindMinutes ?? null, kind: kind ?? null };
  if (isDemo) return demo.update((e) => e.series_id === seriesId, fields);
  const { data, error } = await supabase.from('events').update(fields).eq('series_id', seriesId).select(COLUMNS);
  if (error) throw error;
  return data.map(clean);
}

export async function deleteEvent(id) {
  if (isDemo) return demo.remove((e) => e.id === id);
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteSeries(seriesId) {
  if (isDemo) return demo.remove((e) => e.series_id === seriesId);
  const { error } = await supabase.from('events').delete().eq('series_id', seriesId);
  if (error) throw error;
}

// ---------- tasks: a to-do for a day, no hours. Open ones are few, so they always come whole.

const TASK_COLUMNS = 'id,title,date,priority,done_on,created_at';
const cleanTask = (row) => ({
  id: row.id,
  title: row.title,
  date: row.date, // the day it was written for (or moved to); stays even when it carries on to today
  priority: row.priority ?? 0, // 0 regular, 1 urgent, 2 very urgent
  doneOn: row.done_on ?? null, // null while open; else the day it was on screen when marked done
  createdAt: row.created_at,
});
// Only the fields given, so marking done never touches the name.
const toTaskRow = (fields) => {
  const row = {};
  if ('title' in fields) row.title = fields.title;
  if ('date' in fields) row.date = fields.date;
  if ('priority' in fields) row.priority = fields.priority;
  if ('doneOn' in fields) row.done_on = fields.doneOn;
  return row;
};

// Every open task, whatever its day, and the ones marked done between from and to.
export async function listTasks(from, to) {
  if (isDemo) return demoTasks.list(from, to);
  const { data, error } = await supabase.from('tasks').select(TASK_COLUMNS)
    .or(`done_on.is.null,and(done_on.gte.${from},done_on.lte.${to})`)
    .order('priority', { ascending: false }).order('created_at');
  if (error) throw error;
  return data.map(cleanTask);
}

export async function addTask(fields) {
  if (isDemo) return demoTasks.add(toTaskRow(fields));
  const { data, error } = await supabase.from('tasks').insert(toTaskRow(fields)).select(TASK_COLUMNS).single();
  if (error) throw error;
  return cleanTask(data);
}

export async function updateTask(id, fields) {
  if (isDemo) return demoTasks.update(id, toTaskRow(fields));
  const { data, error } = await supabase.from('tasks').update(toTaskRow(fields)).eq('id', id).select(TASK_COLUMNS).single();
  if (error) throw error;
  return cleanTask(data);
}

export async function deleteTask(id) {
  if (isDemo) return demoTasks.remove(id);
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ---------- reminders on the phone (sent by the "reminders" function in Supabase)

export async function pushPublicKey() {
  const { data, error } = await supabase.functions.invoke('reminders', { method: 'GET' });
  if (error) throw error;
  return data.publicKey;
}

export async function savePushSubscription(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions')
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('reminders', { body: { action: 'test' } });
  if (error) throw error;
  return data.sent;
}

// ---------- demo store

const pad = (n) => String(n).padStart(2, '0');
const dayFromToday = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// In the demo, `window.demoFail = true` in the console makes every save fail, so the failure
// messages can be checked without a real server.
const wait = () => new Promise((resolve, reject) => setTimeout(() => (window.demoFail ? reject(new Error('demo failure')) : resolve()), 350));

const demo = (() => {
  let nextId = 1;
  // Rows look like the database: end_time and series_id, cleaned on the way out.
  const make = (offset, title, time = null, end_time = null, series_id = null, kind = null) =>
    ({ id: String(nextId++), title, date: dayFromToday(offset), time, end_time, series_id, kind });
  const events = [
    make(0, 'הרצאה במימון', '10:00', '12:00', null, 'study'),
    make(0, 'חדר כושר', '18:30', null, null, 'workout'),
    make(2, 'יום הולדת לאמא'),
    make(2, 'ארוחת ערב משפחתית', '20:00'),
    make(5, 'מבחן בחשבונאות פיננסית', '09:00', '12:00'),
    make(-3, 'פגישה עם המנחה', '14:00', null, null, 'meeting'),
    make(8, 'סדנת הכנה לבחינה בדיני מסים, כולל חומרי תרגול', '16:00'),
    make(11, 'יום חופש'),
    make(11, 'רופא שיניים', '08:15', null, null, 'medical'),
    make(11, 'תרגול בחשבונאות', '12:00'),
    make(11, 'קפה עם נועם', '17:00', null, null, 'fun'),
    make(11, 'סרט', '21:30', null, null, 'fun'),
    ...[1, 8, 15, 22].map((offset) => make(offset, 'סמינר', '08:00', '15:00', 'demo-series', 'work')),
  ];
  return {
    async list(from, to) {
      await wait();
      return events.filter((e) => e.date >= from && e.date <= to).map(clean);
    },
    async add(rows) {
      await wait();
      const added = rows.map((row) => ({ id: String(nextId++), series_id: null, ...row }));
      events.push(...added);
      return added.map(clean);
    },
    async update(match, fields) {
      await wait();
      const hit = events.filter(match);
      hit.forEach((e) => Object.assign(e, fields));
      return hit.map(clean);
    },
    async remove(match) {
      await wait();
      for (let i = events.length - 1; i >= 0; i--) if (match(events[i])) events.splice(i, 1);
    },
  };
})();

const demoTasks = (() => {
  let nextId = 1;
  let clock = Date.now() - 86400000;
  // Rows look like the database: done_on and created_at, cleaned on the way out.
  const make = (offset, title, priority = 0, doneOffset = null) => ({
    id: `t${nextId++}`,
    title,
    date: dayFromToday(offset),
    priority,
    done_on: doneOffset === null ? null : dayFromToday(doneOffset),
    created_at: new Date(clock += 60000).toISOString(),
  });
  const tasks = [
    make(-2, 'לעבוד על חשבון בלינקדאין'), // not done two days ago: carries on to today
    make(0, 'לסדר את החדר'),
    make(0, 'לקנות מתנה לאמא', 1),
    make(0, 'לשלוח מייל למרצה על העבודה', 2),
    make(0, 'לשלם חשבון חשמל', 0, 0),
    make(-1, 'להתקשר לסבתא', 0, 0),
    make(0, 'לקרוא פרק 3 במימון', 1, 0),
    make(0, 'לעדכן קורות חיים', 0, 0),
    make(-3, 'להגיש תרגיל 2', 2, -3),
    make(2, 'להכין מצגת לסמינר', 1),
    make(4, 'לחדש ביטוח רכב'), // a day with no events: its dot comes from the task alone
  ];
  const order = (a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at);
  return {
    async list(from, to) {
      await wait();
      return tasks.filter((t) => t.done_on === null || (t.done_on >= from && t.done_on <= to)).sort(order).map(cleanTask);
    },
    async add(row) {
      await wait();
      const task = { id: `t${nextId++}`, priority: 0, done_on: null, created_at: new Date().toISOString(), ...row };
      tasks.push(task);
      return cleanTask(task);
    },
    async update(id, fields) {
      await wait();
      const task = tasks.find((t) => t.id === id);
      Object.assign(task, fields);
      return cleanTask(task);
    },
    async remove(id) {
      await wait();
      tasks.splice(tasks.findIndex((t) => t.id === id), 1);
    },
  };
})();
