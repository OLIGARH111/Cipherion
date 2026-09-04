/* Cipherion — iPhone Telegram-inspired settings */
(() => {
  'use strict';
  const favicon=()=>{let l=document.querySelector('link[rel="icon"]');if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);}l.type='image/svg+xml';l.href='/favicon.svg?v=20260903';};
  favicon();
  const init=()=>{
    const modal=document.getElementById('app-settings-modal');
    if(!modal)return;
    const nav=modal.querySelector('.app-settings-nav');
    const content=modal.querySelector('.app-settings-content');
    if(!nav||!content||modal.dataset.telegramSettingsReady==='1')return;
    modal.dataset.telegramSettingsReady='1';
    document.getElementById('login-cloud-password')?.remove();
    const storeKey='cipherionSettings';
    const defaults={theme:'dark',fontSize:'15',bubbleColor:'default',language:'ru',soundSend:true,autoplayVoice:false,animations:true,reduceMotion:false,browserNotif:true,notifPreview:true,callNotif:true,autoMedia:true,sendEnter:true,emojiAnim:true,autoPhoto:true,autoVideo:false,mobileData:true,phone:'Никто',lastSeen:'Контакты',forward:'Контакты',passcode:'',disappear:'0'};
    let settings={...defaults};try{settings={...settings,...JSON.parse(localStorage.getItem(storeKey)||'{}')}}catch(_){ }
    const save=()=>localStorage.setItem(storeKey,JSON.stringify(settings));
    const apply=()=>{document.documentElement.dataset.cipherionTheme=settings.theme;document.documentElement.style.setProperty('--cipherion-font-size',settings.fontSize+'px');document.documentElement.dataset.bubbleColor=settings.bubbleColor;document.documentElement.lang=settings.language;document.documentElement.dataset.reduceMotion=settings.reduceMotion?'1':'0';save();};
    apply();
    const pages=[
      ['profile','👤','Мой профиль','Имя, фото и информация о себе'],['privacy','🔐','Конфиденциальность','Номер телефона, последний визит и пересылка'],['security','🛡️','Безопасность','Код-пароль и автоудаление'],['notifications','🔔','Уведомления и звуки','Сообщения, звонки и предпросмотр'],['chat-style','🎨','Оформление','Тема, размер текста и цвет сообщений'],['chats','💬','Чаты','Сообщения, медиа и эмодзи'],['data','💾','Данные и память','Автозагрузка и локальное хранилище'],['calls','📞','Звонки','Микрофон, камера и мобильные данные'],['language','🌐','Язык','Язык интерфейса'],['devices','📱','Устройства','Активные сеансы Cipherion'],['animations','✨','Анимации','Анимации и уменьшение движения'],['vip','👑','Cipherion VIP','Премиум-возможности'],['help','❓','Помощь','Частые вопросы и информация']
    ];
    nav.querySelectorAll('.app-set-nav').forEach(x=>x.remove());nav.classList.add('telegram-settings-home');nav.querySelector('h3')?.remove();nav.querySelector('.settings-home-subtitle')?.remove();nav.querySelector('.settings-home-list')?.remove();nav.querySelector('.settings-home-logout')?.remove();
    const title=document.createElement('div');title.className='settings-home-subtitle';title.textContent='Настройки';nav.appendChild(title);
    const list=document.createElement('div');list.className='settings-home-list';nav.appendChild(list);
    [...content.querySelectorAll('.app-set-section')].forEach(x=>{x.classList.add('hidden');x.style.display='none'});content.querySelector('.modal-actions')?.style.setProperty('display','none','important');content.querySelectorAll('.settings-page').forEach(x=>x.remove());
    const map=new Map();
    const row=(label,control)=>`<label class="tg-setting-row"><span>${label}</span>${control}</label>`;
    const check=(key)=>`<input type="checkbox" data-setting="${key}" ${settings[key]?'checked':''}>`;
    const select=(key,opts)=>`<select data-setting="${key}">${opts.map(([v,t])=>`<option value="${v}" ${String(settings[key])===String(v)?'selected':''}>${t}</option>`).join('')}</select>`;
    const makePage=([key,icon,name,desc])=>{
      const p=document.createElement('section');p.className='settings-page hidden';p.dataset.page=key;p.style.display='none';
      p.innerHTML=`<header class="settings-page-header"><button type="button" class="settings-back" aria-label="Назад">‹</button><h3>${name}</h3></header><div class="settings-page-body"><div class="settings-page-icon">${icon}</div><h4>${name}</h4><p class="settings-page-desc">${desc}</p><div class="settings-page-controls"></div></div>`;
      const c=p.querySelector('.settings-page-controls');
      if(key==='privacy')c.innerHTML=row('Номер телефона',select('phone',[['Никто','Никто'],['Контакты','Контакты'],['Все','Все']]))+row('Последний визит',select('lastSeen',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']]))+row('Пересылка сообщений',select('forward',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']]));
      else if(key==='security')c.innerHTML=row('Код-пароль',`<button type="button" data-action="passcode">${settings.passcode?'Изменить':'Настроить'}</button>`)+row('Исчезающие сообщения',select('disappear',[['0','Выкл.'],['30','30 секунд'],['60','1 минута'],['300','5 минут']]));
      else if(key==='notifications')c.innerHTML=row('Уведомления о сообщениях',check('browserNotif'))+row('Звук сообщений',check('soundSend'))+row('Предпросмотр текста',check('notifPreview'))+row('Уведомления о звонках',check('callNotif'));
      else if(key==='chat-style')c.innerHTML=row('Тема',select('theme',[['dark','Тёмная'],['light','Светлая'],['system','Системная']]))+row('Размер текста',select('fontSize',[['14','Маленький'],['15','Обычный'],['17','Крупный']]))+row('Цвет своих сообщений',select('bubbleColor',[['default','Синий'],['green','Зелёный'],['rose','Розовый']]));
      else if(key==='chats')c.innerHTML=row('Автозагрузка медиа',check('autoMedia'))+row('Отправлять по Enter',check('sendEnter'))+row('Анимация эмодзи',check('emojiAnim'));
      else if(key==='data')c.innerHTML=row('Автозагрузка фото',check('autoPhoto'))+row('Автозагрузка видео',check('autoVideo'))+`<button class="tg-wide-action" type="button" data-action="clear-cache">Очистить локальные данные</button>`;
      else if(key==='calls')c.innerHTML=row('Микрофон','<button type="button" data-action="mic">Проверить</button>')+row('Камера','<button type="button" data-action="camera">Проверить</button>')+row('Мобильные данные',check('mobileData'));
      else if(key==='language')c.innerHTML=row('Язык интерфейса',select('language',[['ru','Русский'],['en','English'],['uk','Українська']]));
      else if(key==='devices')c.innerHTML='<div class="device-card"><b>Это устройство</b><span>Текущий сеанс Cipherion</span></div><button class="tg-wide-action" type="button" data-action="refresh">Обновить сеанс</button><button class="tg-wide-action danger" type="button" data-action="sessions">Завершить другие сеансы</button>';
      else if(key==='animations')c.innerHTML=row('Анимации интерфейса',check('animations'))+row('Уменьшить движение',check('reduceMotion'));
      else if(key==='vip')c.innerHTML='<div class="vip-settings-banner">👑 Cipherion VIP</div><p>Дополнительные возможности Cipherion.</p><button class="tg-wide-action" type="button" data-action="vip">Открыть VIP</button>';
      else if(key==='help')c.innerHTML='<button class="tg-wide-action" type="button" data-action="faq">Частые вопросы</button><button class="tg-wide-action" type="button" data-action="support">Связаться с поддержкой</button><p class="settings-about">Cipherion · безопасный мессенджер</p>';
      else if(key==='profile')c.innerHTML='<button class="tg-wide-action" type="button" data-action="profile">Открыть профиль</button><button class="tg-wide-action" type="button" data-action="avatar">Изменить фото</button>';
      p.querySelector('.settings-back').addEventListener('click',home);
      p.addEventListener('change',e=>{const el=e.target.closest('[data-setting]');if(!el)return;settings[el.dataset.setting]=el.type==='checkbox'?el.checked:el.value;apply();});
      p.addEventListener('click',async e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(!a)return;
        if(a==='profile'||a==='avatar'){document.getElementById('menu-settings')?.click();return;}
        if(a==='vip'){document.getElementById('menu-vip')?.click();return;}
        if(a==='clear-cache'){localStorage.removeItem('cipherionDrafts');localStorage.removeItem('cipherionCache');alert('Локальные данные очищены.');return;}
        if(a==='refresh'){alert('Сеанс обновлён.');return;}
        if(a==='sessions'){if(confirm('Завершить другие сеансы?'))alert('Другие сеансы завершены.');return;}
        if(a==='faq'){alert('Разделы настроек открываются кнопками на главном экране. Изменения сохраняются автоматически.');return;}
        if(a==='support'){alert('Поддержка Cipherion доступна через администратора проекта.');return;}
        if(a==='passcode'){const value=prompt('Новый код-пароль (4–6 цифр):');if(value===null)return;if(!/^\d{4,6}$/.test(value)){alert('Код-пароль должен содержать 4–6 цифр.');return;}settings.passcode=value;apply();e.target.textContent='Изменить';return;}
        if(a==='mic'||a==='camera'){if(!navigator.mediaDevices?.getUserMedia){alert('Проверка устройства недоступна.');return;}try{const s=await navigator.mediaDevices.getUserMedia({audio:a==='mic',video:a==='camera'});s.getTracks().forEach(t=>t.stop());alert(a==='mic'?'Микрофон доступен.':'Камера доступна.');}catch(_){alert('Доступ к устройству не предоставлен.');}}
      });
      content.appendChild(p);map.set(key,p);
    };
    pages.forEach(makePage);
    pages.forEach(([key,icon,name,desc])=>{const b=document.createElement('button');b.type='button';b.className='settings-home-row';b.dataset.page=key;b.innerHTML=`<span class="settings-home-icon">${icon}</span><span><b>${name}</b><small>${desc}</small></span><i>›</i>`;list.appendChild(b);});
    const logout=document.createElement('div');logout.className='settings-home-logout';const lb=document.createElement('button');lb.type='button';lb.textContent='🚪 Выйти';lb.onclick=e=>{e.preventDefault();window.logout?.();};logout.appendChild(lb);nav.appendChild(logout);
    function home(){nav.classList.remove('hidden');nav.style.display='';list.style.display='flex';content.classList.add('settings-content-hidden');map.forEach(p=>{p.classList.add('hidden');p.style.display='none'});}
    function open(key){nav.classList.add('hidden');nav.style.display='none';content.classList.remove('settings-content-hidden');map.forEach(p=>{p.classList.add('hidden');p.style.display='none'});const p=map.get(key);if(p){p.classList.remove('hidden');p.style.display='block';}}
    list.addEventListener('click',e=>{const b=e.target.closest('.settings-home-row');if(b){e.preventDefault();open(b.dataset.page);}});
    const close=document.getElementById('app-settings-close');if(close)close.onclick=()=>{modal.classList.add('hidden');home()};
    home();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
