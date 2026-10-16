// Breathe screen shown before a focus session starts.
// A soft "flower" of six translucent petals blooms open as you breathe in,
// rests, and folds back as you breathe out, turning slowly the whole time.
//
// In focus mode it lives *inside* the focus screen (as its own layer), so
// skipping or finishing simply swaps that layer for the timer: there is no
// hand-off between two screens and the home screen is never shown in between.
// With focus mode off it is a standalone overlay above the classic timer.
//
// All motion runs on one Web Animations timeline built from the breathing
// schedule, so every segment starts exactly where (and as slowly as) the last
// one ended: no jumps, and it's all transform/opacity on the compositor.
import { state, on, emit, cat } from '../store.js';
import * as T from '../timer.js';
import * as audio from '../audio.js';
import { esc, html } from '../util.js';
import { root } from '../scale.js';

const SETTLE_MS = 2400; // "get comfortable" before the first breath
const IN_MS = 4000;
const HOLD_MS = 1200;
const OUT_MS = 5000;

// Both ends of every segment are at rest (zero velocity), so segments join smoothly.
const EASE_SETTLE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const EASE_BREATH = 'cubic-bezier(0.42, 0, 0.58, 1)';

let active = null;
export const breathing = () => !!active;

export function mountBreathe() {
  on('breathe', (opts) => show(opts));
}

/** The breathing schedule as segments: [{ kind, dur, at }]. */
function schedule(cycles) {
  const segs = [{ kind: 'settle', dur: SETTLE_MS }];
  for (let i = 0; i < cycles; i++) segs.push({ kind: 'in', dur: IN_MS, i }, { kind: 'hold', dur: HOLD_MS, i }, { kind: 'out', dur: OUT_MS, i });
  let at = 0;
  for (const s of segs) {
    s.at = at;
    at += s.dur;
  }
  return { segs, total: at };
}

/**
 * Keyframes for one property across the whole schedule.
 * `start` is the value at t=0, `end[kind]` the value each segment ends on.
 */
function frames(segs, total, start, end, toCss) {
  const out = [{ offset: 0, easing: EASE_SETTLE, ...toCss(start) }];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const next = segs[k + 1];
    out.push({
      offset: (s.at + s.dur) / total,
      easing: next?.kind === 'hold' ? 'linear' : EASE_BREATH,
      ...toCss(end[s.kind]),
    });
  }
  return out;
}

function show(opts) {
  if (active) return;
  const cycles = Math.max(1, state.settings.breatheCycles || 3);
  const c = cat(opts.categoryId);
  const embedded = state.ui.view === 'timer' && !!document.querySelector('.fs-br');
  const bw = true;
  const petals = Array.from({ length: 6 }, (_, i) => `<i style="--a:${i * 60}deg"></i>`).join('');
  const dots = Array.from({ length: cycles }, () => '<i></i>').join('');
  const el = html(`
    <div class="breathe${bw ? ' bw' : ''}${embedded ? ' embedded' : ''}" style="--c:${c.color}">
      <div class="br-center">
        <div class="br-flower" aria-hidden="true">
          <div class="br-glow"></div>
          <div class="br-spin">${petals}</div>
        </div>
        <div class="br-text">
          <div class="br-word" aria-live="polite"><span>get comfortable</span></div>
          <div class="br-dots" aria-hidden="true">${dots}</div>
        </div>
      </div>
      <div class="br-foot">
        <p class="br-prep">next up, <span>${esc(opts.title || c.name)}</span></p>
        <div class="br-actions">
          <button class="br-skip" type="button">skip</button>
          <button class="br-cancel" type="button">cancel</button>
        </div>
      </div>
    </div>`);
  (embedded ? document.querySelector('.fs-br') : root()).append(el);

  const flower = el.querySelector('.br-flower');
  const glow = el.querySelector('.br-glow');
  const petalEls = [...el.querySelectorAll('.br-spin i')];
  const word = el.querySelector('.br-word');
  const dotEls = el.querySelectorAll('.br-dots i');
  const timers = [];
  const anims = [];
  let done = false;

  // One word at a time: fade out, swap, fade in. Never two words on screen.
  const wordEl = word.firstElementChild;
  let wordAnim = null;
  let wantWord = wordEl.textContent;
  const setWord = (text) => {
    if (text === wantWord) return;
    wantWord = text;
    wordAnim?.cancel();
    const from = getComputedStyle(wordEl).opacity;
    wordAnim = wordEl.animate([{ opacity: from }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    wordAnim.onfinish = () => {
      if (done) return;
      wordEl.textContent = wantWord;
      wordAnim = wordEl.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' });
    };
  };

  // ---- the timeline ----
  const { segs, total } = schedule(cycles);
  const reduce = !!state.settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const opt = { duration: total, fill: 'forwards' };
  if (!reduce) {
    anims.push(
      flower.animate(frames(segs, total, 0.5, { settle: 0.62, in: 1, hold: 1, out: 0.62 }, (v) => ({ transform: `scale(${v})` })), opt),
      glow.animate(frames(segs, total, 0, { settle: 0.35, in: 1, hold: 0.9, out: 0.35 }, (v) => ({ opacity: v })), opt),
      ...petalEls.map((p, i) =>
        p.animate(
          frames(segs, total, -6, { settle: -14, in: -50, hold: -50, out: -14 }, (v) => ({ transform: `rotate(${i * 60}deg) translateY(${v}%)` })),
          opt
        )
      )
    );
  }
  anims.push(flower.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1400, delay: embedded ? 250 : 0, easing: 'ease-out', fill: 'both' }));
  // Start every animation on the same frame so they stay in lock-step.
  const t0 = document.timeline.currentTime;
  if (t0 != null) for (const a of anims) a.startTime = t0;

  for (const s of segs) {
    if (s.kind === 'settle') continue;
    timers.push(
      setTimeout(() => {
        if (s.kind === 'in') {
          setWord('breathe in');
          dotEls.forEach((d, k) => d.classList.toggle('on', k <= s.i));
          if (state.settings.playSound) audio.cue('breathIn');
        } else if (s.kind === 'hold') setWord('hold');
        else {
          setWord('breathe out');
          if (state.settings.playSound) audio.cue('breathOut');
        }
      }, s.at)
    );
  }
  timers.push(setTimeout(() => finish(true), total));

  // ---- leaving ----
  function finish(startIt) {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    document.removeEventListener('keydown', onKey, true);
    // Freeze the flower exactly where it is; the whole group then folds away.
    for (const a of anims) a.pause();
    el.classList.add('leaving');
    active = null;
    try {
      if (startIt) T.beginFocus(opts);
      else if (!state.timer) emit('timer'); // back home (also after a break)
    } finally {
      emit('breathing');
    }
    if (!embedded) setTimeout(() => el.classList.add('gone'), startIt ? 300 : 120);
    setTimeout(() => {
      for (const a of anims) a.cancel();
      el.remove();
    }, 1100);
  }
  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finish(e.key === 'Enter');
    }
  };
  document.addEventListener('keydown', onKey, true);
  el.querySelector('.br-skip').addEventListener('click', () => finish(true));
  el.querySelector('.br-cancel').addEventListener('click', () => finish(false));

  active = { finish };
  emit('breathing'); // focus mode opens (or turns from the break) to show us
  void el.offsetWidth; // commit the start state so the fade-in always runs
  el.classList.add('in');
  setTimeout(() => !done && el.querySelector('.br-skip').focus({ preventScroll: true }), 80);
}
