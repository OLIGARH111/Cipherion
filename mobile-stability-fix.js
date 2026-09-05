/* Cipherion — mobile stability bridge */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nav = () => $('mobile-bottom-nav');
  const settings = () => $('app-settings-modal');
  const chat = () => $('chat-view');

  function sync() {
    const n = nav();
    if (!n) return;
    const s = settings();
    const c = chat();
    const settingsOpen = !!s && !s.classList.contains('hidden');
    const chatOpen = !!c && !c.classList.contains('hidden');
    const subpage = document.body.classList.contains('settings-subpage');

    n.classList.remove('nav-hidden');
    n.style.visibility = 'visible';
    n.style.pointerEvents = 'auto';

    if (chatOpen) {
      n.style.display = 'none';
      n.style.opacity = '0';
      n.style.pointerEvents = 'none';
    } else if (settingsOpen && subpage) {
      n.style.display = 'none';
      n.style.opacity = '0';
      n.style.pointerEvents = 'none';
    } else {
      n.style.display = 'flex';
      n.style.opacity = '1';
    }
  }

  function closeChat() {
    $('chat-view')?.classList.add('hidden');
    $('no-chat')?.classList.remove('hidden');
    document.body.classList.remove('chat-open');
    document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
    sync();
  }

  function openChatVisual() {
    $('no-chat')?.classList.add('hidden');
    $('chat-view')?.classList.remove('hidden');
    document.body.classList.add('chat-open');
    document.querySelector('.sidebar')?.classList.add('hidden-mobile');
    sync();
  }

  function showMain(view) {
    const s = settings();
    if (view === 'settings') {
      closeChat();
      s?.classList.remove('hidden');
      document.body.classList.remove('settings-subpage');
    } else if (view === 'chats') {
      s?.classList.add('hidden');
      document.body.classList.remove('settings-subpage');
      closeChat();
    } else if (view === 'contacts') {
      s?.classList.add('hidden');
      document.body.classList.remove('settings-subpage');
      closeChat();
      $('users-list')?.scrollIntoView({behavior:'smooth', block:'start'});
    } else if (view === 'calls') {
      s?.classList.add('hidden');
      document.body.classList.remove('settings-subpage');
      closeChat();
      alert('Звонки доступны внутри чатов.');
    }
    document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.toggle('active', b.dataset.mobileView === view));
    sync();
  }

  // Navigation: do not let an old handler swallow the iPhone bottom bar.
  document.addEventListener('click', e => {
    const item = e.target.closest('.mobile-nav-item');
    if (item) {
      const view = item.dataset.mobileView;
      if (view) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showMain(view);
        return;
      }
    }

    const logout = e.target.closest('.settings-logout-btn, #settings-logout-btn');
    if (logout) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        if (typeof window.logout === 'function') window.logout();
        else window.location.href = window.location.pathname;
      } catch (_) { window.location.reload(); }
      return;
    }

    const back = e.target.closest('#back-btn');
    if (back) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeChat();
    }
  }, true);

  // Make a contact/chat immediately enter the mobile chat shell. app.js still
  // performs the real API request and fills the messages/header afterwards.
  document.addEventListener('click', e => {
    const row = e.target.closest('#chats-list .list-item[data-chat-id], #users-list .list-item[data-user-id]');
    if (!row) return;
    openChatVisual();
  }, false);

  // If app.js opens/closes the chat asynchronously, keep the shell in sync.
  function observe() {
    const c = chat();
    const s = settings();
    if (c) new MutationObserver(sync).observe(c, {attributes:true, attributeFilter:['class']});
    if (s) new MutationObserver(sync).observe(s, {attributes:true, attributeFilter:['class']});
    new MutationObserver(sync).observe(document.body, {attributes:true, attributeFilter:['class']});
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, {once:true});
  else observe();
})();