// Profile view (lifetime stats + yearly heatmap + categories) and Journal view (all notes).
import { state, on, cat, focusMs } from '../store.js';
import { $, esc, html, dur, durTight, dayStart, addDays, weekStart, longDate, MONTHS, DAY } from '../util.js';
import { I } from './icons.js';
import { openCategories } from './categories.js';
import { noteCardHTML, bindCopy } from './rightPane.js';
import { openBlockEditor } from './editors.js';

function streaks() {
  const days = new Set(state.sessions.filter((s) => s.type === 'focus').map((s) => dayStart(s.start)));
  let cur = 0;
  let d = dayStart(Date.now());
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) {
    cur++;
    d = addDays(d, -1);
  }
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const x of sorted) {
    run = prev != null && Math.round((x - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { cur, best, days: days.size };
}

export function mountProfile(root) {
  root.innerHTML = `<section class="pf"><div class="pf-in"></div></section>`;
  const inner = $('.pf-in', root);
  let dirty = true;

  function render() {
    if (root.offsetParent === null) {
      dirty = true;
      return;
    }
    dirty = false;
    const F = state.sessions.filter((s) => s.type === 'focus');
    const total = F.reduce((t, s) => t + focusMs(s), 0);
    const st = streaks();
    // 26-week heatmap
    const end = dayStart(Date.now());
    const start = weekStart(addDays(end, -7 * 25), state.settings.weekMonday);
    const perDay = new Map();
    for (const s of F) {
      const d = dayStart(s.start);
      if (d >= start) perDay.set(d, (perDay.get(d) || 0) + focusMs(s));
    }
    let cells = '';
    let months = '';
    let lastMonth = -1;
    for (let w = 0; w < 26; w++) {
      const ws = addDays(start, w * 7);
      const m = new Date(ws).getMonth();
      months += `<span>${m !== lastMonth ? MONTHS[m].slice(0, 3) : ''}</span>`;
      lastMonth = m;
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        const ms = perDay.get(d) || 0;
        const lvl = d > end ? -1 : ms === 0 ? 0 : ms < 3_600_000 ? 1 : ms < 7_200_000 ? 2 : ms < 14_400_000 ? 3 : 4;
        cells += `<i class="l${lvl}" title="${new Date(d).toDateString()} · ${dur(ms)}"></i>`;
      }
    }
    const perCat = {};
    for (const s of F) perCat[s.categoryId] = (perCat[s.categoryId] || 0) + focusMs(s);

    inner.innerHTML = `
      <h1 class="view-h">Profile</h1>
      <div class="card stats four">
        <div class="stat"><b>${durTight(total)}</b><small>TOTAL FOCUS</small></div>
        <div class="stat"><b>${F.length}</b><small>SESSIONS</small></div>
        <div class="stat"><b>${st.cur}</b><small>DAY STREAK</small></div>
        <div class="stat"><b>${st.best}</b><small>BEST STREAK</small></div>
      </div>
      <div class="card">
        <div class="card-title">Last 6 months</div>
        <div class="heat"><div class="heat-m">${months}</div><div class="heat-g">${cells}</div></div>
        <div class="heat-legend"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div>
      </div>
      <div class="card">
        <div class="card-title">Categories <button class="link-btn pf-cats">Manage</button></div>
        <div class="pf-cat-list">
          ${state.categories.map((c, i) => `<div class="pf-cat" style="--i:${i}"><span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span><b>${dur(perCat[c.id] || 0)}</b></div>`).join('')}
        </div>
      </div>`;
    $('.pf-cats', inner).onclick = openCategories;
  }
  on('sessions', render);
  on('categories', render);
  return { show: () => render() };
}

export function mountJournal(root) {
  root.innerHTML = `
    <section class="jr">
      <div class="jr-in">
        <div class="jr-head"><h1 class="view-h">Journal</h1><label class="jr-search">${I.search}<input placeholder="Search notes" aria-label="Search notes"/></label></div>
        <div class="jr-list"></div>
      </div>
    </section>`;
  const list = $('.jr-list', root);
  const input = $('.jr-search input', root);
  let limit = 40;

  function render() {
    if (root.offsetParent === null) return;
    const qv = input.value.trim().toLowerCase();
    const items = state.sessions
      .filter((s) => s.note && (!qv || s.note.toLowerCase().includes(qv) || (s.title || '').toLowerCase().includes(qv)))
      .sort((a, b) => b.start - a.start);
    if (!items.length) {
      list.innerHTML = `<div class="empty big">${I.book}<p>${qv ? 'No notes match your search.' : 'Your notes and reflections will be collected here.'}</p></div>`;
      return;
    }
    let out = '';
    let last = null;
    let n = 0;
    for (const s of items.slice(0, limit)) {
      const d = dayStart(s.start);
      if (d !== last) {
        if (last !== null) out += '</div>';
        out += `<div class="lday-h">${longDate(d)}</div><div class="jr-day">`;
        last = d;
      }
      out += noteCardHTML(s, { showDate: true, i: Math.min(n++, 12) });
    }
    out += '</div>';
    if (items.length > limit) out += '<button class="btn ghost jr-more">Show more</button>';
    list.innerHTML = out;
  }
  input.addEventListener('input', () => {
    limit = 40;
    render();
  });
  bindCopy(list);
  list.addEventListener('click', (e) => {
    if (e.target.closest('.jr-more')) {
      limit += 40;
      return render();
    }
    const card = e.target.closest('.ncard');
    const s = card && state.sessions.find((x) => x.id === card.dataset.id);
    if (s) openBlockEditor({ kind: 'session', rec: s });
  });
  on('sessions', render);
  on('categories', render);
  return { show: render, focus: () => input.focus() };
}
