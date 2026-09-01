/* Cipherion Telegram-inspired interaction layer */
(() => {
  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove('hidden');
  const hide = el => el && el.classList.add('hidden');
  const modal = id => { const e=$(id); if(e){show(e); document.body.classList.add('modal-open');} };
  const closeModal = id => { const e=$(id); if(e){hide(e); document.body.classList.remove('modal-open');} };

  // Drawer
  const drawer=$('drawer'), overlay=$('drawer-overlay');
  const openDrawer=()=>{drawer?.classList.add('open');overlay?.classList.remove('hidden');};
  const closeDrawer=()=>{drawer?.classList.remove('open');overlay?.classList.add('hidden');};
  $('menu-btn')?.addEventListener('click',openDrawer); overlay?.addEventListener('click',closeDrawer);
  drawer?.querySelectorAll('.drawer-item').forEach(b=>b.addEventListener('click',()=>{ if(!['menu-theme','logout-btn'].includes(b.id)) closeDrawer(); }));

  // Profile / settings / VIP
  $('menu-settings')?.addEventListener('click',()=>modal('settings-modal'));
  $('menu-app-settings')?.addEventListener('click',()=>modal('app-settings-modal'));
  $('menu-vip')?.addEventListener('click',()=>modal('vip-modal'));
  $('settings-close')?.addEventListener('click',()=>closeModal('settings-modal'));
  $('app-settings-close')?.addEventListener('click',()=>closeModal('app-settings-modal'));
  $('vip-close')?.addEventListener('click',()=>closeModal('vip-modal'));
  $('vip-close-x')?.addEventListener('click',()=>closeModal('vip-modal'));
  $('group-cancel')?.addEventListener('click',()=>closeModal('group-modal'));
  $('channel-cancel')?.addEventListener('click',()=>closeModal('channel-modal'));
  $('group-settings-cancel')?.addEventListener('click',()=>closeModal('group-settings-modal'));
  $('group-start-call')?.addEventListener('click',()=>alert('Видеочат Cipherion будет доступен после подключения WebRTC.'));
  $('menu-new-group')?.addEventListener('click',()=>modal('group-modal'));
  $('menu-new-channel')?.addEventListener('click',()=>modal('channel-modal'));
  $('menu-saved')?.addEventListener('click',()=>alert('Избранное: раздел готовится к синхронизации.'));
  $('chat-info-btn')?.addEventListener('click',()=>modal('group-settings-modal'));

  // Mobile navigation
  document.querySelectorAll('.mobile-nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.mobile-nav-item').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
    const v=btn.dataset.mobileView;
    if(v==='chats'){ document.querySelector('.sidebar')?.classList.remove('hidden-mobile'); document.querySelector('.chat-area')?.classList.remove('mobile-nav-page'); }
    if(v==='contacts'){ document.querySelector('.sidebar')?.classList.remove('hidden-mobile'); $('user-search')?.focus(); }
    if(v==='settings') modal('app-settings-modal');
    if(v==='calls') alert('Звонки Cipherion: интерфейс готов, WebRTC подключим следующим этапом.');
  }));

  // Settings sections
  document.querySelectorAll('.app-set-nav').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.app-set-nav').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
    const target=btn.dataset.section==='language'?'set-lang-section':'set-'+btn.dataset.section;
    document.querySelectorAll('.app-set-section').forEach(x=>x.classList.toggle('hidden',x.id!==target));
  }));

  // Theme toggle
  $('menu-theme')?.addEventListener('click',()=>{
    document.body.classList.toggle('light-theme');
    const light=document.body.classList.contains('light-theme');
    localStorage.setItem('cipherion_theme',light?'light':'dark');
    if($('theme-label')) $('theme-label').textContent=light?'Тёмный режим':'Светлый режим';
    if($('theme-icon')) $('theme-icon').textContent=light?'🌙':'☀️';
  });
  if(localStorage.getItem('cipherion_theme')==='light') $('menu-theme')?.click();

  // Attachments
  $('attach-btn')?.addEventListener('click',()=>$('image-input')?.click());
  $('image-input')?.addEventListener('change',()=>{ if($('image-input').files?.length) alert('Фото выбрано. Отправка медиа подключается к серверному media endpoint.'); });

  // Emoji/sticker quick panel
  $('sticker-btn')?.addEventListener('click',()=>{
    const p=$('sticker-panel'); if(!p)return;
    if(!p.innerHTML)p.innerHTML=['😀','😂','❤️','🔥','👍','🎉','😎','🤔','😭','🥳','👏','🚀'].map(x=>`<button type="button">${x}</button>`).join('');
    p.classList.toggle('hidden');
    p.querySelectorAll('button').forEach(b=>b.onclick=()=>{const i=$('message-input'); if(i){i.value+=b.textContent;i.focus();}});
  });

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeDrawer(); document.querySelectorAll('.modal').forEach(m=>hide(m));}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('user-search')?.focus();}
  });

  // Close modal by clicking outside
  document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.add('hidden');}));
})();
