// What you see while a timer runs (focus mode).
//  - Focus: Pomofocus-inspired. Black, one huge number, one button. Nothing else.
//  - Break: its own calm, light screen with a progress ring and what's next.
//  - Focus -> break: the light spreads from the centre, a check draws itself,
//    "Session complete", then the break fades in.
// Extra controls live in a quiet tray that only appears when the mouse moves.
import { state, emit, on, focusMs, cat, todayFocusCount } from '../store.js';
import * as T from '../timer.js';
import { $, clockText, dur, MIN } from '../util.js';
import { I } from './icons.js';
import { discardSession } from './overlay.js';
import { createDial } from './dial.js';
import { toLocal, W, H } from '../scale.js';
import { breathing } from './breathe.js';

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

export function mountFocusScreen(host, { onExit }) {
  host.insertAdjacentHTML(
    'beforeend',
    `<section class="fs" hidden aria-label="Timer">
      <div class="fs-progress"><i></i></div>

      <div class="fs-f">
        <div class="fs-label"></div>
        <div class="fs-time"></div>
        <div class="fs-analog"><div class="fs-dial"></div><div class="fs-small"></div></div>
        <div class="fs-actions">
          <button class="fs-btn"></button>
          <button class="fs-alt" tabindex="-1">Finish</button>
        </div>
      </div>

      <div class="fs-b">
        <div class="fsb-in">
          <div class="fsb-card">
          <div class="fsb-kind"></div>
          <div class="fsb-ring">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle class="fsb-track" cx="50" cy="50" r="${RING_R}"/>
              <circle class="fsb-bar" cx="50" cy="50" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
            </svg>
            <div class="fsb-time"></div>
          </div>
          <button class="fsb-btn">Start focus</button>
          </div>
          <div class="fsb-next"></div>
          <div class="fs-mood" hidden>
            <span>How was that session?</span>
            <button data-m="focused" title="Focused">🤩</button>
            <button data-m="neutral" title="Neutral">😐</button>
            <button data-m="distracted" title="Distracted">😔</button>
          </div>
        </div>
      </div>

      <div class="fs-br"></div>

      <div class="fs-done" aria-hidden="true">
        <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
        <b>Session complete</b>
        <span class="fs-done-sub"></span>
      </div>

      <div class="fs-tools"></div>
    </section>`
  );
  const el = host.lastElementChild;
  const q = (s) => $(s, el);
  const fTime = q('.fs-time');
  const bTime = q('.fsb-time');
  const btn = q('.fs-btn');
  const bar = q('.fs-progress i');
  const ring = q('.fsb-bar');
  const tools = q('.fs-tools');

  // Analog style: the Session dial, in black and white.
  const dial = createDial(q('.fs-dial'));
  dial.setInteractive(false);
  const small = q('.fs-small');

  let shown = false;
  let hideT = 0;
  let celebrateT = 0;
  let trayT = 0;
  let openT = 0;
  let prevKind = null;
  let toolsKey = '';
  let textKey = '';

  // Remember where the last click happened: the screen opens from there.
  let lastPointer = null;
  addEventListener('pointerdown', (e) => (lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() }), { capture: true, passive: true });

  // After the screen changes (skip breathing, take a break...), the tray stays
  // hidden until the mouse has clearly moved away from where you just clicked,
  // so a second click on the same spot can never land on Finish or Discard.
  let quiet = null;
  function quietTray(minMs) {
    el.classList.add('tools-quiet');
    quiet = { until: Date.now() + minMs, x: lastPointer?.x ?? null, y: lastPointer?.y ?? null };
  }
  // Keyboard users: any key brings the tray back.
  addEventListener(
    'keydown',
    () => {
      if (!quiet) return;
      quiet = null;
      el.classList.remove('tools-quiet');
    },
    true
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (!quiet || Date.now() < quiet.until) return;
      if (quiet.x != null && Math.hypot(e.clientX - quiet.x, e.clientY - quiet.y) < 80) return;
      quiet = null;
      el.classList.remove('tools-quiet');
    },
    { passive: true }
  );

  function setOrigin(p) {
    el.style.setProperty('--ox', `${p.x}px`);
    el.style.setProperty('--oy', `${p.y}px`);
  }

  function applyPrefs() {
    el.dataset.style = state.settings.focusStyle === 'analog' ? 'analog' : 'digital';
    el.dataset.theme = state.settings.breakTheme || 'blue';
  }

  /**
   * on:  open as a circle growing from the last click (the Start button).
   * off: close into `to` (the dial on the home screen), revealing it.
   */
  // What the screen is showing: the breathe layer, focus, or break.
  const kindNow = (v = T.view()) => (breathing() && !state.timer ? 'breathe' : v.kind);

  let riseT = 0;
  function rise() {
    el.classList.remove('rise');
    void el.offsetWidth;
    el.classList.add('rise');
    clearTimeout(riseT);
    riseT = setTimeout(() => el.classList.remove('rise'), 1800);
  }

  function show(on, to) {
    if (on === shown) return;
    shown = on;
    clearTimeout(hideT);
    if (on) {
      const p = lastPointer && Date.now() - lastPointer.t < 15000 ? toLocal(lastPointer.x, lastPointer.y) : { x: W / 2, y: H * 0.7 };
      setOrigin(p);
      prevKind = kindNow();
      el.dataset.kind = prevKind;
      applyPrefs();
      el.classList.remove('celebrate', 'closing', 'in', 'rise', 'opened');
      el.hidden = false;
      void el.offsetWidth;
      el.classList.add('in');
      // Once fully open, drop the circular clip: clicks are then never
      // judged against a half-open shape.
      clearTimeout(openT);
      openT = setTimeout(() => shown && el.classList.add('opened'), 900);
      toolsKey = textKey = '';
      render();
      // Show the tray once so its controls are discoverable, then let it fade.
      host.classList.add('awake');
      clearTimeout(trayT);
      trayT = setTimeout(() => host.classList.remove('awake'), 3200);
    } else {
      if (to) setOrigin(to);
      clearTimeout(openT);
      if (el.classList.contains('opened')) {
        // back to the full circle first, so the close can animate from it
        el.classList.add('snap-clip');
        el.classList.remove('opened');
        void getComputedStyle(el).clipPath;
        el.classList.remove('snap-clip');
      }
      el.classList.add('closing');
      el.classList.remove('in');
      hideT = setTimeout(() => {
        el.hidden = true;
        el.classList.remove('closing');
      }, 820);
    }
  }

  function celebrate() {
    const r = T.reflectTarget();
    q('.fs-done-sub').textContent = r ? `${dur(focusMs(r))} focused${r.title ? ` on ${r.title}` : ''}` : '';
    el.classList.remove('celebrate');
    void el.offsetWidth;
    el.classList.add('celebrate');
    clearTimeout(celebrateT);
    celebrateT = setTimeout(() => el.classList.remove('celebrate'), 3600);
  }

  function renderTools(v) {
    const key = `${v.kind}|${v.over}|${state.ui.muted}|${state.timer?.long}`;
    if (key === toolsKey) return;
    toolsKey = key;
    const b = (act, label, extra = '') => `<button data-act="${act}" ${extra}>${label}</button>`;
    const sound = b('sound', state.ui.muted ? I.speakerOff : I.speaker, `class="ic-only" title="${state.ui.muted ? 'Unmute' : 'Mute'} background sound"`);
    tools.innerHTML =
      v.kind === 'focus'
        ? [
            v.over ? '' : b('break', `${I.coffee}<span>Take a break</span>`),
            v.over ? '' : b('finish', `${I.stop}<span>Finish</span>`),
            b('abandon', 'Discard', 'class="danger" title="Discard this session without saving it (click twice)"'),
            '<i></i>',
            b('minus', '−5'),
            b('plus', '+5'),
            '<i></i>',
            sound,
          ].join('')
        : [
            b('play', `${I.play}<span>Start focus</span>`, 'class="primary"'),
            b('stop', `${I.stop}<span>Stop working</span>`),
            b('kind', state.timer?.long ? 'Make it short' : 'Make it long'),
            '<i></i>',
            b('minus', '−5'),
            b('plus', '+5'),
            '<i></i>',
            sound,
          ].join('');
  }

  function render(v = T.view()) {
    if (!shown || document.hidden) return;
    const kind = kindNow(v);
    if (kind !== 'breathe' && v.phase === 'idle') return;
    const t = state.timer;

    if (kind !== prevKind) {
      if (prevKind === 'focus' && kind === 'break') celebrate();
      // Out of the breathe layer: it folds away, then the timer rises in.
      if (prevKind === 'breathe' && kind === 'focus') rise();
      // The tray you just clicked would otherwise linger and rebuild itself
      // under the transition. Hide it now; it returns on the next mouse move.
      host.classList.remove('awake');
      quietTray(kind === 'break' && prevKind === 'focus' ? 3200 : 1200);
      // Breathing straight out of a break keeps the break colour behind the flower.
      el.classList.toggle('from-break', kind === 'breathe' && prevKind === 'break');
      prevKind = kind;
      el.dataset.kind = kind;
      toolsKey = textKey = '';
    }
    if (kind === 'breathe') return;
    el.dataset.phase = v.phase;
    el.classList.toggle('paused', v.paused);
    el.style.setProperty('--c', cat(t.categoryId).color);

    const time = v.over ? '+' + clockText(v.overMs, true) : clockText(v.remaining);
    const frac = v.over ? 1 : Math.max(0, Math.min(1, v.elapsed / Math.max(1, t.durationMs)));

    if (v.kind === 'focus') {
      if (el.dataset.style === 'analog') {
        const m = Math.min(60, (v.over ? v.overMs : v.remaining) / MIN);
        if (Math.abs(m - dial.value) > 0.4) dial.set(m);
        else dial.set(m, { instant: true });
        if (small.textContent !== time) small.textContent = time;
      } else if (fTime.textContent !== time) fTime.textContent = time;
      bar.style.transform = `scaleX(${frac})`;
    } else {
      if (bTime.textContent !== time) bTime.textContent = time;
      ring.style.strokeDashoffset = String(RING_C * (1 - frac));
    }

    const b = t.block;
    const part = b ? ` · ${b.idx + 1} of ${b.stretches.length}` : '';
    const key = `${v.phase}|${v.paused}|${t.title}|${t.long}|${t.prevId}|${part}`;
    if (key !== textKey) {
      textKey = key;
      if (v.kind === 'focus') {
        q('.fs-label').textContent = v.over ? 'Time’s up. Keep going or take a break.' : (t.title || 'Focus') + part;
        q('.fs-label').classList.toggle('generic', v.over || (!t.title && !part));
        const label = v.over ? 'TAKE A BREAK' : v.paused ? 'RESUME' : 'PAUSE';
        if (btn.textContent !== label) {
          btn.textContent = label;
          btn.classList.remove('swap');
          void btn.offsetWidth;
          btn.classList.add('swap');
        }
        btn.classList.toggle('pressed', !v.over && !v.paused);
        q('.fs-alt').tabIndex = v.over ? 0 : -1;
      } else {
        q('.fsb-kind').textContent = v.over ? 'Break’s over' : t.long ? 'Long break' : 'Short break';
        q('.fsb-next').textContent = `Up next · ${t.title || 'Focus'}${b ? ` (${b.idx + 1} of ${b.stretches.length}) · starts on its own` : ''}`;
        const r = T.reflectTarget();
        const mood = q('.fs-mood');
        mood.hidden = !(r && state.settings.reflection);
        if (r) mood.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === r.mood));
      }
    }
    renderTools(v);
  }

  // ---- actions ---------------------------------------------------------------
  btn.addEventListener('click', () => {
    const v = T.view();
    if (v.phase === 'focusOver') T.takeBreak();
    else if (v.kind === 'focus') T.pauseToggle();
  });
  q('.fs-alt').addEventListener('click', () => T.finish());
  q('.fsb-btn').addEventListener('click', () => T.breakPlay());
  q('.fs-mood').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    T.setMood(b.dataset.m);
    q('.fs-mood').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'minus':
        return T.adjust(-5);
      case 'plus':
        return T.adjust(5);
      case 'sound':
        state.ui.muted = !state.ui.muted;
        return emit('sound');
      case 'break':
        return T.takeBreak();
      case 'finish':
        return T.finish();
      case 'abandon':
        // Destructive, so it asks once: the first click arms it.
        if (!b.classList.contains('armed')) {
          b.classList.add('armed');
          b.textContent = 'Discard?';
          clearTimeout(b._t);
          b._t = setTimeout(() => {
            b.classList.remove('armed');
            b.textContent = 'Discard';
          }, 2600);
          return;
        }
        return discardSession();
      case 'kind':
        return T.setBreakKind(state.timer?.long ? 'short' : 'long');
      case 'stop':
        return T.breakStop();
      case 'play':
        return T.breakPlay();
    }
  });

  on('tick', (v) => render(v));
  on('timer', () => {
    textKey = '';
    render();
  });
  on('breathing', () => render());
  on('sound', () => {
    toolsKey = '';
    render();
  });
  on('sessions', () => {
    textKey = '';
    render();
  });
  on('settings', () => {
    applyPrefs();
    fTime.textContent = '';
    textKey = '';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    textKey = toolsKey = '';
    render();
  });
  return { show };
}
