// Browser integration: desktop notifications, tab title, dynamic favicon.
import { state } from './store.js';

export function canNotify() {
  return 'Notification' in window;
}

export async function requestPermission() {
  if (!canNotify()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function notify(title, body, tag) {
  if (!state.settings.notifications || !canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'session-' + (tag || 'x'), icon: './icon.svg', silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

let lastTitle = '';
export function setTitle(text) {
  if (text !== lastTitle) document.title = lastTitle = text;
}

// Favicon: a bold coloured disc (red for focus, blue for break) with a white
// pie for the time left, so it reads at 16px in a crowded tab bar.
let lastIcon = '';
const link = () => document.getElementById('favicon');
export function iconSVG(fraction, kind) {
  const color = kind === 'break' ? '#4a82ad' : '#e5574f';
  const f = Math.max(0, Math.min(1, fraction));
  const r = 21;
  const a = f * Math.PI * 2;
  const x = 32 + r * Math.sin(a);
  const y = 32 - r * Math.cos(a);
  const pie =
    f >= 0.999
      ? `<circle cx="32" cy="32" r="${r}" fill="#fff"/>`
      : f > 0.001
        ? `<path d="M32 32V${32 - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z" fill="#fff"/>`
        : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="${color}"/><circle cx="32" cy="32" r="${r}" fill="#fff" fill-opacity="0.28"/>${pie}</svg>`;
}
export function setFavicon(fraction, kind) {
  const key = fraction == null ? 'idle' : `${kind}:${Math.round(fraction * 64)}`;
  if (key === lastIcon) return;
  lastIcon = key;
  const el = link();
  if (!el) return;
  el.href = 'data:image/svg+xml,' + encodeURIComponent(iconSVG(fraction == null ? 0.25 : fraction, kind || 'focus'));
}
