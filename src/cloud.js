// Cloud sync for the published Claude Artifact.
// Your data lives in your own private store (data/users/<you>/...), so it
// survives cleared browser storage and follows you between devices.
// Outside an artifact viewer this does nothing and the app stays local-only.
//
// Layout (one viewer):
//   data/users/<id>/core       settings, categories, planned blocks, timer, ui
//   data/users/<id>/m-YYYY-MM  that month's sessions (keeps docs well under 256 KiB)

import { state, on } from './store.js';

const DEBOUNCE = 1500;
let db = null;
let base = '';
let ready = false;
const written = new Map(); // doc id -> JSON last written/read
let timer = 0;
let chain = Promise.resolve();

const monthId = (ts) => {
  const d = new Date(ts);
  return `m-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function coreBody() {
  return {
    version: state.version,
    settings: state.settings,
    categories: state.categories,
    planned: state.planned,
    timer: state.timer,
    ui: state.ui,
  };
}

function snapshotDocs() {
  const docs = { core: coreBody() };
  for (const s of state.sessions) {
    const id = monthId(s.start);
    (docs[id] ||= { sessions: [] }).sessions.push(s);
  }
  // Months that became empty are written as empty so deletions sync too.
  for (const id of written.keys()) if (id.startsWith('m-') && !docs[id]) docs[id] = { sessions: [] };
  return docs;
}

function push() {
  if (!ready) return;
  const docs = snapshotDocs();
  for (const [id, body] of Object.entries(docs)) {
    const json = JSON.stringify(body);
    if (written.get(id) === json) continue;
    written.set(id, json);
    const payload = id === 'core' ? { ...body, updatedAt: state.meta.editedAt || Date.now() } : body;
    // One write at a time per document: serialise all writes.
    chain = chain
      .then(() => db.doc(`${base}/${id}`).set(JSON.parse(JSON.stringify(payload))))
      .catch((e) => {
        written.delete(id); // retry on the next change
        if (e?.code === 'quota_exceeded') console.warn('Session: cloud storage is full', e.message);
      });
  }
}

function schedule() {
  if (!ready) return;
  clearTimeout(timer);
  timer = setTimeout(push, DEBOUNCE);
}

async function pull() {
  const [coreSnap, list] = await Promise.all([db.doc(`${base}/core`).get(), db.collection(base).get()]);
  if (!coreSnap.exists) return null;
  const core = coreSnap.data();
  const sessions = [];
  const months = {};
  for (const d of list.docs) {
    if (!d.id.startsWith('m-')) continue;
    const body = d.data() || {};
    months[d.id] = body;
    if (Array.isArray(body.sessions)) sessions.push(...body.sessions);
  }
  sessions.sort((a, b) => a.start - b.start);
  return { core, sessions, months };
}

function apply({ core, sessions, months }) {
  for (const k of ['settings', 'categories', 'planned', 'ui']) {
    if (core[k] && typeof core[k] === 'object') {
      state[k] = Array.isArray(core[k]) ? core[k] : { ...state[k], ...core[k] };
    }
  }
  state.timer = core.timer || null;
  state.sessions = sessions;
  written.set('core', JSON.stringify(coreBody()));
  for (const [id, body] of Object.entries(months)) written.set(id, JSON.stringify(body));
}

/** Connect to the viewer's private store and reconcile with local data. */
export async function initCloud(onApplied) {
  const claude = window.claude;
  if (!claude?.use) return;
  try {
    const [dbNs, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!dbNs || !user) return;
    const id = await user.id();
    if (!id) return;
    db = dbNs;
    base = `data/users/${id}`;
    const remote = await pull();
    const localEdited = state.meta.editedAt || 0;
    if (remote && (remote.core.updatedAt || 0) >= localEdited) {
      apply(remote);
      state.meta.editedAt = remote.core.updatedAt || Date.now();
      ready = true;
      onApplied?.();
    } else {
      // Nothing in the cloud yet, or this browser has newer changes: upload.
      // Merge sessions from both sides (by id) so nothing logged elsewhere is lost.
      if (remote) {
        const seen = new Set(state.sessions.map((s) => s.id));
        const extra = remote.sessions.filter((s) => s && !seen.has(s.id));
        if (extra.length) {
          state.sessions = [...state.sessions, ...extra].sort((a, b) => a.start - b.start);
          onApplied?.();
        }
      }
      ready = true;
      push();
    }
  } catch (e) {
    console.warn('Session: cloud sync unavailable, staying local', e?.code || e);
    ready = false;
  }
}

// Any real change schedules a sync.
for (const topic of ['timer', 'sessions', 'settings', 'categories', 'planned', 'sound', 'zen']) on(topic, schedule);
addEventListener('pagehide', () => {
  if (ready) {
    clearTimeout(timer);
    push();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ready) {
    clearTimeout(timer);
    push();
  }
});

export const cloudReady = () => ready;

/** Write everything now and wait for it (used before a reload after reset/import). */
export async function flushCloud() {
  if (!ready) return;
  clearTimeout(timer);
  push();
  await chain;
}
