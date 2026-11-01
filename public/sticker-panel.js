// Composer panel: emoji, stickers and GIF in one place, plus sticker suggestions while typing.
import {accountURL,activeAccount} from './account-context.js';
import {$, esc, api, guard, toast, icon} from './ui.js';
import {emojiCategories, searchEmoji, emojiKeywords, jumboSize} from './emoji-data.js';
import {stickerPanel, studio} from './stickers.js';
import {longPress, mobile} from './chat-ui.js';

const tabs = [['emoji', 'Эмодзи'], ['stickers', 'Стикеры'], ['gifs', 'GIF']];
const placeholders = {emoji: 'Поиск эмодзи: смех, сердце, кот…', stickers: 'Поиск стикеров и наборов', gifs: 'Поиск GIF'};
let panel = null, ctx = null, saveTimer;
const cache = {packs: null, packsAt: 0, items: new Map(), favorites: null, gifs: null};
if (typeof window !== 'undefined') window.addEventListener('account-change', () => { closeEmojiPanel(); Object.assign(cache, {packs: null, packsAt: 0, favorites: null, gifs: null}); cache.items.clear(); });

export const emojiPanelOpen = () => !!panel?.isConnected;
export function closeEmojiPanel() {
  if (!panel) return;
  const el = panel; panel = null;
  document.removeEventListener('pointerdown', outside, true);
  const toggle = $('#emoji'); toggle?.setAttribute('aria-expanded', 'false'); toggle?.classList.remove('active');
  el.classList.add('closing');
  setTimeout(() => el.remove(), 160);
}
function outside(e) {
  if (!panel || panel.contains(e.target) || e.target.closest('#emoji,.composer,.sticker-peek-overlay,dialog')) return;
  closeEmojiPanel();
}

// ---------- Data ----------
// Packs change rarely, but loading them costs the server dozens of database reads. They are kept on the
// device for each account and refreshed in the background at most every 10 minutes, so typing (sticker
// suggestions) never queues a burst of pack requests in front of a message being sent.
const PACKS_TTL = 600000;
const storeKey = () => 'accounts/' + activeAccount() + '/sticker-packs';
function stored() { try { const v = JSON.parse(localStorage.getItem(storeKey()) || 'null'); return v && v.account === activeAccount() ? v : null; } catch { return null; } }
function persist() { try { localStorage.setItem(storeKey(), JSON.stringify({account: activeAccount(), at: cache.packsAt, packs: cache.packs, items: cache.saved || {}})); } catch {} }
function sameAccount() { if (cache.account !== activeAccount()) { cache.account = activeAccount(); cache.packs = null; cache.packsAt = 0; cache.items.clear(); cache.favorites = null; cache.saved = null; cache.loading = null; } }
function fetchPacks() {
  return cache.loading ||= Promise.all([api('/packs?mode=installed'), api('/packs?mode=mine')]).then(([installed, mine]) => {
    const seen = new Set();
    cache.packs = [...mine, ...installed].filter(p => !seen.has(p.id) && seen.add(p.id));
    cache.packsAt = Date.now(); cache.items.clear(); cache.saved = {}; persist();
    return cache.packs;
  }).finally(() => { cache.loading = null; });
}
async function loadPacks(force = false) {
  sameAccount();
  if (force) return fetchPacks();
  if (!cache.packs) { const saved = stored(); if (saved?.packs) { cache.packs = saved.packs; cache.packsAt = saved.at || 0; cache.saved = saved.items || {}; } }
  if (!cache.packs) return fetchPacks();
  if (Date.now() - cache.packsAt > PACKS_TTL) fetchPacks().catch(() => {});
  return cache.packs;
}
async function packItems(id) {
  sameAccount();
  if (!cache.items.has(id)) {
    const saved = cache.saved?.[id];
    cache.items.set(id, saved ? Promise.resolve(saved) : api('/packs/' + id).then(p => { cache.saved ||= {}; cache.saved[id] = p.items; persist(); return p.items; }).catch(() => []));
  }
  return cache.items.get(id);
}
async function favorites(force = false) {
  sameAccount();
  if (force || !cache.favorites) cache.favorites = await api('/stickers/favorites');
  return cache.favorites;
}
function invalidate() { cache.packs = null; cache.packsAt = 0; cache.items.clear(); cache.favorites = null; cache.saved = null; try { localStorage.removeItem(storeKey()); } catch {} }

// ---------- Rendering helpers ----------
const stickerButton = (s, attr = 'data-sticker') => `<button type="button" class="ep-sticker" ${attr}="${esc(s.id)}" title="${esc(s.label)}" aria-label="Стикер: ${esc(s.label)}"><img src="${esc(accountURL(s.poster || s.url))}" ${s.animated ? `data-motion="${esc(accountURL(s.url))}" data-poster="${esc(accountURL(s.poster))}"` : ''} alt="" loading="lazy" decoding="async"></button>`;
const section = (id, title, inner, extra = '') => `<section class="ep-section" data-sec="${esc(id)}"><h4><span>${esc(title)}</span>${extra}</h4>${inner}</section>`;
const stripItem = (id, label, inner) => `<button type="button" class="ep-strip-item" data-jump="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${inner}</button>`;
const coverImg = p => p.cover ? `<img src="${esc(accountURL(p.cover))}" alt="" loading="lazy">` : `<span>${esc((p.title || '?').slice(0, 1))}</span>`;

export function toggleEmojiPanel(state, save, {tab} = {}) {
  if (emojiPanelOpen()) { closeEmojiPanel(); return; }
  const host = $('.composer-inner'); if (!host) return;
  ctx = {state, save};
  panel = document.createElement('section');
  panel.className = 'emoji-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Эмодзи, стикеры и GIF');
  panel.innerHTML = `<div class="ep-top"><div class="ep-tabs" role="tablist" aria-label="Тип">${tabs.map(([key, title]) => `<button type="button" role="tab" data-ep-tab="${key}">${title}</button>`).join('')}</div><button type="button" class="icon-button ep-close" aria-label="Закрыть панель" title="Закрыть (Esc)">${icon('close')}</button></div><div class="ep-search search">${icon('search')}<input type="search" id="ep-search" autocomplete="off" aria-label="Поиск"></div><div class="ep-body" id="ep-body" tabindex="-1"></div><nav class="ep-strip" aria-label="Разделы"></nav>`;
  host.prepend(panel);
  const toggle = $('#emoji'); toggle?.setAttribute('aria-expanded', 'true'); toggle?.classList.add('active');
  panel.querySelector('.ep-close').onclick = closeEmojiPanel;
  panel.querySelectorAll('[data-ep-tab]').forEach(b => b.onclick = () => show(b.dataset.epTab));
  let searchTimer;
  panel.querySelector('#ep-search').oninput = e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => render(e.target.value), 180); };
  const body = panel.querySelector('#ep-body');
  body.addEventListener('click', e => onBodyClick(e));
  body.addEventListener('scroll', spy, {passive: true});
  body.addEventListener('contextmenu', e => { const b = e.target.closest('[data-sticker],[data-gif]'); if (!b) return; e.preventDefault(); peekFromButton(b); });
  longPress(body, '[data-sticker],[data-gif]', (_, b) => peekFromButton(b));
  panel.querySelector('.ep-strip').addEventListener('click', e => {
    const b = e.target.closest('[data-jump],[data-strip-action]'); if (!b) return;
    if (b.dataset.stripAction === 'create') { createForm(); return; }
    if (b.dataset.stripAction === 'catalog') { closeEmojiPanel(); guard(() => stickerPanel(state, save, async () => { invalidate(); }))(); return; }
    body.querySelector(`[data-sec="${CSS.escape(b.dataset.jump)}"]`)?.scrollIntoView({block: 'start', behavior: 'smooth'});
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  show(tab || state.settings.emojiTab || 'emoji');
}

function show(tab) {
  if (!panel) return;
  ctx.tab = tab;
  if (ctx.state.settings.emojiTab !== tab) { ctx.state.settings.emojiTab = tab; queueSave(); }
  panel.querySelectorAll('[data-ep-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.epTab === tab)));
  const input = panel.querySelector('#ep-search'); input.value = ''; input.placeholder = placeholders[tab];
  panel.dataset.tab = tab;
  render('');
}

async function render(query) {
  if (!panel) return;
  const body = panel.querySelector('#ep-body'), strip = panel.querySelector('.ep-strip'), tab = ctx.tab, q = query.trim().toLowerCase();
  const ticket = ctx.ticket = Symbol();
  if (tab === 'emoji') {
    const recent = ctx.state.settings.recentEmoji || [];
    if (q) {
      const found = searchEmoji(q);
      body.innerHTML = found.length ? section('search', 'Найдено', `<div class="ep-emoji-grid">${found.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>`) : `<p class="ep-empty">Ничего не нашлось. Попробуйте «смех», «сердце», «кот» или «праздник».</p>`;
      strip.innerHTML = '';
    } else {
      const sections = [recent.length && {id: 'recent', title: 'Недавние', icon: '🕘', list: recent}, ...emojiCategories].filter(Boolean);
      body.innerHTML = sections.map(s => section(s.id, s.title, `<div class="ep-emoji-grid">${s.list.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>`)).join('') + '<div id="ep-custom"></div>';
      strip.innerHTML = sections.map(s => stripItem(s.id, s.title, `<span class="ep-glyph">${s.icon}</span>`)).join('');
    }
    const packs = (await loadPacks().catch(() => [])).filter(p => p.kind === 'emoji');
    if (ticket !== ctx?.ticket || !packs.length) return;
    const lists = await Promise.all(packs.map(p => packItems(p.id)));
    if (ticket !== ctx?.ticket) return;
    const html = packs.map((p, i) => { const items = lists[i].filter(s => !q || s.label.toLowerCase().includes(q)); return items.length ? section('ce-' + p.id, p.title, `<div class="ep-emoji-grid custom">${items.map(s => `<button type="button" data-custom-emoji="${esc(s.id)}" title="${esc(s.label)}" aria-label="${esc(s.label)}"><img src="${esc(accountURL(s.poster || s.url))}" alt="" loading="lazy"></button>`).join('')}</div>`) : ''; }).join('');
    if (q) body.insertAdjacentHTML('beforeend', html); else { body.querySelector('#ep-custom').innerHTML = html; strip.insertAdjacentHTML('beforeend', packs.map(p => stripItem('ce-' + p.id, p.title, coverImg(p))).join('')); }
    spy();
    return;
  }
  if (tab === 'gifs') {
    body.innerHTML = '<div class="ep-loading" aria-label="Загрузка"></div>';strip.innerHTML = '';
    cache.gifs ||= await api('/stickers/gifs').catch(() => []);
    if (ticket !== ctx?.ticket) return;
    const gifs = cache.gifs.filter(s => !q || s.label.toLowerCase().includes(q));
    body.innerHTML = `<div class="ep-gif-grid"><button type="button" class="ep-add-tile" data-action="add-gif">${icon('plus')}<span>Свой GIF</span></button>${gifs.map(s => stickerButton(s, 'data-gif')).join('')}</div>${!gifs.length ? `<p class="ep-empty">${q ? 'GIF не найдены' : 'GIF пока нет. Добавьте свой — он сохранится в набор «Мои GIF».'}</p>` : ''}`;
    return;
  }
  // Stickers
  body.innerHTML = '<div class="ep-loading" aria-label="Загрузка"></div>';
  const [recent, favs, packs] = await Promise.all([api('/stickers/recent').catch(() => []), favorites().catch(() => []), loadPacks().catch(() => [])]);
  const stickerPacks = packs.filter(p => p.kind !== 'emoji');
  const lists = await Promise.all(stickerPacks.map(p => packItems(p.id)));
  if (ticket !== ctx?.ticket) return;
  const me = ctx.state.user.id, match = s => !q || s.label.toLowerCase().includes(q);
  let html = '';
  const r = recent.filter(match).slice(0, 16), f = favs.filter(match);
  if (r.length) html += section('recent', 'Недавние', `<div class="ep-sticker-grid">${r.map(s => stickerButton(s)).join('')}</div>`);
  if (f.length) html += section('favorites', 'Избранные', `<div class="ep-sticker-grid">${f.map(s => stickerButton(s)).join('')}</div>`);
  stickerPacks.forEach((p, i) => {
    const items = lists[i].filter(match), own = p.author === me;
    if (!items.length && (q || !own)) return;
    html += section('pack-' + p.id, p.title, `<div class="ep-sticker-grid">${items.map(s => stickerButton(s)).join('')}${own && !q ? `<button type="button" class="ep-add-tile" data-add-to="${esc(p.id)}" data-kind="${esc(p.kind)}">${icon('plus')}<span>Добавить</span></button>` : ''}</div>`, `<button type="button" class="ep-link" data-open-pack="${esc(p.id)}">${own ? 'Управлять' : 'Набор'}</button>`);
  });
  let catalog = [];
  if (q || !stickerPacks.length) catalog = (await api('/packs?q=' + encodeURIComponent(q)).catch(() => [])).filter(p => p.kind !== 'emoji' && !p.installed && p.author !== me).slice(0, 8);
  if (ticket !== ctx?.ticket) return;
  if (catalog.length) html += section('catalog', q ? 'В каталоге' : 'Популярные наборы', `<div class="ep-pack-list">${catalog.map(p => `<div class="ep-pack-card"><button type="button" class="ep-pack-open" data-open-pack="${esc(p.id)}"><span class="ep-pack-cover">${coverImg(p)}</span><span><b>${esc(p.title)}</b><small>${p.count} стикеров</small></span></button><button type="button" class="primary ep-install" data-install="${esc(p.id)}">Добавить</button></div>`).join('')}</div>`);
  if (!html) html = `<p class="ep-empty">${q ? 'Ничего не найдено' : 'Здесь появятся ваши стикеры'}</p>`;
  html += `<div class="ep-footer"><button type="button" class="secondary" data-action="create">${icon('plus')} Новый набор</button><button type="button" class="secondary" data-action="catalog">${icon('image')} Все наборы</button></div>`;
  body.innerHTML = html;
  strip.innerHTML = (r.length ? stripItem('recent', 'Недавние', icon('clock')) : '') + (f.length ? stripItem('favorites', 'Избранные', icon('star')) : '') + stickerPacks.map(p => stripItem('pack-' + p.id, p.title, coverImg(p))).join('') + `<button type="button" class="ep-strip-item" data-strip-action="create" title="Новый набор" aria-label="Новый набор">${icon('plus')}</button><button type="button" class="ep-strip-item" data-strip-action="catalog" title="Все наборы" aria-label="Все наборы">${icon('settings')}</button>`;
  spy();
}

// Highlight the strip item of the section currently in view.
function spy() {
  if (!panel) return;
  const body = panel.querySelector('#ep-body'), top = body.getBoundingClientRect().top + 8;
  let active = null;
  for (const sec of body.querySelectorAll('.ep-section')) { if (sec.getBoundingClientRect().top <= top) active = sec.dataset.sec; else break; }
  active ||= body.querySelector('.ep-section')?.dataset.sec;
  panel.querySelectorAll('.ep-strip [data-jump]').forEach(b => b.classList.toggle('active', b.dataset.jump === active));
}

function queueSave() { clearTimeout(saveTimer); const {save} = ctx || {}; saveTimer = setTimeout(() => save?.().catch(() => {}), 1200); }
function insert(text) {
  const input = $('#draft'); if (!input) return;
  const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length;
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input'));
  if (!mobile()) input.focus({preventScroll: true});
}
async function sendSticker(id, button) {
  const {state} = ctx;
  if (!state.chat) { toast('Откройте чат'); return; }
  button?.classList.remove('sent'); void button?.offsetWidth; button?.classList.add('sent');
  if (state.sendSticker) await state.sendSticker(id); else await api('/stickers/send', 'POST', {chat: state.chat, sticker: id, clientId: crypto.randomUUID()});
  navigator.vibrate?.(8);
}

function onBodyClick(e) {
  const b = e.target.closest('button'); if (!b || !ctx) return;
  const {state, save} = ctx;
  if (b.dataset.emoji) { insert(b.dataset.emoji); const recent = state.settings.recentEmoji || []; state.settings.recentEmoji = [b.dataset.emoji, ...recent.filter(v => v !== b.dataset.emoji)].slice(0, 32); queueSave(); return; }
  if (b.dataset.customEmoji) { insert(':ce[' + b.dataset.customEmoji + ']'); return; }
  if (b.dataset.sticker || b.dataset.gif) { guard(() => sendSticker(b.dataset.sticker || b.dataset.gif, b))(); return; }
  if (b.dataset.install) { guard(async () => { b.disabled = true; await api('/packs/' + b.dataset.install + '/install', 'POST', {}); invalidate(); toast('Набор добавлен'); await render(panel?.querySelector('#ep-search').value || ''); })(); return; }
  if (b.dataset.openPack) { closeEmojiPanel(); guard(() => stickerPanel(state, save, async () => invalidate(), {pack: b.dataset.openPack}))(); return; }
  if (b.dataset.addTo) { guard(() => studio({id: b.dataset.addTo, kind: b.dataset.kind}, refreshAfterEdit))(); return; }
  if (b.dataset.action === 'create') { createForm(); return; }
  if (b.dataset.action === 'catalog') { closeEmojiPanel(); guard(() => stickerPanel(state, save, async () => invalidate()))(); return; }
  if (b.dataset.action === 'add-gif') guard(async () => { const packs = await api('/packs?mode=mine'); let pack = packs.find(p => p.title === 'Мои GIF'); if (!pack) pack = {...await api('/packs', 'POST', {title: 'Мои GIF'}), kind: 'sticker'}; studio(pack, async () => { cache.gifs = null; await refreshAfterEdit(); }); })();
}
async function refreshAfterEdit() { invalidate(); if (panel) await render(''); }

// Two steps to a personal pack: name it, then draw / upload the first item.
function createForm() {
  if (!panel) return;
  const body = panel.querySelector('#ep-body');
  body.innerHTML = `<form class="ep-create" id="ep-create"><h4>Новый набор</h4><input name="title" required maxlength="80" placeholder="Название, например «Мои коты»" aria-label="Название набора"><div class="ep-kind" role="radiogroup" aria-label="Тип набора"><label><input type="radio" name="kind" value="sticker" checked><span>Стикеры</span></label><label><input type="radio" name="kind" value="emoji"><span>Эмодзи</span></label></div><button class="primary" type="submit">${icon('plus')} Создать и добавить первый</button><button class="secondary" type="button" id="ep-create-cancel">Отмена</button></form>`;
  panel.querySelector('.ep-strip').innerHTML = '';
  const form = body.querySelector('#ep-create');
  form.title.focus();
  body.querySelector('#ep-create-cancel').onclick = () => render('');
  form.onsubmit = guard(async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)), button = form.querySelector('[type=submit]');
    button.disabled = true;
    try { const {id} = await api('/packs', 'POST', data); invalidate(); toast('Набор создан'); studio({id, kind: data.kind}, refreshAfterEdit); await render(''); }
    finally { button.disabled = false; }
  });
}

// ---------- Large preview (long press / right click / tap on a sticker in chat) ----------
function peekFromButton(b) {
  const id = b.dataset.sticker || b.dataset.gif, img = b.querySelector('img');
  showStickerPreview(ctx.state, {id, label: b.title, url: img?.dataset.motion || img?.getAttribute('src')});
}
export async function showStickerPreview(state, sticker, {fromChat = false} = {}) {
  if (!sticker?.id) return;
  document.querySelector('.sticker-peek-overlay')?.remove();
  const favs = await favorites().catch(() => []);
  let isFavorite = favs.some(s => s.id === sticker.id);
  const overlay = document.createElement('div');
  overlay.className = 'sticker-peek-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Стикер: ' + (sticker.label || ''));
  const src = accountURL(sticker.url || sticker.poster || '');
  overlay.innerHTML = `<div class="sticker-peek-card"><img src="${esc(src)}" alt="${esc(sticker.label || 'Стикер')}"><p>${esc(sticker.label || '')}</p><div class="sticker-peek-actions">${state.chat ? `<button type="button" class="primary" data-peek="send">${icon('send')} Отправить</button>` : ''}<button type="button" class="secondary" data-peek="favorite">${icon('star')} <span>${isFavorite ? 'Убрать из избранного' : 'В избранное'}</span></button>${sticker.pack_id || !fromChat ? `<button type="button" class="secondary" data-peek="pack">${icon('image')} Весь набор</button>` : ''}</div></div>`;
  document.body.append(overlay);
  const close = () => { overlay.classList.add('closing'); document.removeEventListener('keydown', key, true); setTimeout(() => overlay.remove(), 150); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-peek]')?.focus();
  overlay.querySelector('[data-peek=send]')?.addEventListener('click', guard(async () => { close(); if (state.sendSticker) await state.sendSticker(sticker.id); }));
  overlay.querySelector('[data-peek=favorite]').addEventListener('click', guard(async e => {
    const button = e.currentTarget;
    await api('/stickers/favorites', isFavorite ? 'DELETE' : 'POST', {id: sticker.id});
    isFavorite = !isFavorite; cache.favorites = null;
    button.querySelector('span').textContent = isFavorite ? 'Убрать из избранного' : 'В избранное';
    toast(isFavorite ? 'Добавлено в избранные стикеры' : 'Убрано из избранного');
    if (panel && ctx?.tab === 'stickers') render(panel.querySelector('#ep-search').value || '');
  }));
  overlay.querySelector('[data-peek=pack]')?.addEventListener('click', guard(async () => {
    close();
    let pack = sticker.pack_id;
    if (!pack) { const all = await loadPacks(); for (const p of all) if ((await packItems(p.id)).some(s => s.id === sticker.id)) { pack = p.id; break; } }
    if (!pack) { toast('Набор недоступен'); return; }
    closeEmojiPanel();
    await stickerPanel(state, ctx?.save || (async () => {}), async () => invalidate(), {pack});
  }));
}

// ---------- Suggestions while typing ----------
const emojiToWords = new Map();
for (const [words, list] of emojiKeywords) for (const e of list) emojiToWords.set(e, [...(emojiToWords.get(e) || []), ...words]);
export function setupStickerSuggestions(state, save) {
  const input = $('#draft'), wrap = $('.composer-inner'); if (!input || !wrap) return;
  ctx ||= {state, save};
  const bar = document.createElement('div');
  bar.className = 'sticker-suggest';
  bar.setAttribute('aria-label', 'Подходящие стикеры');
  bar.hidden = true;
  wrap.prepend(bar);
  let timer, revision = 0, dismissed = '';
  const hide = () => { bar.hidden = true; bar.replaceChildren(); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim(), ticket = ++revision;
    if (!text || text.length > 60 || text === dismissed) { hide(); return; }
    timer = setTimeout(async () => {
      try {
        const jumbo = jumboSize(text);
        const words = jumbo ? [...text].flatMap(ch => emojiToWords.get(ch) || []) : text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3);
        const local = [];
        if (words.length) {
          const packs = (await loadPacks().catch(() => [])).filter(p => p.kind !== 'emoji');
          const pool = [...(await favorites().catch(() => [])), ...(await Promise.all(packs.map(p => packItems(p.id)))).flat()];
          for (const s of pool) { const label = s.label.toLowerCase(); if (words.some(w => label.split(/\s+/).some(l => l.startsWith(w.slice(0, Math.max(3, w.length - 2))))) || (jumbo && s.emoji && text.includes(s.emoji))) local.push(s); }
        }
        const remote = await api('/stickers/recommend?q=' + encodeURIComponent(jumbo ? words.join(' ') || text : text)).catch(() => []);
        if (ticket !== revision || !bar.isConnected) return;
        const seen = new Set(), items = [...local, ...remote].filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, 10);
        if (!items.length) { hide(); return; }
        bar.innerHTML = items.map(s => stickerButton(s, 'data-suggestion')).join('') + `<button type="button" class="sticker-suggest-close" aria-label="Скрыть подсказки">${icon('close')}</button>`;
        bar.hidden = false;
        bar.querySelector('.sticker-suggest-close').onclick = () => { dismissed = input.value.trim(); hide(); };
        bar.querySelectorAll('[data-suggestion]').forEach(b => b.onclick = guard(async () => {
          b.disabled = true;
          try {
            if (state.sendSticker) await state.sendSticker(b.dataset.suggestion); else await api('/stickers/send', 'POST', {chat: state.chat, sticker: b.dataset.suggestion, clientId: crypto.randomUUID()});
            if (jumboSize(input.value)) { input.value = ''; input.dispatchEvent(new Event('input')); }
            hide();
          } finally { b.disabled = false; }
        }));
      } catch {}
    }, 300);
  });
}
