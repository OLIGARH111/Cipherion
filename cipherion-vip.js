/* Cipherion VIP — premium feature center inspired by modern messenger settings */
(() => {
  'use strict';

  const FEATURES = [
    ['stories','◉','Истории','Публикация историй без ограничений, расширенный контроль просмотра.'],
    ['storage','▣','Безлимитное хранилище','Большие файлы и расширенное облачное хранилище.'],
    ['limits','×2','Удвоенные лимиты','Больше папок, закреплённых чатов, ссылок и каналов.'],
    ['business','▦','Cipherion для бизнеса','Дополнительные возможности для владельцев бизнеса.'],
    ['lastseen','◷','Время захода','Расширенный контроль времени захода и прочтения.'],
    ['transcription','◉','Распознавание голоса','Расшифровка входящих голосовых сообщений.'],
    ['fast-download','↯','Ускоренная загрузка','Приоритетная загрузка фото, видео и файлов.'],
    ['translation','文','Перевод в реальном времени','Динамический перевод сообщений в чатах.'],
    ['animated-emoji','☺','Анимированные эмодзи','Дополнительные анимированные эмодзи в чатах.'],
    ['emoji-status','☻','Эмодзи-статусы','Установка эмодзи рядом с именем профиля.'],
    ['saved-tags','⌑','Теги в Избранном','Теги для сообщений в Избранном и быстрого поиска.'],
    ['profile-colors','✎','Цвета имени и профиля','Цвет имени, профиля и оформления ответов.'],
    ['wallpapers','▧','Обои для Вас и собеседника','Персональные обои для личных чатов.'],
    ['badge','★','Значок подписчика','Премиум-значок рядом с именем.'],
    ['message-limits','▣','Ограничение сообщений','Расширенный контроль входящих сообщений.'],
    ['copy-protection','✦','Запрет на копирование','Защита от пересылки, сохранения и копирования.'],
    ['chat-management','●','Управление чатами','Расширенное управление папками и новыми чатами.'],
    ['no-ads','◩','Отключение рекламы','Убирает рекламные блоки в поддерживаемых разделах.'],
    ['app-icon','▦','Иконка приложения','Эксклюзивные варианты иконки Cipherion.'],
    ['reactions','♥','Реакции без границ','Больше реакций и расширенный выбор эмодзи.'],
    ['video-avatar','▶','Активные видеоаватары','Видеоаватар как способ самовыражения.'],
    ['stickers','☺','Эксклюзивные стикеры','Премиальные наборы с уникальной анимацией.'],
    ['effects','✧','Эффекты в сообщениях','Дополнительные анимированные эффекты сообщений.'],
    ['ai','AI','Возможности ИИ','Перевод, изменение стиля и помощь при написании.'],
    ['formatting','A=','Расширенное форматирование','Заголовки, таблицы, ИИ-тексты и медиавставки.'],
    ['tasks','✓','Списки задач','Планирование и отслеживание задач прямо в мессенджере.']
  ];

  const KEY = 'cipherionVipFeatures';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
  };
  const write = state => localStorage.setItem(KEY, JSON.stringify(state));

  function ensureStyle() {
    if (document.getElementById('cipherion-vip-css')) return;
    const link = document.createElement('link');
    link.id = 'cipherion-vip-css';
    link.rel = 'stylesheet';
    link.href = '/cipherion-vip.css?v=20260905-1';
    document.head.appendChild(link);
  }

  function closeExisting() {
    document.getElementById('vip-modal')?.classList.add('hidden');
  }

  function openVIP() {
    ensureStyle();
    closeExisting();
    let root = document.getElementById('cipherion-vip-screen');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cipherion-vip-screen';
      root.className = 'cipherion-vip-screen hidden';
      document.body.appendChild(root);
    }
    const state = read();
    const active = localStorage.getItem('isVip') === '1';
    root.innerHTML = `
      <div class="cvip-shell">
        <header class="cvip-header">
          <button type="button" class="cvip-back" aria-label="Назад">‹</button>
          <div><h1>Cipherion VIP</h1><span>${active ? 'VIP активен' : 'Премиум-возможности'}</span></div>
          <button type="button" class="cvip-more" aria-label="Информация">•••</button>
        </header>
        <div class="cvip-scroll">
          <div class="cvip-hero">
            <div class="cvip-crown">👑</div>
            <div><strong>Cipherion VIP</strong><p>Расширьте возможности мессенджера</p></div>
          </div>
          <div class="cvip-section-title">ПРЕИМУЩЕСТВА ПОДПИСКИ</div>
          <section class="cvip-card">
            ${FEATURES.map(([id,icon,title,desc]) => `
              <button type="button" class="cvip-feature" data-feature="${id}">
                <span class="cvip-icon">${icon}</span><span class="cvip-feature-copy"><b>${title}</b><small>${desc}</small></span><span class="cvip-check">${state[id] ? '✓' : '›'}</span>
              </button>`).join('')}
          </section>
          <div class="cvip-section-title">О CIPHERION VIP</div>
          <section class="cvip-about"><p>VIP объединяет расширенные возможности оформления, общения, медиа, приватности и продуктивности.</p></section>
        </div>
        <div class="cvip-bottom"><button type="button" class="cvip-subscribe">${active ? 'VIP активен' : 'Подключить Cipherion VIP'}</button></div>
      </div>`;
    document.body.appendChild(root);
    root.classList.remove('hidden');
    root.querySelector('.cvip-back').onclick = () => root.classList.add('hidden');
    root.querySelector('.cvip-more').onclick = () => alert('Cipherion VIP\nПремиум-функции проекта.');
    root.querySelector('.cvip-subscribe').onclick = () => {
      if (localStorage.getItem('isVip') !== '1') {
        localStorage.setItem('isVip', '1');
        root.querySelector('.cvip-subscribe').textContent = 'VIP активен';
        alert('Cipherion VIP активирован.');
        openVIP();
      }
    };
    root.querySelectorAll('.cvip-feature').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.feature;
        const next = read(); next[id] = !next[id]; write(next);
        btn.querySelector('.cvip-check').textContent = next[id] ? '✓' : '›';
        document.documentElement.dataset[`vip${id.replace(/-([a-z])/g, (_,c) => c.toUpperCase())}`] = next[id] ? '1' : '0';
      };
    });
    requestAnimationFrame(() => root.querySelector('.cvip-scroll')?.scrollTo(0, 0));
  }

  function bind() {
    ensureStyle();
    const menu = document.getElementById('menu-vip');
    if (menu && !menu.dataset.cipherionVipBound) {
      menu.dataset.cipherionVipBound = '1';
      menu.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); openVIP(); }, true);
    }
    document.addEventListener('click', e => {
      const button = e.target.closest('.vip-settings-open, [data-open-vip]');
      if (button) { e.preventDefault(); openVIP(); }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true}); else bind();
  window.openCipherionVIP = openVIP;
})();
