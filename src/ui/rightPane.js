// Right pane: session notes + recent notes, and the day calendar.
import { state, emit, on, save, cat, focusMs, MOODS } from '../store.js';
import * as T from '../timer.js';
import { $, esc, html, hm, dur, durCaps, ago, dayStart, addDays, weekStart, sameDay, WD, MIN, HOUR, DAY } from '../util.js';
import { dayStats } from '../store.js';
import { I } from './icons.js';
import { openMenu, toast } from './overlay.js';
import { openBlockEditor } from './editors.js';
import { S, onScale } from '../scale.js';

const HOUR_PX = 96;

export function noteCardHTML(s, { showDate = false, i = 0 } = {}) {
  const c = cat(s.categoryId);
  const mood = s.type === 'break' ? '' : MOODS[s.mood]?.arrow || '';
  return `
  <article class="ncard${s.type === 'break' ? ' is-break' : ''}" data-id="${s.id}" style="--c:${c.color};--i:${i}">
    <span class="ncard-mood" title="${esc(MOODS[s.mood]?.label || '')}">${s.type === 'break' ? '<i class="bdot"></i>' : mood}</span>
    <span class="ncard-bar"></span>
    <div class="ncard-main">
      <div class="ncard-top">
        <div>
          <h4>${esc(s.type === 'break' ? 'Break' : s.title || c.name)}</h4>
          <time>${showDate ? `${hm(s.start)} → ${hm(s.end)}` : ago(s.end)}</time>
        </div>
        <div class="ncard-meta">
          ${s.type === 'break' ? '' : `<span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span>`}
          <b>${dur(focusMs(s))}</b>
        </div>
      </div>
      ${s.note ? `<div class="ncard-note"><p>${esc(s.note)}</p><button class="ncard-copy" title="Copy note" aria-label="Copy note">${I.copy}</button></div>` : ''}
    </div>
  </article>`;
}

export function bindCopy(container) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('.ncard-copy');
    if (!b) return;
    e.stopPropagation();
    const s = state.sessions.find((x) => x.id === b.closest('.ncard').dataset.id);
    if (s) navigator.clipboard?.writeText(s.note).then(() => toast('Note copied'), () => {});
  });
}

export function mountRightPane(root) {
  root.innerHTML = `
  <section class="rp" data-tab="${state.ui.rightTab}">
    <div class="rp-tabs" role="tablist">
      <i class="rp-tab-ind"></i>
      <button data-tab="today" role="tab">Today</button>
      <button data-tab="notes" role="tab">Notes</button>
      <button data-tab="calendar" role="tab">Calendar</button>
    </div>
    <div class="rp-body">
    <div class="rp-today"></div>
    <div class="rp-notes">
      <h2 class="rp-h">Notes</h2>
      <div class="rf-card" hidden>
        <div class="rf-text"><small>Session complete</small><b class="rf-title"></b><span class="rf-meta mono-sm"></span></div>
        <div class="rf-moods">
          <button data-m="focused"><span>🤩</span>Focused</button>
          <button data-m="neutral"><span>😐</span>Neutral</button>
          <button data-m="distracted"><span>😔</span>Distracted</button>
        </div>
      </div>
      <textarea class="note-area" placeholder="Write down your thoughts, your learning, or what you are confused about. Clarify your thoughts. Writing is thinking."></textarea>
      <div class="rn-head">
        <span class="rn-title">Recent Notes</span>
        <button class="chip" data-f="break"><i class="radio"></i>Break</button>
        <button class="chip" data-f="cat"><i class="radio"></i>Current category only</button>
      </div>
      <div class="rn-list"></div>
    </div>
    <div class="rp-cal">
      <div class="cal-top">
        <div class="cal-nav">
          <button class="sq cal-prev" aria-label="Previous day">${I.chevLeft}</button>
          <button class="cal-today">Today</button>
          <button class="sq cal-next" aria-label="Next day">${I.chevRight}</button>
        </div>
        <div class="week"></div>
      </div>
      <div class="cal-sum mono"></div>
      <div class="cal-mini"><div class="mini-track"><div class="mini-view"></div><div class="mini-segs"></div></div></div>
      <div class="cal-scroll">
        <div class="cal-grid" style="height:${HOUR_PX * 24}px">
          <div class="cal-hours"></div>
          <div class="cal-blocks"></div>
          <div class="cal-ghost" hidden></div>
          <div class="now-line"><span class="now-time"></span></div>
        </div>
      </div>
      <div class="cal-empty" hidden>
        <span class="cal-empty-ic">${I.calPlus}</span>
        <b>Nothing planned yet</b>
        <small>Drag on the calendar to block out study time.<br/>Finished sessions show up here too.</small>
        <button class="btn sm cal-empty-btn">Plan a block</button>
      </div>
      <button class="fab" aria-label="New event" title="New event">${I.plus}</button>
    </div>
    </div>
  </section>`;
  const el = root.firstElementChild;
  const q = (s) => $(s, el);

  let scrolledOnce = false;
  const tabInd = q('.rp-tab-ind');
  function moveTabInd() {
    const b = q(`.rp-tabs button[data-tab="${el.dataset.tab}"]`);
    if (!b || !b.offsetWidth) return;
    tabInd.style.width = b.offsetWidth + 'px';
    tabInd.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  // ---- tab switch --------------------------------------------------------
  function setTab(tab) {
    if (!['today', 'notes', 'calendar'].includes(tab)) tab = 'today';
    state.ui.rightTab = tab;
    el.dataset.tab = tab;
    el.querySelectorAll('.rp-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    moveTabInd();
    if (tab === 'today') renderToday();
    else if (tab === 'calendar') {
      animDay = null;
      renderCalendar();
      if (!scrolledOnce) {
        scrolledOnce = true;
        requestAnimationFrame(() => scrollToNow());
      }
    } else renderNotes();
    save();
  }
  q('.rp-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  requestAnimationFrame(moveTabInd);
  onScale(moveTabInd);

  // ---- today: progress, what's planned, what's done ---------------------------
  const todayEl = q('.rp-today');
  function renderToday() {
    if (el.dataset.tab !== 'today') return;
    const now = Date.now();
    const d0 = dayStart(now);
    const { ms, streak, count } = dayStats(now);
    const planned = state.planned.filter((p) => p.end > now && p.start < d0 + DAY).sort((a, b) => a.start - b.start);
    const done = state.sessions.filter((x) => x.type === 'focus' && x.start >= d0 && x.start < d0 + DAY).sort((a, b) => b.start - a.start);
    const row = (kind, r, i) => {
      const c = cat(r.categoryId);
      const len = kind === 'plan' ? r.end - r.start : focusMs(r);
      return `<button class="ag-row ${kind}" data-kind="${kind}" data-id="${r.id}" style="--c:${c.color};--i:${i}">
        <i class="ag-dot"></i>
        <span class="ag-main"><b>${esc(r.title || c.name)}</b><small>${hm(r.start)} – ${hm(r.end)}${state.settings.useCategories ? ` · ${esc(c.name)}` : ''}</small></span>
        <em>${kind === 'plan' ? (r.start <= now ? 'Now' : 'Start') : dur(len)}</em>
      </button>`;
    };
    todayEl.innerHTML = `
      <div class="td-head">
        <div class="td-stat"><b>${count ? dur(ms) : '0 min'}</b><small>focused today</small></div>
        <div class="td-stat"><b>${count}</b><small>${count === 1 ? 'session' : 'sessions'}</small></div>
        <div class="td-stat"><b>${streak}</b><small>day streak</small></div>
      </div>
      <div class="td-sec">
        <div class="td-h"><span>Planned</span><button class="td-add">${I.plus}Plan a block</button></div>
        ${planned.map((p, i) => row('plan', p, i)).join('')}
      </div>
      ${done.length ? `<div class="td-sec">
        <div class="td-h"><span>Done</span></div>
        ${done.map((x, i) => row('done', x, i + planned.length)).join('')}
      </div>` : ''}`;
  }
  todayEl.addEventListener('click', (e) => {
    if (e.target.closest('.td-add')) return q('.fab').click();
    const r = e.target.closest('.ag-row');
    if (!r) return;
    if (r.dataset.kind === 'plan') {
      const p = state.planned.find((x) => x.id === r.dataset.id);
      if (!p) return;
      if (state.timer) return toast('Finish the current session first');
      const mins = Math.max(5, Math.min(180, Math.round((p.end - Math.max(p.start, Date.now())) / MIN / 5) * 5));
      return T.startFocus({ title: p.title, categoryId: p.categoryId, durationMs: mins * MIN });
    }
    const x = state.sessions.find((s2) => s2.id === r.dataset.id);
    if (x) openBlockEditor({ kind: 'session', rec: x });
  });

  // ---- notes ---------------------------------------------------------------
  const area = q('.note-area');
  const list = q('.rn-list');
  area.addEventListener('input', () => T.setNote(area.value));
  const PH = area.placeholder;
  const rfCard = q('.rf-card');
  function syncArea() {
    const r = T.reflectTarget();
    const v = r ? r.note : state.timer ? state.timer.note : state.ui.draft.note;
    if (document.activeElement !== area && area.value !== (v || '')) area.value = v || '';
    area.placeholder = r ? `What did you learn while working on “${r.title || cat(r.categoryId).name}”? What's left to do?` : PH;
    // Inline reflection while on a break.
    const show = !!r && state.settings.reflection;
    if (show) {
      const c = cat(r.categoryId);
      rfCard.style.setProperty('--c', c.color);
      q('.rf-title').textContent = r.title || c.name;
      q('.rf-meta').textContent = `${hm(r.start)} → ${hm(r.end)} · ${dur(focusMs(r)).toUpperCase()} · How was your focus?`;
      rfCard.querySelectorAll('.rf-moods button').forEach((b) => b.classList.toggle('on', b.dataset.m === r.mood));
    }
    if (rfCard.hidden === show) {
      rfCard.hidden = !show;
      if (show) {
        rfCard.classList.remove('enter');
        void rfCard.offsetWidth;
        rfCard.classList.add('enter');
      }
    }
  }
  rfCard.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    T.setMood(b.dataset.m);
    rfCard.querySelectorAll('.rf-moods button').forEach((x) => x.classList.toggle('on', x === b));
  });
  area.addEventListener('blur', () => T.reflectTarget() && renderNotes());
  const f = state.ui.notesFilter;
  el.querySelectorAll('.chip').forEach((b) => {
    b.classList.toggle('on', !!f[b.dataset.f]);
    b.addEventListener('click', () => {
      f[b.dataset.f] = !f[b.dataset.f];
      b.classList.toggle('on', f[b.dataset.f]);
      renderNotes();
      save();
    });
  });
  function renderNotes() {
    syncArea();
    if (el.dataset.tab !== 'notes') return;
    const curCat = state.timer ? state.timer.categoryId : state.ui.draft.categoryId;
    const justDone = T.reflectTarget()?.id;
    const items = state.sessions
      .filter((s) => (s.note || s.id === justDone) && (f.break || s.type !== 'break') && (!f.cat || s.categoryId === curCat))
      .sort((a, b) => b.end - a.end)
      .slice(0, 60);
    list.innerHTML = items.length
      ? items.map((s, i) => noteCardHTML(s, { i })).join('')
      : `<div class="empty big">${I.note}<p>No notes yet.<br/><small>Jot down what you learned or where you got stuck during a session. They’ll be collected here.</small></p></div>`;
  }
  bindCopy(list);
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.ncard');
    if (!card) return;
    const s = state.sessions.find((x) => x.id === card.dataset.id);
    if (s) openBlockEditor({ kind: 'session', rec: s });
  });

  // ---- calendar --------------------------------------------------------------
  let day = dayStart(Date.now());
  const scroller = q('.cal-scroll');
  const blocks = q('.cal-blocks');
  const nowLine = q('.now-line');
  const week = q('.week');
  const hours = q('.cal-hours');
  hours.innerHTML = Array.from({ length: 24 }, (_, h) =>
    `<div class="hr" style="top:${h * HOUR_PX}px"><span>${String(h).padStart(2, '0')}:00</span></div>`
  ).join('');

  function dayItems(d) {
    const a = d;
    const b = d + DAY;
    const sessions = state.sessions.filter((s) => s.start < b && s.end > a);
    const planned = state.planned.filter((s) => s.start < b && s.end > a);
    return { sessions, planned };
  }

  function renderWeek() {
    const ws = weekStart(day, state.settings.weekMonday);
    const today = dayStart(Date.now());
    let s = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const dt = new Date(d);
      s += `<button class="wd${d === day ? ' on' : ''}${d === today ? ' today' : ''}" data-d="${d}"><small>${WD[dt.getDay()]}</small><b>${dt.getDate()}</b></button>`;
    }
    week.innerHTML = s;
    q('.cal-today').textContent = day === today ? 'Today' : new Date(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  week.addEventListener('click', (e) => {
    const b = e.target.closest('.wd');
    if (b) goDay(Number(b.dataset.d));
  });
  q('.cal-prev').onclick = () => goDay(addDays(day, -1));
  q('.cal-next').onclick = () => goDay(addDays(day, 1));
  q('.cal-today').onclick = () => goDay(dayStart(Date.now()), true);
  function goDay(d, scrollNow = false) {
    day = d;
    renderCalendar();
    if (scrollNow) scrollToNow(true);
  }

  const y = (ts) => ((ts - day) / HOUR) * HOUR_PX;
  let animDay = null;

  function renderCalendar() {
    if (el.dataset.tab !== 'calendar') return;
    renderWeek();
    const { sessions, planned } = dayItems(day);
    const focus = sessions.filter((s) => s.type === 'focus');
    const m = { focused: 0, neutral: 0, distracted: 0 };
    for (const s of focus) if (m[s.mood] != null) m[s.mood]++;
    const total = focus.reduce((a, s) => a + focusMs(s), 0);
    q('.cal-sum').textContent = `${m.focused}↑ · ${m.neutral}→ · ${m.distracted}↓  ${durCaps(total)} FOCUS`;

    let out = '';
    let bi = 0;
    blocks.classList.toggle('static', animDay === day);
    animDay = day;
    for (const p of planned) {
      const c = cat(p.categoryId);
      const top = Math.max(0, y(p.start));
      const h = Math.max(18, Math.min(HOUR_PX * 24, y(p.end)) - top);
      out += `<div class="blk planned${h < 44 ? ' tiny' : ''}" data-kind="planned" data-id="${p.id}" style="top:${top}px;height:${h}px;--c:${c.color};--i:${bi++}">
        <div class="blk-in"><small>${hm(p.start)}</small><b>${esc(p.title || 'Untitled')}</b><span>Planning</span></div><em>${dur(p.end - p.start)}</em></div>`;
    }
    for (const s of sessions) {
      const c = cat(s.categoryId);
      const top = Math.max(0, y(s.start));
      const h = Math.max(6, Math.min(HOUR_PX * 24, y(s.end)) - top);
      const brk = s.type === 'break';
      out += `<div class="blk sess${brk ? ' brk' : ''}${h < 44 ? ' tiny' : ''}" data-kind="session" data-id="${s.id}" style="top:${top}px;height:${h}px;--c:${c.color};--i:${bi++}">
        <div class="blk-in"><small>${hm(s.start)}</small><b>${esc(brk ? 'Break' : s.title || c.name)}</b>${brk ? '' : `<span>${esc(c.name)}</span>`}</div><em>${dur(focusMs(s))}</em></div>`;
    }
    const t = state.timer;
    if (t && t.start < day + DAY && T.now() > day) {
      const c = cat(t.categoryId);
      const top = Math.max(0, y(t.start));
      const end = Math.max(T.now(), t.start + MIN);
      const h = Math.max(10, y(end) - top);
      out += `<div class="blk live${t.kind === 'break' ? ' brk' : ''}" data-kind="live" style="top:${top}px;height:${h}px;--c:${c.color}"></div>`;
    }
    blocks.innerHTML = out;
    const emptyEl = q('.cal-empty');
    const isEmpty = !planned.length && !sessions.length && !t && day >= dayStart(Date.now());
    if (emptyEl.hidden === isEmpty) {
      emptyEl.hidden = !isEmpty;
      if (isEmpty) {
        emptyEl.classList.remove('in');
        void emptyEl.offsetWidth;
        emptyEl.classList.add('in');
      }
    }
    renderNow();
    renderMini(sessions);
  }

  function renderNow() {
    const now = Date.now();
    const show = sameDay(now, day);
    nowLine.hidden = !show;
    if (!show) return;
    nowLine.style.transform = `translateY(${y(now)}px)`;
    q('.now-time').textContent = hm(now);
  }

  // Minimap of the whole day + the visible window.
  const miniSegs = q('.mini-segs');
  const miniView = q('.mini-view');
  function renderMini(sessions) {
    miniSegs.innerHTML = sessions
      .map((s) => {
        const a = Math.max(0, (s.start - day) / DAY) * 100;
        const b = Math.min(1, (s.end - day) / DAY) * 100;
        return `<i style="left:${a}%;width:${Math.max(0.6, b - a)}%;--c:${s.type === 'break' ? '#8a8a8a' : cat(s.categoryId).color}"></i>`;
      })
      .join('');
    renderMiniView();
  }
  let miniRaf = 0;
  function renderMiniView() {
    miniRaf = 0;
    const total = HOUR_PX * 24;
    miniView.style.left = (scroller.scrollTop / total) * 100 + '%';
    miniView.style.width = (scroller.clientHeight / total) * 100 + '%';
  }
  scroller.addEventListener('scroll', () => {
    if (!miniRaf) miniRaf = requestAnimationFrame(renderMiniView);
  }, { passive: true });
  q('.cal-mini').addEventListener('click', (e) => {
    const r = q('.mini-track').getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    scroller.scrollTo({ top: frac * HOUR_PX * 24 - scroller.clientHeight / 2, behavior: 'smooth' });
  });

  function scrollToNow(smooth = false) {
    const target = sameDay(Date.now(), day) ? y(Date.now()) - scroller.clientHeight * 0.35 : 8 * HOUR_PX;
    scroller.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  // Click / drag on empty space to create; click a block for actions.
  const ghost = q('.cal-ghost');
  const grid = q('.cal-grid');
  let drag = null;
  const snapTs = (clientY) => {
    const r = grid.getBoundingClientRect();
    const mins = ((clientY - r.top) / S / HOUR_PX) * 60;
    return day + Math.max(0, Math.min(24 * 60, Math.round(mins / 15) * 15)) * MIN;
  };
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.blk')) return;
    const r = grid.getBoundingClientRect();
    if ((e.clientX - r.left) / S < 52) return;
    drag = { a: snapTs(e.clientY), b: null, y0: e.clientY, id: e.pointerId };
    grid.setPointerCapture(e.pointerId);
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.abs(e.clientY - drag.y0) < 6 && drag.b == null) return;
    drag.b = snapTs(e.clientY);
    const a = Math.min(drag.a, drag.b);
    const b = Math.max(drag.a, drag.b, a + 15 * MIN);
    ghost.hidden = false;
    ghost.style.top = y(a) + 'px';
    ghost.style.height = y(b) - y(a) + 'px';
    ghost.textContent = `${hm(a)} → ${hm(b)}`;
  });
  grid.addEventListener('pointerup', () => {
    if (!drag) return;
    const { a: a0, b: b0 } = drag;
    drag = null;
    ghost.hidden = true;
    let a = a0;
    let b = a0 + 30 * MIN;
    if (b0 != null) {
      a = Math.min(a0, b0);
      b = Math.max(a0, b0, a + 15 * MIN);
    }
    openBlockEditor({ kind: 'planned', start: a, end: b });
  });
  grid.addEventListener('pointercancel', () => {
    drag = null;
    ghost.hidden = true;
  });

  blocks.addEventListener('click', (e) => {
    const b = e.target.closest('.blk');
    if (!b) return;
    if (b.dataset.kind === 'live') return emit('navigate', { view: 'timer' });
    const isPlanned = b.dataset.kind === 'planned';
    const rec = (isPlanned ? state.planned : state.sessions).find((x) => x.id === b.dataset.id);
    if (!rec) return;
    const c = cat(rec.categoryId);
    const header = `<div class="menu-event" style="--c:${isPlanned ? '#bdbdbd' : c.color}"><i></i><div><b>${esc(rec.title || (rec.type === 'break' ? 'Break' : c.name))}</b><small>${isPlanned ? 'Planning' : esc(c.name)}</small><span class="mono-sm">${hm(rec.start)} → ${hm(rec.end)}</span></div><em>${dur(isPlanned ? rec.end - rec.start : focusMs(rec))}</em></div>`;
    const startIt = () => {
      if (state.timer) return toast('Finish the current Session first');
      const mins = isPlanned ? Math.max(5, Math.min(60, Math.round((rec.end - rec.start) / MIN / 5) * 5)) : state.settings.sessionMin;
      T.startFocus({ title: rec.title, categoryId: rec.categoryId, durationMs: mins * MIN });
    };
    openMenu(
      b,
      [
        { header },
        { label: 'Start Session', icon: I.play, onClick: startIt, disabled: rec.type === 'break' },
        { label: isPlanned ? 'Edit calendar event' : 'Edit Session', icon: I.compose, onClick: () => openBlockEditor({ kind: isPlanned ? 'planned' : 'session', rec }) },
        {
          label: isPlanned ? 'Delete calendar event' : 'Delete Session',
          icon: I.trash,
          danger: true,
          onClick: () => {
            const key = isPlanned ? 'planned' : 'sessions';
            const before = state[key];
            state[key] = before.filter((x) => x !== rec);
            emit(key);
            toast(isPlanned ? 'Event deleted' : 'Session deleted', {
              action: 'Undo',
              onAction: () => {
                if (!state[key].includes(rec)) state[key] = [...state[key], rec].sort((a, b) => a.start - b.start);
                emit(key);
              },
            });
          },
        },
      ],
      { width: 300, className: 'menu-lg' }
    );
  });

  q('.fab').addEventListener('click', () => {
    const now = Date.now();
    const base = sameDay(now, day) ? now : day + 9 * HOUR;
    const a = Math.ceil(base / (15 * MIN)) * 15 * MIN;
    openBlockEditor({ kind: 'planned', start: a, end: a + 30 * MIN });
  });

  q('.cal-empty-btn').addEventListener('click', () => q('.fab').click());

  // ---- wiring ------------------------------------------------------------------
  let lastPhase = T.view().phase;
  on('timer', () => {
    const p = T.view().phase;
    const wasIdle = lastPhase === 'idle';
    if (wasIdle && p !== 'idle') setTab('notes');
    else if (!wasIdle && p === 'idle') {
      area.value = '';
      // Back home: today's progress, with the session you just logged.
      setTab('today');
    }
    lastPhase = p;
    syncArea();
    renderCalendar();
    renderNotes();
  });
  on('sessions', () => {
    renderCalendar();
    renderNotes();
    renderToday();
  });
  on('planned', () => {
    renderCalendar();
    renderToday();
  });
  on('dayChange', renderToday);
  on('categories', () => {
    renderCalendar();
    renderNotes();
  });
  on('settings', () => {
    renderCalendar();
    renderToday();
  });
  on('minute', () => {
    renderToday();
    if (el.dataset.tab === 'calendar') {
      if (state.timer) renderCalendar();
      else renderNow();
    }
  });
  on('dayChange', () => goDay(dayStart(Date.now())));

  setTab(state.timer ? state.ui.rightTab : 'today');

  return { setTab, focusNotes: () => { setTab('notes'); area.focus(); } };
}
