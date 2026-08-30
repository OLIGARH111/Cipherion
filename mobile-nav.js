/* Cipherion mobile vertical navigation helpers */
(function () {
  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function enterChatMobile() {
    if (!isMobile()) return;
    const sidebar = document.querySelector('.sidebar');
    const chatArea = document.querySelector('.chat-area');
    sidebar?.classList.add('hidden-mobile');
    chatArea?.classList.add('chat-open');
    document.body.classList.add('mobile-in-chat');
  }

  function leaveChatMobile() {
    const sidebar = document.querySelector('.sidebar');
    const chatArea = document.querySelector('.chat-area');
    sidebar?.classList.remove('hidden-mobile');
    chatArea?.classList.remove('chat-open');
    document.body.classList.remove('mobile-in-chat');
  }

  // Hook openChat if already defined, else wait
  function patchOpenChat() {
    if (typeof window.openChat !== 'function' && typeof openChat === 'function') {
      // openChat is in global scope of app.js (not on window if const/let)
    }
    // app.js uses function openChat — it's global function declaration, on window
    const original = window.openChat;
    if (typeof original === 'function' && !original.__mobilePatched) {
      window.openChat = async function patchedOpenChat() {
        const result = await original.apply(this, arguments);
        enterChatMobile();
        return result;
      };
      window.openChat.__mobilePatched = true;
    } else if (typeof openChat === 'function') {
      // Try to patch via assignment — openChat from app.js is function declaration
      try {
        const orig = openChat;
        if (!orig.__mobilePatched) {
          // eslint-disable-next-line no-global-assign
          openChat = async function () {
            const result = await orig.apply(this, arguments);
            enterChatMobile();
            return result;
          };
          openChat.__mobilePatched = true;
          window.openChat = openChat;
        }
      } catch (e) {}
    }
  }

  // Observe chat-view visibility as fallback
  function watchChatView() {
    const chatView = document.getElementById('chat-view');
    if (!chatView) return;
    const obs = new MutationObserver(() => {
      if (!isMobile()) return;
      if (!chatView.classList.contains('hidden')) {
        enterChatMobile();
      }
    });
    obs.observe(chatView, { attributes: true, attributeFilter: ['class'] });
  }

  function bindBack() {
    const backBtn = document.getElementById('back-btn');
    if (!backBtn || backBtn.__mobileBound) return;
    backBtn.__mobileBound = true;
    backBtn.addEventListener('click', () => {
      leaveChatMobile();
    });
  }

  function setupBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav || nav.__mobileBound) return;
    nav.__mobileBound = true;
    nav.querySelectorAll('.mobile-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
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
          document.getElementById('menu-app-settings')?.click();
        }
      });
    });
  }

  function init() {
    patchOpenChat();
    bindBack();
    watchChatView();
    setupBottomNav();
    // retry patch in case app.js loads after
    setTimeout(patchOpenChat, 100);
    setTimeout(patchOpenChat, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', init);

  // Expose for debugging
  window.__cipherionMobile = { enterChatMobile, leaveChatMobile, isMobile };
})();
