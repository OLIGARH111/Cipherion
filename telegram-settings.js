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
      // Remove client-side session/auth state without touching settings data.
      const keys = [
        'token', 'access_token', 'auth_token', 'jwt', 'session',
        'cipherionToken', 'cipherion_token', 'cipherionUser', 'currentUser'
      ];
      keys.forEach(k => {
        try { localStorage.removeItem(k); } catch (_) {}
        try { sessionStorage.removeItem(k); } catch (_) {}
      });

      // Also clear common auth cookies when the browser allows it.
      try {
        document.cookie.split(';').forEach(part => {
          const name = part.split('=')[0].trim();
          if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        });
      } catch (_) {}

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
