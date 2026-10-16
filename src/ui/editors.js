// Reflection sheet + editors for logged sessions and planned calendar blocks.
import { state, emit, on, cat, MOODS, focusMs } from '../store.js';
import { esc, html, hm, dur, pad, uid, MIN, isMac } from '../util.js';
import { I } from './icons.js';
import { openModal, confirmDialog } from './overlay.js';
import { openCategoryMenu } from './categories.js';

export function mountReflection() {
  on('reflect', (rec) => openReflection(rec));
}

function moodPicker(current) {
  const el = html(`<div class="moods">${Object.entries(MOODS)
    .map(([k, m]) => `<button class="mood${k === current ? ' on' : ''}" data-m="${k}" type="button"><span class="mood-emoji">${m.emoji}</span><span>${m.label}</span></button>`)
    .join('')}</div>`);
  let value = current;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.mood');
    if (!b) return;
    value = b.dataset.m;
    el.querySelectorAll('.mood').forEach((x) => x.classList.toggle('on', x === b));
  });
  return { el, get value() { return value; } };
}

export function openReflection(rec) {
  const c = cat(rec.categoryId);
  const body = html(`
    <div class="reflect">
      <div class="reflect-sum">
        <span class="cat-tag" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span>
        <span class="mono-sm">${hm(rec.start)} → ${hm(rec.end)} · ${dur(focusMs(rec)).toUpperCase()}</span>
      </div>
      <h3 class="reflect-title">${esc(rec.title || c.name)}</h3>
      <p class="reflect-q">How was your focus?</p>
      <div class="mood-host"></div>
      <textarea class="reflect-note" placeholder="What have you learned? What's left to do?">${esc(rec.note)}</textarea>
    </div>`);
  const mp = moodPicker(rec.mood || state.settings.defaultMood);
  body.querySelector('.mood-host').append(mp.el);
  const footer = html(`<div class="row-btns"><button class="btn ghost">Skip</button><button class="btn primary">SUBMIT <kbd>${isMac ? '⌘' : 'Ctrl'}↵</kbd></button></div>`);
  const m = openModal({ title: 'Session Ended', body, footer, width: 440, className: 'reflect-modal' });
  const submit = () => {
    rec.mood = mp.value;
    rec.note = body.querySelector('.reflect-note').value.trim();
    emit('sessions');
    m.close();
  };
  footer.children[0].onclick = () => m.close();
  footer.children[1].onclick = submit;
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });
  setTimeout(() => body.querySelector('.reflect-note').focus(), 80);
}

// ---- shared form helpers ------------------------------------------------------
const toTimeVal = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toDateVal = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function fromVals(dateV, timeV) {
  const [y, mo, da] = dateV.split('-').map(Number);
  const [h, mi] = timeV.split(':').map(Number);
  return new Date(y, mo - 1, da, h || 0, mi || 0).getTime();
}

function catButton(initial) {
  let id = initial;
  const b = html(`<button class="cat-pill" type="button"><i class="dot"></i><span></span>${I.chevDown}</button>`);
  const paint = () => {
    const c = cat(id);
    b.querySelector('span').textContent = c.name;
    b.querySelector('.dot').style.setProperty('--dot', c.color);
  };
  b.onclick = () => openCategoryMenu(b, id, (x) => { id = x; paint(); });
  paint();
  return { el: b, get value() { return id; } };
}

/**
 * Create/edit a logged session (rec) or a planned block.
 * kind: 'session' | 'planned'
 */
export function openBlockEditor({ kind, rec, start, end }) {
  const isNew = !rec;
  const r = rec || { title: '', categoryId: state.ui.draft.categoryId, start, end, type: 'focus', mood: state.settings.defaultMood, note: '' };
  const body = html(`
    <div class="form">
      ${isNew ? `<div class="seg kind-seg"><button type="button" data-k="planned" class="${kind === 'planned' ? 'on' : ''}">Plan</button><button type="button" data-k="session" class="${kind === 'session' ? 'on' : ''}">Log session</button></div>` : ''}
      <label class="field"><span>Title</span><input class="f-title" value="${esc(r.title)}" maxlength="140" placeholder="${kind === 'planned' ? 'What do you plan to do?' : 'Intention'}"/></label>
      <div class="field"><span>Category</span><span class="cat-host"></span></div>
      <div class="field"><span>Date</span><input class="f-date" type="date" value="${toDateVal(r.start)}"/></div>
      <div class="field two"><span>Time</span><input class="f-start" type="time" value="${toTimeVal(r.start)}"/><em>→</em><input class="f-end" type="time" value="${toTimeVal(r.end)}"/></div>
      <div class="only-session">
        <div class="field"><span>Type</span><div class="seg type-seg"><button type="button" data-t="focus" class="${r.type !== 'break' ? 'on' : ''}">Focus</button><button type="button" data-t="break" class="${r.type === 'break' ? 'on' : ''}">Break</button></div></div>
        <div class="field col only-focus"><span>Mood</span><div class="mood-host"></div></div>
        <label class="field col"><span>Notes</span><textarea class="f-note" placeholder="Notes">${esc(r.note || '')}</textarea></label>
      </div>
    </div>`);
  let k = kind;
  let type = r.type === 'break' ? 'break' : 'focus';
  const cb = catButton(r.categoryId);
  body.querySelector('.cat-host').append(cb.el);
  const mp = moodPicker(r.mood || state.settings.defaultMood);
  body.querySelector('.mood-host').append(mp.el);
  const sync = () => {
    body.querySelector('.only-session').hidden = k !== 'session';
    body.querySelector('.only-focus').hidden = type === 'break';
  };
  body.querySelector('.kind-seg')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    k = b.dataset.k;
    body.querySelectorAll('.kind-seg button').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  });
  body.querySelector('.type-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    type = b.dataset.t;
    body.querySelectorAll('.type-seg button').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  });
  sync();

  const footer = html(`<div class="row-btns spread">${isNew ? '<span></span>' : '<button class="btn ghost danger-text del">Delete</button>'}<div class="row-btns"><button class="btn ghost cancel">Cancel</button><button class="btn primary ok">Save</button></div></div>`);
  const m = openModal({ title: isNew ? 'New Event' : kind === 'planned' ? 'Edit Planned Block' : 'Edit Session', body, footer, width: 420 });
  const saveIt = () => {
    const dateV = body.querySelector('.f-date').value;
    let s = fromVals(dateV, body.querySelector('.f-start').value);
    let e = fromVals(dateV, body.querySelector('.f-end').value);
    if (e <= s) e += 24 * 60 * MIN;
    const patch = { title: body.querySelector('.f-title').value.trim(), categoryId: cb.value, start: s, end: e };
    if (isNew) {
      if (k === 'planned') state.planned.push({ id: uid(), ...patch });
      else state.sessions.push({ id: uid(), type, ...patch, pausedMs: 0, plannedMs: e - s, mood: type === 'focus' ? mp.value : null, note: body.querySelector('.f-note').value.trim() });
    } else {
      Object.assign(rec, patch);
      if (kind === 'session') {
        rec.type = type;
        rec.mood = type === 'focus' ? mp.value : null;
        rec.note = body.querySelector('.f-note').value.trim();
        rec.pausedMs = Math.min(rec.pausedMs || 0, e - s);
      }
    }
    emit(k === 'planned' ? 'planned' : 'sessions');
    m.close();
  };
  footer.querySelector('.cancel').onclick = () => m.close();
  footer.querySelector('.ok').onclick = saveIt;
  footer.querySelector('.del')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete this?', message: 'This cannot be undone.', ok: 'Delete' });
    if (!ok) return;
    if (kind === 'planned') state.planned = state.planned.filter((x) => x !== rec);
    else state.sessions = state.sessions.filter((x) => x !== rec);
    emit(kind === 'planned' ? 'planned' : 'sessions');
    m.close();
  });
  body.querySelector('.f-title').addEventListener('keydown', (e) => e.key === 'Enter' && saveIt());
  setTimeout(() => body.querySelector('.f-title').focus(), 60);
}
