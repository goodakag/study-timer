// Small DOM / time / format helpers shared by every module.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const pad = (n) => String(n).padStart(2, '0');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Parse HTML into a single element. */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? 'Cmd ⌘' : 'Ctrl';
export const ALT = isMac ? 'Option ⌥' : 'Alt';

/** Clock display: counts down (ceil) or up (floor). Shows h:mm:ss past an hour. */
export function clockText(ms, up = false) {
  const total = Math.max(0, up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "39min", "1h 2min", "2h" */
export function dur(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}
/** "1H 0MIN" style used in mono summary lines */
export function durCaps(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  return `${Math.floor(mins / 60)}H ${mins % 60}MIN`;
}
/** "60h16min" style used on analytics cards */
export function durTight(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(mins / 60);
  return h ? `${h}h${mins % 60}min` : `${mins}min`;
}

let use24 = true;
export const setClock24 = (v) => (use24 = !!v);
export function hm(ts) {
  const d = new Date(ts);
  if (use24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
export function ago(ts, now = Date.now()) {
  const s = Math.round((ts - now) / 1000);
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
export function weekStart(ts, startsMonday = true) {
  const d = new Date(dayStart(ts));
  const dow = d.getDay();
  const back = startsMonday ? (dow + 6) % 7 : dow;
  d.setDate(d.getDate() - back);
  return d.getTime();
}
export function monthStart(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
export function addMonths(ts, n) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}
export const sameDay = (a, b) => dayStart(a) === dayStart(b);

export const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}

export async function download(name, text, type = 'application/json') {
  // Inside a Claude Artifact, files go through the viewer's save prompt.
  if (window.claude?.use) {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) {
      try {
        await dl.save({ filename: name, data: text });
      } catch {
        /* declined or unavailable: nothing to do */
      }
      return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const isTyping = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
