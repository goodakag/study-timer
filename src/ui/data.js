// Import / export helpers.
import { state, emit, cat, focusMs } from '../store.js';
import { uid, dayStart, addDays, MIN, HOUR } from '../util.js';

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function toCSV(sessions) {
  const rows = [['type', 'title', 'category', 'start', 'end', 'focus_minutes', 'paused_minutes', 'mood', 'note']];
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    rows.push([
      s.type,
      s.title,
      cat(s.categoryId).name,
      new Date(s.start).toISOString(),
      new Date(s.end).toISOString(),
      (focusMs(s) / 60000).toFixed(1),
      ((s.pausedMs || 0) / 60000).toFixed(1),
      s.mood || '',
      s.note || '',
    ]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\n');
}

export function exportAll() {
  return JSON.stringify({ app: 'session-web', exportedAt: new Date().toISOString(), ...state, timer: null }, null, 2);
}

/** Validate an imported backup; returns sanitized data or throws. */
export function parseBackup(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object') throw new Error('Not a Session backup');
  if (!Array.isArray(d.sessions)) throw new Error('Backup has no sessions');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sessions = d.sessions
    .filter((s) => s && num(s.start) && num(s.end) && s.end >= s.start)
    .map((s) => ({
      id: String(s.id || Math.random().toString(36).slice(2)),
      type: s.type === 'break' ? 'break' : 'focus',
      title: String(s.title || ''),
      categoryId: String(s.categoryId || 'session'),
      start: s.start,
      end: s.end,
      pausedMs: num(s.pausedMs) || 0,
      plannedMs: num(s.plannedMs) || s.end - s.start,
      mood: ['focused', 'neutral', 'distracted'].includes(s.mood) ? s.mood : null,
      note: String(s.note || ''),
    }));
  const categories = Array.isArray(d.categories)
    ? d.categories.filter((c) => c && c.id && c.name).map((c) => ({ id: String(c.id), name: String(c.name), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#df6363' }))
    : undefined;
  const planned = Array.isArray(d.planned)
    ? d.planned.filter((p) => p && num(p.start) && num(p.end)).map((p) => ({ id: String(p.id), title: String(p.title || ''), categoryId: String(p.categoryId || 'session'), start: p.start, end: p.end }))
    : [];
  return { sessions, categories, planned, settings: d.settings && typeof d.settings === 'object' ? d.settings : undefined };
}

/** Fills the last 3 weeks with example sessions. */
export function addSampleData() {
  const titles = {
    session: ['Write article', 'Review PR', 'Fix calendar bug', 'Plan next sprint', 'Refactor timer'],
    learn: ['Learn Swift concurrency', 'Read about Pomodoro', 'Practice Spanish'],
    reading: ['Read “Deep Work”', 'Read research paper'],
    personal: ['Tax paperwork', 'Plan trip'],
    health: ['Stretching routine', 'Meal prep'],
  };
  const notes = ['Got further than expected — next: tests.', 'Got stuck on the layout, try a simpler approach tomorrow.', 'Writing is thinking. Outline first.', '', '', ''];
  const moods = ['focused', 'focused', 'focused', 'neutral', 'distracted'];
  const cats = state.categories.map((c) => c.id);
  const today = dayStart(Date.now());
  for (let d = 21; d >= 1; d--) {
    const day = addDays(today, -d);
    let t = day + (8 + Math.floor(Math.random() * 3)) * HOUR + Math.floor(Math.random() * 40) * MIN;
    const n = 2 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const cid = Math.random() < 0.55 ? cats[0] : cats[Math.floor(Math.random() * cats.length)];
      const pool = titles[cid] || titles.session;
      const len = [25, 25, 25, 30, 45, 50][Math.floor(Math.random() * 6)] * MIN + Math.floor(Math.random() * 6) * MIN;
      state.sessions.push({ id: uid(), type: 'focus', title: pool[Math.floor(Math.random() * pool.length)], categoryId: cid, start: t, end: t + len, pausedMs: 0, plannedMs: 25 * MIN, mood: moods[Math.floor(Math.random() * moods.length)], note: notes[Math.floor(Math.random() * notes.length)] });
      t += len;
      const br = (i % 4 === 3 ? 18 : 5) * MIN + Math.floor(Math.random() * 4) * MIN;
      state.sessions.push({ id: uid(), type: 'break', title: '', categoryId: cid, start: t, end: t + br, pausedMs: 0, plannedMs: 5 * MIN, mood: null, note: '' });
      t += br + (Math.random() < 0.3 ? Math.floor(Math.random() * 90) * MIN : 0);
    }
  }
  state.sessions.sort((a, b) => a.start - b.start);
  emit('sessions');
}
