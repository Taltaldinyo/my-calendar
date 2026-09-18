// Everything that reads or writes events. The screens never talk to Supabase directly.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LOGIN_EMAIL } from './config.js';

// Demo mode: sample events kept in memory, no sign-in. Only on this computer (localhost),
// so the screens can be checked without the real password.
export const isDemo = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('demo');

const supabase = isDemo ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

export class WrongPasswordError extends Error {}

const COLUMNS = 'id,title,date,time';
const clean = (row) => ({ id: row.id, title: row.title, date: row.date, time: row.time ? row.time.slice(0, 5) : null });

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

export async function addEvent({ title, date, time }) {
  if (isDemo) return demo.add({ title, date, time });
  const { data, error } = await supabase.from('events').insert({ title, date, time }).select(COLUMNS).single();
  if (error) throw error;
  return clean(data);
}

export async function updateEvent(id, { title, date, time }) {
  if (isDemo) return demo.update(id, { title, date, time });
  const { data, error } = await supabase.from('events').update({ title, date, time }).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return clean(data);
}

export async function deleteEvent(id) {
  if (isDemo) return demo.remove(id);
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw error;
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
  const make = (offset, title, time = null) => ({ id: String(nextId++), title, date: dayFromToday(offset), time });
  const events = [
    make(0, 'הרצאה במימון', '10:00'),
    make(0, 'חדר כושר', '18:30'),
    make(2, 'יום הולדת לאמא'),
    make(2, 'ארוחת ערב משפחתית', '20:00'),
    make(5, 'מבחן בחשבונאות פיננסית', '09:00'),
    make(-3, 'פגישה עם המנחה', '14:00'),
    make(8, 'סדנת הכנה לבחינה בדיני מסים, כולל חומרי תרגול', '16:00'),
    make(11, 'יום חופש'),
    make(11, 'רופא שיניים', '08:15'),
    make(11, 'תרגול בחשבונאות', '12:00'),
    make(11, 'קפה עם נועם', '17:00'),
    make(11, 'סרט', '21:30'),
  ];
  const wait = () => new Promise((resolve) => setTimeout(resolve, 350));
  const copy = (e) => ({ ...e });
  return {
    async list(from, to) {
      await wait();
      return events.filter((e) => e.date >= from && e.date <= to).map(copy);
    },
    async add(fields) {
      await wait();
      const e = { id: String(nextId++), ...fields };
      events.push(e);
      return copy(e);
    },
    async update(id, fields) {
      await wait();
      const e = events.find((x) => x.id === id);
      Object.assign(e, fields);
      return copy(e);
    },
    async remove(id) {
      await wait();
      events.splice(events.findIndex((x) => x.id === id), 1);
    },
  };
})();
