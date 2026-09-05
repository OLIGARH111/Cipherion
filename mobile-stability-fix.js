/* Cipherion — mobile navigation/chat stability fix */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const nav = () => $('mobile-bottom-nav');
  const settings = () => $('app-settings-modal');
  const chat = () => $('chat-view');

  const sync = () => {
    const n = nav();
    const s = settings();
    const c = chat();
    if (!n) return;

    const settingsOpen = !!s && !s.classList.contains('hidden');
    const subpage = document.body.classList.contains('settings-subpage');
    const chatOpen = !!c && !c.classList.contains('hidden');

    n.classList.remove('nav-hidden');
    n.style.visibility = 'visible';
    n.style.pointerEvents = 'auto';

    if (chatOpen || (settingsOpen && subpage)) {
      n.style.display = 'none';
      n.style.opacity = '0';
      n.style.pointerEvents = 'none';
    } else {
      n.style.display = 'flex';
      n.style.opacity = '1';
    }
  };

  const switchMainView = view => {
    const s = settings();
    if (s && !s.classList.contains('hidden')) {
      s.classList.add('hidden');
      document.body.classList.remove('settings-subpage');
    }
    const c = chat();
    if (c && !c.classList.contains('hidden')) {
      c.classList.add('hidden');
    }
    document.body.classList.remove('chat-open');

    document.querySelectorAll('.mobile-nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.mobileView === view);
    });

    if (view === 'chats') {
      $('no-chat')?.classList.remove('hidden');
      $('chat-view')?.classList.add('hidden');
      document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
    } else if (view === 'settings') {
      if (s) s.classList.remove('hidden');
    }
    sync();
  };

  document.addEventListener('click', e => {
    const item = e.target.closest('.mobile-nav-item');
    if (item) {
      const view = item.dataset.mobileView;
      if (view === 'chats' || view === 'settings') {
        e.preventDefault();
        e.stopImmediatePropagation();
        switchMainView(view);
        return;
      }
    }

    const back = e.target.closest('#back-btn');
    if (back) {
      document.body.classList.remove('chat-open');
      sync();
      return;
    }
  }, true);

  const observe = () => {
    const c = chat();
    const s = settings();
    if (c) new MutationObserver(sync).observe(c, {attributes:true, attributeFilter:['class']});
    if (s) new MutationObserver(sync).observe(s, {attributes:true, attributeFilter:['class']});
    new MutationObserver(sync).observe(document.body, {attributes:true, attributeFilter:['class']});
    sync();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, {once:true});
  else observe();
})();
