// Cipherion — управление анимациями. CSS лежит в animations.css.
// Скрипт необязательный: без него сайт работает, просто без части эффектов.
const reduced = matchMedia('(prefers-reduced-motion:reduce)');
const calm = () => reduced.matches || document.body.classList.contains('no-motion');

document.body.classList.add('anim-ready');

// ---------- Плавный уход заставки ----------
// app.js убирает #launch через remove(). Возвращаем элемент на место и растворяем.
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (node.id !== 'launch' || node.dataset.exit || calm()) continue;
      node.dataset.exit = '1';
      document.body.append(node);
      void node.offsetWidth; // зафиксировать стартовое состояние для transition
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 750);
    }
  }
}).observe(document.body, { childList: true });

// ---------- Анимация только новых элементов ----------
// Список перерисовывается целиком, поэтому по ключам определяем, что действительно новое.
function tracker({ selector, container, keyOf, lastN, openCls, newCls, limit }) {
  let prev = new Set();
  return () => {
    const root = container ? document.querySelector(container) : document;
    if (!root) return;
    const els = [...root.querySelectorAll(selector)];
    if (!els.length) return;
    const keys = els.map(keyOf);
    const overlap = keys.some(k => prev.has(k));
    const fresh = els.filter((el, i) => !prev.has(keys[i]));
    prev = new Set(keys);
    if (!fresh.length || calm()) return;
    if (!overlap) {
      // Открыли другой чат / список: каскад из последних элементов.
      els.slice(-limit).forEach((el, i) => {
        el.style.setProperty('--i', i);
        el.classList.add(openCls);
      });
    } else {
      // Пришло новое: анимируем только то, что добавилось в конец списка.
      const tail = new Set(els.slice(-lastN));
      fresh.filter(el => tail.has(el)).forEach(el => el.classList.add(newCls));
    }
  };
}

const scanners = [
  tracker({
    selector: '.message[data-key]', container: '.messages',
    keyOf: el => el.dataset.key, lastN: 3, openCls: 'msg-open', newCls: 'msg-in', limit: 8,
  }),
  tracker({
    selector: '.chat-item', container: null,
    keyOf: el => el.dataset.chat || el.dataset.open || el.textContent.slice(0, 40),
    lastN: 3, openCls: 'item-in', newCls: 'item-in', limit: 10,
  }),
];

new MutationObserver(() => scanners.forEach(scan => scan()))
  .observe(document.body, { childList: true, subtree: true });

// ---------- Волна при нажатии на кнопки ----------
document.addEventListener('pointerdown', event => {
  if (calm() || event.button > 0) return;
  const button = event.target.closest?.('.primary,.secondary');
  if (!button || button.disabled) return;
  const box = button.getBoundingClientRect();
  const size = Math.max(box.width, box.height) * 2;
  if (getComputedStyle(button).position === 'static') button.style.position = 'relative';
  button.style.overflow = 'hidden';
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px`;
  button.append(ripple);
  setTimeout(() => ripple.remove(), 700);
}, { passive: true });

// ---------- Плавная смена экрана ----------
// Рабочая область перерисовывается и при обновлении данных, поэтому
// анимируем только когда действительно открылся другой раздел или чат.
let lastView = '';
function scanView() {
  const view = document.querySelector('.workspace > *');
  if (!view) { lastView = ''; return; }
  const title = view.querySelector('.conversation-title h3, .panel-page > header h1, .empty h2');
  const key = view.className.replace(/\s*view-in/, '') + '|' + (title?.textContent || '');
  if (key === lastView) return;
  lastView = key;
  if (calm()) return;
  view.querySelectorAll('.setting-card,.history-row,.person').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
  view.classList.remove('view-in');
  void view.offsetWidth;
  view.classList.add('view-in');
}
new MutationObserver(scanView).observe(document.body, { childList: true, subtree: true });
