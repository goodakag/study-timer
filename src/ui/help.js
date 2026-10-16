// Keyboard shortcut sheet (press ?) and the first-run welcome.
import { state, emit, save } from '../store.js';
import { html, MOD, ALT, isMac } from '../util.js';
import { I } from './icons.js';
import { openModal } from './overlay.js';
import { addSampleData } from './data.js';

const ENTER = isMac ? 'Return ↩' : 'Enter ↵';

/** [group, [[label, keys[]]]] — shared by this sheet and Settings. */
export const SHORTCUTS = [
  [
    'General',
    [
      ['Timer', [ALT, '1']],
      ['Analytics', [ALT, '2']],
      ['Journal', [ALT, '3']],
      ['Profile', [ALT, '4']],
      ['Settings', [MOD, ',']],
      ['Show these shortcuts', ['?']],
    ],
  ],
  [
    'Timer',
    [
      ['Start session', [MOD, ENTER]],
      ['Pause / resume', ['Space']],
      ['Take a break', [ALT, 'B']],
      ['Finish / discard session', [ALT, 'F']],
      ['−5 / +5 minutes', [MOD, 'Shift ⇧', ', .']],
      ['Mute background sound', [ALT, 'M']],
      ['Write notes', [ALT, 'N']],
      ['Skip breathing', [ENTER]],
    ],
  ]
];

const kbd = (keys) => `<span class="kbds">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`;

let sheet = null;
export function openShortcuts() {
  if (sheet) return sheet.close();
  const body = html(`<div class="keys">${SHORTCUTS.map(
    ([title, items]) =>
      `<section><h4>${title}</h4>${items.map(([label, keys]) => `<div class="key-row"><span>${label}</span>${kbd(keys)}</div>`).join('')}</section>`
  ).join('')}</div>`);
  sheet = openModal({ title: 'Keyboard shortcuts', body, width: 720, className: 'keys-modal', onClose: () => (sheet = null) });
}

/** Shown once, the first time someone opens the app. */
export function maybeWelcome() {
  if (state.ui.onboarded) return;
  if (state.sessions.length) {
    state.ui.onboarded = true;
    return save();
  }
  const steps = [
    [I.clock, 'Set the time', 'Drag the dial, up to 3 hours. Long blocks get breaks built in.'],
    [I.play, 'Start, then breathe', 'A few calm breaths, then only the timer.'],
    [I.coffee, 'Take real breaks', 'When time’s up, step away. Your progress is saved.'],
  ];
  const body = html(`
    <div class="welcome">
      <div class="wl-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/><path d="M32 32V8a24 24 0 0 1 20.8 12z"/><circle class="hub" cx="32" cy="32" r="3.6"/></svg></div>
      <h2>welcome to study timer</h2>
      <p class="wl-sub">a calm focus timer for studying and deep work.</p>
      <ol class="wl-steps">${steps.map(([ic, t, d], i) => `<li style="--i:${i}"><span class="wl-ic">${ic}</span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ol>
      <div class="wl-actions">
        <button class="btn primary wl-go">Let’s focus</button>
        <button class="btn ghost wl-demo">Explore with a sample week</button>
      </div>
      <p class="wl-foot">Everything stays in your browser. Press <kbd>?</kbd> any time for shortcuts.</p>
    </div>`);
  const done = () => {
    state.ui.onboarded = true;
    save();
  };
  const m = openModal({ body, width: 460, className: 'welcome-modal', closeButton: false, onClose: done });
  body.querySelector('.wl-go').onclick = () => {
    m.close();
    emit('navigate', { view: 'timer' });
  };
  body.querySelector('.wl-demo').onclick = () => {
    addSampleData();
    m.close();
    emit('navigate', { view: 'analytics' });
  };
  setTimeout(() => body.querySelector('.wl-go').focus({ preventScroll: true }), 60);
}
