/* Cipherion UI v3 behaviours */
(function () {
  let mediaMode = 'voice'; // voice | circle

  function $(sel, root) { return (root || document).querySelector(sel); }
  function token() { return localStorage.getItem('token'); }

  /* ---- Sidebar structure: title + users class ---- */
  function polishSidebar() {
    const sidebar = $('.sidebar');
    if (!sidebar || sidebar.__v3) return;
    sidebar.__v3 = true;

    // Mark section titles
    sidebar.querySelectorAll('.section-title').forEach((el) => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t.includes('чат')) el.classList.add('section-title-chats');
      if (t.includes('пользовател') || t.includes('контакт')) el.classList.add('section-title-users');
    });

    // Centered "Чаты" title under search
    if (!$('.chats-page-title', sidebar)) {
      const title = document.createElement('div');
      title.className = 'chats-page-title';
      title.textContent = 'Чаты';
      const header = $('.sidebar-header', sidebar);
      if (header && header.nextSibling) sidebar.insertBefore(title, header.nextSibling);
      else sidebar.prepend(title);
    }

    // Ensure stories row visible shell
    const row = $('#stories-row');
    if (row) {
      row.classList.remove('hidden');
      if (!row.innerHTML.trim()) {
        row.innerHTML = `
          <div class="story-bubble" id="story-add-btn-v3">
            <div class="story-ring"><div class="story-ring-inner story-add">+</div></div>
            <div class="story-name">Ваша</div>
          </div>`;
        $('#story-add-btn-v3')?.addEventListener('click', openStoryCompose);
      }
    }
  }

  function openStoryCompose() {
    const modal = $('#story-compose-modal');
    if (!modal) {
      alert('Истории: войдите и активируйте VIP');
      return;
    }
    modal.classList.remove('hidden');
  }

  /* ---- Composer: voice ↔ circle + attach menu ---- */
  function setupComposer() {
    const form = $('#message-form');
    const voiceBtn = $('#voice-btn');
    const attachBtn = $('#attach-btn');
    const videoBtn = $('#video-note-btn');
    if (!form || !voiceBtn || form.__v3) return;
    form.__v3 = true;

    // Long-press or double-tap not needed: single press toggles mode; when recording uses existing handler
    // Intercept first click to toggle mode if not recording
    voiceBtn.addEventListener(
      'click',
      (e) => {
        if (window.__cipherionRecording) return; // let native handler record
        // If already recording, don't toggle
        const rec = $('#recording-indicator');
        if (rec && !rec.classList.contains('hidden')) return;

        // Toggle mode only when not mid-record: use data attribute
        if (!voiceBtn.__armed) {
          e.preventDefault();
          e.stopImmediatePropagation();
          mediaMode = mediaMode === 'voice' ? 'circle' : 'voice';
          voiceBtn.classList.toggle('mode-circle', mediaMode === 'circle');
          voiceBtn.textContent = mediaMode === 'circle' ? '🔵' : '🎤';
          voiceBtn.title = mediaMode === 'circle' ? 'Кружок (нажмите ещё раз для записи)' : 'Голосовое';
          voiceBtn.__armed = true;
          setTimeout(() => {
            voiceBtn.__armed = false;
          }, 1200);
          return;
        }

        // Second press within window: start circle or voice
        if (mediaMode === 'circle') {
          e.preventDefault();
          e.stopImmediatePropagation();
          videoBtn?.click();
          voiceBtn.__armed = false;
        }
        // else fall through to original voice handler
      },
      true
    );

    // Attach menu
    let menu = $('#attach-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'attach-menu';
      menu.className = 'attach-menu hidden';
      menu.innerHTML = `
        <button type="button" data-att="photo">🖼 Фото</button>
        <button type="button" data-att="file">📄 Файл</button>
        <button type="button" data-att="poll">📊 Опрос</button>
        <button type="button" data-att="sticker">😊 Стикер</button>
      `;
      const chatView = $('#chat-view');
      if (chatView) chatView.appendChild(menu);
      else form.appendChild(menu);
    }

    attachBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== attachBtn) menu.classList.add('hidden');
    });

    // Hidden file input for generic files
    let fileInput = $('#file-input-v3');
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.id = 'file-input-v3';
      fileInput.hidden = true;
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        await sendAsFileOrImage(f);
        fileInput.value = '';
      });
    }

    menu.querySelectorAll('[data-att]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.att;
        menu.classList.add('hidden');
        if (a === 'photo') $('#image-input')?.click();
        else if (a === 'file') {
          fileInput.accept = '*/*';
          fileInput.click();
        } else if (a === 'poll') openPollModal();
        else if (a === 'sticker') $('#sticker-btn')?.click();
      });
    });
  }

  async function sendAsFileOrImage(file) {
    const chatId = window.currentChatId || (typeof currentChatId !== 'undefined' ? currentChatId : null);
    // currentChatId is script-local; try from app state via open chat
    const cid = chatId || getCurrentChatId();
    if (!cid) {
      alert('Сначала выберите чат');
      return;
    }
    const tok = token();
    if (!tok) return;

    if (file.type && file.type.startsWith('image/')) {
      const fd = new FormData();
      fd.append('chat_id', String(cid));
      fd.append('file', file);
      const res = await fetch('/upload/image', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok },
        body: fd
      });
      if (!res.ok) alert((await res.json().catch(() => ({}))).detail || 'Ошибка');
      return;
    }

    // Files: send as text note with name (no dedicated endpoint yet)
    const text = '📎 Файл: ' + file.name + ' (' + Math.round(file.size / 1024) + ' КБ)';
    const fd = new FormData();
    fd.append('chat_id', String(cid));
    fd.append('content', text);
    await fetch('/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok },
      body: fd
    });
  }

  function getCurrentChatId() {
    // Heuristic from active list item
    const active = document.querySelector('#chats-list .list-item.active');
    if (active?.dataset?.chatId) return +active.dataset.chatId;
    return window.__currentChatId || null;
  }

  // Track openChat
  const _open = window.openChat;
  // Patch after load via MutationObserver on chat-view
  const chatView = $('#chat-view');
  if (chatView) {
    new MutationObserver(() => {
      if (!chatView.classList.contains('hidden')) {
        // try read from global if app exposes later
      }
    }).observe(chatView, { attributes: true });
  }

  function openPollModal() {
    let m = $('#poll-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'poll-modal';
      m.className = 'poll-modal hidden';
      m.innerHTML = `
        <div class="poll-box">
          <h3 style="margin:0 0 8px">Опрос</h3>
          <input id="poll-q" placeholder="Вопрос">
          <input id="poll-a1" placeholder="Вариант 1">
          <input id="poll-a2" placeholder="Вариант 2">
          <input id="poll-a3" placeholder="Вариант 3 (необяз.)">
          <div style="display:flex;gap:8px;margin-top:12px">
            <button type="button" class="btn-secondary" id="poll-cancel" style="flex:1;padding:12px;border-radius:12px;border:none">Отмена</button>
            <button type="button" class="btn-primary" id="poll-send" style="flex:1;padding:12px;border-radius:12px;border:none;background:#7c5cff;color:#fff">Отправить</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
      $('#poll-cancel', m)?.addEventListener('click', () => m.classList.add('hidden'));
      $('#poll-send', m)?.addEventListener('click', async () => {
        const q = $('#poll-q', m)?.value?.trim();
        const a1 = $('#poll-a1', m)?.value?.trim();
        const a2 = $('#poll-a2', m)?.value?.trim();
        const a3 = $('#poll-a3', m)?.value?.trim();
        if (!q || !a1 || !a2) {
          alert('Нужны вопрос и минимум 2 варианта');
          return;
        }
        let text = '📊 Опрос: ' + q + '\n• ' + a1 + '\n• ' + a2;
        if (a3) text += '\n• ' + a3;
        const cid = getCurrentChatId();
        if (!cid) {
          alert('Выберите чат');
          return;
        }
        const fd = new FormData();
        fd.append('chat_id', String(cid));
        fd.append('content', text);
        await fetch('/messages', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token() },
          body: fd
        });
        m.classList.add('hidden');
      });
    }
    m.classList.remove('hidden');
  }

  /* ---- Profile sheet on title click ---- */
  function setupProfile() {
    const title = $('#chat-title');
    if (!title || title.__v3) return;
    title.__v3 = true;
    title.addEventListener(
      'click',
      async (e) => {
        e.stopPropagation();
        const cid = getCurrentChatId();
        if (!cid) return;
        try {
          const res = await fetch('/chats/' + cid + '/info', {
            headers: { Authorization: 'Bearer ' + token() },
            credentials: 'same-origin'
          });
          if (!res.ok) return;
          const info = await res.json();
          showProfileSheet(info);
        } catch (err) {}
      },
      true
    );
  }

  function showProfileSheet(info) {
    let sheet = $('#profile-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'profile-sheet';
      sheet.className = 'profile-sheet hidden';
      sheet.innerHTML = '<div class="profile-sheet-panel" id="profile-sheet-panel"></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', (e) => {
        if (e.target === sheet) sheet.classList.add('hidden');
      });
    }
    const panel = $('#profile-sheet-panel');
    const other = info.other_user;
    const name = info.name || other?.username || 'Чат';
    const av = info.avatar_url || other?.avatar_url;
    const letter = (name || '?')[0].toUpperCase();
    let typeLabel = 'Личный чат';
    if (info.is_favorites) typeLabel = 'Избранное';
    else if (info.is_channel) typeLabel = 'Канал';
    else if (info.is_group) typeLabel = 'Группа';

    let rows = '';
    rows += row('Тип', typeLabel);
    if (other?.handle) rows += row('Ник', '@' + other.handle);
    if (other?.phone) rows += row('Телефон', other.phone);
    if (other?.email) rows += row('Почта', other.email);
    if (other?.bio) rows += row('О себе', other.bio);
    if (other?.birthday) rows += row('День рождения', other.birthday);
    if (other?.is_online != null) rows += row('Статус', other.is_online ? 'В сети' : 'Не в сети');
    if (info.description) rows += row('Описание', info.description);
    if (info.member_count) rows += row('Участники', String(info.member_count));
    if (info.message_count != null) rows += row('Сообщений', String(info.message_count));
    if (info.is_group || info.is_channel) {
      (info.members || []).slice(0, 30).forEach((m) => {
        rows += row(m.is_admin ? 'Админ' : 'Участник', m.username + (m.handle ? ' @' + m.handle : ''));
      });
    }

    panel.innerHTML = `
      <div class="profile-sheet-handle"></div>
      <div class="profile-sheet-hero">
        <div class="ps-av">${av ? '<img src="' + av + '" alt="">' : letter}</div>
        <div class="ps-name">${esc(name)}</div>
        <div class="ps-sub">${esc(typeLabel)}</div>
      </div>
      ${rows}
      <button type="button" style="width:100%;margin-top:16px;padding:14px;border-radius:14px;border:none;background:rgba(255,255,255,0.08);color:inherit;font-size:15px" id="ps-close">Закрыть</button>
    `;
    $('#ps-close')?.addEventListener('click', () => sheet.classList.add('hidden'));
    sheet.classList.remove('hidden');
  }

  function row(k, v) {
    return `<div class="ps-row"><span class="ps-k">${esc(k)}</span><span class="ps-v">${esc(v)}</span></div>`;
  }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  /* Track chat id from list clicks */
  function trackChatId() {
    document.addEventListener(
      'click',
      (e) => {
        const item = e.target.closest('#chats-list .list-item');
        if (item?.dataset?.chatId) window.__currentChatId = +item.dataset.chatId;
      },
      true
    );
  }

  /* VIP already full-screen via CSS */

  function init() {
    polishSidebar();
    setupComposer();
    setupProfile();
    trackChatId();
    // Re-polish when stories reload
    const row = $('#stories-row');
    if (row && !row.__obs) {
      row.__obs = true;
      new MutationObserver(() => {
        if (!$('#story-add-btn', row) && !$('#story-add-btn-v3', row)) {
          // keep +
        }
      }).observe(row, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
  setTimeout(init, 400);
  setTimeout(init, 1200);
})();
