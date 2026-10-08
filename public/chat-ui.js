// Small UI building blocks for the Telegram-like layout: popover menus,
// long press, swipe-back on phones, resizable chat list and date labels.
const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches || document.body.classList.contains('no-motion');
export const mobile = () => !!globalThis.matchMedia?.('(max-width:700px)')?.matches;

// ---------- Dates ----------
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export function dayLabel(t) {
  const today = startOfDay(Date.now()), day = startOfDay(t);
  if (day === today) return 'Сегодня';
  if (today - day <= 86400000 * 1.5 && today > day) return 'Вчера';
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear();
  return new Date(t).toLocaleDateString('ru', sameYear ? {day: 'numeric', month: 'long'} : {day: 'numeric', month: 'long', year: 'numeric'});
}
// Chat list: time for today, weekday for this week, short date otherwise.
export function listTime(t) {
  if (!t) return '';
  const today = startOfDay(Date.now()), day = startOfDay(t);
  if (day === today) return new Date(t).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});
  if (today - day < 86400000 * 6.5) return new Date(t).toLocaleDateString('ru', {weekday: 'short'});
  return new Date(t).toLocaleDateString('ru', {day: '2-digit', month: '2-digit', year: '2-digit'});
}

// ---------- Delivery ticks ----------
const tickPaths = {
  sent: '<path d="M2.5 6.5 6 10l7.5-8"/>',
  delivered: '<path d="M1 6.5 4.5 10 12 2"/><path d="M8 9.2 8.8 10 16.3 2"/>'
};
export function ticks(status) {
  const title = status === 'read' ? 'Прочитано' : status === 'delivered' ? 'Доставлено' : 'Отправлено';
  return `<span class="tick ${status === 'read' ? 'read ticks' : ''}" title="${title}">${tickSVG(status)}</span>`;
}
export const tickSVG = status => `<svg viewBox="0 0 17 12" width="17" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${status === 'sent' ? tickPaths.sent : tickPaths.delivered}</svg>`;

// ---------- Popover menu ----------
let current = null;
export function closePopover() {
  if (!current) return;
  const {el, cleanup, onClose, returnFocus} = current; current = null;
  cleanup(); el.classList.add('closing');
  setTimeout(() => el.remove(), reduced() ? 0 : 120);
  onClose?.();
  const active = document.activeElement;
  if (returnFocus?.isConnected && (active === document.body || el.contains(active))) returnFocus.focus({preventScroll: true});
}
export const popoverOpen = () => !!current;
/**
 * Opens a floating menu at (x, y) or under an anchor element.
 * html must contain buttons with role="menuitem" for keyboard navigation.
 */
export function popover({x, y, anchor, html, className = '', label = 'Меню', onClose, align = 'start'}) {
  closePopover();
  document.querySelectorAll('.ctx-menu.closing').forEach(menu => menu.remove());
  const el = document.createElement('div');
  el.className = 'ctx-menu ' + className;
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  el.innerHTML = html;
  document.body.append(el);
  const box = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, gap = 8;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = align === 'end' ? r.right - box.width : r.left;
    y = r.bottom + 6;
    if (y + box.height > vh - gap) y = r.top - box.height - 6;
  }
  x = Math.max(gap, Math.min(x ?? 0, vw - box.width - gap));
  y = Math.max(gap, Math.min(y ?? 0, vh - box.height - gap));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.transformOrigin = `${anchor && align === 'end' ? 'right' : 'left'} top`;
  const items = () => [...el.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],.ctx-reactions button')].filter(b => !b.disabled);
  const outside = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor?.contains(e.target)) closePopover(); };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    const list = items(); if (!list.length) return;
    if (e.key === 'Tab') { closePopover(); return; }
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  };
  const dismiss = () => closePopover();
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  document.addEventListener('keydown', key, true);
  addEventListener('resize', dismiss);
  addEventListener('blur', dismiss);
  const scrollers = [...document.querySelectorAll('.messages,.chat-list')];
  scrollers.forEach(s => s.addEventListener('scroll', dismiss, {passive: true}));
  current = {el, onClose, returnFocus: document.activeElement, cleanup() {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('resize', dismiss); removeEventListener('blur', dismiss);
    scrollers.forEach(s => s.removeEventListener('scroll', dismiss));
  }};
  // Focus the first menu item only for keyboard users (avoids a focus ring after a mouse click).
  const firstItem = el.querySelector('[role=menuitem]');
  if (firstItem && document.documentElement.dataset.input === 'keyboard') firstItem.focus({preventScroll: true});
  else el.tabIndex = -1, el.focus({preventScroll: true});
  return el;
}
export const menuItem = (action, iconHTML, label, extra = '') => `<button type="button" role="menuitem" class="ctx-item" ${action} ${extra}>${iconHTML}<span>${label}</span></button>`;

// Remember whether the user navigates with keyboard or pointer.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.dataset.input = 'keyboard'; }, true);
  document.addEventListener('pointerdown', () => { document.documentElement.dataset.input = 'pointer'; }, true);
}

// ---------- Long press (touch) ----------
// Calls handler(event, target) after holding a finger still; suppresses the following click.
export function longPress(root, selector, handler, delay = 450) {
  let timer, start, target, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    target = e.target.closest(selector); if (!target) return;
    fired = false; start = {x: e.clientX, y: e.clientY};
    cancel();
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(12); handler({clientX: start.x, clientY: start.y}, target); }, delay);
  });
  root.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  // Touch devices also send contextmenu on long press; the timer above already handled it.
  root.addEventListener('contextmenu', e => { if (e.target.closest(selector) && (fired || timer)) e.preventDefault(); });
}

// ---------- Swipe from the left edge to go back (phones) ----------
export function swipeBack(panel, isActive, onBack) {
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false, horizontal = false, startTime = 0;
  panel.addEventListener('touchstart', e => {
    if (!mobile() || !isActive() || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 28) return;
    tracking = true; decided = false; horizontal = false; dx = 0; startX = t.clientX; startY = t.clientY; startTime = Date.now();
  }, {passive: true});
  panel.addEventListener('touchmove', e => {
    if (!tracking) return;
    const t = e.touches[0];
    dx = Math.max(0, t.clientX - startX);
    if (!decided && (Math.abs(dx) > 8 || Math.abs(t.clientY - startY) > 8)) { decided = true; horizontal = Math.abs(dx) > Math.abs(t.clientY - startY); if (!horizontal) tracking = false; }
    if (!horizontal) return;
    panel.classList.add('dragging');
    panel.style.transform = `translateX(${dx}px)`;
  }, {passive: true});
  const end = () => {
    if (!tracking) return; tracking = false;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    const fast = dx > 40 && Date.now() - startTime < 250;
    if (horizontal && (dx > panel.clientWidth * 0.33 || fast)) onBack();
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
}

// ---------- Resizable chat list (desktop) ----------
const WIDTH_KEY = 'ui/side-width';
export const SIDE_MIN = 280, SIDE_MAX = 480;
export function sideWidth() {
  let value = 360;
  try { value = Number(localStorage.getItem(WIDTH_KEY)) || 360; } catch {}
  return Math.max(SIDE_MIN, Math.min(SIDE_MAX, value));
}
export function setupResizer(handle, shell) {
  const apply = width => {
    width = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, width)));
    shell.style.setProperty('--side-width', width + 'px');
    handle.setAttribute('aria-valuenow', String(width));
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
  };
  handle.setAttribute('aria-valuemin', String(SIDE_MIN));
  handle.setAttribute('aria-valuemax', String(SIDE_MAX));
  handle.setAttribute('aria-valuenow', String(sideWidth()));
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const left = shell.getBoundingClientRect().left;
    shell.classList.add('resizing');
    const move = ev => apply(ev.clientX - left);
    const up = () => { shell.classList.remove('resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => apply(360));
  handle.addEventListener('keydown', e => {
    const now = Number(handle.getAttribute('aria-valuenow')) || 360;
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(now - 16); }
    if (e.key === 'ArrowRight') { e.preventDefault(); apply(now + 16); }
  });
}
