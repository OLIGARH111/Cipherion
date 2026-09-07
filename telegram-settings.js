/* Cipherion — settings and mobile bridge */
(() => {
  'use strict';

  const init = () => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal) return;

    let logout = modal.querySelector('.settings-home-logout');
    const nav = modal.querySelector('.app-settings-nav');
    if (nav && !logout) {
      logout = document.createElement('div');
      logout.className = 'settings-home-logout';
      logout.innerHTML = '<button type="button" class="settings-logout-btn">🚪 Выйти</button>';
      nav.appendChild(logout);
    }

    const performLogout = () => {
      try { window.__cipherionWS?.close(1000, 'logout'); } catch (_) {}
      try { localStorage.removeItem('token'); localStorage.removeItem('userId'); localStorage.removeItem('username'); } catch (_) {}
      try { sessionStorage.removeItem('token'); sessionStorage.removeItem('userId'); sessionStorage.removeItem('username'); } catch (_) {}
      try {
        if (typeof window.logout === 'function') {
          window.logout();
          return;
        }
      } catch (_) {}
      window.location.reload();
    };

    const bindLogout = () => {
      const button = modal.querySelector('.settings-logout-btn');
      if (!button || button.dataset.logoutBound === '1') return;
      button.dataset.logoutBound = '1';
      button.type = 'button';
      button.style.pointerEvents = 'auto';
      button.style.position = 'relative';
      button.style.zIndex = '100002';
      ['pointerdown', 'touchstart', 'click'].forEach(type => {
        button.addEventListener(type, e => {
          e.preventDefault();
          e.stopPropagation();
          performLogout();
        }, { capture: true, passive: false });
      });
    };

    bindLogout();
    if (nav) new MutationObserver(bindLogout).observe(nav, {childList:true, subtree:true});

    // Delegated fallback: catches the Settings logout even if another UI layer
    // replaces the button or re-renders the settings navigation.
    document.addEventListener('pointerdown', e => {
      if (e.target?.closest?.('#app-settings-modal .settings-logout-btn')) {
        e.preventDefault();
        e.stopPropagation();
        performLogout();
      }
    }, { capture: true, passive: false });
  };

  const loadAssets = () => {
    if (!document.getElementById('mobile-final-fix-css')) {
      const css = document.createElement('link');
      css.id = 'mobile-final-fix-css';
      css.rel = 'stylesheet';
      css.href = '/mobile-final-fix.css?v=20260905-1';
      document.head.appendChild(css);
    }
    if (!document.getElementById('mobile-stability-fix-js')) {
      const script = document.createElement('script');
      script.id = 'mobile-stability-fix-js';
      script.src = '/mobile-stability-fix.js?v=20260905-2';
      script.defer = true;
      document.head.appendChild(script);
    }
    if (!document.getElementById('cipherion-enhancements-css')) {
      const css = document.createElement('link');
      css.id = 'cipherion-enhancements-css';
      css.rel = 'stylesheet';
      css.href = '/cipherion-enhancements.css?v=20260905-1';
      document.head.appendChild(css);
    }
    if (!document.getElementById('cipherion-enhancements-js')) {
      const script = document.createElement('script');
      script.id = 'cipherion-enhancements-js';
      script.src = '/cipherion-enhancements.js?v=20260905-1';
      script.defer = true;
      document.head.appendChild(script);
    }
    if (!document.getElementById('cipherion-runtime-fix-js')) {
      const script = document.createElement('script');
      script.id = 'cipherion-runtime-fix-js';
      script.src = '/cipherion-runtime-fix.js?v=20260905-1';
      script.defer = true;
      document.head.appendChild(script);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); loadAssets(); }, {once:true});
  } else {
    init();
    loadAssets();
  }
})();
