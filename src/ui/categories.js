// Category picker menu + the "Categories" manager sheet.
import { state, emit, PALETTE } from '../store.js';
import { esc, html, uid } from '../util.js';
import { openMenu, openModal, confirmDialog } from './overlay.js';

export function openCategoryMenu(anchor, currentId, onPick, opts = {}) {
  const items = state.categories.map((c) => ({
    label: c.name,
    dot: c.color,
    right: c.id === currentId ? '<span class="menu-tick">✓</span>' : '',
    onClick: () => onPick(c.id),
  }));
  items.push({ sep: true }, { label: 'Manage categories…', onClick: () => openCategories() });
  return openMenu(anchor, items, { width: 210, ...opts });
}

export function catPillHTML(c, cls = '') {
  return `<span class="cat-tag ${cls}" style="--c:${c.color}"><i class="dot"></i>${esc(c.name)}</span>`;
}

export function openCategories() {
  const body = html(`
    <div class="cats">
      <input class="cats-search" placeholder="Categories" aria-label="Search categories" />
      <div class="cats-list"></div>
    </div>`);
  const footer = html('<div class="center-foot"><button class="btn primary wide">ADD NEW CATEGORY</button></div>');
  const m = openModal({ title: 'Categories', body, footer, width: 420, className: 'cats-modal' });
  const list = body.querySelector('.cats-list');
  const search = body.querySelector('.cats-search');
  let editing = null;

  function render() {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    state.categories
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .forEach((c, i) => {
        if (editing === c.id) {
          const row = html(`
            <div class="cat-row editing">
              <div class="cat-edit">
                <input class="cat-name-input" value="${esc(c.name)}" maxlength="32" aria-label="Category name"/>
                <div class="swatches">${PALETTE.map((p) => `<button class="sw${p === c.color ? ' on' : ''}" style="--c:${p}" data-c="${p}" aria-label="Color ${p}"></button>`).join('')}</div>
                <div class="cat-edit-btns">
                  ${state.categories.length > 1 && i !== 0 ? '<button class="btn ghost sm del">Delete</button>' : '<span></span>'}
                  <button class="btn primary sm ok">Done</button>
                </div>
              </div>
            </div>`);
          const name = row.querySelector(".cat-name-input");
          row.querySelector('.swatches').addEventListener('click', (e) => {
            const b = e.target.closest('.sw');
            if (!b) return;
            c.color = b.dataset.c;
            emit('categories');
            render();
          });
          const done = () => {
            c.name = name.value.trim() || c.name;
            editing = null;
            emit('categories');
            render();
          };
          row.querySelector('.ok').onclick = done;
          name.addEventListener('keydown', (e) => e.key === 'Enter' && done());
          row.querySelector('.del')?.addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: `Delete “${c.name}”?`,
              message: 'Sessions in this category will move to the default category.',
              ok: 'Delete',
            });
            if (!ok) return;
            const fallback = state.categories[0].id;
            for (const s of state.sessions) if (s.categoryId === c.id) s.categoryId = fallback;
            for (const s of state.planned) if (s.categoryId === c.id) s.categoryId = fallback;
            if (state.ui.draft.categoryId === c.id) state.ui.draft.categoryId = fallback;
            if (state.timer?.categoryId === c.id) state.timer.categoryId = fallback;
            state.categories = state.categories.filter((x) => x !== c);
            editing = null;
            emit('categories');
            emit('sessions');
            emit('timer');
            render();
          });
          list.append(row);
          setTimeout(() => name.focus(), 30);
        } else {
          const row = html(`
            <div class="cat-row" style="--i:${i}">
              <i class="dot" style="--dot:${c.color}"></i>
              <span class="cat-row-name">${esc(c.name)}</span>
              ${i === 0 ? '<span class="nocat">no category</span>' : ''}
              <button class="cat-edit-link">Edit</button>
            </div>`);
          row.querySelector('.cat-edit-link').onclick = () => {
            editing = c.id;
            render();
          };
          list.append(row);
        }
      });
  }
  search.addEventListener('input', render);
  footer.querySelector('button').onclick = () => {
    const used = new Set(state.categories.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[state.categories.length % PALETTE.length];
    const c = { id: uid(), name: search.value.trim() || 'New category', color };
    state.categories.push(c);
    search.value = '';
    editing = c.id;
    emit('categories');
    render();
    list.scrollTop = list.scrollHeight;
  };
  render();
  setTimeout(() => search.focus(), 60);
  return m;
}
