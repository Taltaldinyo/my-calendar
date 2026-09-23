// Everything that reads or writes events. The screens never talk to Supabase directly.
// The Supabase library is a copy kept in vendor/ (version 2.117.0), loaded by index.html.
// Not from a public CDN on purpose: nothing outside the repo can change what runs here.
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_EMAIL } from './config.js?v=11';

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
  kind: row.kind ?? null, // meeting / work / study / fun / medical / other, or none
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

const demo = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const dayFromToday = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  let nextId = 1;
  // Rows look like the database: end_time and series_id, cleaned on the way out.
  const make = (offset, title, time = null, end_time = null, series_id = null, kind = null) =>
    ({ id: String(nextId++), title, date: dayFromToday(offset), time, end_time, series_id, kind });
  const events = [
    make(0, 'הרצאה במימון', '10:00', '12:00', null, 'study'),
    make(0, 'חדר כושר', '18:30', null, null, 'other'),
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
  const wait = () => new Promise((resolve) => setTimeout(resolve, 350));
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
