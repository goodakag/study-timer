// App state, persistence (localStorage) and a tiny pub/sub bus.
import { debounce, dayStart, DAY } from './util.js';

const KEY = 'session-web:v1';

export const PALETTE = [
  '#df6363', '#9159e2', '#fc9e6d', '#57bdc6', '#aecc5c',
  '#d8a756', '#6197f9', '#59d278', '#e46fb0', '#9a9a9a',
];

export const SOUNDS = [
  ['off', 'None'],
  ['brown', 'Brown noise'],
  ['pink', 'Pink noise'],
  ['white', 'White noise'],
  ['rain', 'Rain'],
  ['ticking', 'Clock ticking'],
];

export const MOODS = {
  focused: { label: 'Focused', emoji: '🤩', arrow: '↑' },
  neutral: { label: 'Neutral', emoji: '😐', arrow: '→' },
  distracted: { label: 'Distracted', emoji: '😔', arrow: '↓' },
};

function defaults() {
  return {
    version: 1,
    settings: {
      sessionMin: 25,
      shortBreakMin: 5,
      longBreakMin: 20,
      longBreakEvery: 4,
      streakTarget: 8,
      snapMin: 5,
      autoStartSession: false,
      autoStartBreak: false,
      breathe: true,
      breatheCycles: 3,
      reflection: false, // the after-session question was removed
      defaultMood: 'focused',
      suggestions: 'all',
      focusOnCategory: true,
      endingSoon: true,
      endingSoonMin: 2,
      playSound: true,
      presence: true,
      presenceMin: 10,
      overflow: true,
      tooLong: true,
      tooLongMin: 10,
      notifications: false,
      bg: { focus: 'brown', overflow: 'rain', break: 'off', breakOver: 'ticking' },
      volume: 0.5,
      clock24: true,
      weekMonday: true,
      titleCountdown: true,
      reduceMotion: false,
      look: 'cozy', // 'cozy' | 'classic'
      focusStyle: 'digital', // 'digital' | 'analog'
      breakTheme: 'blue', // blue | teal | green | purple | rose | cozy | light | gray
      focusMode: true,
      useCategories: false, // tag sessions with a subject + colour (off: one plain category) // full-screen focus view while a timer runs
      longestStretch: 50, // blocks over an hour split into stretches of at most this
    },
    categories: [
      { id: 'session', name: 'Session', color: '#df6363' },
      { id: 'personal', name: 'Personal', color: '#9159e2' },
      { id: 'reading', name: 'Reading', color: '#fc9e6d' },
      { id: 'learn', name: 'Learn', color: '#aecc5c' },
      { id: 'health', name: 'Health', color: '#59d278' },
    ],
    sessions: [], // {id,type:'focus'|'break',title,categoryId,start,end,pausedMs,plannedMs,mood,note}
    planned: [], // {id,title,categoryId,start,end}
    timer: null, // active timer, see timer.js
    ui: {
      view: 'timer',
      rightTab: 'today',
      draft: { title: '', categoryId: 'session', minutes: 25, note: '' },
      muted: false,
      zen: true,
      onboarded: false,
      notesFilter: { break: false, cat: false },
    },
    meta: { editedAt: 0 }, // last real change, used to reconcile with the cloud copy
  };
}

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    const b = base?.[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, over[k]) : over[k];
  }
  return out;
}

let raw = null;
try {
  raw = JSON.parse(localStorage.getItem(KEY) || 'null');
} catch {
  raw = null;
}
export const state = merge(defaults(), raw || {});
if (!state.categories.length) state.categories = defaults().categories;
state.settings.reflection = false;
// Breaks moved to a brighter default colour.
if (!state.meta.breakV2) {
  state.settings.breakTheme = 'blue';
  state.meta.breakV2 = true;
}
// Focus mode is a setting; the full-view peek only ever lasts one session.
state.ui.zen = true; // focus mode is always on (there is no full view)

let storageOk = true;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}
export const isStorageOk = () => storageOk;
export const save = debounce(persist, 300);
export const flush = () => save.flush();
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.hidden && flush());

export function replaceAll(data) {
  const fresh = merge(defaults(), data || {});
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  // A deliberate replace is the newest version, so the cloud copy must not win.
  state.meta.editedAt = Date.now();
  flush();
}
export function resetAll() {
  replaceAll(defaults());
}

// ---- pub/sub -------------------------------------------------------------
const subs = new Map();
export function on(topic, fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
}
const TRANSIENT = new Set(['tick', 'minute', 'reflect', 'breathe', 'breathing', 'navigate', 'help']);
/** Emit topics. Anything but transient topics marks state dirty. */
export function emit(topic, payload) {
  const set = subs.get(topic);
  // One listener failing must never stop the others (e.g. the switch to the
  // focus screen runs after several other listeners).
  if (set)
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[session] "${topic}" listener failed`, err);
      }
    }
  if (!TRANSIENT.has(topic)) {
    state.meta.editedAt = Date.now();
    save();
  }
}

// ---- selectors -----------------------------------------------------------
/** Categories are optional; when off, everything uses the first one. */
export const catsOn = () => !!state.settings.useCategories;

export function cat(id) {
  return state.categories.find((c) => c.id === id) || state.categories[0];
}

export const focusMs = (s) => Math.max(0, s.end - s.start - (s.pausedMs || 0));

export function sessionsBetween(a, b, type) {
  return state.sessions.filter((s) => s.start < b && s.end > a && (!type || s.type === type));
}

export function todayFocusCount(now = Date.now()) {
  const a = dayStart(now);
  return state.sessions.filter((s) => s.type === 'focus' && s.start >= a && s.start < a + DAY).length;
}

/** Focus time today, and how many days in a row (ending today or yesterday) had a session. */
export function dayStats(now = Date.now()) {
  const today = dayStart(now);
  let ms = 0;
  const days = new Set();
  for (const s of state.sessions) {
    if (s.type !== 'focus') continue;
    const d = dayStart(s.start);
    days.add(d);
    if (d === today) ms += focusMs(s);
  }
  let streak = 0;
  let d = days.has(today) ? today : dayStart(today - DAY / 2);
  while (days.has(d)) {
    streak++;
    d = dayStart(d - DAY / 2);
  }
  return { ms, streak, count: todayFocusCount(now) };
}

/** Unique past intentions (most recent first) for autocomplete. */
export function suggestions(query, categoryId) {
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const out = [];
  const pool = [...state.sessions, ...state.planned].sort((a, b) => b.start - a.start);
  for (const s of pool) {
    if (!s.title || s.type === 'break') continue;
    if (state.settings.suggestions === 'category' && categoryId && s.categoryId !== categoryId) continue;
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    if (q && !key.includes(q)) continue;
    if (q && key === q) continue;
    seen.add(key);
    out.push({ title: s.title, categoryId: s.categoryId });
    if (out.length >= 6) break;
  }
  return out;
}
