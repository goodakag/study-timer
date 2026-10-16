// Popover menus and modal sheets.
import { esc, html } from '../util.js';
import { I } from './icons.js';
import { root, localRect, W, H } from '../scale.js';
import * as T from '../timer.js';
import { on } from '../store.js';

// ---- menus ------------------------------------------------------------------
let openM = null;

export function closeMenu() {
  if (!openM) return;
  const m = openM;
  openM = null;
  m.cleanup();
  m.el.classList.remove('in');
  m.el.classList.add('out');
  setTimeout(() => m.el.remove(), 140);
  m.onClose?.();
}
export const menuOpen = () => !!openM;

/**
 * items: {label, icon, danger, onClick, checked, dot, right, sep, header, disabled}
 */
export function openMenu(anchor, items, { place = 'auto', align = 'center', width, className = '', onClose } = {}) {
  closeMenu();
  const el = html(`<div class="menu ${className}" role="menu"></div>`);
  if (width) el.style.width = width + 'px';
  const buttons = [];
  let idx0 = 0;
  for (const it of items) {
    if (it.sep) {
      el.append(html('<div class="menu-sep"></div>'));
      continue;
    }
    if (it.header) {
      el.append(html(`<div class="menu-header">${it.header}</div>`));
      continue;
    }
    const b = html(
      `<button class="menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" role="menuitem" ${it.disabled ? 'disabled' : ''}>
        ${it.dot ? `<i class="dot" style="--dot:${it.dot}"></i>` : ''}
        ${it.check !== undefined ? `<span class="menu-check">${it.check ? I.check : ''}</span>` : ''}
        <span class="menu-label">${esc(it.label)}</span>
        ${it.right ? `<span class="menu-right">${it.right}</span>` : ''}
        ${it.icon ? `<span class="menu-icon">${it.icon}</span>` : ''}
      </button>`
    );
    b.style.setProperty('--i', idx0++);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!it.keepOpen) closeMenu();
      it.onClick?.(e);
    });
    buttons.push(b);
    el.append(b);
  }
  root().append(el);

  // Position relative to the anchor, flipping/clamping into the viewport.
  const r = localRect(anchor);
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  const vw = W;
  const vh = H;
  let below = place === 'below' || (place === 'auto' && r.bottom + mh + 8 < vh);
  if (place === 'above' && r.top - mh - 8 < 0) below = true;
  let top = below ? r.bottom + 6 : r.top - mh - 6;
  let left = align === 'start' ? r.left : align === 'end' ? r.right - mw : r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(vw - mw - 8, left));
  top = Math.max(8, Math.min(vh - mh - 8, top));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : mh}px`;
  requestAnimationFrame(() => el.classList.add('in'));

  let idx = -1;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
      anchor.focus?.();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const enabled = buttons.filter((b) => !b.disabled);
      if (!enabled.length) return;
      idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[idx].focus();
    }
  };
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onToggle = (e) => {
    if (anchor.contains(e.target)) {
      e.stopPropagation();
      closeMenu();
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    anchor.addEventListener('click', onToggle, true);
  });
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', closeMenu);
  openM = {
    el,
    onClose,
    cleanup() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      anchor.removeEventListener('click', onToggle, true);
      removeEventListener('resize', closeMenu);
    },
  };
  return { el, close: closeMenu };
}

// ---- modals -------------------------------------------------------------------
const stack = [];
export const modalOpen = () => stack.length > 0;

export function closeTopModal() {
  stack[stack.length - 1]?.close();
}

export function openModal({ title = '', body, footer, width = 440, className = '', onClose, closeButton = true } = {}) {
  const rootEl = html(`
    <div class="modal-root">
      <div class="modal-backdrop"></div>
      <div class="modal ${className}" role="dialog" aria-modal="true" style="--w:${width}px">
        ${title || closeButton ? `<div class="modal-head">${title ? `<h2>${esc(title)}</h2>` : '<span></span>'}${closeButton ? `<button class="modal-x" aria-label="Close">${I.close}</button>` : ''}</div>` : ''}
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`);
  const bodyEl = rootEl.querySelector('.modal-body');
  const footEl = rootEl.querySelector('.modal-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  if (typeof footer === 'string') footEl.innerHTML = footer;
  else if (footer) footEl.append(footer);
  else footEl.remove();
  const prevFocus = document.activeElement;
  // Keystrokes belong to the sheet now, not to whatever was focused behind it.
  prevFocus?.blur?.();
  let closed = false;
  const api = {
    el: rootEl.querySelector('.modal'),
    body: bodyEl,
    foot: footEl,
    close() {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      rootEl.classList.remove('in');
      rootEl.classList.add('out');
      setTimeout(() => rootEl.remove(), 180);
      onClose?.();
      prevFocus?.focus?.({ preventScroll: true });
    },
  };
  rootEl.querySelector('.modal-backdrop').addEventListener('click', api.close);
  rootEl.querySelector('.modal-x')?.addEventListener('click', api.close);
  root().append(rootEl);
  stack.push(api);
  requestAnimationFrame(() => rootEl.classList.add('in'));
  return api;
}

export function confirmDialog({ title, message, ok = 'Confirm', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const footer = html(`<div class="row-btns"><button class="btn ghost">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div>`);
    const m = openModal({ title, body: `<p class="muted-p">${esc(message)}</p>`, footer, width: 380, onClose: () => resolve(result) });
    footer.children[0].onclick = () => m.close();
    footer.children[1].onclick = () => {
      result = true;
      m.close();
    };
    setTimeout(() => footer.children[1].focus(), 50);
  });
}

// ---- toast ----------------------------------------------------------------------
let toastEl = null;
let toastT = 0;
/** A short message; `action` adds one button (e.g. Undo) and keeps it up longer. */
export function toast(text, { action, onAction, ms } = {}) {
  if (!toastEl) {
    toastEl = html('<div class="toast" role="status"><span></span><button type="button"></button></div>');
    root().append(toastEl);
  }
  const btn = toastEl.querySelector('button');
  toastEl.querySelector('span').textContent = text;
  btn.hidden = !action;
  btn.textContent = action || '';
  btn.onclick = action
    ? () => {
        clearTimeout(toastT);
        toastEl.classList.remove('in');
        onAction?.();
      }
    : null;
  toastEl.classList.toggle('has-action', !!action);
  toastEl.classList.remove('in');
  void toastEl.offsetWidth;
  toastEl.classList.add('in');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('in'), ms || (action ? 5000 : 2200));
}

/** Discard the running session, with a few seconds to take it back. */
export function discardSession() {
  const snap = T.abandon();
  if (snap) toast(snap.kind === 'break' ? 'Break discarded' : 'Session discarded', { action: 'Undo', onAction: () => T.restore(snap) });
}

// Starting a new session closes any pending Undo (it would restore on top of it).
on('breathe', () => {
  clearTimeout(toastT);
  toastEl?.classList.remove('in');
});
