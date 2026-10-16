// Settings view: grouped sidebar + grouped rows, like the desktop app.
import { state, emit, on, SOUNDS, MOODS, replaceAll, resetAll, isStorageOk } from '../store.js';
import { $, esc, html, download } from '../util.js';
import { I } from './icons.js';
import { confirmDialog, toast } from './overlay.js';
import { openCategories } from './categories.js';
import { requestPermission, canNotify } from '../notify.js';
import { exportAll, parseBackup, toCSV, addSampleData } from './data.js';
import { SHORTCUTS } from './help.js';
import * as audio from '../audio.js';
import { flushCloud } from '../cloud.js';

const SECTIONS = [
  [
    { id: 'timer', label: 'Timer', icon: I.timerFill, bg: '#7d6ae0' },
    { id: 'focus', label: 'Focus & breaks', icon: I.sun, bg: '#d9666b' },
    { id: 'sound', label: 'Sound & alerts', icon: I.music, bg: '#4f86e8' },
    { id: 'appearance', label: 'Appearance', icon: I.window, bg: '#d28a3e' },
  ],
  [
    { id: 'categories', label: 'Categories', icon: I.layers, bg: '#8b78ea' },
    { id: 'calendar', label: 'Calendar', icon: I.calFill, bg: '#4d93d9' },
    { id: 'data', label: 'Your data', icon: I.database, bg: '#5aa36e' },
  ],
  [
    { id: 'shortcuts', label: 'Shortcuts', icon: I.keyboard, bg: '#8a8a8f' },
    { id: 'about', label: 'About', icon: I.info, bg: '#8a8a8f' },
  ],
];

const get = (k) => k.split('.').reduce((o, p) => o?.[p], state.settings);
function set(k, v) {
  const parts = k.split('.');
  const last = parts.pop();
  parts.reduce((o, p) => o[p], state.settings)[last] = v;
}

const toggle = (k) => `<label class="switch"><input type="checkbox" data-k="${k}" ${get(k) ? 'checked' : ''}/><i></i></label>`;
const select = (k, opts, num = false) =>
  `<span class="select"><select data-k="${k}" ${num ? 'data-num' : ''}>${opts.map(([v, l]) => `<option value="${v}" ${String(get(k)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${I.updown}</span>`;
const number = (k, min, max) => `<input class="num" type="number" inputmode="numeric" data-k="${k}" min="${min}" max="${max}" value="${get(k)}"/>`;
const row = (label, ctrl, sub = '') => `<div class="srow"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${ctrl}</div>`;
const group = (title, rows, note = '') =>
  `${title ? `<h4 class="sg-title">${title}</h4>` : ''}<div class="sg">${rows.join('')}</div>${note ? `<p class="sg-note">${note}</p>` : ''}`;
const seg = (k, opts) =>
  `<span class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(get(k)) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</span>`;
const swatches = (k, opts) =>
  `<span class="seg swatches" data-seg="${k}">${opts.map(([v, c, l]) => `<button type="button" data-v="${v}" title="${l}" aria-label="${l}" style="--sw:${c}" class="${get(k) === v ? 'on' : ''}"></button>`).join('')}</span>`;
const kbd = (...keys) => `<span class="kbds">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`;
const nums = (a, b, step = 1) => {
  const o = [];
  for (let i = a; i <= b; i += step) o.push([i, String(i)]);
  return o;
};

function content(id) {
  switch (id) {
    case 'timer':
      return (
        group('Lengths', [
          row('Focus session', number('sessionMin', 1, 180), 'minutes'),
          row('Short break', number('shortBreakMin', 1, 60), 'minutes'),
          row('Long break', number('longBreakMin', 1, 90), 'minutes'),
          row('Long break after', select('longBreakEvery', [[0, 'Never'], ...nums(2, 8).map(([v]) => [v, `${v} sessions`])], true)),
        ], 'Drag the dial clockwise for focus (up to 3 hours) and counter-clockwise for a break.') +
        group('Long study blocks', [
          row('Longest stretch without a break', seg('longestStretch', [[25, '25'], [40, '40'], [45, '45'], [50, '50'], [60, '60']]), 'minutes'),
        ], 'Blocks over an hour are split into equal stretches with a short break between each, then a long break at the end. 1h 30m becomes 2 × 45 min.') +
        group('When time is up', [
          row('Keep counting (overflow)', toggle('overflow'), 'Finish your thought, then stop when you are ready'),
          row('Start breaks automatically', toggle('autoStartBreak')),
          row('Start the next session automatically', toggle('autoStartSession')),
        ]) +
        group('Dial', [row('Snap to', seg('snapMin', [[1, '1 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']]))])
      );
    case 'focus':
      return (
        group('Focus mode', [
          row('Focus timer', seg('focusStyle', [['digital', 'Digital'], ['analog', 'Analog']])),
        ]) +
        group('Before you start', [
          row('Breathe before each session', toggle('breathe')),
          row('Breaths', seg('breatheCycles', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])),
        ])
      );
    case 'sound': {
      const perm = canNotify() ? Notification.permission : 'unsupported';
      return (
        group('Sound', [
          row('Play sounds', toggle('playSound')),
          row('Volume', `<input class="slider" type="range" min="0" max="1" step="0.01" data-k="volume" value="${get('volume')}"/>`),
        ]) +
        group('Background sound', [
          row('While focusing', select('bg.focus', SOUNDS)),
          row('Overflow', select('bg.overflow', SOUNDS)),
          row('Break', select('bg.break', SOUNDS)),
          row('Break overflow', select('bg.breakOver', SOUNDS)),
        ]) +
        group('Alerts', [
          row('Desktop notifications', toggle('notifications'), perm === 'denied' ? 'Blocked in your browser settings' : perm === 'unsupported' ? 'Not supported in this browser' : 'Even when this tab is in the background'),
          row('Warn before the end', toggle('endingSoon')),
          row('How early', seg('endingSoonMin', [[1, '1 min'], [2, '2 min'], [5, '5 min']])),
          row('Gentle check-in chime', toggle('presence'), 'A soft sound now and then to pull you back'),
          row('Check-in every', number('presenceMin', 1, 60), 'minutes'),
          row('Remind me when I run long', toggle('tooLong')),
        ])
      );
    }
    case 'appearance':
      return (
        group('Theme', [
          row('Look', seg('look', [['cozy', 'Cozy'], ['classic', 'Classic']])),
          row('Break colour', swatches('breakTheme', [['blue', '#4a82ad', 'Blue'], ['teal', '#3f8f93', 'Teal'], ['green', '#4f9473', 'Green'], ['purple', '#7c71b8', 'Purple'], ['rose', '#c06f78', 'Rose'], ['cozy', '#4a403e', 'Taupe'], ['light', '#ebe5df', 'Light'], ['gray', '#505050', 'Gray']])),
        ], 'Cozy is warm and soft; Classic is the original Session look. The break colour fills the screen during breaks.') +
        group('', [
          row('24-hour clock', toggle('clock24')),
          row('Countdown in the tab title', toggle('titleCountdown')),
          row('Categories', toggle('useCategories'), 'Tag sessions with a subject and colour'),
          row('Reduce motion', toggle('reduceMotion')),
          row('Intention suggestions', seg('suggestions', [['all', 'All'], ['category', 'Category'], ['off', 'Off']])),
        ])
      );
    case 'calendar':
      return group('', [row('Week starts on', seg('weekMonday', [['true', 'Monday'], ['false', 'Sunday']]))], 'Plan blocks from the Today panel or the Calendar tab. Click a planned block to start it.');
    case 'categories':
      return (
        group('', state.categories.map((c) => row(`<span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span>`, ''))) +
        `<div class="sbtns"><button class="btn primary" data-act="cats">Manage categories</button></div>`
      );
    case 'shortcuts':
      return SHORTCUTS.map(([title, items]) => group(title, items.map(([label, keys]) => row(label, kbd(...keys))))).join('');
    case 'data':
      return (
        group('', [
          row('Export all data (JSON)', '<button class="btn sm" data-act="export">Export</button>'),
          row('Export sessions (CSV)', '<button class="btn sm" data-act="csv">Export</button>'),
          row('Import backup (JSON)', '<button class="btn sm" data-act="import">Import…</button>'),
        ], 'Everything is stored only in this browser. Export a backup to move it to another browser or computer.') +
        group('', [row('Add sample data', '<button class="btn sm" data-act="demo">Add</button>', 'Fills the last 3 weeks with example Sessions')]) +
        group('', [row('<span class="danger-text">Delete all data</span>', '<button class="btn sm danger" data-act="reset">Delete…</button>')])
      );
    case 'about':
      return group('', [
        row('Study Timer', '<span class="muted">v1.1</span>'),
        row('Storage', `<span class="muted">${isStorageOk() ? 'Saved in this browser' : 'Storage unavailable'}</span>`),
      ], 'A free, open-source focus timer for studying, inspired by Session and Pomofocus. Not affiliated with either. Works offline once loaded.');
  }
  return '';
}

export function mountSettings(root) {
  root.innerHTML = `
  <section class="st">
    <nav class="st-nav">
      <div class="st-sync"><div><b>${state.sessions.length} sessions</b><small>Saved in this browser</small></div><span class="st-sync-ic">${I.refresh}</span></div>
      ${SECTIONS.map((g) => `<div class="st-group">${g.map((s) => `<button class="st-item" data-s="${s.id}"><span class="st-ic" style="background:${s.bg}">${s.icon}</span><span>${s.label}</span>${I.chevRight}</button>`).join('')}</div>`).join('')}
      <p class="st-ver">Study Timer</p>
    </nav>
    <div class="st-main"><div class="st-content"></div></div>
  </section>`;
  const el = root.firstElementChild;
  const contentEl = $('.st-content', el);
  let current = 'general';

  function show(id) {
    current = id;
    el.querySelectorAll('.st-item').forEach((b) => b.classList.toggle('on', b.dataset.s === id));
    contentEl.innerHTML = content(id);
    contentEl.classList.remove('anim');
    void contentEl.offsetWidth;
    contentEl.classList.add('anim');
    $('.st-sync b', el).textContent = `${state.sessions.length} sessions`;
    contentEl.parentElement.scrollTop = 0;
  }
  $('.st-nav', el).addEventListener('click', (e) => {
    const b = e.target.closest('.st-item');
    if (b) show(b.dataset.s);
  });

  const onChange = async (e) => {
    const t = e.target;
    const k = t.dataset.k;
    if (!k) return;
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') {
      if (t.value.trim() === '') {
        if (e.type === 'change') t.value = get(k); // cleared: keep the old value
        return;
      }
      v = Math.round(Number(t.value));
      if (!Number.isFinite(v)) return;
      v = Math.max(Number(t.min), Math.min(Number(t.max), v));
      if (e.type === 'change') t.value = v;
    } else if (t.type === 'range') v = Number(t.value);
    else if (t.dataset.num !== undefined) v = Number(t.value);
    else if (t.value === 'true' || t.value === 'false') v = t.value === 'true';
    else v = t.value;
    if (k === 'notifications' && v) {
      const ok = await requestPermission();
      if (!ok) {
        t.checked = false;
        toast('Notifications are blocked by the browser');
        return;
      }
    }
    // The idle dial follows the default length of the mode it's showing.
    const d = state.ui.draft;
    const mode = d.minutes > 0 ? 'sessionMin' : -d.minutes >= state.settings.longBreakMin ? 'longBreakMin' : 'shortBreakMin';
    set(k, v);
    if (!state.timer && k === mode) d.minutes = k === 'sessionMin' ? v : -v;
    if (k === 'volume') audio.setVolume(v);
    emit('settings');
    if (k.startsWith('bg.')) emit('sound');
  };
  contentEl.addEventListener('change', onChange);
  contentEl.addEventListener('input', (e) => e.target.type === 'range' && onChange(e));

  contentEl.addEventListener('click', async (e) => {
    const sb = e.target.closest('.seg button');
    if (sb) {
      const k = sb.parentElement.dataset.seg;
      const raw = sb.dataset.v;
      const v = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
      set(k, v);
      sb.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === sb));
      return emit('settings');
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const stamp = new Date().toISOString().slice(0, 10);
    if (act === 'cats') openCategories();
    if (act === 'export') download(`session-backup-${stamp}.json`, exportAll());
    if (act === 'csv') download(`session-${stamp}.csv`, toCSV(state.sessions), 'text/csv');
    if (act === 'import') {
      const input = html('<input type="file" accept="application/json,.json" hidden/>');
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const data = parseBackup(await file.text());
          const ok = await confirmDialog({ title: 'Import backup?', message: `This replaces your current data with ${data.sessions.length} sessions from “${file.name}”.`, ok: 'Import', danger: false });
          if (!ok) return;
          replaceAll({ ...state, ...data, settings: data.settings ? { ...state.settings, ...data.settings } : state.settings, timer: null });
          await flushCloud();
          location.reload();
        } catch (err) {
          toast(`Import failed: ${err.message}`);
        }
      };
      input.click();
    }
    if (act === 'demo') {
      addSampleData();
      toast('Sample data added');
      show(current);
    }
    if (act === 'reset') {
      const ok = await confirmDialog({ title: 'Delete all data?', message: 'All Sessions, notes, categories and settings in this browser will be permanently deleted.', ok: 'Delete everything' });
      if (!ok) return;
      resetAll();
      await flushCloud();
          location.reload();
    }
  });

  on('categories', () => current === 'categories' && show(current));

  show('timer');
  return { show };
}
