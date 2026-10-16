// Timer state machine. All timing is derived from timestamps, so the timer
// stays exact through tab throttling, sleep, and page reloads.
import { state, emit, save, todayFocusCount, cat } from './store.js';
import { uid, MIN } from './util.js';
import * as audio from './audio.js';
import { notify } from './notify.js';

// ?speed=60 makes time run 60x faster (for testing the full flow quickly).
const speed = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
const realBase = Date.now();
export const now = speed === 1 ? () => Date.now() : () => realBase + (Date.now() - realBase) * speed;

/**
 * state.timer = {
 *   kind: 'focus' | 'break', title, categoryId, start, durationMs,
 *   pausedAt: ts|null, pausedTotal: ms, note, fx: {...fired cue flags}
 * }
 */
export function view(t = state.timer, at = now()) {
  if (!t) return { phase: 'idle' };
  const elapsed = (t.pausedAt ?? at) - t.start - t.pausedTotal;
  const remaining = t.durationMs - elapsed;
  const over = remaining <= 0;
  const phase = t.kind === 'focus' ? (over ? 'focusOver' : 'focus') : over ? 'breakOver' : 'break';
  return { phase, kind: t.kind, paused: t.pausedAt != null, elapsed, remaining, over, overMs: -remaining, t };
}

// ---- ticking (Worker-driven so background tabs aren't throttled) ----------
let worker = null;
let lastPhase = null;
function ensureTicker(run) {
  if (run) {
    if (!worker) {
      const src = `let t;onmessage=e=>{clearTimeout(t);if(e.data){const l=()=>{postMessage(0);t=setTimeout(l,1000-Date.now()%1000+3)};l()}}`;
      try {
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        worker.onmessage = tick;
      } catch {
        worker = { postMessage: (on) => { clearInterval(worker._i); if (on) worker._i = setInterval(tick, 1000); } };
      }
    }
    worker.postMessage(1);
  } else if (worker) {
    worker.postMessage(0);
  }
}

function fx(name, body, cueName, tag) {
  if (cueName && state.settings.playSound) audio.cue(cueName);
  if (name) notify(name, body, tag);
}

function tick() {
  const t = state.timer;
  if (!t) return ensureTicker(false);
  const v = view(t);
  const s = state.settings;
  const f = t.fx;
  if (!v.paused) {
    if (t.kind === 'focus') {
      const soonMs = s.endingSoonMin * MIN;
      if (s.endingSoon && !f.soon && !v.over && v.remaining <= soonMs && t.durationMs > soonMs) {
        f.soon = true;
        fx('Session ending soon', `${Math.round(soonMs / MIN)} minutes left on “${t.title || cat(t.categoryId).name}”. Start wrapping up.`, 'soon', 'soon');
      }
      if (s.presence && !v.over) {
        const n = Math.floor(v.elapsed / (s.presenceMin * MIN));
        if (n > f.presence) {
          f.presence = n;
          if (s.playSound) audio.cue('presence');
        }
      }
      if (v.over && !f.end) {
        f.end = true;
        const b = t.block;
        if (b) {
          // Long study block: straight into the break, then the next stretch.
          const last = b.idx >= b.stretches.length - 1;
          fx(last ? 'Block complete' : 'Stretch complete', last ? 'Great work. Enjoy a long break.' : `Short break, then stretch ${b.idx + 2} of ${b.stretches.length}.`, null, 'end');
          t.autoEnd = true;
          return takeBreak(last ? 'long' : 'short');
        }
        fx('Session has ended', `“${t.title || cat(t.categoryId).name}” is done. Take a break when you’re ready.`, 'end', 'end');
        if (s.autoStartBreak || !s.overflow) t.autoEnd = true;
        if (s.autoStartBreak) return takeBreak();
        if (!s.overflow) return finish();
      }
    } else if (v.over && !f.end) {
      f.end = true;
      if (t.block) {
        fx('Break is over', `Stretch ${t.block.idx + 1} of ${t.block.stretches.length}${t.title ? ` · ${t.title}` : ''}`, null, 'end');
        t.autoEnd = true;
        return nextStretch();
      }
      fx('Break is over', t.title ? `Next up: ${t.title}` : 'Time to get back to focus.', 'breakEnd', 'end');
      if (s.autoStartSession) {
        t.autoEnd = true;
        return breakPlay();
      }
    }
    if (v.over && s.tooLong) {
      const n = Math.floor(v.overMs / (s.tooLongMin * MIN));
      if (n > f.tooLong) {
        f.tooLong = n;
        fx(t.kind === 'focus' ? 'You’ve been working too long' : 'Your break went too long',
          t.kind === 'focus' ? 'Stand up, stretch, and take a break.' : 'Ready to start the next session?', 'tooLong', 'long');
      }
    }
  }
  if (v.phase !== lastPhase) {
    lastPhase = v.phase;
    emit('timer');
  } else save();
  emit('tick', v);
}

// ---- actions --------------------------------------------------------------
/** A block longer than an hour, split into equal stretches (whole minutes). */
export function splitBlock(totalMin) {
  if (!(totalMin > 60)) return null;
  const longest = Math.max(20, state.settings.longestStretch || 50);
  const n = Math.ceil(totalMin / longest);
  const base = Math.floor(totalMin / n);
  const extra = totalMin - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
/** The block the running timer belongs to: { stretches, idx } (idx = current / next stretch). */
export const blockOf = (t = state.timer) => t?.block || null;

/** Long durations become a block of stretches (first stretch now). */
function withBlock(o) {
  const stretches = splitBlock(Math.round(o.durationMs / MIN));
  if (stretches) {
    o.block = { stretches, idx: 0 };
    o.durationMs = stretches[0] * MIN;
  }
  return o;
}

/** A fresh start: focus mode follows the setting again (the full-view peek ends). */
function freshStart() {
  state.ui.zen = true;
}

function begin(kind, { title = '', categoryId, durationMs, note = '', long = false, prevId = null, block = null }) {
  state.timer = {
    kind,
    long,
    prevId,
    block,
    title,
    categoryId: categoryId || state.ui.draft.categoryId,
    start: now(),
    durationMs,
    pausedAt: null,
    pausedTotal: 0,
    note,
    fx: { soon: false, end: false, presence: 0, tooLong: 0 },
  };
  lastPhase = null;
  emit('timer');
  ensureTicker(true);
  tick();
}

function logCurrent() {
  const t = state.timer;
  if (!t) return null;
  // Ended by the timer itself (e.g. after the laptop slept): count only the planned time.
  const planned = t.start + t.pausedTotal + t.durationMs;
  const end = t.pausedAt ?? (t.autoEnd ? Math.min(now(), planned) : now());
  if (end - t.start - t.pausedTotal < 10_000 && !t.note) return null; // ignore accidental starts
  const rec = {
    id: uid(),
    type: t.kind,
    title: t.title,
    categoryId: t.categoryId,
    start: t.start,
    end,
    pausedMs: t.pausedTotal,
    plannedMs: t.durationMs,
    mood: t.kind === 'focus' ? state.settings.defaultMood : null,
    note: t.note || '',
  };
  state.sessions.push(rec);
  emit('sessions');
  return rec;
}

/** Request a focus session; goes through the breathe screen if enabled. */
export function startFocus(opts) {
  const o = {
    title: opts.title ?? state.ui.draft.title,
    categoryId: opts.categoryId ?? state.ui.draft.categoryId,
    durationMs: opts.durationMs ?? state.settings.sessionMin * MIN,
    note: opts.note ?? state.ui.draft.note ?? '',
    block: null,
  };
  withBlock(o);
  freshStart();
  audio.unlock();
  if (state.settings.breathe && !opts.skipBreathe) emit('breathe', o);
  else beginFocus(o);
}
export function beginFocus(o) {
  state.ui.draft.note = '';
  begin('focus', o);
  if (state.settings.playSound) audio.cue('start');
}

/** Every Nth session of the day earns a long break. */
export function isLongBreakNext() {
  const s = state.settings;
  const n = todayFocusCount(now());
  return s.longBreakEvery > 0 && n > 0 && n % s.longBreakEvery === 0;
}
/** Break length you'd get if the running focus session ended now. */
export function breakAfterCurrentMs() {
  const s = state.settings;
  const n = todayFocusCount(now()) + (state.timer?.kind === 'focus' ? 1 : 0);
  const long = s.longBreakEvery > 0 && n > 0 && n % s.longBreakEvery === 0;
  return (long ? s.longBreakMin : s.shortBreakMin) * MIN;
}
export function nextBreakMs() {
  const s = state.settings;
  return (isLongBreakNext() ? s.longBreakMin : s.shortBreakMin) * MIN;
}

export function startBreak(durationMs) {
  freshStart();
  audio.unlock();
  const d = state.ui.draft;
  const ms = durationMs ?? nextBreakMs();
  begin('break', { title: d.title, categoryId: state.settings.useCategories ? d.categoryId : state.categories[0].id, durationMs: ms, long: ms >= state.settings.longBreakMin * MIN && ms > state.settings.shortBreakMin * MIN });
  if (state.settings.playSound) audio.cue('breakEnd');
}

export function pauseToggle() {
  const t = state.timer;
  if (!t) return;
  if (t.pausedAt != null) {
    t.pausedTotal += now() - t.pausedAt;
    t.pausedAt = null;
  } else t.pausedAt = now();
  emit('timer');
  emit('tick', view());
}

export function adjust(deltaMin) {
  const t = state.timer;
  if (!t) return;
  t.durationMs = Math.max(0, t.durationMs + deltaMin * MIN);
  const v = view(t);
  if (t.kind === 'break') t.long = t.durationMs > state.settings.shortBreakMin * MIN;
  // Only re-arm the end; if this pushed it past the end, the next tick ends it properly.
  if (!v.over) {
    t.fx.end = false;
    t.fx.tooLong = 0;
  }
  if (v.remaining > state.settings.endingSoonMin * MIN) t.fx.soon = false;
  emit('timer');
  emit('tick', view());
}

export function setDuration(min) {
  const t = state.timer;
  if (!t) return;
  adjust(min - t.durationMs / MIN);
}

// Reflection is asked when you stop working (Finish). When you take a break,
// the break screen itself hosts the reflection (mood + notes) for the session.
function afterFocus(rec, ask) {
  const d = state.ui.draft;
  if (state.timer) {
    d.title = state.timer.title;
    d.categoryId = state.timer.categoryId;
  }
  d.note = '';
}

/** Finish the focus session (log it) and go idle. */
export function finish() {
  const rec = logCurrent();
  afterFocus(rec, true);
  state.timer = null;
  ensureTicker(false);
  emit('timer');
}

export function abandon() {
  const snap = state.timer ? JSON.parse(JSON.stringify(state.timer)) : null;
  if (state.timer) {
    state.ui.draft.title = state.timer.title;
    state.ui.draft.categoryId = state.timer.categoryId;
  }
  state.timer = null;
  ensureTicker(false);
  emit('timer');
  return snap;
}

/** Undo a discard: the timer carries on as if it had never stopped. */
export function restore(snap) {
  if (!snap || state.timer) return;
  state.timer = snap;
  ensureTicker(true);
  emit('timer');
}

/** From focus/overflow: log the session and start a break. */
export function takeBreak(kind) {
  const rec = logCurrent();
  afterFocus(rec, false);
  const d = state.ui.draft;
  // In a block, the break leads into the next stretch (and the last one earns a long break).
  const b = state.timer?.kind === 'focus' ? state.timer.block : null;
  const next = b && b.idx < b.stretches.length - 1 ? { stretches: b.stretches, idx: b.idx + 1 } : null;
  const long = b ? !next : kind ? kind === 'long' : isLongBreakNext();
  const ms = (long ? state.settings.longBreakMin : state.settings.shortBreakMin) * MIN;
  begin('break', { title: d.title, categoryId: d.categoryId, durationMs: ms, long, prevId: rec?.id || null, block: next });
  if (state.settings.playSound) audio.cue('breakEnd');
}

/** From overflow: log and immediately start another session with the same intention. */
export function restart() {
  const t = state.timer;
  const rec = logCurrent();
  afterFocus(rec, false);
  begin('focus', withBlock({ title: t.title, categoryId: t.categoryId, durationMs: state.settings.sessionMin * MIN }));
  if (state.settings.playSound) audio.cue('start');
}

/** From a break: log the break and start the next focus session. */
// The break screen stays up underneath the breathe overlay, so there is no
// flash of the idle screen between break and focus.
export function breakPlay() {
  const t = state.timer;
  if (t?.block) return nextStretch(true);
  logCurrent();
  state.timer = null;
  ensureTicker(false);
  const o = withBlock({ title: t?.title, categoryId: t?.categoryId, durationMs: state.settings.sessionMin * MIN, note: '', block: null });
  if (state.settings.breathe) {
    audio.unlock();
    emit('breathe', o);
  } else beginFocus(o);
}

/** From a block's break: log it and start the next stretch. */
function nextStretch(viaBreathe = false) {
  const t = state.timer;
  const b = t.block;
  logCurrent();
  const o = { title: t.title, categoryId: t.categoryId, durationMs: b.stretches[b.idx] * MIN, note: '', block: b };
  if (viaBreathe && state.settings.breathe) {
    state.timer = null;
    ensureTicker(false);
    audio.unlock();
    return emit('breathe', o);
  }
  beginFocus(o);
}

/** From a break: log the break and stop working. */
export function breakStop() {
  logCurrent();
  state.timer = null;
  ensureTicker(false);
  emit('timer');
}

/** The session a break is reflecting on (the one that just ended). */
export function reflectTarget() {
  const t = state.timer;
  if (!t || t.kind !== 'break' || !t.prevId) return null;
  return state.sessions.find((s) => s.id === t.prevId) || null;
}

export function setNote(text) {
  const r = reflectTarget();
  if (r) r.note = text;
  else if (state.timer) state.timer.note = text;
  else state.ui.draft.note = text;
  save();
}

export function setMood(mood) {
  const r = reflectTarget();
  if (!r) return;
  r.mood = mood;
  emit('sessions');
}

/** Switch the running break between short and long. */
export function setBreakKind(kind) {
  const t = state.timer;
  if (!t || t.kind !== 'break') return;
  t.long = kind === 'long';
  t.durationMs = (t.long ? state.settings.longBreakMin : state.settings.shortBreakMin) * MIN;
  if (!view(t).over) t.fx.end = false;
  t.fx.tooLong = 0;
  emit('timer');
  emit('tick', view());
}

export function editActive(patch) {
  if (!state.timer) return;
  Object.assign(state.timer, patch);
  emit('timer');
  emit('tick', view());
}

export function resume() {
  if (state.timer) {
    // Don't re-fire cues that were already due while the tab was closed.
    const v = view();
    lastPhase = v.phase;
    ensureTicker(true);
    tick();
  }
}
