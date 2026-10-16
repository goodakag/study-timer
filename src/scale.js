// Layout root helpers. The app fills the window at native resolution (no
// scaling); the helpers keep overlay positioning code in one place.

const BASE_W = 1180;
const BASE_H = 760;


export let S = 1; // current scale factor
export let W = BASE_W; // root size in local units
export let H = BASE_H;

let rootEl = null;
export const root = () => rootEl || document.body;

/** Convert a screen point (clientX/Y) to local root coordinates. */
export function toLocal(x, y) {
  const r = root().getBoundingClientRect();
  return { x: (x - r.left) / S, y: (y - r.top) / S };
}

/** An element's rect in local root coordinates. */
export function localRect(el) {
  const a = el.getBoundingClientRect();
  const p = toLocal(a.left, a.top);
  const w = a.width / S;
  const h = a.height / S;
  return { left: p.x, top: p.y, width: w, height: h, right: p.x + w, bottom: p.y + h };
}

const subs = new Set();
export const onScale = (fn) => subs.add(fn);

export function fit() {
  if (!rootEl) return;
  // Native resolution: the app is exactly the browser window, with no zoom or
  // transform, so text and the dial are drawn pixel-sharp on every screen.
  // Sizes that should grow with the window use clamp()/vh in CSS instead.
  S = 1;
  W = window.innerWidth;
  H = window.innerHeight;
  rootEl.style.width = '100vw';
  rootEl.style.height = '100vh';
  rootEl.style.zoom = '';
  rootEl.style.transform = '';
  document.documentElement.style.setProperty('--s', 1);
  for (const fn of subs) fn(S);
}

export function initScale(el) {
  rootEl = el;
  fit();
  let raf = 0;
  addEventListener('resize', () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), fit()));
  });
  // Browser zoom / moving between monitors changes devicePixelRatio.
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => (fit(), watchDpr()), { once: true });
  };
  watchDpr();
}
