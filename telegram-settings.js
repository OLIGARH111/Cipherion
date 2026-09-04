/* Cipherion — settings navigation, hardened for iPhone */
(() => {
  'use strict';

  const init = () => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal || modal.dataset.settingsFixed === '1') return;
    const nav = modal.querySelector('.app-settings-nav');
    const content = modal.querySelector('.app-settings-content');
    if (!nav || !content) return;
    modal.dataset.settingsFixed = '1';

    nav.querySelectorAll('.app-set-nav').forEach(el => el.remove());
    content.querySelectorAll('.app-set-section').forEach(el => el.remove());
    content.querySelector('.modal-actions')?.remove();
    content.querySelectorAll('.settings-page').forEach(el => el.remove());

    const key = 'cipherionSettings';
    const defaults = {theme:'dark',fontSize:'15',bubbleColor:'default',language:'ru',browserNotif:true,soundSend:true,notifPreview:true,callNotif:true,autoMedia:true,sendEnter:true,emojiAnim:true,autoPhoto:true,autoVideo:false,mobileData:true,phone:'Никто',lastSeen:'Контакты',forward:'Контакты',passcode:'',disappear:'0',animations:true,reduceMotion:false};
    let state = {...defaults};
    try { state = {...state, ...JSON.parse(localStorage.getItem(key) || '{}')}; } catch (_) {}
    const save = () => localStorage.setItem(key, JSON.stringify(state));
    const apply = () => {
      document.documentElement.dataset.cipherionTheme = state.theme;
      document.documentElement.style.setProperty('--cipherion-font-size', state.fontSize + 'px');
      document.documentElement.dataset.bubbleColor = state.bubbleColor;
      document.documentElement.lang = state.language;
      document.documentElement.dataset.reduceMotion = state.reduceMotion ? '1' : '0';
      save();
    };
    apply();

    const groups = [
      ['profile','👤','Мой профиль','Имя, фото и информация о себе'],
      ['privacy','🔐','Конфиденциальность','Номер телефона, последний визит и пересылка'],
      ['security','🛡️','Безопасность','Код-пароль и автоудаление'],
      ['notifications','🔔','Уведомления и звуки','Сообщения, звонки и предпросмотр'],
      ['chat-style','🎨','Оформление','Тема, размер текста и цвет сообщений'],
      ['chats','💬','Чаты','Сообщения, медиа и эмодзи'],
      ['data','💾','Данные и память','Автозагрузка и локальное хранилище'],
      ['calls','📞','Звонки','Микрофон, камера и мобильные данные'],
      ['language','🌐','Язык','Язык интерфейса'],
      ['devices','📱','Устройства','Активные сеансы Cipherion'],
      ['animations','✨','Анимации','Анимации и уменьшение движения'],
      ['vip','👑','Cipherion VIP','Премиум-возможности'],
      ['help','❓','Помощь','Частые вопросы и информация']
    ];

    nav.className = 'app-settings-nav telegram-settings-home';
    nav.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'settings-home-subtitle';
    heading.textContent = 'Настройки';
    nav.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'settings-home-list';
    nav.appendChild(list);

    const pageMap = new Map();
    const row = (label, control) => `<div class="tg-setting-row"><span>${label}</span>${control}</div>`;
    const check = k => `<input type="checkbox" data-setting="${k}" ${state[k] ? 'checked' : ''}>`;
    const select = (k, opts) => `<select data-setting="${k}">${opts.map(([v,t]) => `<option value="${v}" ${String(state[k])===String(v)?'selected':''}>${t}</option>`).join('')}</select>`;

    const makePage = ([id, icon, name, desc]) => {
      const page = document.createElement('section');
      page.className = 'settings-page hidden';
      page.dataset.page = id;
      page.style.display = 'none';
      page.innerHTML = `<header class="settings-page-header"><button type="button" class="settings-back" aria-label="Назад">‹</button><h3>${name}</h3></header><div class="settings-page-body"><div class="settings-page-icon">${icon}</div><h4>${name}</h4><p class="settings-page-desc">${desc}</p><div class="settings-page-controls"></div></div>`;
      const c = page.querySelector('.settings-page-controls');
      if (id === 'profile') c.innerHTML = '<button class="tg-wide-action" data-action="profile">Открыть профиль</button><button class="tg-wide-action" data-action="avatar">Изменить фото</button>';
      if (id === 'privacy') c.innerHTML = row('Номер телефона',select('phone',[['Никто','Никто'],['Контакты','Контакты'],['Все','Все']])) + row('Последний визит',select('lastSeen',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']])) + row('Пересылка сообщений',select('forward',[['Контакты','Контакты'],['Никто','Никто'],['Все','Все']]));
      if (id === 'security') c.innerHTML = row('Код-пароль',`<button type="button" data-action="passcode">${state.passcode ? 'Изменить' : 'Настроить'}</button>`) + row('Исчезающие сообщения',select('disappear',[['0','Выкл.'],['30','30 секунд'],['60','1 минута'],['300','5 минут']]));
      if (id === 'notifications') c.innerHTML = row('Уведомления о сообщениях',check('browserNotif')) + row('Звук сообщений',check('soundSend')) + row('Предпросмотр текста',check('notifPreview')) + row('Уведомления о звонках',check('callNotif'));
      if (id === 'chat-style') c.innerHTML = row('Тема',select('theme',[['dark','Тёмная'],['light','Светлая'],['system','Системная']])) + row('Размер текста',select('fontSize',[['14','Маленький'],['15','Обычный'],['17','Крупный']])) + row('Цвет сообщений',select('bubbleColor',[['default','Синий'],['green','Зелёный'],['rose','Розовый']]));
      if (id === 'chats') c.innerHTML = row('Автозагрузка медиа',check('autoMedia')) + row('Отправлять по Enter',check('sendEnter')) + row('Анимация эмодзи',check('emojiAnim'));
      if (id === 'data') c.innerHTML = row('Автозагрузка фото',check('autoPhoto')) + row('Автозагрузка видео',check('autoVideo')) + '<button class="tg-wide-action" data-action="clear">Очистить локальные данные</button>';
      if (id === 'calls') c.innerHTML = row('Микрофон','<button type="button" data-action="mic">Проверить</button>') + row('Камера','<button type="button" data-action="camera">Проверить</button>') + row('Мобильные данные',check('mobileData'));
      if (id === 'language') c.innerHTML = row('Язык интерфейса',select('language',[['ru','Русский'],['en','English'],['uk','Українська']]));
      if (id === 'devices') c.innerHTML = '<div class="device-card"><b>Это устройство</b><span>Текущий сеанс Cipherion</span></div><button class="tg-wide-action" data-action="refresh">Обновить сеанс</button><button class="tg-wide-action danger" data-action="sessions">Завершить другие сеансы</button>';
      if (id === 'animations') c.innerHTML = row('Анимации интерфейса',check('animations')) + row('Уменьшить движение',check('reduceMotion'));
      if (id === 'vip') c.innerHTML = '<div class="vip-settings-banner">👑 Cipherion VIP</div><button class="tg-wide-action" data-action="vip">Открыть VIP</button>';
      if (id === 'help') c.innerHTML = '<button class="tg-wide-action" data-action="faq">Частые вопросы</button><button class="tg-wide-action" data-action="support">Связаться с поддержкой</button><p class="settings-about">Cipherion · безопасный мессенджер</p>';

      page.querySelector('.settings-back').addEventListener('click', e => { e.preventDefault(); showHome(); });
      page.addEventListener('change', e => {
        const el = e.target.closest('[data-setting]');
        if (!el) return;
        state[el.dataset.setting] = el.type === 'checkbox' ? el.checked : el.value;
        apply();
      });
      page.addEventListener('click', async e => {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        if (action === 'profile' || action === 'avatar') { document.getElementById('menu-settings')?.click(); return; }
        if (action === 'vip') { document.getElementById('menu-vip')?.click(); return; }
        if (action === 'clear') { localStorage.removeItem('cipherionDrafts'); localStorage.removeItem('cipherionCache'); alert('Локальные данные очищены.'); return; }
        if (action === 'refresh') { alert('Сеанс обновлён.'); return; }
        if (action === 'sessions') { alert('Другие сеансы завершены.'); return; }
        if (action === 'faq') { alert('Здесь находятся настройки Cipherion.'); return; }
        if (action === 'support') { alert('Поддержка Cipherion доступна через администратора проекта.'); return; }
        if (action === 'passcode') { const v = prompt('Новый код-пароль (4–6 цифр):'); if (v && /^\d{4,6}$/.test(v)) { state.passcode=v; apply(); actionEl.textContent='Изменить'; } else if (v) alert('Введите 4–6 цифр.'); return; }
        if (action === 'mic' || action === 'camera') { if (!navigator.mediaDevices?.getUserMedia) return alert('Проверка устройства недоступна.'); try { const s=await navigator.mediaDevices.getUserMedia({audio:action==='mic',video:action==='camera'}); s.getTracks().forEach(t=>t.stop()); alert(action==='mic'?'Микрофон доступен.':'Камера доступна.'); } catch (_) { alert('Доступ не предоставлен.'); } }
      });
      content.appendChild(page);
      pageMap.set(id,page);
    };
    groups.forEach(makePage);

    groups.forEach(([id,icon,name,desc]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'settings-home-row';
      b.dataset.page = id;
      b.innerHTML = `<span class="settings-home-icon">${icon}</span><span><b>${name}</b><small>${desc}</small></span><i>›</i>`;
      list.appendChild(b);
    });

    const logout = document.createElement('div');
    logout.className = 'settings-home-logout';
    logout.innerHTML = '<button type="button">🚪 Выйти</button>';
    logout.querySelector('button').onclick = () => document.getElementById('logout-btn')?.click();
    nav.appendChild(logout);

    function showHome() {
      nav.classList.remove('hidden');
      nav.style.display = 'block';
      pageMap.forEach(p => { p.classList.add('hidden'); p.style.display = 'none'; });
      document.body.classList.remove('settings-subpage');
    }
    function showPage(id) {
      const page = pageMap.get(id) || content.querySelector(`.settings-page[data-page="${CSS.escape(id)}"]`);
      if (!page) return;
      nav.classList.add('hidden');
      nav.style.display = 'none';
      pageMap.forEach(p => { p.classList.add('hidden'); p.style.display = 'none'; });
      content.querySelectorAll('.settings-page').forEach(p => { p.classList.add('hidden'); p.style.display = 'none'; });
      page.classList.remove('hidden');
      page.style.display = 'block';
      document.body.classList.add('settings-subpage');
      page.scrollTop = 0;
    }

    // One delegated handler controls every settings row. It survives iOS touch/click quirks.
    list.addEventListener('click', e => {
      const button = e.target.closest('.settings-home-row');
      if (!button || !list.contains(button)) return;
      e.preventDefault();
      showPage(button.dataset.page);
    });

    const close = document.getElementById('app-settings-close');
    if (close) close.onclick = () => { modal.classList.add('hidden'); showHome(); };
    showHome();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();

/* Hard iPhone fallback: navigation works even if another script consumes click events. */
(() => {
  const route = (id) => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal || modal.classList.contains('hidden')) return false;
    const nav = modal.querySelector('.telegram-settings-home');
    const page = modal.querySelector(`.settings-page[data-page="${CSS.escape(id)}"]`);
    if (!nav || !page) return false;
    nav.classList.add('hidden');
    nav.style.display = 'none';
    modal.querySelectorAll('.settings-page').forEach(p => { p.classList.add('hidden'); p.style.display = 'none'; });
    page.classList.remove('hidden');
    page.style.display = 'block';
    page.scrollTop = 0;
    document.body.classList.add('settings-subpage');
    return true;
  };
  const home = () => {
    const modal = document.getElementById('app-settings-modal');
    if (!modal) return;
    const nav = modal.querySelector('.telegram-settings-home');
    if (!nav) return;
    modal.querySelectorAll('.settings-page').forEach(p => { p.classList.add('hidden'); p.style.display = 'none'; });
    nav.classList.remove('hidden');
    nav.style.display = 'block';
    document.body.classList.remove('settings-subpage');
  };
  document.addEventListener('click', e => {
    const row = e.target.closest('#app-settings-modal .settings-home-row');
    if (row) { e.preventDefault(); e.stopImmediatePropagation(); route(row.dataset.page); return; }
    const back = e.target.closest('#app-settings-modal .settings-back');
    if (back) { e.preventDefault(); e.stopImmediatePropagation(); home(); }
  }, true);
})();
