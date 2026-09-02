/* Cipherion — Telegram-inspired settings pages */
(() => {
  'use strict';
  const modal = document.getElementById('app-settings-modal');
  if (!modal) return;
  const nav = modal.querySelector('.app-settings-nav');
  const content = modal.querySelector('.app-settings-content');
  if (!nav || !content) return;

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

  const oldSections = new Map([...content.querySelectorAll('.app-set-section')].map(x => [x.id, x]));
  const header = nav.querySelector('h3');
  const originalNav = [...nav.querySelectorAll('.app-set-nav')];
  originalNav.forEach(x => x.remove());
  nav.classList.add('telegram-settings-home');
  const homeList = document.createElement('div'); homeList.className='settings-home-list'; nav.appendChild(homeList);
  const homeTitle = document.createElement('div'); homeTitle.className='settings-home-subtitle'; homeTitle.textContent='Настройки'; homeList.before(homeTitle);

  const makePage = (key, icon, title, desc) => {
    const page = document.createElement('section'); page.className='settings-page hidden'; page.dataset.page=key;
    page.innerHTML=`<header class="settings-page-header"><button type="button" class="settings-back">‹</button><h3>${title}</h3></header><div class="settings-page-body"><div class="settings-page-icon">${icon}</div><h4>${title}</h4><p class="settings-page-desc">${desc}</p><div class="settings-page-controls"></div></div>`;
    const controls=page.querySelector('.settings-page-controls');
    if (key==='privacy') controls.innerHTML='<label class="tg-setting-row"><span>Номер телефона</span><select><option>Никто</option><option>Контакты</option></select></label><label class="tg-setting-row"><span>Последний визит</span><select><option>Контакты</option><option>Никто</option></select></label><label class="tg-setting-row"><span>Пересылка сообщений</span><select><option>Контакты</option><option>Никто</option></select></label>';
    else if (key==='notifications') controls.innerHTML='<label class="tg-setting-row"><span>Уведомления о сообщениях</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Звук сообщений</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Предпросмотр текста</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Уведомления о звонках</span><input type="checkbox" checked></label>';
    else if (key==='chats') controls.innerHTML='<label class="tg-setting-row"><span>Автозагрузка медиа</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Отправлять по Enter</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Анимация эмодзи</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Размер текста</span><select><option>Обычный</option><option>Крупный</option></select></label>';
    else if (key==='data') controls.innerHTML='<label class="tg-setting-row"><span>Автозагрузка фото</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Автозагрузка видео</span><input type="checkbox"></label><label class="tg-setting-row"><span>Использование памяти</span><button type="button">Очистить</button></label>';
    else if (key==='calls') controls.innerHTML='<label class="tg-setting-row"><span>Микрофон</span><button type="button">Проверить</button></label><label class="tg-setting-row"><span>Камера</span><button type="button">Проверить</button></label><label class="tg-setting-row"><span>Использовать мобильные данные</span><input type="checkbox" checked></label>';
    else if (key==='devices') controls.innerHTML='<div class="device-card"><b>Это устройство</b><span>Текущий сеанс Cipherion</span></div><button class="tg-wide-action">Завершить другие сеансы</button>';
    else if (key==='animations') controls.innerHTML='<label class="tg-setting-row"><span>Анимации интерфейса</span><input type="checkbox" checked></label><label class="tg-setting-row"><span>Уменьшить движение</span><input type="checkbox"></label>';
    else if (key==='language') controls.innerHTML='<label class="tg-setting-row"><span>Язык интерфейса</span><select><option>Русский</option><option>English</option><option>Українська</option></select></label>';
    else if (key==='chat-style') controls.innerHTML='<label class="tg-setting-row"><span>Тема</span><select><option>Тёмная</option><option>Системная</option><option>Светлая</option></select></label><label class="tg-setting-row"><span>Размер текста</span><select><option>Обычный</option><option>Крупный</option></select></label>';
    else if (key==='security') controls.innerHTML='<label class="tg-setting-row"><span>Облачный пароль</span><button type="button">Изменить</button></label><label class="tg-setting-row"><span>Код-пароль</span><button type="button">Настроить</button></label><label class="tg-setting-row"><span>Исчезающие сообщения</span><select><option>Выкл.</option><option>30 секунд</option><option>1 минута</option><option>5 минут</option></select></label>';
    else if (key==='vip') controls.innerHTML='<div class="vip-settings-banner">👑 Cipherion VIP</div><p>Дополнительные возможности, расширенные настройки и приоритетные функции.</p><button class="tg-wide-action">Открыть VIP</button>';
    else if (key==='help') controls.innerHTML='<button class="tg-wide-action">Частые вопросы</button><button class="tg-wide-action">Связаться с поддержкой</button><p class="settings-about">Cipherion · безопасный мессенджер</p>';
    else if (key==='profile') controls.innerHTML='<button class="tg-wide-action">Изменить профиль</button><button class="tg-wide-action">Изменить фото</button>';
    page.querySelector('.settings-back').onclick=()=>showHome();
    content.appendChild(page); return page;
  };
  const pageMap=new Map(pages.map(p=>[p[0],makePage(...p)]));

  pages.forEach(([key,icon,title,desc])=>{ const b=document.createElement('button'); b.type='button'; b.className='settings-home-row'; b.innerHTML=`<span class="settings-home-icon">${icon}</span><span><b>${title}</b><small>${desc}</small></span><i>›</i>`; b.onclick=()=>showPage(key); homeList.appendChild(b); });
  function showHome(){ nav.classList.remove('hidden'); content.querySelectorAll('.app-set-section,.settings-page').forEach(x=>x.classList.add('hidden')); content.classList.add('settings-content-hidden'); homeList.classList.remove('hidden'); header.textContent='Настройки'; }
  function showPage(key){ nav.classList.add('hidden'); content.classList.remove('settings-content-hidden'); content.querySelectorAll('.settings-page').forEach(x=>x.classList.add('hidden')); pageMap.get(key)?.classList.remove('hidden'); }
  const oldClose=document.getElementById('app-settings-close');
  if(oldClose) oldClose.onclick=()=>{modal.classList.add('hidden');showHome();};
  showHome();
})();
