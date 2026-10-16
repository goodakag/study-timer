// Analytics view: period stats, distribution chart, category table, session log.
import { state, on, cat, focusMs, MOODS } from '../store.js';
import { $, esc, html, hm, dur, durTight, dayStart, addDays, weekStart, monthStart, addMonths, longDate, MONTHS, WD, DAY, HOUR, MIN, pad, download } from '../util.js';
import { I } from './icons.js';
import { openMenu } from './overlay.js';
import { openBlockEditor } from './editors.js';
import { toCSV } from './data.js';

const MODES = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };

function rangeOf(mode, anchor, monday) {
  if (mode === 'day') {
    const a = dayStart(anchor);
    return [a, addDays(a, 1)];
  }
  if (mode === 'week') {
    const a = weekStart(anchor, monday);
    return [a, addDays(a, 7)];
  }
  if (mode === 'month') {
    const a = monthStart(anchor);
    return [a, addMonths(a, 1)];
  }
  const y = new Date(anchor).getFullYear();
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
}
function shift(mode, anchor, n) {
  if (mode === 'day') return addDays(anchor, n);
  if (mode === 'week') return addDays(anchor, 7 * n);
  if (mode === 'month') return addMonths(anchor, n);
  const d = new Date(anchor);
  return new Date(d.getFullYear() + n, 0, 1).getTime();
}
function chipText(mode, a) {
  const d = new Date(a);
  if (mode === 'day') return [`${WD[d.getDay()]}`, `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`];
  if (mode === 'week') {
    const e = new Date(addDays(a, 6));
    return [`${d.getFullYear()}`, `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()} – ${e.getDate()}`];
  }
  if (mode === 'month') return [`${d.getFullYear()}`, MONTHS[d.getMonth()]];
  return ['', `${d.getFullYear()}`];
}
function titleText(mode, a, monday) {
  const [cur] = rangeOf(mode, Date.now(), monday);
  const [prev] = rangeOf(mode, shift(mode, Date.now(), -1), monday);
  const names = { day: ['Today', 'Yesterday'], week: ['This week', 'Last week'], month: ['This month', 'Last month'], year: ['This year', 'Last year'] }[mode];
  if (a === cur) return names[0];
  if (a === prev) return names[1];
  return chipText(mode, a).filter(Boolean).reverse().join(' ');
}
function bucketName(h) {
  if (h < 5) return 'Night';
  if (h < 11) return 'Morning';
  if (h < 14) return 'Noon';
  if (h < 18) return 'Afternoon';
  if (h < 22) return 'Evening';
  return 'Night';
}
function pct(cur, prev) {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / prev) * 100);
}
function delta(p) {
  if (p === null || p === 0 || !Number.isFinite(p)) return '<span class="delta"> </span>';
  return `<span class="delta ${p > 0 ? 'up' : 'down'}">${Math.abs(p)}% ${p > 0 ? '↑' : '↓'}</span>`;
}

export function mountAnalytics(root) {
  root.innerHTML = `
  <section class="an">
    <header class="an-top">
      <div class="an-nav">
        <button class="sq an-prev" aria-label="Previous">${I.chevLeft}</button>
        <button class="an-mode"><span></span>${I.updown}</button>
        <button class="sq an-next" aria-label="Next">${I.chevRight}</button>
      </div>
      <button class="icon-btn an-export" title="Export" aria-label="Export">${I.share}</button>
      <div class="an-chips"></div>
    </header>
    <div class="an-bar">
      <button class="toggle-chip an-notes"><i class="radio"></i>Show notes only</button>
      <button class="pill-btn an-filter">Filter ${I.chevDown}</button>
    </div>
    <div class="an-body">
      <div class="an-left"></div>
      <div class="an-right"></div>
    </div>
  </section>`;
  const el = root.firstElementChild;
  const q = (s) => $(s, el);
  const ui = { mode: 'month', anchor: Date.now(), notesOnly: false, cats: new Set(), moods: new Set(), limit: 21 };
  let dirty = true;

  q('.an-prev').onclick = () => go(shift(ui.mode, ui.anchor, -1));
  q('.an-next').onclick = () => go(shift(ui.mode, ui.anchor, 1));
  q('.an-mode').onclick = () =>
    openMenu(q('.an-mode'), Object.entries(MODES).map(([k, v]) => ({
      label: v,
      right: k === ui.mode ? '<span class="menu-tick">✓</span>' : '',
      onClick: () => { ui.mode = k; go(Date.now()); },
    })), { width: 160 });
  q('.an-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.an-chip');
    if (b) go(Number(b.dataset.a));
  });
  q('.an-notes').onclick = () => {
    ui.notesOnly = !ui.notesOnly;
    q('.an-notes').classList.toggle('on', ui.notesOnly);
    render();
  };
  q('.an-filter').onclick = () => {
    openMenu(q('.an-filter'), [
      { header: 'Category' },
      ...state.categories.map((c) => ({
        label: c.name, dot: c.color,
        right: ui.cats.has(c.id) ? '<span class="menu-tick">✓</span>' : '',
        onClick: () => { ui.cats.has(c.id) ? ui.cats.delete(c.id) : ui.cats.add(c.id); render(); },
      })),
      { header: 'Focus state' },
      ...Object.entries(MOODS).map(([k, m]) => ({
        label: `${m.emoji} ${m.label}`,
        right: ui.moods.has(k) ? '<span class="menu-tick">✓</span>' : '',
        onClick: () => { ui.moods.has(k) ? ui.moods.delete(k) : ui.moods.add(k); render(); },
      })),
      { sep: true },
      { label: 'Clear filters', onClick: () => { ui.cats.clear(); ui.moods.clear(); render(); } },
    ], { align: 'end', width: 220 });
  };
  q('.an-export').onclick = () =>
    openMenu(q('.an-export'), [
      { label: 'Export CSV', icon: I.download, onClick: () => download(`session-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(state.sessions), 'text/csv') },
      { label: 'Export JSON', icon: I.download, onClick: () => download(`session-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ sessions: state.sessions, categories: state.categories, planned: state.planned }, null, 2)) },
    ], { align: 'end', width: 200 });

  function go(anchor) {
    ui.anchor = anchor;
    ui.limit = 21;
    render();
  }

  const left = q('.an-left');
  const right = q('.an-right');
  right.addEventListener('click', (e) => {
    if (e.target.closest('.an-more')) {
      ui.limit += 30;
      return render();
    }
    const row = e.target.closest('.lrow');
    if (!row) return;
    const s = state.sessions.find((x) => x.id === row.dataset.id);
    if (s) openBlockEditor({ kind: 'session', rec: s });
  });

  function pass(s) {
    if (ui.cats.size && !ui.cats.has(s.categoryId)) return false;
    if (ui.moods.size && s.type === 'focus' && !ui.moods.has(s.mood)) return false;
    return true;
  }

  function render() {
    if (!el.isConnected || el.offsetParent === null) {
      dirty = true;
      return;
    }
    dirty = false;
    const monday = state.settings.weekMonday;
    const [a, b] = rangeOf(ui.mode, ui.anchor, monday);
    const [pa, pb] = rangeOf(ui.mode, shift(ui.mode, ui.anchor, -1), monday);
    q('.an-mode span').textContent = titleText(ui.mode, a, monday);
    q('.an-filter').classList.toggle('on', ui.cats.size + ui.moods.size > 0);

    // chips
    let chips = '';
    for (let i = -2; i <= 2; i++) {
      const [ca] = rangeOf(ui.mode, shift(ui.mode, a, i), monday);
      const [small, big] = chipText(ui.mode, ca);
      chips += `<button class="an-chip${i === 0 ? ' on' : ''}" data-a="${ca}"><small>${small}</small><span>${big}</span></button>`;
    }
    q('.an-chips').innerHTML = chips;

    const inR = (s, x, y) => s.start >= x && s.start < y && pass(s);
    const cur = state.sessions.filter((s) => inR(s, a, b));
    const prev = state.sessions.filter((s) => inR(s, pa, pb));
    const F = cur.filter((s) => s.type === 'focus');
    const B = cur.filter((s) => s.type === 'break');
    const PF = prev.filter((s) => s.type === 'focus');
    const PB = prev.filter((s) => s.type === 'break');
    const sum = (arr) => arr.reduce((t, s) => t + focusMs(s), 0);
    const tf = sum(F), tb = sum(B), ptf = sum(PF), ptb = sum(PB);
    const now = Date.now();
    const days = Math.max(1, Math.ceil((Math.min(b, Math.max(now, a + 1)) - a) / DAY));
    const pdays = Math.max(1, Math.round((pb - pa) / DAY));
    const byBucket = (arr) => {
      const m = {};
      for (const s of arr) {
        const k = bucketName(new Date(s.start).getHours());
        m[k] = (m[k] || 0) + focusMs(s);
      }
      const top = Object.entries(m).sort((x, y) => y[1] - x[1])[0];
      return top ? top[0] : '-';
    };
    const moods = { focused: 0, neutral: 0, distracted: 0 };
    const pmoods = { focused: 0, neutral: 0, distracted: 0 };
    for (const s of F) if (moods[s.mood] != null) moods[s.mood]++;
    for (const s of PF) if (pmoods[s.mood] != null) pmoods[s.mood]++;
    const ratio = tb ? `${(tf / tb).toFixed(1)}/1` : '-';
    const pratio = ptb ? ptf / ptb : 0;

    // distribution bins
    let bins = [];
    if (ui.mode === 'day') bins = Array.from({ length: 24 }, (_, h) => ({ a: a + h * HOUR, b: a + (h + 1) * HOUR, label: pad(h) }));
    else if (ui.mode === 'year') bins = Array.from({ length: 12 }, (_, m) => ({ a: addMonths(a, m), b: addMonths(a, m + 1), label: MONTHS[m].slice(0, 1) }));
    else {
      for (let d = a; d < b; d = addDays(d, 1)) {
        const dt = new Date(d);
        bins.push({ a: d, b: addDays(d, 1), label: ui.mode === 'week' ? WD[dt.getDay()].slice(0, 2) : pad(dt.getDate()) });
      }
    }
    for (const bin of bins) {
      bin.segs = {};
      bin.brk = 0;
      bin.total = 0;
      bin.now = now >= bin.a && now < bin.b;
    }
    for (const s of cur) {
      const bin = bins.find((x) => s.start >= x.a && s.start < x.b);
      if (!bin) continue;
      const ms = focusMs(s);
      if (s.type === 'break') bin.brk += ms;
      else bin.segs[s.categoryId] = (bin.segs[s.categoryId] || 0) + ms;
      bin.total += ms;
    }
    const maxT = Math.max(HOUR / (ui.mode === 'day' ? 4 : 1), ...bins.map((x) => x.total));
    const elapsedBins = bins.filter((x) => x.a <= now).length || 1;
    const avg = bins.reduce((t, x) => t + x.total - x.brk, 0) / elapsedBins;
    const step = bins.length > 16 ? 3 : 1;
    const chart = `
      <div class="chart">
        <div class="chart-cols">
          ${bins.map((bin, i) => `
            <div class="col${bin.now ? ' now' : ''}" title="${esc(bin.label)} · ${dur(bin.total - bin.brk)} focus">
              <div class="col-track"><div class="col-fill" style="--i:${i}">
                ${Object.entries(bin.segs).map(([cid, ms]) => `<i class="seg" style="height:${(ms / maxT) * 100}%;--c:${cat(cid).color}"></i>`).join('')}
                ${bin.brk ? `<i class="seg brk" style="height:${(bin.brk / maxT) * 100}%"></i>` : ''}
              </div></div>
              <span class="col-x">${i % step === 0 ? bin.label : ''}</span>
            </div>`).join('')}
          ${avg > 0 ? `<div class="avg-line" style="--r:${(avg / maxT).toFixed(4)}"></div>` : ''}
        </div>
        <div class="chart-y">
          <span style="--r:1">${durTight(maxT)}</span>
          <span style="--r:0.5">${durTight(maxT / 2)}</span>
          ${avg > 0 && Math.abs(avg / maxT - 0.5) > 0.12 && avg / maxT < 0.88 ? `<span class="avg" style="--r:${(avg / maxT).toFixed(4)}">${durTight(avg)}<br>average</span>` : ''}
          <span style="--r:0">0min</span>
        </div>
      </div>`;

    // categories
    const catTotals = {};
    const pcatTotals = {};
    for (const s of F) catTotals[s.categoryId] = (catTotals[s.categoryId] || 0) + focusMs(s);
    for (const s of PF) pcatTotals[s.categoryId] = (pcatTotals[s.categoryId] || 0) + focusMs(s);
    const catRows = Object.entries(catTotals).sort((x, y) => y[1] - x[1]);

    left.innerHTML = `
      <div class="card stats" style="--i:0">
        <div class="stat">${delta(pct(tf, ptf))}<b>${durTight(tf)}</b><small>TOTAL FOCUS</small></div>
        <div class="stat">${delta(pct(tf / days, ptf / pdays))}<b>${durTight(tf / days)}</b><small>AVG FOCUS/DAY</small></div>
        <div class="stat"><span class="delta"> </span><b>${byBucket(F)}</b><small>MOST FOCUSED</small></div>
        <div class="stat">${delta(pct(tb, ptb))}<b>${durTight(tb)}</b><small>TOTAL BREAK</small></div>
        <div class="stat">${delta(pratio && tb ? pct(tf / tb, pratio) : null)}<b>${ratio}</b><small>FOCUS/BREAK</small></div>
        <div class="stat"><span class="delta"> </span><b>${byBucket(F.filter((s) => s.mood === 'distracted'))}</b><small>MOST DISTRACTED</small></div>
      </div>
      <div class="card moods-card" style="--i:1">
        ${Object.entries(MOODS).map(([k, m]) => `
          <div class="mstat"><div><span class="mcheck">${I.checkCircle}</span><b>${moods[k]}</b><span class="memoji">${m.emoji}</span></div><small>${m.label} ${m.arrow}</small>${delta(pct(moods[k], pmoods[k]))}</div>`).join('')}
      </div>
      <div class="card" style="--i:2">
        <div class="card-title">${ui.mode === 'day' ? 'Hourly' : ui.mode === 'year' ? 'Monthly' : 'Daily'} Distribution</div>
        ${chart}
      </div>
      <div class="card" style="--i:3">
        <div class="card-title">Category Distribution</div>
        <table class="ctable">
          <thead><tr><th>CATEGORY</th><th>RATIO</th><th>CHANGE</th><th>TIME SPENT</th></tr></thead>
          <tbody>
            ${catRows.length ? catRows.map(([cid, ms]) => {
              const c = cat(cid);
              const p = pct(ms, pcatTotals[cid] || 0);
              return `<tr><td><span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span></td><td>${Math.round((ms / tf) * 100)}%</td><td>${p === null ? 'new' : p === 0 ? '–' : `<span class="delta ${p > 0 ? 'up' : 'down'}">${Math.abs(p)}% ${p > 0 ? '↑' : '↓'}</span>`}</td><td>${dur(ms)}</td></tr>`;
            }).join('') : '<tr><td colspan="4" class="empty-cell">No sessions in this period</td></tr>'}
          </tbody>
        </table>
      </div>`;

    // right: grouped log
    let list = cur.filter((s) => !ui.notesOnly || s.note).sort((x, y) => y.start - x.start);
    const groups = [];
    for (const s of list) {
      const d = dayStart(s.start);
      let g = groups[groups.length - 1];
      if (!g || g.d !== d) groups.push((g = { d, items: [] }));
      g.items.push(s);
    }
    const shown = groups.slice(0, ui.limit);
    right.innerHTML = shown.length
      ? shown.map((g, gi) => `
        <div class="lday" style="--i:${gi}">
          <div class="lday-h">${longDate(g.d)}</div>
          <div class="lday-card">
            ${g.items.map((s) => {
              const c = cat(s.categoryId);
              if (s.type === 'break')
                return `<div class="lrow brk" data-id="${s.id}"><span class="lmood">${I.sparkle}</span><span class="lbar"><i></i></span><div class="lmain"><b>Break</b><span class="mono-sm">${hm(s.start)} → ${hm(s.end)}</span>${s.note ? `<p>${esc(s.note)}</p>` : ''}</div><div class="lmeta"><span></span><b>${dur(focusMs(s))}</b></div></div>`;
              return `<div class="lrow" data-id="${s.id}" style="--c:${c.color}"><span class="lmood">${MOODS[s.mood]?.arrow || ''}</span><span class="lbar"></span><div class="lmain"><b>${esc(s.title || c.name)}</b><span class="mono-sm">${hm(s.start)} → ${hm(s.end)}</span>${s.note ? `<p>${esc(s.note)}</p>` : ''}</div><div class="lmeta"><span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span><b>${dur(focusMs(s))}</b></div></div>`;
            }).join('')}
          </div>
        </div>`).join('') + (groups.length > shown.length ? '<button class="btn ghost an-more">Show more</button>' : '')
      : `<div class="empty big">${I.chart}<p>No sessions ${ui.notesOnly ? 'with notes ' : ''}in this period yet.</p></div>`;
  }

  on('sessions', render);
  on('categories', render);
  on('settings', render);
  return {
    show() {
      if (dirty) render();
      else render();
    },
  };
}
