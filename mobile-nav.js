/* Cipherion mobile: sausage nav, quick menu, pin bar */
(function () {
  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function enterChatMobile() {
    if (!isMobile()) return;
    document.querySelector('.sidebar')?.classList.add('hidden-mobile');
    document.querySelector('.chat-area')?.classList.add('chat-open');
    document.body.classList.add('mobile-in-chat');
  }

  function leaveChatMobile() {
    document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
    document.querySelector('.chat-area')?.classList.remove('chat-open');
    document.body.classList.remove('mobile-in-chat');
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
      if (header && header.nextSibling) {
        chatView.insertBefore(bar, header.nextSibling);
      } else {
        chatView.insertBefore(bar, chatView.firstChild);
      }
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
      bar.querySelector('.pin-text').textContent = text.trim().slice(0, 80);
      bar.classList.remove('hidden');
      bar.onclick = () => pinned.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      bar.classList.add('hidden');
    }
  }

  function enhancePinButtons() {
    document.querySelectorAll('.msg-pin').forEach((btn) => {
      if (btn.__pinBound) return;
      btn.__pinBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id || !window.token) return;
        try {
          const res = await fetch('/messages/' + id + '/pin', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + window.token },
            credentials: 'same-origin'
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(data.detail || 'Не удалось закрепить');
            return;
          }
          const msg = btn.closest('.message');
          if (msg) {
            // unpin others in UI for single pin feel
            if (data.is_pinned) {
              document.querySelectorAll('#messages .message.pinned-msg').forEach((m) => {
                if (m !== msg) m.classList.remove('pinned-msg');
              });
              msg.classList.add('pinned-msg');
            } else {
              msg.classList.remove('pinned-msg');
            }
          }
          refreshPinnedBar();
        } catch (err) {
          alert('Ошибка закрепления');
        }
      });
    });
  }

  function watchMessages() {
    const messages = document.getElementById('messages');
    if (!messages || messages.__pinObs) return;
    messages.__pinObs = true;
    const obs = new MutationObserver(() => {
      enhancePinButtons();
      refreshPinnedBar();
    });
    obs.observe(messages, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function ensureQuickMenu() {
    if (document.getElementById('quick-menu-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'quick-menu-sheet';
    sheet.className = 'quick-menu-sheet hidden';
    sheet.innerHTML = `
      <div class="quick-menu-panel">
        <div class="quick-menu-handle"></div>
        <div class="quick-menu-profile">
          <div class="avatar" id="qm-avatar">?</div>
          <div>
            <div id="qm-username" style="font-weight:600;font-size:16px"></div>
            <div style="font-size:12px;opacity:.7;margin-top:2px">в сети</div>
          </div>
        </div>
        <button type="button" class="quick-menu-item" data-action="profile"><span class="quick-menu-icon">👤</span>Мой профиль</button>
        <button type="button" class="quick-menu-item" data-action="settings"><span class="quick-menu-icon">⚙️</span>Настройки</button>
        <button type="button" class="quick-menu-item" data-action="group"><span class="quick-menu-icon">👥</span>Создать группу</button>
        <button type="button" class="quick-menu-item" data-action="channel"><span class="quick-menu-icon">📢</span>Создать канал</button>
        <button type="button" class="quick-menu-item" data-action="saved"><span class="quick-menu-icon">💾</span>Избранное</button>
        <button type="button" class="quick-menu-item" data-action="vip"><span class="quick-menu-icon">👑</span>Cipherion VIP</button>
        <div class="quick-menu-divider"></div>
        <button type="button" class="quick-menu-item" data-action="theme"><span class="quick-menu-icon" id="qm-theme-icon">☀️</span><span id="qm-theme-label">Светлый режим</span></button>
        <div class="quick-menu-divider"></div>
        <button type="button" class="quick-menu-item danger" data-action="logout"><span class="quick-menu-icon">🚪</span>Выйти</button>
      </div>`;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) closeQuickMenu();
    });

    sheet.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        closeQuickMenu();
        if (a === 'profile') document.getElementById('menu-settings')?.click();
        else if (a === 'settings') document.getElementById('menu-app-settings')?.click();
        else if (a === 'group') document.getElementById('menu-new-group')?.click();
        else if (a === 'channel') document.getElementById('menu-new-channel')?.click();
        else if (a === 'saved') document.getElementById('menu-saved')?.click();
        else if (a === 'vip') document.getElementById('menu-vip')?.click();
        else if (a === 'theme') document.getElementById('menu-theme')?.click();
        else if (a === 'logout') document.getElementById('logout-btn')?.click();
      });
    });
  }

  function openQuickMenu() {
    ensureQuickMenu();
    const sheet = document.getElementById('quick-menu-sheet');
    const name = window.username || localStorage.getItem('username') || '';
    const avUrl = window.myAvatarUrl || localStorage.getItem('avatarUrl');
    const qmName = document.getElementById('qm-username');
    const qmAv = document.getElementById('qm-avatar');
    if (qmName) qmName.textContent = name;
    if (qmAv) {
      if (avUrl) {
        qmAv.classList.add('has-photo');
        qmAv.innerHTML = '<img src="' + avUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      } else {
        qmAv.classList.remove('has-photo');
        qmAv.textContent = (name || '?')[0].toUpperCase();
      }
    }
    const light = document.body.classList.contains('light');
    const icon = document.getElementById('qm-theme-icon');
    const label = document.getElementById('qm-theme-label');
    if (icon) icon.textContent = light ? '🌙' : '☀️';
    if (label) label.textContent = light ? 'Тёмный режим' : 'Светлый режим';
    sheet.classList.remove('hidden');
  }

  function closeQuickMenu() {
    document.getElementById('quick-menu-sheet')?.classList.add('hidden');
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
          sidebar?.classList.remove('mobile-contacts-view');
        } else if (view === 'contacts') {
          sidebar?.classList.add('mobile-contacts-view');
          document.getElementById('users-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (view === 'settings') {
          openQuickMenu();
        } else if (view === 'calls') {
          // placeholder
        }
      });
    });
  }

  // Expose token for pin fetch
  Object.defineProperty(window, 'token', {
    get() {
      return localStorage.getItem('token');
    },
    configurable: true
  });

  function init() {
    bindBack();
    watchChatView();
    watchMessages();
    setupBottomNav();
    ensurePinnedBar();
    enhancePinButtons();
    // hide legacy drawer triggers
    document.getElementById('menu-btn')?.style.setProperty('display', 'none', 'important');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', init);
  setTimeout(init, 300);

  window.__cipherionMobile = { enterChatMobile, leaveChatMobile, openQuickMenu, closeQuickMenu, refreshPinnedBar };
})();
