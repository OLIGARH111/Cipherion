/* Cipherion — Telegram-inspired settings pages */
(() => {
  'use strict';
  const init = () => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal) return;
    const nav = modal.querySelector('.app-settings-nav');
    const content = modal.querySelector('.app-settings-content');
    if (!nav || !content || modal.dataset.telegramSettingsReady === '1') return;
    modal.dataset.telegramSettingsReady = '1';

    const pages = [
      ['profile','👤','Мой профиль','Имя, фото и информация о себе'],
      ['privacy','🔐','Конфиденциальность','Кто может видеть ваши данные'],
      ['security','🛡️','Безопасность','Пароли и защита аккаунта'],
      ['notifications','🔔','Уведомления и звуки','Сообщения, звонки и звуки'],
      ['chat-style','🎨','Оформление','Тема, размер текста и пузырьки'],
      ['chats','💬','Чаты','Настройки сообщений и медиа'],
      ['data','💾','Данные и память','Автозагрузка и хранилище'],
      ['calls','📞','Звонки','Звук, камера и вызовы'],
      ['language','🌐','Язык','Язык интерфейса'],
      ['devices','📱','Устройства','Активные сеансы'],
      ['animations','✨','Анимации','Движение интерфейса'],
      ['vip','👑','Cipherion VIP','Премиум-возможности'],
      ['help','❓','Помощь','Частые вопросы и информация']
    ];

    const header = nav.querySelector('h3');
    nav.querySelectorAll('.app-set-nav').forEach(x => x.remove());
    nav.classList.add('telegram-settings-home');

    let homeTitle = nav.querySelector('.settings-home-subtitle');
    if (!homeTitle) { homeTitle=document.createElement('div'); homeTitle.className='settings-home-subtitle'; homeTitle.textContent='Настройки'; nav.appendChild(homeTitle); }
    let homeList = nav.querySelector('.settings-home-list');
    if (!homeList) { homeList=document.createElement('div'); homeList.className='settings-home-list'; nav.appendChild(homeList); }
    homeList.innerHTML='';

    const oldSections = [...content.querySelectorAll('.app-set-section')];
    oldSections.forEach(x => { x.classList.add('hidden'); x.style.display='none'; });
    const oldActions = content.querySelector('.modal-actions');
    if (oldActions) oldActions.style.display='none';

    const pageMap = new Map();
    const makePage = ([key,icon,title,desc]) => {
      const page=document.createElement('section');
      page.className='settings-page hidden'; page.dataset.page=key; page.style.display='none';
      page.innerHTML=`<header class="settings-page-header"><button type="button" class="settings-back" aria-label="Назад">‹</button><h3>${title}</h3></header><div class="settings-page-body"><div class="settings-page-icon">${icon}</div><h4>${title}</h4><p class="settings-page-desc">${desc}</p><div class="settings-page-controls"></div></div>`;
      const c=page.querySelector('.settings-page-controls');
      const rows={
        privacy:'<label class="tg-setting-row"><span>Номер телефона</span><select><option>Никто</option><option>Контакты</option></select></label><label class="tg-setting-row"><span>Последний визит</span><select><option>Контакты</option><option>Никто</option></select></label><label class="tg-setting-row"><span>Пересылка сообщений</span><select><option>Контакты</option><option>Никто</option></select></label>',
        notifications:'<label class="tg-setting-row"><span>Уведомления о сообщениях</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Звук сообщений</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Предпросмотр текста</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Уведомления о звонках</span><input type="checkbox" checked></label>',
        chats:'<label class="tg-setting-row"><span>Автозагрузка медиа</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Отправлять по Enter</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Анимация эмодзи</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Размер текста</span><select><option>Обычный</option><option>Крупный</option></select></label>',
        data:'<label class="tg-setting-row"><span>Автозагрузка фото</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Автозагрузка видео</span><input type="checkbox"></label><label class="tg-setting-row"><span>Использование памяти</span><button type="button">Очистить</button></label>',
        calls:'<label class="tg-setting-row"><span>Микрофон</span><button type="button">Проверить</button></label><label class="tg-setting-row"><span>Камера</span><button type="button">Проверить</button></label><label class="tg-setting-row"><span>Использовать мобильные данные</span><input type="checkbox" checked></label>',
        devices:'<div class="device-card"><b>Это устройство</b><span>Текущий сеанс Cipherion</span></div><button class="tg-wide-action" type="button">Завершить другие сеансы</button>',
        animations:'<label class="tg-setting-row"><span>Анимации интерфейса</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Уменьшить движение</span><input type="checkbox"></label>',
        language:'<label class="tg-setting-row"><span>Язык интерфейса</span><select><option>Русский</option><option>English</option><option>Українська</option></select></label>',
        'chat-style':'<label class="tg-setting-row"><span>Тема</span><select><option>Тёмная</option><option>Системная</option><option>Светлая</option></select></label><label class="tg-setting-row"><span>Размер текста</span><select><option>Обычный</option><option>Крупный</option></select></label>',
        security:'<label class="tg-setting-row"><span>Облачный пароль</span><button type="button">Изменить</button></label><label class="tg-setting-row"><span>Код-пароль</span><button type="button">Настроить</button></label><label class="tg-setting-row"><span>Исчезающие сообщения</span><select><option>Выкл.</option><option>30 секунд</option><option>1 минута</option><option>5 минут</option></select></label>',
        vip:'<div class="vip-settings-banner">👑 Cipherion VIP</div><p>Дополнительные возможности, расширенные настройки и приоритетные функции.</p><button class="tg-wide-action" type="button">Открыть VIP</button>',
        help:'<button class="tg-wide-action" type="button">Частые вопросы</button><button class="tg-wide-action" type="button">Связаться с поддержкой</button><p class="settings-about">Cipherion · безопасный мессенджер</p>',
        profile:'<button class="tg-wide-action" type="button">Изменить профиль</button><button class="tg-wide-action" type="button">Изменить фото</button>'
      };
      c.innerHTML=rows[key]||'';
      page.querySelector('.settings-back').addEventListener('click',showHome);
      content.appendChild(page); pageMap.set(key,page); return page;
    };
    pages.forEach(makePage);

    pages.forEach(([key,icon,title,desc])=>{
      const b=document.createElement('button'); b.type='button'; b.className='settings-home-row';
      b.innerHTML=`<span class="settings-home-icon">${icon}</span><span><b>${title}</b><small>${desc}</small></span><i>›</i>`;
      b.addEventListener('click',()=>showPage(key)); homeList.appendChild(b);
    });

    let logout=nav.querySelector('.settings-home-logout');
    if(!logout){ logout=document.createElement('div'); logout.className='settings-home-logout'; logout.innerHTML='<button type="button">🚪 Выйти</button>'; nav.appendChild(logout); }
    const logoutBtn=logout.querySelector('button');
    logoutBtn.addEventListener('click',()=>document.getElementById('logout-btn')?.click());

    function showHome(){
      nav.classList.remove('hidden'); nav.style.display='';
      content.classList.add('settings-content-hidden');
      homeList.classList.remove('hidden'); homeList.style.display='flex';
      pageMap.forEach(p=>{p.classList.add('hidden');p.style.display='none';});
      if(header) header.textContent='Настройки';
    }
    function showPage(key){
      nav.classList.add('hidden'); nav.style.display='none';
      content.classList.remove('settings-content-hidden'); content.style.display='block';
      pageMap.forEach(p=>{p.classList.add('hidden');p.style.display='none';});
      const page=pageMap.get(key); if(!page)return;
      page.classList.remove('hidden'); page.style.display='block';
    }

    const close=document.getElementById('app-settings-close');
    if(close) close.onclick=()=>{modal.classList.add('hidden');showHome();};
    showHome();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
