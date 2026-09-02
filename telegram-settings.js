/* Cipherion — Telegram-inspired, functional settings */
(() => {
  'use strict';
  const init = () => {
    const modal=document.getElementById('app-settings-modal');
    if(!modal) return;
    const nav=modal.querySelector('.app-settings-nav');
    const content=modal.querySelector('.app-settings-content');
    if(!nav||!content||modal.dataset.telegramSettingsReady==='1') return;
    modal.dataset.telegramSettingsReady='1';
    const storeKey='cipherionSettings';
    const defaults={theme:'dark',fontSize:'15',bubbleColor:'default',language:'ru',soundSend:true,autoplayVoice:false,animations:true,reduceMotion:false,browserNotif:true,notifPreview:true,autoMedia:true,sendEnter:true,emojiAnim:true,autoPhoto:true,autoVideo:false,phone:'Никто',lastSeen:'Контакты',forward:'Контакты',cloudPassword:'',passcode:'',disappear:'0'};
    let settings={...defaults}; try{settings={...settings,...JSON.parse(localStorage.getItem(storeKey)||'{}')}}catch(_){ }
    const save=()=>localStorage.setItem(storeKey,JSON.stringify(settings));
    const apply=()=>{document.documentElement.dataset.cipherionTheme=settings.theme;document.documentElement.style.setProperty('--cipherion-font-size',settings.fontSize+'px');document.documentElement.dataset.bubbleColor=settings.bubbleColor;document.documentElement.lang=settings.language;document.documentElement.dataset.reduceMotion=settings.reduceMotion?'1':'0';save();};
    apply();
    const pages=[['profile','👤','Мой профиль','Имя, фото и информация о себе'],['privacy','🔐','Конфиденциальность','Номер телефона, последний визит и пересылка'],['security','🛡️','Безопасность','Пароли, код-пароль и автоудаление'],['notifications','🔔','Уведомления и звуки','Сообщения, звонки и предпросмотр'],['chat-style','🎨','Оформление','Тема, размер текста и цвет сообщений'],['chats','💬','Чаты','Сообщения, медиа и эмодзи'],['data','💾','Данные и память','Автозагрузка и использование памяти'],['calls','📞','Звонки','Микрофон, камера и мобильные данные'],['language','🌐','Язык','Язык интерфейса'],['devices','📱','Устройства','Активные сеансы Cipherion'],['animations','✨','Анимации','Анимации и уменьшение движения'],['vip','👑','Cipherion VIP','Премиум-возможности'],['help','❓','Помощь','Частые вопросы и информация']];
    nav.querySelectorAll('.app-set-nav').forEach(x=>x.remove());
    nav.classList.add('telegram-settings-home');
    nav.querySelector('.settings-home-subtitle')?.remove();nav.querySelector('.settings-home-list')?.remove();nav.querySelector('.settings-home-logout')?.remove();
    const title=document.createElement('div');title.className='settings-home-subtitle';title.textContent='Настройки';nav.appendChild(title);
    const list=document.createElement('div');list.className='settings-home-list';nav.appendChild(list);
    const oldSections=[...content.querySelectorAll('.app-set-section')];oldSections.forEach(x=>{x.classList.add('hidden');x.style.display='none'});
    const actions=content.querySelector('.modal-actions');if(actions)actions.style.display='none';
    content.querySelectorAll('.settings-page').forEach(x=>x.remove());
    const map=new Map();
    const row=(label,control)=>`<label class="tg-setting-row"><span>${label}</span>${control}</label>`;
    const check=(key)=>`<input type="checkbox" data-setting="${key}" ${settings[key]?'checked':''}>`;
    const select=(key,opts)=>`<select data-setting="${key}">${opts.map(([v,t])=>`<option value="${v}" ${String(settings[key])===String(v)?'selected':''}>${t}</option>`).join('')}</select>`;
    function page([key,icon,name,desc]){
      const p=document.createElement('section');p.className='settings-page hidden';p.dataset.page=key;p.style.display='none';
      p.innerHTML=`<header class="settings-page-header"><button type="button" class="settings-back" aria-label="Назад">‹</button><h3>${name}</h3></header><div class="settings-page-body"><div class="settings-page-icon">${icon}</div><h4>${name}</h4><p class="settings-page-desc">${desc}</p><div class="settings-page-controls"></div></div>`;
      const c=p.querySelector('.settings-page-controls');
      if(key==='privacy')c.innerHTML=row('Номер телефона',select('phone',[['Никто','Никто'],['Контакты','Контакты'],['Все','Все']]))+row('Последний визит',select('lastSeen',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']]))+row('Пересылка сообщений',select('forward',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']]));
      else if(key==='security')c.innerHTML=row('Облачный пароль',`<button type="button" data-action="cloud">Изменить</button>`)+row('Код-пароль',`<button type="button" data-action="passcode">Настроить</button>`)+row('Исчезающие сообщения',select('disappear',[['0','Выкл.'],['30','30 секунд'],['60','1 минута'],['300','5 минут']]));
      else if(key==='notifications')c.innerHTML=row('Уведомления о сообщениях',check('browserNotif'))+row('Звук сообщений',check('soundSend'))+row('Предпросмотр текста',check('notifPreview'))+row('Уведомления о звонках',check('browserNotif'));
      else if(key==='chat-style')c.innerHTML=row('Тема',select('theme',[['dark','Тёмная'],['light','Светлая'],['system','Системная']]))+row('Размер текста',select('fontSize',[['14','Маленький'],['15','Обычный'],['17','Крупный']]))+row('Цвет своих сообщений',select('bubbleColor',[['default','Синий'],['green','Зелёный'],['rose','Розовый']]));
      else if(key==='chats')c.innerHTML=row('Автозагрузка медиа',check('autoMedia'))+row('Отправлять по Enter',check('sendEnter'))+row('Анимация эмодзи',check('emojiAnim'))+row('Размер текста',select('fontSize',[['14','Маленький'],['15','Обычный'],['17','Крупный']]));
      else if(key==='data')c.innerHTML=row('Автозагрузка фото',check('autoPhoto'))+row('Автозагрузка видео',check('autoVideo'))+`<button class="tg-wide-action" type="button" data-action="clear-cache">Очистить локальный кэш</button>`;
      else if(key==='calls')c.innerHTML=`${row('Микрофон','<button type="button" data-action="mic">Проверить</button>')}${row('Камера','<button type="button" data-action="camera">Проверить</button>')}${row('Использовать мобильные данные',check('autoMedia'))}`;
      else if(key==='language')c.innerHTML=row('Язык интерфейса',select('language',[['ru','Русский'],['en','English'],['uk','Українська']]));
      else if(key==='devices')c.innerHTML='<div class="device-card"><b>Это устройство</b><span>Текущий сеанс Cipherion</span></div><button class="tg-wide-action" type="button" data-action="refresh">Обновить сеанс</button>';
      else if(key==='animations')c.innerHTML=row('Анимации интерфейса',check('animations'))+row('Уменьшить движение',check('reduceMotion'));
      else if(key==='vip')c.innerHTML='<div class="vip-settings-banner">👑 Cipherion VIP</div><p>Дополнительные возможности Cipherion.</p><button class="tg-wide-action" type="button" data-action="vip">Открыть VIP</button>';
      else if(key==='help')c.innerHTML='<button class="tg-wide-action" type="button" data-action="faq">Частые вопросы</button><button class="tg-wide-action" type="button" data-action="support">Связаться с поддержкой</button><p class="settings-about">Cipherion · безопасный мессенджер</p>';
      else if(key==='profile')c.innerHTML='<button class="tg-wide-action" type="button" data-action="profile">Открыть мой профиль</button><button class="tg-wide-action" type="button" data-action="avatar">Изменить фото</button>';
      p.querySelector('.settings-back').addEventListener('click',home);
      p.addEventListener('change',e=>{const el=e.target.closest('[data-setting]');if(!el)return;settings[el.dataset.setting]=el.type==='checkbox'?el.checked:el.value;apply();});
      p.addEventListener('click',async e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(!a)return;
        if(a==='profile'||a==='avatar')document.getElementById('menu-settings')?.click();
        if(a==='vip')document.getElementById('menu-vip')?.click();
        if(a==='clear-cache'){localStorage.removeItem('cipherionDrafts');alert('Локальный кэш очищен');}
        if(a==='refresh')alert('Сеанс актуален');
        if(a==='faq')alert('Cipherion: откройте нужный раздел настроек для изменения параметров.');
        if(a==='support')alert('Поддержка Cipherion пока доступна через администратора проекта.');
        if(a==='cloud'||a==='passcode'){const value=prompt(a==='cloud'?'Новый облачный пароль:':'Новый код-пароль (до 6 цифр):');if(value!==null){settings[a==='cloud'?'cloudPassword':'passcode']=value;apply();alert('Настройка сохранена на этом устройстве.');}}
        if(a==='mic'||a==='camera'){try{const s=await navigator.mediaDevices.getUserMedia({audio:a==='mic',video:a==='camera'});s.getTracks().forEach(t=>t.stop());alert('Устройство доступно.')}catch(_){alert('Доступ к устройству не предоставлен.')}}
      });
      content.appendChild(p);map.set(key,p);
    }
    pages.forEach(page);
    pages.forEach(([key,icon,name,desc])=>{const b=document.createElement('button');b.type='button';b.className='settings-home-row';b.innerHTML=`<span class="settings-home-icon">${icon}</span><span><b>${name}</b><small>${desc}</small></span><i>›</i>`;b.addEventListener('click',()=>open(key));list.appendChild(b);});
    const logout=document.createElement('div');logout.className='settings-home-logout';
    const logoutButton=document.createElement('button');logoutButton.type='button';logoutButton.textContent='🚪 Выйти';
    logoutButton.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.removeItem('token');localStorage.removeItem('userId');localStorage.removeItem('username');localStorage.removeItem('currentUser');sessionStorage.clear();window.location.reload();});
    logout.appendChild(logoutButton);nav.appendChild(logout);
    function home(){nav.classList.remove('hidden');nav.style.display='';list.style.display='flex';content.classList.add('settings-content-hidden');map.forEach(p=>{p.classList.add('hidden');p.style.display='none'});}
    function open(key){nav.classList.add('hidden');nav.style.display='none';content.classList.remove('settings-content-hidden');map.forEach(p=>{p.classList.add('hidden');p.style.display='none'});const p=map.get(key);if(p){p.classList.remove('hidden');p.style.display='block';}}
    const close=document.getElementById('app-settings-close');if(close)close.onclick=()=>{modal.classList.add('hidden');home()};
    home();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
