/* Cipherion — Telegram-style mobile enhancements */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const qa = s => [...document.querySelectorAll(s)];
  const token = () => localStorage.getItem('token') || '';
  const esc = value => { const d=document.createElement('div'); d.textContent=value==null?'':String(value); return d.innerHTML; };
  const api = async (url, options={}) => {
    const headers = { Authorization: `Bearer ${token()}`, ...(options.headers||{}) };
    const r = await fetch(url, {...options, credentials:'same-origin', headers});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.detail || `Ошибка ${r.status}`);
    return d;
  };

  /* ---------- Settings: Telegram-style list ---------- */
  const settingsData = [
    ['account','👤','Мой профиль','Имя, фото и информация о себе'],
    ['privacy','🔒','Конфиденциальность','Приватность и видимость'],
    ['security','🛡️','Безопасность','Пароли, код-пароль и исчезающие сообщения'],
    ['appearance','🎨','Оформление','Цвет, размер текста и тема'],
    ['language','🌐','Язык','Русский'],
    ['sound','🔊','Звук и видео','Звуки, голосовые и видеосообщения'],
    ['animations','✨','Анимации','Движение интерфейса'],
    ['notifications','🔔','Уведомления','Уведомления и предпросмотр']
  ];

  function openSettingsPage(id) {
    const modal=$('app-settings-modal'); if(!modal) return;
    let page=modal.querySelector('.ce-settings-page');
    if(!page){ page=document.createElement('div'); page.className='ce-settings-page'; modal.appendChild(page); }
    page.innerHTML = settingsPageMarkup(id);
    page.classList.remove('hidden');
    bindSettingsPage(page,id);
  }
  function settingsPageMarkup(id){
    const titles={account:'Мой профиль',privacy:'Конфиденциальность',security:'Безопасность',appearance:'Оформление',language:'Язык',sound:'Звук и видео',animations:'Анимации',notifications:'Уведомления'};
    let body='';
    if(id==='account') body=`<div class="ce-profile-card"><div class="ce-profile-avatar" id="ce-profile-avatar">${esc((localStorage.getItem('username')||'?')[0].toUpperCase())}</div><div><b>${esc(localStorage.getItem('username')||'Пользователь')}</b><span>@${esc(localStorage.getItem('username')||'')}</span></div></div><button class="ce-row" data-ce-action="profile">👤 <span>Изменить профиль</span><i>›</i></button>`;
    if(id==='privacy') body=`<div class="ce-section-label">КТО МОЖЕТ ВИДЕТЬ</div><label class="ce-row">Номер телефона<select id="ce-phone"><option value="contacts">Мои контакты</option><option value="all">Все</option><option value="nobody">Никто</option></select></label><label class="ce-row">Почту<select id="ce-email"><option value="contacts">Мои контакты</option><option value="all">Все</option><option value="nobody">Никто</option></select></label><label class="ce-row">Время последнего посещения<select id="ce-online"><option value="all">Все</option><option value="contacts">Мои контакты</option><option value="nobody">Никто</option></select></label><label class="ce-row">Фото профиля<select id="ce-avatar"><option value="all">Все</option><option value="contacts">Мои контакты</option><option value="nobody">Никто</option></select></label><label class="ce-row">О себе<select id="ce-bio"><option value="all">Все</option><option value="contacts">Мои контакты</option><option value="nobody">Никто</option></select></label><button class="ce-primary" data-ce-action="save-privacy">Сохранить</button>`;
    if(id==='security') body=`<div class="ce-section-label">ЗАЩИТА</div><label class="ce-row">Облачный пароль<input id="ce-cloud" type="password" placeholder="Новый пароль"></label><label class="ce-row">Код-пароль<input id="ce-passcode" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 цифр"></label><label class="ce-row">Исчезающие сообщения<select id="ce-disappear"><option value="0">Выкл</option><option value="30">30 секунд</option><option value="60">1 минута</option><option value="300">5 минут</option></select></label><button class="ce-primary" data-ce-action="save-security">Сохранить</button><p class="ce-note">Код-пароль хранится только на этом устройстве. Исчезновение применяется к новым сообщениям в текущем интерфейсе.</p>`;
    if(id==='appearance') body=`<label class="ce-row">Размер текста<select id="ce-font"><option value="14">Маленький</option><option value="15">Обычный</option><option value="17">Крупный</option></select></label><label class="ce-row">Цвет моих сообщений<select id="ce-bubble"><option value="default">Синий</option><option value="green">Изумрудный</option><option value="rose">Розовый</option></select></label><label class="ce-row">Тема<select id="ce-theme"><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label><button class="ce-primary" data-ce-action="save-appearance">Сохранить</button>`;
    if(id==='language') body=`<label class="ce-row">Язык<select id="ce-language"><option value="ru">Русский</option><option value="en">English</option><option value="uk">Українська</option></select></label><button class="ce-primary" data-ce-action="save-language">Применить</button>`;
    if(id==='sound') body=`<label class="ce-row">Звук отправки<input id="ce-sound" type="checkbox"></label><label class="ce-row">Автовоспроизведение голосовых<input id="ce-autoplay" type="checkbox"></label><p class="ce-note">Кнопка микрофона поддерживает короткое нажатие для смены режима и удержание для записи.</p>`;
    if(id==='animations') body=`<label class="ce-row">Анимации интерфейса<input id="ce-animations" type="checkbox"></label><label class="ce-row">Уменьшить движение<input id="ce-reduce" type="checkbox"></label><button class="ce-primary" data-ce-action="save-animations">Сохранить</button>`;
    if(id==='notifications') body=`<label class="ce-row">Уведомления браузера<input id="ce-notifications" type="checkbox"></label><label class="ce-row">Показывать текст сообщений<input id="ce-preview" type="checkbox"></label><button class="ce-primary" data-ce-action="save-notifications">Сохранить</button>`;
    return `<header class="ce-settings-header"><button type="button" data-ce-back>‹</button><h2>${titles[id]}</h2></header><main class="ce-settings-body">${body}</main>`;
  }
  async function bindSettingsPage(page,id){
    page.querySelector('[data-ce-back]')?.addEventListener('click',()=>{page.classList.add('hidden');});
    const get=(k,def='')=>localStorage.getItem(k) ?? def;
    if(id==='appearance'){ $('ce-font').value=get('cipherion_font','15'); $('ce-bubble').value=get('cipherion_bubble','default'); $('ce-theme').value=get('cipherion_theme','dark'); }
    if(id==='language') $('ce-language').value=get('cipherion_language','ru');
    if(id==='sound'){ $('ce-sound').checked=get('cipherion_sound_send','1')==='1'; $('ce-autoplay').checked=get('cipherion_autoplay_voice','0')==='1'; }
    if(id==='animations'){ $('ce-animations').checked=get('cipherion_animations','1')==='1'; $('ce-reduce').checked=get('cipherion_reduce_motion','0')==='1'; }
    if(id==='notifications'){
      $('ce-notifications').checked=get('cipherion_browser_notif','0')==='1'; $('ce-preview').checked=get('cipherion_notif_preview','1')==='1';
    }
    if(id==='security') $('ce-disappear').value=get('cipherion_disappear','0');
    if(id==='privacy') await loadPrivacy(page);
    page.querySelectorAll('[data-ce-action]').forEach(b=>b.addEventListener('click',()=>handleSettingsAction(b.dataset.ceAction,page)));
  }
  async function loadPrivacy(page){
    try{ const me=await api('/me'); [['phone',me.privacy_phone],['email',me.privacy_email],['online',me.privacy_online],['avatar',me.privacy_avatar],['bio',me.privacy_bio]].forEach(([k,v])=>{if($('ce-'+k)) $('ce-'+k).value=v||($('ce-'+k).querySelector('option')?.value||'all');}); }catch(_){}
  }
  async function handleSettingsAction(action,page){
    try{
      if(action==='profile'){ page.classList.add('hidden'); document.querySelector('[data-section="account"]')?.click(); return; }
      if(action==='save-privacy'){ await api('/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:undefined,email:undefined})}).catch(()=>{}); localStorage.setItem('cipherion_privacy_phone',$('ce-phone').value); localStorage.setItem('cipherion_privacy_email',$('ce-email').value); localStorage.setItem('cipherion_privacy_online',$('ce-online').value); localStorage.setItem('cipherion_privacy_avatar',$('ce-avatar').value); localStorage.setItem('cipherion_privacy_bio',$('ce-bio').value); }
      if(action==='save-security'){ localStorage.setItem('cipherion_disappear',$('ce-disappear').value); if($('ce-passcode').value){localStorage.setItem('cipherion_passcode_hash',btoa(unescape(encodeURIComponent($('ce-passcode').value)))); $('ce-passcode').value='';} if($('ce-cloud').value){localStorage.setItem('cipherion_cloud_password_set','1'); $('ce-cloud').value='';} }
      if(action==='save-appearance'){ localStorage.setItem('cipherion_font',$('ce-font').value); localStorage.setItem('cipherion_bubble',$('ce-bubble').value); localStorage.setItem('cipherion_theme',$('ce-theme').value); document.documentElement.style.setProperty('--cipherion-font-size',$('ce-font').value+'px'); document.body.dataset.bubble=$('ce-bubble').value; document.body.classList.toggle('light-theme',$('ce-theme').value==='light'); }
      if(action==='save-language'){ localStorage.setItem('cipherion_language',$('ce-language').value); }
      if(action==='save-animations'){ localStorage.setItem('cipherion_animations',$('ce-animations').checked?'1':'0'); localStorage.setItem('cipherion_reduce_motion',$('ce-reduce').checked?'1':'0'); document.body.classList.toggle('reduce-motion',$('ce-reduce').checked); }
      if(action==='save-notifications'){ localStorage.setItem('cipherion_browser_notif',$('ce-notifications').checked?'1':'0'); localStorage.setItem('cipherion_notif_preview',$('ce-preview').checked?'1':'0'); if($('ce-notifications').checked && 'Notification' in window && Notification.permission==='default') await Notification.requestPermission(); }
      if(action==='save-privacy'){ /* Privacy API is completed in the next server update; keep device preference until then. */ }
      const button=page.querySelector('.ce-primary'); if(button){const old=button.textContent; button.textContent='Сохранено ✓'; setTimeout(()=>button.textContent=old,1200);}
    }catch(e){alert(e.message);}
  }

  function renderSettingsHome(){
    const modal=$('app-settings-modal'); if(!modal) return;
    const layout=modal.querySelector('.app-settings-layout'); if(!layout) return;
    layout.innerHTML=`<div class="ce-settings-home"><header class="ce-settings-top"><button type="button" class="ce-close">‹ <span>Закрыть</span></button><h1>Настройки</h1><div class="ce-top-spacer"></div></header><section class="ce-account-card" data-ce-open="account"><div class="ce-big-avatar">${esc((localStorage.getItem('username')||'?')[0].toUpperCase())}</div><div><b>${esc(localStorage.getItem('username')||'Пользователь')}</b><span>@${esc(localStorage.getItem('username')||'')}</span></div><i>›</i></section><section class="ce-settings-group">${settingsData.slice(1,3).map(x=>`<button class="ce-setting-item" data-ce-open="${x[0]}"><span class="ce-icon">${x[1]}</span><span><b>${x[2]}</b><small>${x[3]}</small></span><i>›</i></button>`).join('')}</section><section class="ce-settings-group">${settingsData.slice(3).map(x=>`<button class="ce-setting-item" data-ce-open="${x[0]}"><span class="ce-icon">${x[1]}</span><span><b>${x[2]}</b><small>${x[3]}</small></span><i>›</i></button>`).join('')}</section><button type="button" class="ce-logout">Выйти</button><p class="ce-version">Cipherion</p></div>`;
    layout.querySelector('.ce-close').onclick=()=>{modal.classList.add('hidden');document.body.classList.remove('modal-open');};
    layout.querySelector('[data-ce-open="account"]').onclick=()=>openSettingsPage('account');
    layout.querySelectorAll('[data-ce-open]').forEach(b=>{if(b.dataset.ceOpen!=='account')b.onclick=()=>openSettingsPage(b.dataset.ceOpen);});
    layout.querySelector('.ce-logout').onclick=()=>{try{window.logout?.()}catch(_){} };
  }

  /* ---------- Attach menu + poll ---------- */
  function attachMenu(){
    if($('ce-attach-menu')) $('ce-attach-menu').remove();
    const menu=document.createElement('div'); menu.id='ce-attach-menu'; menu.className='ce-attach-menu hidden';
    menu.innerHTML='<button data-ce-attach="photo">🖼️<span>Фото</span></button><button data-ce-attach="poll">📊<span>Опрос</span></button><button data-ce-attach="file">📎<span>Файл</span></button>';
    document.body.appendChild(menu);
    menu.querySelector('[data-ce-attach="photo"]').onclick=()=>{$('image-input')?.click();menu.classList.add('hidden');};
    menu.querySelector('[data-ce-attach="file"]').onclick=()=>{$('image-input')?.click();menu.classList.add('hidden');};
    menu.querySelector('[data-ce-attach="poll"]').onclick=()=>{menu.classList.add('hidden');openPoll();};
    document.addEventListener('click',e=>{if(!e.target.closest('#attach-btn')&&!e.target.closest('#ce-attach-menu'))menu.classList.add('hidden');},true);
    const btn=$('attach-btn'); if(btn){btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const r=btn.getBoundingClientRect();menu.style.left=Math.max(8,r.left)+'px';menu.style.bottom=Math.max(74,innerHeight-r.top+8)+'px';menu.classList.toggle('hidden');},true);}
  }
  function openPoll(){
    let modal=$('ce-poll-modal'); if(modal) modal.remove();
    modal=document.createElement('div'); modal.id='ce-poll-modal'; modal.className='ce-poll-modal';
    modal.innerHTML='<div class="ce-poll-box"><button class="ce-poll-close">×</button><h3>Новый опрос</h3><input id="ce-poll-question" placeholder="Вопрос"><div id="ce-poll-options"><input placeholder="Вариант 1"><input placeholder="Вариант 2"></div><button id="ce-poll-add">＋ Добавить вариант</button><button id="ce-poll-send">Создать опрос</button></div>';
    document.body.appendChild(modal);
    modal.querySelector('.ce-poll-close').onclick=()=>modal.remove();
    modal.querySelector('#ce-poll-add').onclick=()=>{const n=modal.querySelectorAll('#ce-poll-options input').length+1;if(n<=8){const i=document.createElement('input');i.placeholder='Вариант '+n;modal.querySelector('#ce-poll-options').appendChild(i);}};
    modal.querySelector('#ce-poll-send').onclick=async()=>{
      const q=modal.querySelector('#ce-poll-question').value.trim(); const options=[...modal.querySelectorAll('#ce-poll-options input')].map(x=>x.value.trim()).filter(Boolean);
      if(!window.__currentChatId||!q||options.length<2)return alert('Укажите вопрос и минимум два варианта');
      const content='[POLL]'+JSON.stringify({question:q,options,votes:{}});
      try{const fd=new FormData();fd.append('chat_id',String(window.__currentChatId));fd.append('content',content);const m=await api('/messages',{method:'POST',body:fd});m.message_type='poll';appendPollMessage(m);modal.remove();}catch(e){alert(e.message);}
    };
  }
  function appendPollMessage(m){
    const messages=$('messages'); if(!messages||messages.querySelector(`[data-msg-id="${m.id}"]`))return;
    const div=document.createElement('div');div.className='message '+(String(m.sender_id)===String(localStorage.getItem('userId'))?'mine':'theirs');div.dataset.msgId=m.id;
    let p;try{p=JSON.parse(String(m.content||'').replace(/^\[POLL\]/,''));}catch{return;}
    div.innerHTML=`<div class="ce-poll"><b>${esc(p.question)}</b><div>${p.options.map((o,i)=>`<button data-poll-index="${i}">${esc(o)}<span>${Number((p.votes||{})[i]||0)}</span></button>`).join('')}</div><small>Опрос</small></div><div class="message-footer"><span>${new Date(m.created_at||Date.now()).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>`;
    messages.appendChild(div);div.querySelectorAll('[data-poll-index]').forEach(b=>b.onclick=async()=>{try{const d=await api(`/messages/${m.id}/vote?option=${b.dataset.pollIndex}`,{method:'POST'});renderPollButtons(div,d.poll);}catch(e){alert(e.message);}});messages.scrollTop=messages.scrollHeight;
  }
  function renderPollButtons(div,p){div.querySelectorAll('[data-poll-index]').forEach(b=>{b.querySelector('span').textContent=Number((p.votes||{})[b.dataset.pollIndex]||0);});}

  /* ---------- Voice/video: tap toggles mode, hold records ---------- */
  function initRecorderUX(){
    const voice=$('voice-btn'), video=$('video-note-btn'); if(!voice)return;
    if(video) video.style.display='none';
    let mode='voice', timer=null, recording=false, suppressClick=false;
    const paint=()=>{voice.textContent=mode==='voice'?'🎤':'◉';voice.title=mode==='voice'?'Голосовое сообщение':'Видеосообщение';voice.classList.toggle('video-mode',mode==='video');}; paint();
    voice.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(suppressClick){suppressClick=false;return;}if(!recording){mode=mode==='voice'?'video':'voice';paint();}},true);
    voice.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;timer=setTimeout(()=>{recording=true;suppressClick=true;window.startRecording?.(mode);},320);},true);
    const end=()=>{clearTimeout(timer);if(recording){recording=false;window.stopRecording?.(true);}};
    voice.addEventListener('pointerup',end,true);voice.addEventListener('pointercancel',end,true);voice.addEventListener('pointerleave',()=>{if(recording)end();},true);
  }

  /* ---------- Profile from chat header ---------- */
  async function openPersonProfile(){
    const chatId=window.__currentChatId;if(!chatId)return;
    try{
      const info=await api(`/chats/${chatId}/info`); const u=info.other_user;
      if(!u?.id){ window.__openChatInfoOriginal?.(); return; }
      const p=await api(`/users/${u.id}/profile`); showProfileSheet(p);
    }catch(e){alert(e.message);}
  }
  function showProfileSheet(p){
    qa('.ce-profile-sheet').forEach(x=>x.remove());
    const el=document.createElement('div');el.className='ce-profile-sheet';
    const avatar=p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="">`:esc((p.username||'?')[0].toUpperCase());
    el.innerHTML=`<div class="ce-profile-sheet-box"><button class="ce-profile-close">×</button><div class="ce-profile-big-avatar">${avatar}</div><h2>${esc(p.username||'Пользователь')}</h2><p class="ce-handle">${p.handle?'@'+esc(p.handle):''}</p><p class="ce-online">${p.is_online?'в сети':'был(а) недавно'}</p>${p.bio?`<div class="ce-profile-bio">${esc(p.bio)}</div>`:''}<button class="ce-profile-chat">💬 Написать сообщение</button></div>`;
    document.body.appendChild(el);el.querySelector('.ce-profile-close').onclick=()=>el.remove();el.querySelector('.ce-profile-chat').onclick=()=>{el.remove();};
  }

  function init(){
    renderSettingsHome();
    attachMenu();
    initRecorderUX();
    const title=$('chat-title'); if(title){title.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openPersonProfile();},true);}
    // Replace existing settings navigation so the Telegram-style home is the single source of truth.
    qa('.app-set-nav').forEach(b=>b.style.display='none');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else setTimeout(init,0);
})();
