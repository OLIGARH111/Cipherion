/* Cipherion — settings navigation */
(() => {
  'use strict';
  const init = () => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal || modal.dataset.settingsLogoutFixed === '1') return;
    modal.dataset.settingsLogoutFixed = '1';

    const nav = modal.querySelector('.app-settings-nav');
    const content = modal.querySelector('.app-settings-content');
    if (!nav || !content) return;

    // Keep the existing settings UI, but make the logout action independent
    // from the drawer button. This prevents another handler from swallowing it.
    let logout = nav.querySelector('.settings-home-logout');
    if (!logout) {
      logout = document.createElement('div');
      logout.className = 'settings-home-logout';
      logout.innerHTML = '<button type="button" class="settings-logout-btn">🚪 Выйти</button>';
      nav.appendChild(logout);
    }

    const performLogout = () => {
      // Prefer the app's own logout routine so every auth key used by Cipherion
      // is cleared consistently. Fall back to local cleanup if it is unavailable.
      try {
        if (typeof window.logout === 'function' && window.logout !== performLogout) {
          window.logout();
          return;
        }
      } catch (_) {}

      const keys = [
        'token', 'access_token', 'auth_token', 'jwt', 'session',
        'cipherionToken', 'cipherion_token', 'cipherionUser', 'currentUser',
        'userId', 'username'
      ];
      keys.forEach(k => {
        try { localStorage.removeItem(k); } catch (_) {}
        try { sessionStorage.removeItem(k); } catch (_) {}
      });

      modal.classList.add('hidden');
      document.getElementById('app-screen')?.classList.add('hidden');
      document.getElementById('auth-screen')?.classList.remove('hidden');
      document.body.classList.remove('chat-open', 'settings-subpage');
      window.location.reload();
    };

    const bindLogout = () => {
      const button = logout.querySelector('button');
      if (!button || button.dataset.logoutBound === '1') return;
      button.dataset.logoutBound = '1';
      button.type = 'button';
      button.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        performLogout();
      }, true);
    };
    bindLogout();

    // If another settings script rebuilds the navigation, restore the button.
    new MutationObserver(bindLogout).observe(nav, {childList: true, subtree: true});
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once: true});
  } else {
    init();
  }
})();

/* Load the mobile stability bridge after the existing app scripts are ready. */
(() => {
  const load = () => {
    if (document.getElementById('mobile-stability-fix-js')) return;
    const script = document.createElement('script');
    script.id = 'mobile-stability-fix-js';
    script.src = '/mobile-stability-fix.js?v=20260905-1';
    script.defer = true;
    document.head.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true});
  else load();
})();
