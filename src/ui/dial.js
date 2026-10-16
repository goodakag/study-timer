// The dial: 60 ticks, a disc, a wedge for the time, and a hand.
// Drag clockwise for a focus session, counter-clockwise for a break.
// Focus keeps going past a full turn (laps), up to 3 hours.

const C = 100;
const R_DISC = 62;
export const MAX_FOCUS = 180;
const MIN_V = -60;
const clampV = (v) => Math.max(MIN_V, Math.min(MAX_FOCUS, v));

function ticks() {
  let out = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const quarter = i % 15 === 0;
    const five = i % 5 === 0;
    const r1 = quarter ? 79 : five ? 82 : 87.5;
    const r2 = 94;
    const cls = quarter ? 'tk q' : five ? 'tk f' : 'tk';
    out += `<line class="${cls}" x1="${(C + r1 * sin).toFixed(2)}" y1="${(C - r1 * cos).toFixed(2)}" x2="${(C + r2 * sin).toFixed(2)}" y2="${(C - r2 * cos).toFixed(2)}"/>`;
  }
  return out;
}
const TICKS = ticks();

function wedgePath(min) {
  const m = Math.max(-60, Math.min(60, min));
  if (Math.abs(m) < 0.02) return '';
  if (Math.abs(m) >= 59.98) return `M${C} ${C - R_DISC}A${R_DISC} ${R_DISC} 0 1 1 ${C - 0.01} ${C - R_DISC}Z`;
  const a = (m / 60) * Math.PI * 2;
  const x = C + R_DISC * Math.sin(a);
  const y = C - R_DISC * Math.cos(a);
  const large = Math.abs(m) > 30 ? 1 : 0;
  const sweep = m > 0 ? 1 : 0;
  return `M${C} ${C}L${C} ${C - R_DISC}A${R_DISC} ${R_DISC} 0 ${large} ${sweep} ${x.toFixed(2)} ${y.toFixed(2)}Z`;
}

export function createDial(host, { onInput, getSnap = () => 5 } = {}) {
  host.innerHTML = `
    <svg class="dial" viewBox="0 0 200 200" role="slider" aria-label="Timer duration" tabindex="-1">
      <defs>
        <radialGradient id="hubg" cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfc8c9"/>
        </radialGradient>
      </defs>
      <g class="ticks">${TICKS}</g>
      <circle class="disc" cx="${C}" cy="${C}" r="${R_DISC}"/>
      <circle class="lap" cx="${C}" cy="${C}" r="${R_DISC}"/>
      <path class="wedge"/>
      <g class="pips"></g>
      <g class="hand"><line x1="${C}" y1="${C}" x2="${C}" y2="${C - 86}"/></g>
      <circle class="hub" cx="${C}" cy="${C}" r="10.5"/>
      <circle class="hub-ring" cx="${C}" cy="${C}" r="10.5"/>
      <circle class="hit" cx="${C}" cy="${C}" r="99"/>
    </svg>`;
  const svg = host.firstElementChild;
  const wedge = svg.querySelector('.wedge');
  const hand = svg.querySelector('.hand');
  const lap = svg.querySelector('.lap');
  const pips = svg.querySelector('.pips');
  let lastLaps = -1;

  let target = 25; // minutes, signed (negative = break)
  let shown = 25;
  let vel = 0;
  let raf = 0;
  let last = 0;
  let interactive = false;

  function draw(v) {
    // Past an hour: the full hours sit underneath in a deeper tone, the
    // current hour is the wedge on top, and a pip per full hour sits by the hub.
    const laps = v > 60 ? Math.floor((v - 0.001) / 60) : 0;
    const cur = laps ? v - laps * 60 : v;
    wedge.setAttribute('d', wedgePath(cur));
    hand.style.transform = `rotate(${(v / 60) * 360}deg)`;
    if (laps !== lastLaps) {
      lastLaps = laps;
      svg.classList.toggle('lapped', laps > 0);
      let h = '';
      for (let i = 0; i < laps; i++) h += `<circle cx="${C - (laps - 1) * 4 + i * 8}" cy="${C + 30}" r="2.4"/>`;
      pips.innerHTML = h;
    }
  }
  // Critically damped: the hand eases straight to its value, never overshoots.
  let stiff = 260;
  let damp = 2 * Math.sqrt(260);
  function animate(ts) {
    const dt = Math.min(0.032, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    const f = (target - shown) * stiff - vel * damp;
    vel += f * dt;
    shown += vel * dt;
    if (Math.abs(target - shown) < 0.005 && Math.abs(vel) < 0.02) {
      shown = target;
      vel = 0;
      draw(shown);
      raf = 0;
      last = 0;
      return;
    }
    draw(shown);
    raf = requestAnimationFrame(animate);
  }
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
  function set(v, { instant = false, soft = false } = {}) {
    target = v;
    svg.setAttribute('aria-valuenow', String(Math.round(v)));
    if (instant || document.hidden || reduced()) {
      if (!raf) {
        shown = v;
        vel = 0;
        draw(v);
      }
      return;
    }
    stiff = soft ? 70 : 260;
    damp = 2 * Math.sqrt(stiff);
    if (!raf) raf = requestAnimationFrame(animate);
  }
  /** Jump to `from`, then glide to `to` (phase changes). */
  function sweep(from, to) {
    // No decorative sweep: just show the value.
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    shown = to;
    vel = 0;
    target = to;
    draw(to);
  }
  function pulse() {}

  // ---- interaction -------------------------------------------------------
  let rawMin = 25;
  let lastAng = 0;
  let dragging = false;
  const angleOf = (e) => {
    const r = svg.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    let a = (Math.atan2(x, -y) * 180) / Math.PI;
    if (a < 0) a += 360;
    return a;
  };
  const snapOf = (raw) => {
    const s = getSnap() || 1;
    let v = Math.round(raw / s) * s;
    if (v === 0) v = raw >= 0 ? s : -s;
    return clampV(v);
  };
  function commit(v) {
    if (v === target) return;
    set(v);
    onInput?.(v);
  }
  svg.addEventListener('pointerdown', (e) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    // (no focus() here: a mouse drag shouldn't draw a keyboard focus ring)
    dragging = true;
    svg.classList.add('dragging');
    const a = angleOf(e);
    const pos = a / 6;
    // Pick the lap (or the break side) closest to the current value.
    const options = [pos - 60, pos, pos + 60, pos + 120];
    rawMin = options.reduce((best, o) => (Math.abs(o - target) < Math.abs(best - target) ? o : best), options[1]);
    if (Math.abs(rawMin) < 0.5) rawMin = target >= 0 ? 0.5 : -0.5;
    lastAng = a;
    commit(snapOf(rawMin));
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const a = angleOf(e);
    let d = a - lastAng;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    lastAng = a;
    rawMin = clampV(rawMin + d / 6);
    commit(snapOf(rawMin));
  });
  const end = () => {
    dragging = false;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!interactive) return;
      e.preventDefault();
      const s = getSnap() || 1;
      const next = target + (e.deltaY < 0 ? s : -s);
      commit(next === 0 ? (e.deltaY < 0 ? s : -s) : clampV(next));
    },
    { passive: false }
  );
  svg.addEventListener('keydown', (e) => {
    if (!interactive) return;
    const s = getSnap() || 1;
    let next = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = target + s;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = target - s;
    if (next == null) return;
    e.preventDefault();
    if (next === 0) next = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? s : -s;
    commit(clampV(next));
  });

  draw(shown);
  return {
    el: svg,
    set,
    sweep,
    pulse,
    get animating() {
      return !!raf;
    },
    get value() {
      return target;
    },
    setInteractive(v) {
      interactive = v;
      svg.classList.toggle('interactive', v);
      svg.tabIndex = v ? 0 : -1;
    },
  };
}
