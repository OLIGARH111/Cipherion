/* Cipherion mobile: flat settings, pin, auth gate */
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

  function openAppSection(section) {
    // Map to data-section buttons in app-settings-modal
    const map = {
      security: 'security',
      chat: 'chat-style',
      language: 'language',
      sound: 'av',
      anim: 'anim',
      notif: 'notif'
    };
    const key = map[section] || section;
    document.getElementById('menu-app-settings')?.click();
    setTimeout(() => {
      const btn = document.querySelector('.app-set-nav[data-section="' + key + '"]');
      btn?.click();
    }, 80);
  }

  function ensureSettingsPanel() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return null;
    let panel = document.getElementById('settings-panel');
    if (panel) {
      // upgrade content if old nested version
      if (!panel.querySelector('[data-sp="security"]')) {
        panel.remove();
        panel = null;
      } else return panel;
    }
    panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.innerHTML = `
      <div class="sp-header">Настройки</div>
      <div class="sp-profile" data-sp="profile">
        <div class="sp-av" id="sp-avatar">?</div>
        <div>
          <div class="sp-name" id="sp-username">Пользователь</div>
          <div class="sp-sub">Мой профиль ›</div>
        </div>
      </div>
      <div class="sp-section">Аккаунт</div>
      <button type="button" class="sp-item" data-sp="profile"><span class="sp-ico">👤</span>Мой профиль</button>
      <button type="button" class="sp-item" data-sp="vip"><span class="sp-ico">👑</span>Cipherion VIP</button>
      <div class="sp-section">Приватность и приложение</div>
      <button type="button" class="sp-item" data-sp="security"><span class="sp-ico">🔒</span>Безопасность</button>
      <button type="button" class="sp-item" data-sp="chat"><span class="sp-ico">🎨</span>Оформление чатов</button>
      <button type="button" class="sp-item" data-sp="language"><span class="sp-ico">🌐</span>Язык</button>
      <button type="button" class="sp-item" data-sp="sound"><span class="sp-ico">🔊</span>Звук и медиа</button>
      <button type="button" class="sp-item" data-sp="anim"><span class="sp-ico">✨</span>Анимации</button>
      <button type="button" class="sp-item" data-sp="notif"><span class="sp-ico">🔔</span>Уведомления</button>
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
      if (a === 'profile') document.getElementById('menu-settings')?.click();
      else if (a === 'vip') document.getElementById('menu-vip')?.click();
      else if (a === 'security' || a === 'chat' || a === 'language' || a === 'sound' || a === 'anim' || a === 'notif') openAppSection(a);
      else if (a === 'group') document.getElementById('menu-new-group')?.click();
      else if (a === 'channel') document.getElementById('menu-new-channel')?.click();
      else if (a === 'saved') document.getElementById('menu-saved')?.click();
      else if (a === 'theme') {
        document.getElementById('menu-theme')?.click();
        setTimeout(fillSettingsProfile, 50);
      } else if (a === 'logout') document.getElementById('logout-btn')?.click();
    });
    return panel;
  }

  function fillSettingsProfile() {
    const name = localStorage.getItem('username') || '';
    const avUrl = localStorage.getItem('avatarUrl');
    const n = document.getElementById('sp-username');
    const a = document.getElementById('sp-avatar');
    if (n) n.textContent = name || 'Пользователь';
    if (a) {
      if (avUrl) a.innerHTML = '<img src="' + avUrl + '" alt="">';
      else a.textContent = (name || '?')[0].toUpperCase();
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
    refreshPinnedBar, syncAppReady, pinMessage
  };
})();
