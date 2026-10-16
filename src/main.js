import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/timer.css';
import './styles/panes.css';
import './styles/views.css';
import './styles/overlays.css';
import './styles/motion.css';
import './styles/zen.css';
import './styles/cozy.css';
import './styles/home.css';

import { state, emit, on, save, cat } from './store.js';
import * as T from './timer.js';
import * as audio from './audio.js';
import { setTitle, setFavicon } from './notify.js';
import { initScale, onScale, localRect } from './scale.js';
import { $, html, clockText, isTyping, isMac, setClock24, dayStart, MIN, MOD, ALT } from './util.js';
import { I } from './ui/icons.js';
import { mountTimerPane } from './ui/timerPane.js';
import { mountRightPane } from './ui/rightPane.js';
import { mountBreathe, breathing } from './ui/breathe.js';
import { mountFocusScreen } from './ui/focusScreen.js';
import { initCloud } from './cloud.js';
import { mountReflection } from './ui/editors.js';
import { closeMenu, menuOpen, modalOpen, closeTopModal, toast, openMenu, openModal } from './ui/overlay.js';
import { openShortcuts, maybeWelcome } from './ui/help.js';

const app = $('#app');
app.append(
  html(`
  <div class="app">
    <header class="topbar">
      <div class="tb-left">
        <button class="tb-back" hidden>${I.chevLeft}<span>Timer</span><b class="tb-live" hidden></b></button>
        <div class="tb-brand"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="d" cx="32" cy="32" r="26"/><path class="w" d="M32 32V6a26 26 0 0 1 22.5 13z"/><circle class="h" cx="32" cy="32" r="4"/></svg><span>session</span></div>
      </div>
      <button class="tb-more" aria-label="Menu" title="Menu">${I.more}</button>
    </header>
    <main class="views">
      <div class="view" data-v="timer"><div class="timer-host"></div></div>
      <div class="view" data-v="analytics" hidden></div>
      <div class="view" data-v="profile" hidden></div>
      <div class="view" data-v="journal" hidden></div>
    </main>
    <div class="drawer-scrim"></div>
    <aside class="right-host" aria-label="Today, notes and calendar"></aside>
  </div>`)
);

initScale($('.app'));
const timerPane = mountTimerPane($('.timer-host'));
const rightPane = mountRightPane($('.right-host'));
mountBreathe();
mountReflection();

// ---- views (lazy-mounted) -------------------------------------------------
const mounted = {};
const loaders = {
  analytics: () => import('./ui/analytics.js').then((m) => m.mountAnalytics),
  profile: () => import('./ui/profile.js').then((m) => m.mountProfile),
  journal: () => import('./ui/profile.js').then((m) => m.mountJournal),
};
// Settings live in a sheet over whatever you're doing, not in a page of their own.
let settingsApi = null;
let settingsHost = null;
let settingsReady = null;
async function openSettings(section) {
  // One shared load, so two quick opens can't race each other.
  settingsReady ||= import('./ui/settings.js').then(({ mountSettings }) => {
    settingsHost = html('<div class="settings-host"></div>');
    settingsApi = mountSettings(settingsHost);
  });
  await settingsReady;
  if (document.querySelector('.settings-modal')) return settingsApi.show(section || 'timer');
  if (modalOpen()) closeTopModal();
  openModal({ title: 'Settings', body: settingsHost, width: 860, className: 'settings-modal' });
  settingsApi.show(section || 'timer');
}
async function showView(v, opts = {}) {
  if (v === 'settings') return openSettings(opts.section);
  if (!loaders[v] && v !== 'timer') v = 'timer';
  state.ui.view = v;
  closeDrawer();
  $('.tb-back').hidden = v === 'timer';
  $('.tb-brand').hidden = v !== 'timer';
  document.querySelectorAll('.view').forEach((x) => (x.hidden = x.dataset.v !== v));
  if (v !== 'timer') {
    const host = document.querySelector(`.view[data-v="${v}"]`);
    if (!mounted[v]) {
      host.classList.add('loading');
      try {
        mounted[v] ||= (await loaders[v]())(host);
      } finally {
        host.classList.remove('loading');
      }
    }
    if (state.ui.view !== v) return;
    mounted[v].show?.(opts.section);
  }
  updateBadge();
  updateZen();
  save();
}
$('.tb-back').addEventListener('click', () => showView('timer'));

// Everything that isn't the timer lives behind one menu in the corner.
const appRoot = $('.app');
function openDrawer(tab) {
  if (state.ui.view !== 'timer') showView('timer');
  rightPane.setTab(tab);
  appRoot.classList.add('drawer-open');
}
function closeDrawer() {
  appRoot.classList.remove('drawer-open');
}
const drawerOpen = () => appRoot.classList.contains('drawer-open');
$('.drawer-scrim').addEventListener('click', closeDrawer);
$('.tb-more').addEventListener('click', () =>
  openMenu(
    $('.tb-more'),
    [
      { label: 'Today & plan', icon: I.calendar, onClick: () => openDrawer('today') },
      { label: 'Notes', icon: I.compose, right: `<span class="menu-kbd">${ALT} N</span>`, onClick: () => openDrawer('notes') },
      { label: 'Calendar', icon: I.calPlus, onClick: () => openDrawer('calendar') },
      { sep: true },
      { label: 'Insights', icon: I.chart, onClick: () => showView('analytics') },
      { label: 'Journal', icon: I.book, onClick: () => showView('journal') },
      { label: 'Profile', icon: I.user, onClick: () => showView('profile') },
      { sep: true },
      { label: 'Settings', icon: I.gear, right: `<span class="menu-kbd">${MOD} ,</span>`, onClick: () => openSettings() },
      { label: 'Keyboard shortcuts', icon: I.keyboard, right: '<span class="menu-kbd">?</span>', onClick: openShortcuts },
    ],
    { align: 'end', width: 240 }
  )
);
on('navigate', ({ view, section }) => showView(view, { section }));

// ---- focus mode: while a timer runs, everything but the timer steps aside ----
const appEl = $('.app');
let mouseT = 0;
const focusScreen = mountFocusScreen(appEl, {
  onExit() {
    state.ui.zen = false;
    emit('zen');
    toast('Full view for this session', { action: 'Back to focus', onAction: () => ((state.ui.zen = true), emit('zen')) });
  },
  onNotes() {
    state.ui.zen = false;
    emit('zen');
    openDrawer('notes');
    rightPane.focusNotes();
  },
});
function updateZen() {
  // The breathe screen is part of focus mode, so it opens it too.
  // Focus mode is how the timer runs: always on while a timer (or breathing) is going.
  const on = state.ui.view === 'timer' && (T.view().phase !== 'idle' || breathing());
  if (appEl.classList.contains('zen') === on) return;
  appEl.classList.toggle('zen', on);
  if (on) return focusScreen.show(true, null);
  // Close into the dial, then let the home screen settle back in.
  const dialEl = $('.tp .dial-host');
  const r = dialEl && dialEl.offsetWidth ? localRect(dialEl) : null;
  focusScreen.show(false, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  timerPane.enter();
}
on('timer', updateZen);
on('breathe', closeDrawer);
on('timer', () => state.timer && closeDrawer());
on('breathing', updateZen);
on('zen', () => {
  updateZen();
  save();
});
// Secondary controls fade out until the mouse moves.
addEventListener(
  'pointermove',
  () => {
    if (!appEl.classList.contains('zen')) return;
    appEl.classList.add('awake');
    clearTimeout(mouseT);
    mouseT = setTimeout(() => appEl.classList.remove('awake'), 2200);
  },
  { passive: true }
);

// ---- title, favicon, rail badge ------------------------------------------------
const badge = $('.tb-live');
function updateBadge(v = T.view()) {
  const show = state.ui.view !== 'timer' && v.phase !== 'idle';
  if (badge.hidden === show) badge.hidden = !show;
  if (show) badge.textContent = v.over ? clockText(v.overMs, true) : clockText(v.remaining);
}
function updateChrome(v = T.view()) {
  const t = state.timer;
  if (!t) {
    setTitle('Study Timer');
    setFavicon(null);
  } else {
    // Like Pomofocus: the countdown first, then what you're doing.
    const time = v.over ? '+' + clockText(v.overMs, true) : clockText(v.remaining);
    const what = v.paused ? 'Paused' : t.kind === 'break' ? (v.over ? 'Break is over' : 'Time for a break') : v.over ? 'Time is up' : t.title || 'Time to focus';
    setTitle(state.settings.titleCountdown ? `${time} · ${what}` : 'Study Timer');
    setFavicon(v.over ? 0 : Math.max(0, Math.min(1, v.remaining / Math.max(1, t.durationMs))), t.kind);
  }
  updateBadge(v);
}
on('tick', updateChrome);
on('timer', () => updateChrome());
on('settings', () => updateChrome());

// ---- sound -------------------------------------------------------------------
const BG_KEY = { focus: 'focus', focusOver: 'overflow', break: 'break', breakOver: 'breakOver' };
function syncSound() {
  const v = T.view();
  const s = state.settings;
  audio.setCuesEnabled(s.playSound);
  audio.setVolume(s.volume);
  const type = v.phase === 'idle' || v.paused || state.ui.muted ? 'off' : s.bg[BG_KEY[v.phase]] || 'off';
  audio.setBackground(type);
}
on('timer', syncSound);
on('sound', syncSound);
on('settings', syncSound);
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock, { passive: true });
addEventListener('keydown', unlock);

// ---- keep the screen awake while a timer runs (laptops dim mid-study) -------------
let wakeLock = null;
async function syncWakeLock() {
  const want = !!state.timer && !document.hidden;
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null; // not allowed here (battery saver, sandbox): carry on without it
  }
}
on('timer', syncWakeLock);
document.addEventListener('visibilitychange', syncWakeLock);

// ---- display settings ------------------------------------------------------------
function applyDisplay() {
  setClock24(state.settings.clock24);
  document.documentElement.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  document.documentElement.dataset.look = state.settings.look === 'classic' ? 'classic' : 'cozy';
  document.documentElement.dataset.cats = state.settings.useCategories ? 'on' : 'off';
}
on('settings', applyDisplay);
applyDisplay();

// ---- minute ticker (calendar now-line, idle range pill) ---------------------------
let today = dayStart(Date.now());
function minuteLoop() {
  setTimeout(() => {
    emit('minute');
    const d = dayStart(Date.now());
    if (d !== today) {
      today = d;
      emit('dayChange');
      emit('sessions');
    }
    minuteLoop();
  }, 60_000 - (Date.now() % 60_000) + 20);
}
minuteLoop();

// ---- keyboard shortcuts ---------------------------------------------------------------
addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const typing = isTyping(e.target);
  const v = T.view();

  if (e.key === 'Escape') {
    if (menuOpen()) return closeMenu();
    if (modalOpen()) return closeTopModal();
    if (drawerOpen() && !typing) return closeDrawer();
    if (typing) return e.target.blur();
    return;
  }
  if (breathing() || modalOpen()) return;

  if (e.key === '?' && !typing && !mod) {
    e.preventDefault();
    return openShortcuts();
  }

  if (e.altKey && !mod && /^Digit[1-4]$/.test(e.code)) {
    e.preventDefault();
    return showView(['timer', 'analytics', 'journal', 'profile'][Number(e.code.slice(5)) - 1]);
  }
  if (mod && e.code === 'Comma' && !e.shiftKey) {
    e.preventDefault();
    return showView('settings');
  }
  if (mod && e.code === 'KeyI') {
    e.preventDefault();
    showView('timer');
    return timerPane.focusIntent();
  }
  if (e.altKey && e.code === 'KeyC') {
    e.preventDefault();
    showView('timer');
    return timerPane.openCategory();
  }
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    if (state.ui.view !== 'timer') showView('timer');
    if (v.phase === 'idle') timerPane.start();
    else if (v.phase === 'break' || v.phase === 'breakOver') T.breakPlay();
    return;
  }
  if (mod && e.shiftKey && (e.code === 'Comma' || e.code === 'Period')) {
    e.preventDefault();
    if (state.timer) T.adjust(e.code === 'Comma' ? -5 : 5);
    return;
  }
  if (e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    if (v.kind === 'focus') T.takeBreak();
    else if (v.phase === 'idle') T.startBreak();
    return;
  }
  if (e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    showView('timer');
    return timerPane.openStopMenu();
  }
  if (e.altKey && e.code === 'KeyM') {
    e.preventDefault();
    return timerPane.toggleMute();
  }
  if (e.altKey && e.code === 'KeyN') {
    e.preventDefault();
    if (state.timer) return;
    showView('timer');
    openDrawer('notes');
    return rightPane.focusNotes();
  }
  if (e.code === 'Space' && !typing && !mod && !e.altKey && state.ui.view === 'timer') {
    if (e.target.closest?.('button')) return; // let buttons handle space
    e.preventDefault();
    if (v.phase === 'focus') T.pauseToggle();
    else if (v.phase === 'idle') timerPane.start();
  }
});

// ---- boot -------------------------------------------------------------------------
T.resume();
syncSound();
updateChrome();
syncWakeLock();

// When published as a Claude Artifact, keep data in the viewer's private cloud
// store so it survives cleared browser storage and follows them between devices.
initCloud(() => {
  for (const t of ['categories', 'settings', 'planned', 'sessions', 'timer', 'sound']) emit(t);
  T.resume();
  syncSound();
  updateChrome();
  syncWakeLock();
  updateZen();
});
showView(['analytics', 'journal'].includes(state.ui.view) ? state.ui.view : 'timer');
setTimeout(maybeWelcome, 500);
requestAnimationFrame(() => document.documentElement.classList.add('ready'));

// Offline cache for self-hosted copies (Claude Artifacts don't run service workers).
if (import.meta.env.PROD && !window.claude && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
