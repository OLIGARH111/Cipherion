/* Cipherion final UI/function safety hooks. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bind = (id, fn) => { const e = $(id); if (!e || e.__finalFix) return; e.__finalFix = true; e.addEventListener('click', fn); };

  // The video-note overlay must always have working controls.
  bind('video-note-stop', () => window.stopRecording?.(true));
  bind('video-note-cancel', () => window.stopRecording?.(false));

  // Keep the auth navigation clean on mobile and desktop.
  function syncAuthNav() {
    const auth = $('auth-screen');
    const nav = $('mobile-bottom-nav');
    if (!auth || !nav) return;
    nav.style.display = auth.classList.contains('hidden') ? '' : 'none';
  }
  syncAuthNav();
  new MutationObserver(syncAuthNav).observe($('auth-screen') || document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  // Browser notification permission is requested only when the user explicitly enables it.
  bind('app-settings-save', async () => {
    const enabled = $('set-browser-notif')?.checked;
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }
  });

  // Apply local settings immediately when they change.
  const savedFont = localStorage.getItem('cipherion_font');
  if (savedFont) document.documentElement.style.setProperty('--cipherion-font-size', savedFont + 'px');
  if (localStorage.getItem('cipherion_reduce_motion') === '1') document.body.classList.add('reduce-motion');

  // Prevent accidental form submission while an attachment/recording is active.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && typeof window.stopRecording === 'function' && $('recording-indicator') && !$('recording-indicator').classList.contains('hidden')) {
      window.stopRecording(false);
    }
  });
})();
