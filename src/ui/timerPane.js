// Left pane: intention, category, dial, and phase controls.
import { state, emit, on, save, cat, suggestions, todayFocusCount, dayStats, SOUNDS } from '../store.js';
import * as T from '../timer.js';
import { $, esc, html, clockText, hm, dur, MIN, pad } from '../util.js';
import { createDial } from './dial.js';
import { createRoller } from './roll.js';
import { localRect, W, H } from '../scale.js';
import { breathing } from './breathe.js';
import { I } from './icons.js';
import { openMenu, openModal, discardSession } from './overlay.js';
import { openCategoryMenu, catPillHTML } from './categories.js';
import { requestPermission } from '../notify.js';

const BG_KEY = { focus: 'focus', focusOver: 'overflow', break: 'break', breakOver: 'breakOver', idle: 'focus' };

/** "@learn", "30m", "1h", "1h 30m" inside the intention. */
export function parseIntention(text) {
  let title = text;
  let categoryId = null;
  let minutes = null;
  title = title.replace(/(^|\s)@(\S+)/g, (m, sp, name) => {
    if (!state.settings.useCategories) return m;
    const c = state.categories.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase()));
    if (!c) return m;
    categoryId = c.id;
    return sp;
  });
  title = title.replace(/(^|\s)(\d{1,3})\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)(?:\s*(\d{1,2})\s*(?:m|min|mins))?(?=\s|$)/i, (m, sp, n, u, n2) => {
    minutes = /^h/i.test(u) ? Number(n) * 60 + (n2 ? Number(n2) : 0) : Number(n);
    return sp;
  });
  return { title: title.replace(/\s+/g, ' ').trim(), categoryId, minutes };
}

export function mountTimerPane(root) {
  root.innerHTML = `
  <section class="tp" data-phase="idle">
    <button class="tp-tune icon-btn" title="Sound options" aria-label="Sound options">${I.speaker}</button>
    <button class="tp-zen icon-btn" aria-label="Toggle focus mode"></button>
    <div class="tp-head">
      <div class="tp-next">What's next?</div>
      <div class="dots" aria-label="Sessions today"></div>
      <h1 class="tp-q">What's your focus?</h1>
      <button class="cat-pill" aria-label="Category"><i class="dot"></i><span class="cat-name"></span>${I.chevDown}</button>
      <div class="intent-wrap">
        <input class="intent" placeholder="What are you working on?" maxlength="140" autocomplete="off" spellcheck="false" aria-label="Intention" />
        <button class="intent-clear" aria-label="Clear" tabindex="-1">${I.close}</button>
        <div class="suggest" role="listbox"></div>
      </div>
      <h2 class="tp-title"></h2>
      <button class="tp-edit">Edit Session</button>
    </div>
    <div class="tp-mid">
      <div class="tp-breaklabel">Taking a break</div>
      <div class="mode-tabs" role="tablist" aria-label="Timer mode">
        <i class="mode-ind"></i>
        <button data-mode="focus" role="tab">Focus</button>
        <button data-mode="short" role="tab">Short Break</button>
        <button data-mode="long" role="tab">Long Break</button>
      </div>
      <div class="dial-host"></div>
      <div class="tp-time">25:00</div>
      <div class="tp-adjust">
        <button class="adj" data-d="-5" aria-label="Minus 5 minutes">-5</button>
        <button class="range-pill"><span class="range-text"></span>${I.chevDown}</button>
        <button class="adj" data-d="5" aria-label="Plus 5 minutes">+5</button>
      </div>
      <button class="tp-today" type="button" title="See your progress"></button>
      <div class="tp-reflect" hidden>
        <span>How was your focus?</span>
        <button data-m="focused" title="Focused">🤩</button>
        <button data-m="neutral" title="Neutral">😐</button>
        <button data-m="distracted" title="Distracted">😔</button>
      </div>
    </div>
    <div class="tp-foot">
      <button class="start-btn">Start session</button>
      <div class="ctrls">
        <button class="ctrl c-left"></button>
        <button class="ctrl c-main"></button>
        <button class="ctrl c-right"></button>
      </div>
    </div>
  </section>`;

  const el = root.firstElementChild;
  const q = (s) => $(s, el);
  const dots = q('.dots');
  const catPill = q('.cat-pill');
  const intent = q('.intent');
  const suggest = q('.suggest');
  const timeEl = q('.tp-time');
  const roller = createRoller(timeEl);
  const rangeText = q('.range-text');
  const rangePill = q('.range-pill');
  const startBtn = q('.start-btn');
  const [cLeft, cMain, cRight] = [q('.c-left'), q('.c-main'), q('.c-right')];
  const titleEl = q('.tp-title');

  const d = state.ui.draft;
  if (!d.minutes) d.minutes = state.settings.sessionMin;

  const dial = createDial(q('.dial-host'), {
    getSnap: () => state.settings.snapMin,
    onInput(v) {
      d.minutes = v;
      save();
      renderIdleMode();
      renderToday();
      renderTick();
    },
  });

  let phase = null;
  let ctrlsReady = false;
  let ctrlKey = '';

  // With categories off, everything uses the first (plain) category.
  const draftCat = () => (state.settings.useCategories ? d.categoryId : state.categories[0].id);
  function curCat() {
    return cat(state.timer ? state.timer.categoryId : draftCat());
  }

  // Under the dial, for blocks over an hour: how the time will be split up.
  const todayEl = q('.tp-today');
  function renderToday() {
    const parts = d.minutes > 60 ? T.splitBlock(d.minutes) : null;
    todayEl.hidden = !parts;
    if (!parts) return;
    const same = parts.every((p) => p === parts[0]);
    const h = `<span><b>${parts.length} × ${same ? parts[0] : `~${Math.round(d.minutes / parts.length)}`} min</b> focus</span><i></i><span>${state.settings.shortBreakMin} min breaks</span><i></i><span>then a long break</span>`;
    if (todayEl.innerHTML !== h) todayEl.innerHTML = h;
  }

  let lastDots = -1;
  function renderDots() {
    const n = todayFocusCount(T.now());
    const target = Math.max(1, Math.min(16, state.settings.streakTarget));
    let s = '';
    for (let i = 0; i < target; i++) s += `<i class="${i < n ? 'on' : ''}${lastDots >= 0 && i < n && i >= lastDots ? ' pop' : ''}" style="--i:${i}"></i>`;
    lastDots = n;
    dots.innerHTML = s;
    dots.title = `${n} of ${target} sessions today`;
  }

  // Focus / Short Break / Long Break tabs mirror the dial (clockwise = focus,
  // counter-clockwise = break), so starting a break is one obvious click.
  const modeTabs = q('.mode-tabs');
  const modeInd = q('.mode-ind');
  function idleMode() {
    if (d.minutes > 0) return 'focus';
    return -d.minutes >= state.settings.longBreakMin ? 'long' : 'short';
  }
  function renderIdleMode() {
    const brk = d.minutes < 0;
    el.classList.toggle('mode-break', brk && phase === 'idle');
    const label = brk ? (idleMode() === 'long' ? 'Start long break' : 'Start break') : 'Start session';
    if (startBtn.textContent !== label) startBtn.textContent = label;
    const m = idleMode();
    let i = 0;
    modeTabs.querySelectorAll('button').forEach((b, k) => {
      const on = b.dataset.mode === m;
      b.classList.toggle('on', on);
      if (on) i = k;
    });
    const b = modeTabs.querySelectorAll('button')[i];
    if (b.offsetWidth) {
      modeInd.style.width = b.offsetWidth + 'px';
      modeInd.style.transform = `translateX(${b.offsetLeft}px)`;
    }
  }
  modeTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    const s = state.settings;
    d.minutes = b.dataset.mode === 'focus' ? s.sessionMin : -(b.dataset.mode === 'long' ? s.longBreakMin : s.shortBreakMin);
    dial.set(Math.max(-60, Math.min(60, d.minutes)));
    save();
    renderIdleMode();
    renderTick();
  });
  requestAnimationFrame(() => renderIdleMode());

  function setCtrl(btn, icon, label, cls = '') {
    if (btn.dataset.icon !== label) {
      btn.dataset.icon = label;
      btn.innerHTML = icon;
      const ic = btn.firstElementChild;
      if (ic && ctrlsReady) ic.classList.add('swap');
    }
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.className = `ctrl ${btn === cMain ? 'c-main' : btn === cLeft ? 'c-left' : 'c-right'} ${cls}`;
  }

  function renderCtrls(v) {
    const key = `${v.phase}|${v.paused}|${state.ui.muted}`;
    if (key === ctrlKey) return;
    ctrlKey = key;
    // Break and Finish are always their own buttons; sound lives in the
    // speaker icon at the top of the pane.
    cRight.hidden = false;
    if (v.phase === 'focus') {
      setCtrl(cLeft, I.coffee, 'Take a break');
      setCtrl(cMain, v.paused ? I.play : I.pause, v.paused ? 'Resume' : 'Pause');
      setCtrl(cRight, I.stop, 'Finish session');
    } else if (v.phase === 'focusOver') {
      setCtrl(cLeft, I.repeat, 'Start another session');
      setCtrl(cMain, I.coffee, 'Take a break');
      setCtrl(cRight, I.stop, 'Finish session');
    } else if (v.phase === 'break' || v.phase === 'breakOver') {
      setCtrl(cLeft, I.stop, 'Stop working');
      setCtrl(cMain, I.play, 'Start focus');
      cRight.hidden = true;
    }
  }

  function render() {
    const v = T.view();
    const c = curCat();
    const prev = phase;
    phase = v.phase;
    el.dataset.phase = v.phase;
    if (prev && prev !== v.phase) phaseChange(prev, v);
    el.classList.toggle('paused', !!v.paused);
    el.style.setProperty('--c', c.color);
    document.documentElement.style.setProperty('--cat', c.color);
    q('.cat-name').textContent = c.name;
    catPill.querySelector('.dot').style.setProperty('--dot', c.color);
    if (state.timer) {
      titleEl.textContent = state.timer.title || c.name;
      titleEl.classList.toggle('untitled', !state.timer.title);
      closeSuggest();
    } else if (document.activeElement !== intent) intent.value = d.title;
    q('.intent-clear').hidden = !intent.value;
    dial.setInteractive(v.phase === 'idle');
    if (v.phase === 'idle') dial.set(d.minutes);
    renderIdleMode();
    renderCtrls(v);
    renderDots();
    renderToday();
    renderZen();
    const tune = q('.tp-tune');
    const tuneKey = state.ui.muted ? 'off' : 'on';
    if (tune.dataset.k !== tuneKey) {
      tune.dataset.k = tuneKey;
      tune.innerHTML = state.ui.muted ? I.speakerOff : I.speaker;
      tune.title = state.ui.muted ? 'Sound is muted. Sound options' : 'Sound options';
      tune.classList.toggle('muted', state.ui.muted);
    }
    rangePill.disabled = v.phase === 'idle';
    renderTick(v);
  }

  // Choreography when the phase changes: content re-enters, a wash of the new
  // colour spreads from the main control, and the dial sweeps to its new value.
  function phaseChange(prev, v) {
    // In focus mode the full-screen view owns the transition; animating this
    // pane underneath at the same time is what produced the "ghosting".
    // (Returning home is animated by enter().)
    if (state.ui.view === 'timer') return;
    // Coming straight out of the breathe overlay: it is still covering this
    // pane, so don't stage a second transition underneath it.
    if (breathing()) return;
    el.classList.remove('phase-in');
    void el.offsetWidth;
    el.classList.add('phase-in');
    if (v.phase === 'idle') dial.sweep(0, d.minutes);
    else if (v.phase === 'focusOver') dial.sweep(0, Math.min(60, v.overMs / MIN));
    else if (v.phase === 'focus') dial.sweep(0, Math.min(60, v.remaining / MIN));
  }

  const zenBtn = q('.tp-zen');
  const reflectRow = q('.tp-reflect');
  function renderZen() {
    const zen = state.ui.zen;
    zenBtn.innerHTML = zen ? I.panel : I.focus;
    zenBtn.title = zen ? 'Show notes & calendar (Alt+Z)' : 'Focus mode (Alt+Z)';
    const r = T.reflectTarget();
    reflectRow.hidden = !(r && state.settings.reflection);
    if (r) reflectRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === r.mood));
  }
  zenBtn.addEventListener('click', () => {
    state.ui.zen = !state.ui.zen;
    emit('zen');
  });
  reflectRow.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    T.setMood(b.dataset.m);
    reflectRow.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });

  function renderTick(v = T.view()) {
    if (document.hidden) return;
    const t = state.timer;
    const at = T.now();
    if (v.phase === 'idle') {
      const m = Math.abs(d.minutes);
      roller.set(clockText(m * MIN), { animate: false });
      rangeText.textContent = `${hm(at)} → ${hm(at + m * MIN)}`;
      return;
    }
    if (v.phase === 'focus') {
      roller.set(clockText(v.remaining));
      setDial(Math.min(180, v.remaining / MIN));
      const end = at + v.remaining;
      rangeText.textContent = `${hm(t.start)} → ${hm(end)}`;
    } else if (v.phase === 'focusOver') {
      roller.set(clockText(v.overMs, true));
      setDial(Math.min(60, v.overMs / MIN));
      rangeText.textContent = `${hm(t.start)} → now`;
    } else {
      roller.set(v.over ? clockText(v.overMs, true) : clockText(v.remaining));
      q('.tp-breaklabel').textContent = v.over ? 'Break is over' : t.long ? 'Taking a long break' : 'Taking a break';
      rangeText.textContent = v.over ? `${hm(t.start)} → now` : `${hm(t.start)} → ${hm(at + v.remaining)}`;
    }
    renderCtrls(v);
  }

  // Small per-second steps snap; bigger jumps (+5 / -5, edits) glide.
  function setDial(min) {
    if (Math.abs(min - dial.value) > 0.4) dial.set(min);
    else dial.set(min, { instant: true });
  }

  // ---- intention + suggestions -------------------------------------------
  let sugItems = [];
  let sugIdx = -1;
  function closeSuggest() {
    suggest.classList.remove('open');
    sugItems = [];
    sugIdx = -1;
  }
  function renderSuggest() {
    if (state.timer || state.settings.suggestions === 'off') return closeSuggest();
    sugItems = suggestions(intent.value, d.categoryId);
    if (!sugItems.length) return closeSuggest();
    sugIdx = Math.min(sugIdx, sugItems.length - 1);
    suggest.innerHTML = sugItems
      .map((s, i) => `<button class="sug${i === sugIdx ? ' active' : ''}" data-i="${i}" style="--i:${i}" tabindex="-1"><span>${esc(s.title)}</span>${catPillHTML(cat(s.categoryId), 'sm')}</button>`)
      .join('');
    suggest.classList.add('open');
  }
  function pick(i) {
    const s = sugItems[i];
    if (!s) return;
    d.title = s.title;
    d.categoryId = s.categoryId;
    intent.value = s.title;
    closeSuggest();
    emit('timer');
  }
  suggest.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.sug');
    if (!b) return;
    e.preventDefault();
    pick(Number(b.dataset.i));
  });
  intent.addEventListener('focus', renderSuggest);
  intent.addEventListener('blur', () => setTimeout(closeSuggest, 80));
  intent.addEventListener('input', () => {
    // Apply "@category" / "30m" tokens as soon as they're completed with a space.
    if (/(^|\s)(@\S+|\d{1,3}\s*(h|hr|hrs|m|min|mins))\s$/i.test(intent.value)) {
      const p = parseIntention(intent.value);
      if (p.categoryId || p.minutes) {
        if (p.categoryId) d.categoryId = p.categoryId;
        if (p.minutes) d.minutes = Math.max(1, Math.min(180, p.minutes));
        intent.value = p.title ? p.title + ' ' : '';
        emit('timer');
      }
    }
    d.title = intent.value.trim();
    q('.intent-clear').hidden = !intent.value;
    sugIdx = -1;
    renderSuggest();
    save();
  });
  intent.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && sugItems.length) {
      e.preventDefault();
      sugIdx = (sugIdx + 1) % sugItems.length;
      renderSuggest();
    } else if (e.key === 'ArrowUp' && sugItems.length) {
      e.preventDefault();
      sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length;
      renderSuggest();
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (sugIdx >= 0) pick(sugIdx);
      else start();
    } else if (e.key === 'Escape') {
      if (sugItems.length) closeSuggest();
      else intent.blur();
      e.stopPropagation();
    }
  });
  q('.intent-clear').addEventListener('click', () => {
    intent.value = '';
    d.title = '';
    q('.intent-clear').hidden = true;
    intent.focus();
    save();
  });

  // ---- actions --------------------------------------------------------------
  function start() {
    if (state.timer) return;
    // The intention field is hidden on home, so sessions start untitled.
    if (!intent.offsetParent) intent.value = '';
    const p = parseIntention(intent.value);
    if (p.categoryId) d.categoryId = p.categoryId;
    if (p.minutes) d.minutes = Math.max(1, Math.min(180, p.minutes));
    d.title = p.title;
    intent.value = p.title;
    intent.blur();
    closeSuggest();
    if (state.settings.notifications) requestPermission();
    if (d.minutes < 0) T.startBreak(-d.minutes * MIN);
    else T.startFocus({ title: d.title, categoryId: draftCat(), durationMs: d.minutes * MIN });
  }
  startBtn.addEventListener('click', start);

  catPill.addEventListener('click', () => {
    openCategoryMenu(catPill, curCat().id, (id) => {
      if (state.timer) T.editActive({ categoryId: id });
      else {
        d.categoryId = id;
        emit('timer');
        if (state.settings.focusOnCategory) intent.focus();
      }
    }, { align: 'center' });
  });

  el.querySelectorAll('.adj').forEach((b) =>
    b.addEventListener('click', () => T.adjust(Number(b.dataset.d)))
  );

  rangePill.addEventListener('click', () => {
    if (!state.timer) return;
    const cur = Math.round(state.timer.durationMs / MIN);
    const opts = state.timer.kind === 'focus' ? [15, 20, 25, 30, 45, 50, 60, 90] : [5, 10, 15, 20, 30];
    openMenu(
      rangePill,
      [
        { header: 'Set duration' },
        ...opts.map((m) => ({ label: `${m} minutes`, right: m === cur ? '<span class="menu-tick">✓</span>' : '', onClick: () => T.setDuration(m) })),
      ],
      { width: 180 }
    );
  });

  function toggleMute() {
    state.ui.muted = !state.ui.muted;
    emit('sound');
    render();
  }

  cLeft.addEventListener('click', () => {
    if (phase === 'focus') T.takeBreak();
    else if (phase === 'focusOver') T.restart();
    else if (phase === 'break' || phase === 'breakOver') T.breakStop();
  });
  cMain.addEventListener('click', () => {
    if (phase === 'focus') T.pauseToggle();
    else if (phase === 'focusOver') T.takeBreak();
    else if (phase === 'break' || phase === 'breakOver') T.breakPlay();
  });
  cRight.addEventListener('click', () => {
    if (phase === 'focus' || phase === 'focusOver') openStopMenu();
  });
  function openStopMenu() {
    openMenu(
      cRight,
      [
        { label: 'Finish Session', icon: I.exit, onClick: T.finish },
        { sep: true },
        { label: 'Abandon Session', icon: I.close, danger: true, onClick: discardSession },
      ],
      { place: 'above', width: 260, className: 'menu-lg' }
    );
  }

  q('.tp-edit').addEventListener('click', openEditSession);
  q('.tp-tune').addEventListener('click', openTune);

  function openTune() {
    const v = T.view();
    const key = BG_KEY[v.phase];
    const label = { focus: 'Session', overflow: 'Overflow', break: 'Break', breakOver: 'Break overflow' }[key];
    openMenu(
      q('.tp-tune'),
      [
        { header: `Background sound · ${label}` },
        ...SOUNDS.map(([id, name]) => ({
          label: name,
          right: state.settings.bg[key] === id ? '<span class="menu-tick">✓</span>' : '',
          onClick: () => {
            state.settings.bg[key] = id;
            emit('settings');
            emit('sound');
          },
        })),
        { sep: true },
        { label: state.ui.muted ? 'Unmute' : 'Mute', icon: state.ui.muted ? I.speaker : I.speakerOff, onClick: toggleMute },
        { label: 'Sound settings…', onClick: () => emit('navigate', { view: 'settings', section: 'sound' }) },
      ],
      { align: 'end', width: 230 }
    );
  }

  function openEditSession() {
    const t = state.timer;
    if (!t) return;
    const startD = new Date(t.start);
    const body = html(`
      <div class="form">
        <label class="field"><span>Intention</span><input class="f-title" value="${esc(t.title)}" maxlength="140" placeholder="Intention"/></label>
        <label class="field"><span>Category</span><button class="cat-pill f-cat" type="button"><i class="dot"></i><span></span>${I.chevDown}</button></label>
        <label class="field"${t.kind === 'break' ? ' hidden' : ''}><span>Started at</span><input class="f-start" type="time" value="${pad(startD.getHours())}:${pad(startD.getMinutes())}"/></label>
      </div>`);
    let catId = t.categoryId;
    const catBtn = body.querySelector('.f-cat');
    const paint = () => {
      const c = cat(catId);
      catBtn.querySelector('span').textContent = c.name;
      catBtn.querySelector('.dot').style.setProperty('--dot', c.color);
    };
    paint();
    catBtn.onclick = () => openCategoryMenu(catBtn, catId, (id) => { catId = id; paint(); });
    const footer = html('<div class="row-btns"><button class="btn ghost">Cancel</button><button class="btn primary">Save</button></div>');
    const m = openModal({ title: t.kind === 'break' ? 'Up Next' : 'Edit Session', body, footer, width: 380 });
    const saveIt = () => {
      const [h, mi] = body.querySelector('.f-start').value.split(':').map(Number);
      const s = new Date(t.start);
      if (!Number.isNaN(h)) s.setHours(h, mi, 0, 0);
      const newStart = t.kind === 'break' ? t.start : Math.min(s.getTime(), T.now());
      T.editActive({ title: body.querySelector('.f-title').value.trim(), categoryId: catId, start: newStart });
      m.close();
    };
    footer.children[0].onclick = () => m.close();
    footer.children[1].onclick = saveIt;
    body.querySelector('.f-title').addEventListener('keydown', (e) => e.key === 'Enter' && saveIt());
    setTimeout(() => body.querySelector('.f-title').select(), 50);
  }

  on('timer', render);
  on('categories', render);
  setTimeout(() => (ctrlsReady = true), 0);
  on('sessions', renderDots);
  on('sessions', renderToday);
  on('minute', renderToday);
  on('dayChange', renderToday);
  on('settings', () => {
    renderDots();
    renderToday();
    render();
  });
  on('tick', renderTick);
  on('minute', () => renderTick());
  on('sound', render);
  on('zen', renderZen);
  on('sessions', renderZen);
  document.addEventListener('visibilitychange', () => !document.hidden && render());
  render();

  return {
    /** Home screen settling back in after focus mode closes. */
    enter() {
      el.classList.remove('home-in');
      void el.offsetWidth;
      el.classList.add('home-in');
      dial.sweep(0, d.minutes);
    },
    focusIntent() {
      if (!state.timer) intent.focus();
    },
    start,
    openCategory: () => state.settings.useCategories && catPill.click(),
    openStopMenu: () => (phase === 'focus' || phase === 'focusOver') && openStopMenu(),
    toggleMute,
  };
}
