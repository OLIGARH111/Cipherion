/* Cipherion mobile: settings inline, pin, auth gate */
(function () {
  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function syncAppReady() {
    const auth = document.getElementById('auth-screen');
    const app = document.getElementById('app-screen');
    const onApp = !!(app && !app.classList.contains('hidden'));
    document.body.classList.toggle('app-ready', onApp);
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    if (!onApp || (auth && !auth.classList.contains('hidden'))) {
      nav.style.setProperty('display', 'none', 'important');
    } else if (document.body.classList.contains('mobile-in-chat')) {
      nav.style.setProperty('display', 'none', 'important');
    } else if (isMobile()) {
      nav.style.setProperty('display', 'grid', 'important');
    }
  }

  function enterChatMobile() {
    if (!isMobile()) return;
    document.querySelector('.sidebar')?.classList.add('hidden-mobile');
    document.querySelector('.chat-area')?.classList.add('chat-open');
    document.body.classList.add('mobile-in-chat');
    syncAppReady();
  }

  function leaveChatMobile() {
    document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
    document.querySelector('.chat-area')?.classList.remove('chat-open');
    document.body.classList.remove('mobile-in-chat');
    syncAppReady();
  }

  function inlineBlock(a) {
    const titles = {
      security: 'Безопасность',
      chat: 'Оформление чатов',
      language: 'Язык',
      sound: 'Звук и медиа',
      anim: 'Анимации',
      notif: 'Уведомления'
    };
    let body = '';
    if (a === 'security') {
      body = `
        <label class="set-row"><span>Облачный пароль</span><input type="password" id="sp-cloud" placeholder="Новый"></label>
        <label class="set-row"><span>Код-пароль</span><input type="password" id="sp-code" maxlength="6" placeholder="4–6 цифр"></label>
        <label class="set-row"><span>Кто видит номер</span>
          <select id="sp-priv-phone"><option value="all">Все</option><option value="contacts" selected>Контакты</option><option value="nobody">Никто</option></select>
        </label>
        <label class="set-row"><span>Кто видит онлайн</span>
          <select id="sp-priv-online"><option value="all" selected>Все</option><option value="contacts">Контакты</option><option value="nobody">Никто</option></select>
        </label>`;
    } else if (a === 'chat') {
      body = `
        <label class="set-row"><span>Шрифт</span>
          <select id="sp-font"><option value="14">S</option><option value="15" selected>M</option><option value="17">L</option><option value="19">XL</option></select>
        </label>
        <label class="set-row"><span>Плотность</span>
          <select id="sp-density"><option value="compact">Компактно</option><option value="normal" selected>Обычная</option><option value="relaxed">Свободная</option></select>
        </label>`;
    } else if (a === 'language') {
      body = `<label class="set-row"><span>Язык</span><select><option selected>Русский</option><option>English</option><option>Українська</option></select></label>`;
    } else if (a === 'sound') {
      body = `
        <label class="set-row"><span>Звук отправки</span><input type="checkbox" checked></label>
        <label class="set-row"><span>Звук входящих</span><input type="checkbox" checked></label>`;
    } else if (a === 'anim') {
      body = `
        <label class="set-row"><span>Анимации</span><input type="checkbox" checked></label>
        <label class="set-row"><span>Меньше движения</span><input type="checkbox"></label>`;
    } else if (a === 'notif') {
      body = `
        <label class="set-row"><span>В браузере</span><input type="checkbox" checked></label>
        <label class="set-row"><span>Не беспокоить</span><input type="checkbox"></label>`;
    }
    return `<div class="sp-inline-title">${titles[a] || ''}</div>${body}`;
  }

  function ensureSettingsPanel() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return null;
    let panel = document.getElementById('settings-panel');
    // Always rebuild to apply new layout
    if (panel && !panel.dataset.v2) {
      panel.remove();
      panel = null;
    }
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.dataset.v2 = '1';
    panel.innerHTML = `
      <div class="sp-header">Настройки</div>
      <div class="sp-hero" id="sp-hero">
        <div class="sp-av-lg" id="sp-avatar">?</div>
        <div class="sp-meta-line" id="sp-meta-line">—</div>
      </div>
      <div class="sp-section">Аккаунт</div>
      <button type="button" class="sp-item" data-sp="vip"><span class="sp-ico">👑</span>Cipherion VIP</button>
      <div class="sp-section">Приватность и приложение</div>
      <button type="button" class="sp-item" data-sp="security"><span class="sp-ico">🔒</span>Безопасность</button>
      <div class="sp-inline" data-for="security"></div>
      <button type="button" class="sp-item" data-sp="chat"><span class="sp-ico">🎨</span>Оформление чатов</button>
      <div class="sp-inline" data-for="chat"></div>
      <button type="button" class="sp-item" data-sp="language"><span class="sp-ico">🌐</span>Язык</button>
      <div class="sp-inline" data-for="language"></div>
      <button type="button" class="sp-item" data-sp="sound"><span class="sp-ico">🔊</span>Звук и медиа</button>
      <div class="sp-inline" data-for="sound"></div>
      <button type="button" class="sp-item" data-sp="anim"><span class="sp-ico">✨</span>Анимации</button>
      <div class="sp-inline" data-for="anim"></div>
      <button type="button" class="sp-item" data-sp="notif"><span class="sp-ico">🔔</span>Уведомления</button>
      <div class="sp-inline" data-for="notif"></div>
      <div class="sp-section">Создать</div>
      <button type="button" class="sp-item" data-sp="group"><span class="sp-ico">👥</span>Создать группу</button>
      <button type="button" class="sp-item" data-sp="channel"><span class="sp-ico">📢</span>Создать канал</button>
      <button type="button" class="sp-item" data-sp="saved"><span class="sp-ico">💾</span>Избранное</button>
      <div class="sp-section">Внешний вид</div>
      <button type="button" class="sp-item" data-sp="theme"><span class="sp-ico" id="sp-theme-ico">☀️</span><span id="sp-theme-label">Светлый режим</span></button>
      <div class="sp-section">Сессия</div>
      <button type="button" class="sp-item danger" data-sp="logout"><span class="sp-ico">🚪</span>Выйти</button>
    `;
    sidebar.appendChild(panel);

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sp]');
      if (!btn) return;
      const a = btn.getAttribute('data-sp');
      const inlineKeys = ['security', 'chat', 'language', 'sound', 'anim', 'notif'];

      if (inlineKeys.includes(a)) {
        e.preventDefault();
        e.stopPropagation();
        // close other inlines
        panel.querySelectorAll('.sp-inline').forEach((b) => {
          if (b.dataset.for !== a) b.classList.remove('open');
        });
        const block = panel.querySelector('.sp-inline[data-for="' + a + '"]');
        if (!block) return;
        if (!block.dataset.filled) {
          block.innerHTML = inlineBlock(a);
          block.dataset.filled = '1';
          const font = block.querySelector('#sp-font');
          font?.addEventListener('change', () => {
            document.querySelectorAll('.message').forEach((m) => {
              m.style.fontSize = font.value + 'px';
            });
          });
        }
        block.classList.toggle('open');
        return;
      }

      if (a === 'vip') document.getElementById('menu-vip')?.click();
      else if (a === 'group') document.getElementById('menu-new-group')?.click();
      else if (a === 'channel') document.getElementById('menu-new-channel')?.click();
      else if (a === 'saved') document.getElementById('menu-saved')?.click();
      else if (a === 'theme') {
        document.getElementById('menu-theme')?.click();
        setTimeout(fillSettingsProfile, 50);
      } else if (a === 'logout') document.getElementById('logout-btn')?.click();
    });

    // Tap avatar → edit profile modal (optional, not a list item)
    panel.querySelector('#sp-hero')?.addEventListener('click', () => {
      document.getElementById('menu-settings')?.click();
    });

    return panel;
  }

  async function fillSettingsProfile() {
    const name = localStorage.getItem('username') || '';
    let phone = localStorage.getItem('phone') || '';
    let avUrl = localStorage.getItem('avatarUrl');

    try {
      const tok = localStorage.getItem('token');
      if (tok) {
        const res = await fetch('/me', {
          headers: { Authorization: 'Bearer ' + tok },
          credentials: 'same-origin'
        });
        if (res.ok) {
          const me = await res.json();
          if (me.phone) {
            phone = me.phone;
            localStorage.setItem('phone', phone);
          }
          if (me.username) localStorage.setItem('username', me.username);
          if (me.avatar_url) {
            avUrl = me.avatar_url;
            localStorage.setItem('avatarUrl', avUrl);
          }
        }
      }
    } catch (e) {}

    const uname = localStorage.getItem('username') || name || 'Пользователь';
    const a = document.getElementById('sp-avatar');
    const meta = document.getElementById('sp-meta-line');
    if (a) {
      if (avUrl) a.innerHTML = '<img src="' + avUrl + '" alt="">';
      else a.textContent = (uname || '?')[0].toUpperCase();
    }
    if (meta) {
      const parts = [];
      if (phone) parts.push(phone);
      if (uname) parts.push(uname);
      meta.textContent = parts.length ? parts.join(' · ') : uname;
    }
    const light = document.body.classList.contains('light');
    const ico = document.getElementById('sp-theme-ico');
    const lab = document.getElementById('sp-theme-label');
    if (ico) ico.textContent = light ? '🌙' : '☀️';
    if (lab) lab.textContent = light ? 'Тёмный режим' : 'Светлый режим';
  }

  function openSettingsView() {
    ensureSettingsPanel();
    fillSettingsProfile();
    leaveChatMobile();
    const sidebar = document.querySelector('.sidebar');
    sidebar?.classList.remove('mobile-contacts-view');
    sidebar?.classList.add('mobile-settings-view');
    document.getElementById('settings-panel')?.style.setProperty('display', 'flex');
  }

  function closeSettingsView() {
    document.querySelector('.sidebar')?.classList.remove('mobile-settings-view');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.style.display = 'none';
  }

  function ensurePinnedBar() {
    const chatView = document.getElementById('chat-view');
    if (!chatView) return null;
    let bar = document.getElementById('pinned-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pinned-bar';
      bar.className = 'pinned-bar hidden';
      bar.innerHTML = '<span class="pin-icon">📌</span><span class="pin-text"></span>';
      const header = chatView.querySelector('.chat-header');
      if (header && header.nextSibling) chatView.insertBefore(bar, header.nextSibling);
      else chatView.insertBefore(bar, chatView.firstChild);
    }
    return bar;
  }

  function refreshPinnedBar() {
    const bar = ensurePinnedBar();
    if (!bar) return;
    const pinned = document.querySelector('#messages .message.pinned-msg');
    if (pinned) {
      const text =
        pinned.querySelector('.message-sticker')?.textContent ||
        pinned.querySelector('.poll-q')?.textContent ||
        pinned.querySelector('div:not(.message-sender):not(.message-time):not(.msg-actions)')?.textContent ||
        'Закреплённое сообщение';
      bar.querySelector('.pin-text').textContent = String(text || '').trim().slice(0, 80);
      bar.classList.remove('hidden');
      bar.onclick = () => pinned.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else bar.classList.add('hidden');
  }

  async function pinMessage(id, msgEl) {
    const tok = localStorage.getItem('token');
    if (!id || !tok) return;
    try {
      const res = await fetch('/messages/' + id + '/pin', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok },
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.detail || 'Не удалось закрепить');
        return;
      }
      if (data.is_pinned) {
        document.querySelectorAll('#messages .message.pinned-msg').forEach((m) => {
          if (m !== msgEl) m.classList.remove('pinned-msg');
        });
        msgEl?.classList.add('pinned-msg');
      } else msgEl?.classList.remove('pinned-msg');
      refreshPinnedBar();
    } catch (e) {
      alert('Ошибка закрепления');
    }
  }

  function enhancePinButtons() {
    document.querySelectorAll('.msg-pin').forEach((btn) => {
      if (btn.__pinBound2) return;
      btn.__pinBound2 = true;
      const fresh = btn.cloneNode(true);
      fresh.__pinBound2 = true;
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        pinMessage(fresh.dataset.id, fresh.closest('.message'));
      });
    });
  }

  function watchMessages() {
    const messages = document.getElementById('messages');
    if (!messages || messages.__pinObs) return;
    messages.__pinObs = true;
    new MutationObserver(() => {
      enhancePinButtons();
      refreshPinnedBar();
    }).observe(messages, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function watchChatView() {
    const chatView = document.getElementById('chat-view');
    if (!chatView || chatView.__mobObs) return;
    chatView.__mobObs = true;
    new MutationObserver(() => {
      if (!isMobile()) return;
      if (!chatView.classList.contains('hidden')) enterChatMobile();
    }).observe(chatView, { attributes: true, attributeFilter: ['class'] });
  }

  function watchAuthApp() {
    const auth = document.getElementById('auth-screen');
    const app = document.getElementById('app-screen');
    const obs = new MutationObserver(syncAppReady);
    if (auth) obs.observe(auth, { attributes: true, attributeFilter: ['class'] });
    if (app) obs.observe(app, { attributes: true, attributeFilter: ['class'] });
    syncAppReady();
  }

  function bindBack() {
    const backBtn = document.getElementById('back-btn');
    if (!backBtn || backBtn.__mobileBound) return;
    backBtn.__mobileBound = true;
    backBtn.addEventListener('click', () => leaveChatMobile());
  }

  function setupBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav || nav.__sausageBound) return;
    nav.__sausageBound = true;
    nav.querySelectorAll('.mobile-nav-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        nav.querySelectorAll('.mobile-nav-item').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.mobileView;
        leaveChatMobile();
        const sidebar = document.querySelector('.sidebar');
        if (view === 'chats') {
          closeSettingsView();
          sidebar?.classList.remove('mobile-contacts-view');
        } else if (view === 'contacts') {
          closeSettingsView();
          sidebar?.classList.add('mobile-contacts-view');
          document.getElementById('users-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (view === 'settings') {
          openSettingsView();
        } else {
          closeSettingsView();
          sidebar?.classList.remove('mobile-contacts-view');
        }
      });
    });
  }

  function init() {
    bindBack();
    watchChatView();
    watchMessages();
    watchAuthApp();
    setupBottomNav();
    ensurePinnedBar();
    enhancePinButtons();
    ensureSettingsPanel();
    syncAppReady();
    document.getElementById('menu-btn')?.style.setProperty('display', 'none', 'important');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
  setTimeout(init, 300);
  setTimeout(syncAppReady, 800);

  window.__cipherionMobile = {
    enterChatMobile, leaveChatMobile, openSettingsView, closeSettingsView,
    refreshPinnedBar, syncAppReady, pinMessage, fillSettingsProfile
  };
})();
