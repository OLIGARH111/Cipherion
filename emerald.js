/* Cipherion emerald UX: composer, polls, calls, profile, settings */
(function () {
  const CALLS_KEY = 'cipherion_call_history';
  const POLL_KEY = 'cipherion_poll_votes';
  let mediaMode = 'voice'; // voice | circle
  let holdTimer = null;
  let holdStarted = false;
  let recordingActive = false;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [...(r || document).querySelectorAll(s)]; }
  function tok() { return localStorage.getItem('token'); }
  function chatId() {
    return window.__currentChatId || (+($('#chats-list .list-item.active')?.dataset?.chatId) || null);
  }

  /* ---------- Composer structure ---------- */
  function setupComposer() {
    const form = $('#message-form');
    if (!form || form.__em) return;
    form.__em = true;

    const input = $('#message-input');
    const attach = $('#attach-btn');
    const voice = $('#voice-btn');
    const sticker = $('#sticker-btn');
    const videoBtn = $('#video-note-btn');
    const nativeSubmit = form.querySelector('button[type="submit"]');

    // Wrap input + sticker
    if (input && !input.closest('.composer-field')) {
      const wrap = document.createElement('div');
      wrap.className = 'composer-field';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      if (sticker) {
        sticker.style.display = '';
        wrap.appendChild(sticker);
      }
    }

    // Main send button (airplane) — shared for text & voice
    let sendBtn = $('#send-main-btn');
    if (!sendBtn) {
      sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.id = 'send-main-btn';
      sendBtn.title = 'Отправить';
      sendBtn.setAttribute('aria-label', 'Отправить');
      sendBtn.innerHTML = '✈';
      form.appendChild(sendBtn);
    }
    if (nativeSubmit) nativeSubmit.style.display = 'none';

    // Order: attach, field, voice/send
    if (attach) attach.style.order = '1';

    function syncSendMode() {
      const hasText = !!(input && input.value.trim().length > 0);
      form.classList.toggle('has-text', hasText);
      form.classList.toggle('is-recording', recordingActive);
    }

    input?.addEventListener('input', syncSendMode);
    input?.addEventListener('keyup', syncSendMode);

    sendBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (recordingActive) {
        // Finish & send voice via existing stopRecording
        recordingActive = false;
        form.classList.remove('is-recording');
        if (typeof stopRecording === 'function') stopRecording();
        else $('#cancel-rec-btn'); // fallback
        // stopRecording already uploads when not cancelled
        syncSendMode();
        return;
      }
      const text = (input?.value || '').trim();
      if (!text) return;
      // Trigger native form submit path
      if (nativeSubmit) nativeSubmit.click();
      else form.requestSubmit?.();
      setTimeout(syncSendMode, 50);
    });

    // Voice: tap = toggle mode; hold 2s = record
    if (voice) {
      // Remove conflicting ui-v3 listeners by cloning
      const v = voice.cloneNode(true);
      voice.parentNode.replaceChild(v, voice);

      v.addEventListener('pointerdown', (e) => {
        if (recordingActive) return;
        holdStarted = false;
        holdTimer = setTimeout(async () => {
          holdStarted = true;
          if (mediaMode === 'circle') {
            videoBtn?.click();
            return;
          }
          recordingActive = true;
          form.classList.add('is-recording');
          syncSendMode();
          if (typeof startRecording === 'function') {
            try { await startRecording(); } catch (err) {
              recordingActive = false;
              form.classList.remove('is-recording');
            }
          }
        }, 2000);
      });

      const cancelHold = () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      };

      v.addEventListener('pointerup', (e) => {
        cancelHold();
        if (holdStarted) {
          holdStarted = false;
          return; // recording already started
        }
        // short tap: toggle mode
        mediaMode = mediaMode === 'voice' ? 'circle' : 'voice';
        v.classList.toggle('mode-circle', mediaMode === 'circle');
        v.textContent = mediaMode === 'circle' ? '🔵' : '🎤';
        v.title = mediaMode === 'circle' ? 'Кружок — удерживайте 2 сек' : 'Голосовое — удерживайте 2 сек';
      });
      v.addEventListener('pointerleave', cancelHold);
      v.addEventListener('pointercancel', cancelHold);

      // Prevent old click toggle/start
      v.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
    }

    // Hide separate send-rec inside indicator
    const sendRec = $('#send-rec-btn');
    if (sendRec) sendRec.style.display = 'none';

    // When recording UI resets, clear state
    const recInd = $('#recording-indicator');
    if (recInd) {
      new MutationObserver(() => {
        if (recInd.classList.contains('hidden')) {
          recordingActive = false;
          form.classList.remove('is-recording');
          syncSendMode();
        } else {
          recordingActive = true;
          form.classList.add('is-recording');
          syncSendMode();
        }
      }).observe(recInd, { attributes: true, attributeFilter: ['class'] });
    }

    // Cancel recording
    $('#cancel-rec-btn')?.addEventListener('click', () => {
      recordingActive = false;
      form.classList.remove('is-recording');
      syncSendMode();
    });

    syncSendMode();
  }

  /* ---------- Polls with vote buttons ---------- */
  function parsePoll(text) {
    if (!text || !String(text).includes('📊')) return null;
    const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
    const qLine = lines.find((l) => l.includes('Опрос:') || l.startsWith('📊'));
    if (!qLine) return null;
    const q = qLine.replace(/^📊\s*/, '').replace(/^Опрос:\s*/i, '').trim();
    const opts = lines
      .filter((l) => l.startsWith('•') || l.startsWith('-') || l.startsWith('·'))
      .map((l) => l.replace(/^[•\-·]\s*/, '').trim())
      .filter(Boolean);
    if (!q || opts.length < 2) return null;
    return { q, opts };
  }

  function getVotes(msgId) {
    try {
      return JSON.parse(localStorage.getItem(POLL_KEY) || '{}')[msgId] || { counts: {}, mine: null };
    } catch {
      return { counts: {}, mine: null };
    }
  }

  function saveVote(msgId, optIdx) {
    const all = JSON.parse(localStorage.getItem(POLL_KEY) || '{}');
    const cur = all[msgId] || { counts: {}, mine: null };
    if (cur.mine != null && cur.counts[cur.mine]) {
      cur.counts[cur.mine] = Math.max(0, (cur.counts[cur.mine] || 0) - 1);
    }
    cur.mine = optIdx;
    cur.counts[optIdx] = (cur.counts[optIdx] || 0) + 1;
    all[msgId] = cur;
    localStorage.setItem(POLL_KEY, JSON.stringify(all));
    return cur;
  }

  function enhancePolls() {
    $$('#messages .message').forEach((div) => {
      if (div.__pollDone) return;
      const textEl = div.querySelector('div:not(.message-sender):not(.message-time):not(.msg-actions):not(.voice-message):not(.voice-transcript)');
      if (!textEl) return;
      const raw = textEl.textContent || '';
      const poll = parsePoll(raw);
      if (!poll) return;
      div.__pollDone = true;
      const id = div.dataset.msgId || ('tmp' + Math.random());
      const votes = getVotes(id);
      const total = Object.values(votes.counts).reduce((a, b) => a + b, 0) || 0;

      const card = document.createElement('div');
      card.className = 'poll-card';
      let html = `<div class="poll-q">📊 ${esc(poll.q)}</div>`;
      poll.opts.forEach((opt, i) => {
        const c = votes.counts[i] || 0;
        const pct = total ? Math.round((c / total) * 100) : 0;
        const voted = votes.mine === i ? 'voted' : '';
        html += `<button type="button" class="poll-opt ${voted}" data-i="${i}"><span class="bar" style="width:${pct}%"></span><span>${esc(opt)} · ${pct}%</span></button>`;
      });
      html += `<div class="poll-meta">Голосов: ${total}</div>`;
      card.innerHTML = html;
      textEl.replaceWith(card);

      card.querySelectorAll('.poll-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = +btn.dataset.i;
          saveVote(id, i);
          div.__pollDone = false;
          enhancePolls();
        });
      });
    });
  }

  function watchMessages() {
    const box = $('#messages');
    if (!box || box.__emObs) return;
    box.__emObs = true;
    new MutationObserver(() => enhancePolls()).observe(box, { childList: true, subtree: true });
    enhancePolls();
  }

  /* ---------- Full-screen profile + call ---------- */
  function ensureProfileFull() {
    let el = $('#profile-full');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'profile-full';
    el.className = 'profile-full hidden';
    document.body.appendChild(el);
    return el;
  }

  function showProfileFull(info) {
    const el = ensureProfileFull();
    const other = info.other_user;
    const name = info.name || other?.username || 'Чат';
    const av = info.avatar_url || other?.avatar_url;
    const letter = (name || '?')[0].toUpperCase();
    let type = 'Личный чат';
    if (info.is_favorites) type = 'Избранное';
    else if (info.is_channel) type = 'Канал';
    else if (info.is_group) type = 'Группа';

    const canCall = !info.is_group && !info.is_channel && !info.is_favorites && other;

    let rows = '';
    const add = (k, v) => {
      if (v == null || v === '') return;
      rows += `<div class="pf-row"><span class="pf-k">${esc(k)}</span><span>${esc(v)}</span></div>`;
    };
    add('Тип', type);
    if (other?.handle) add('Ник', '@' + other.handle);
    if (other?.phone) add('Телефон', other.phone);
    if (other?.email) add('Почта', other.email);
    if (other?.bio) add('О себе', other.bio);
    if (other?.birthday) add('День рождения', other.birthday);
    if (other && other.is_online != null) add('Статус', other.is_online ? 'В сети' : 'Не в сети');
    if (info.description) add('Описание', info.description);
    if (info.member_count) add('Участники', String(info.member_count));
    if (info.message_count != null) add('Сообщений', String(info.message_count));
    (info.members || []).slice(0, 40).forEach((m) => {
      add(m.is_admin ? 'Админ' : 'Участник', m.username + (m.handle ? ' @' + m.handle : ''));
    });

    el.innerHTML = `
      <div class="pf-top"><button type="button" class="pf-back" id="pf-back">←</button><strong>Профиль</strong></div>
      <div class="pf-hero">
        <div class="pf-av">${av ? '<img src="' + av + '" alt="">' : letter}</div>
        <div class="pf-name">${esc(name)}</div>
        <div style="opacity:.7">${esc(type)}</div>
        ${canCall ? '<div class="pf-actions"><button type="button" class="pf-call" id="pf-call" title="Позвонить">📞</button></div>' : ''}
      </div>
      ${rows}
    `;
    el.classList.remove('hidden');
    $('#pf-back')?.addEventListener('click', () => el.classList.add('hidden'));
    $('#pf-call')?.addEventListener('click', () => {
      startCall({
        name,
        avatar: av,
        userId: other?.id,
        chatId: info.id
      });
    });
  }

  function setupProfileOpen() {
    const title = $('#chat-title');
    if (!title || title.__em) return;
    title.__em = true;
    title.addEventListener(
      'click',
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cid = chatId();
        if (!cid) return;
        try {
          const res = await fetch('/chats/' + cid + '/info', {
            headers: { Authorization: 'Bearer ' + tok() },
            credentials: 'same-origin'
          });
          if (!res.ok) return;
          showProfileFull(await res.json());
        } catch {}
      },
      true
    );
  }

  /* ---------- Calls ---------- */
  function loadCalls() {
    try {
      return JSON.parse(localStorage.getItem(CALLS_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveCall(entry) {
    const list = loadCalls();
    list.unshift(entry);
    localStorage.setItem(CALLS_KEY, JSON.stringify(list.slice(0, 100)));
    renderCallsList();
  }

  function ensureCallScreen() {
    let el = $('#call-screen');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'call-screen';
    el.className = 'call-screen hidden';
    el.innerHTML = `
      <div class="cs-av" id="cs-av">?</div>
      <div class="cs-name" id="cs-name"></div>
      <div class="cs-status" id="cs-status">Вызов…</div>
      <div id="cs-timer" style="font-variant-numeric:tabular-nums;opacity:.8">0:00</div>
      <button type="button" class="cs-hang" id="cs-hang" title="Завершить">📵</button>
    `;
    document.body.appendChild(el);
    return el;
  }

  let callTimer = null;
  let callStart = 0;
  let currentCall = null;

  function startCall({ name, avatar, userId, chatId: cid }) {
    const el = ensureCallScreen();
    currentCall = { name, avatar, userId, chatId: cid, started: Date.now() };
    const av = $('#cs-av');
    if (avatar) av.innerHTML = '<img src="' + avatar + '" alt="">';
    else av.textContent = (name || '?')[0].toUpperCase();
    $('#cs-name').textContent = name || 'Абонент';
    $('#cs-status').textContent = 'Вызов…';
    $('#cs-timer').textContent = '0:00';
    el.classList.remove('hidden');
    callStart = Date.now();
    let connected = false;
    clearInterval(callTimer);
    callTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - callStart) / 1000);
      if (!connected && sec >= 2) {
        connected = true;
        $('#cs-status').textContent = 'Идёт разговор';
        callStart = Date.now();
      }
      const s = connected ? Math.floor((Date.now() - callStart) / 1000) : sec;
      const m = Math.floor(s / 60);
      const r = String(s % 60).padStart(2, '0');
      $('#cs-timer').textContent = m + ':' + r;
    }, 500);

    $('#cs-hang').onclick = () => endCall(connected);
  }

  function endCall(wasConnected) {
    clearInterval(callTimer);
    const el = $('#call-screen');
    el?.classList.add('hidden');
    if (currentCall) {
      const dur = wasConnected ? Math.floor((Date.now() - callStart) / 1000) : 0;
      saveCall({
        id: Date.now(),
        name: currentCall.name,
        avatar: currentCall.avatar,
        userId: currentCall.userId,
        chatId: currentCall.chatId,
        direction: 'out',
        status: wasConnected ? 'answered' : 'cancelled',
        duration: dur,
        at: new Date().toISOString()
      });
    }
    currentCall = null;
  }

  function renderCallsList() {
    let host = $('#calls-panel');
    if (!host) {
      const sidebar = $('.sidebar');
      if (!sidebar) return;
      host = document.createElement('div');
      host.id = 'calls-panel';
      host.className = 'calls-list';
      host.style.display = 'none';
      host.innerHTML = '<div class="chats-page-title">Звонки</div><div id="calls-list-body"></div>';
      sidebar.appendChild(host);
    }
    const body = $('#calls-list-body');
    const list = loadCalls();
    if (!list.length) {
      body.innerHTML = '<p style="padding:24px;text-align:center;opacity:.6">Нет звонков</p>';
      return;
    }
    body.innerHTML = list
      .map((c) => {
        const d = new Date(c.at);
        const time = d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const dir = c.direction === 'in' ? '📥' : '📤';
        const st = c.status === 'answered' ? formatDur(c.duration) : 'отменён';
        return `<div class="call-item" data-chat="${c.chatId || ''}">
          <span class="ci-dir">${dir}</span>
          <div class="ci-meta"><div class="ci-name">${esc(c.name)}</div><div class="ci-time">${time} · ${st}</div></div>
          <button type="button" class="pf-call" style="width:40px;height:40px;font-size:16px" data-recall='${esc(JSON.stringify({ name: c.name, avatar: c.avatar, userId: c.userId, chatId: c.chatId }))}'>📞</button>
        </div>`;
      })
      .join('');
    body.querySelectorAll('[data-recall]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          startCall(JSON.parse(btn.getAttribute('data-recall')));
        } catch {}
      });
    });
  }

  function formatDur(s) {
    s = s || 0;
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setupCallsTab() {
    renderCallsList();
    const nav = $('#mobile-bottom-nav');
    if (!nav || nav.__emCalls) return;
    nav.__emCalls = true;
    nav.querySelectorAll('.mobile-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.mobileView;
        const panel = $('#calls-panel');
        const sidebar = $('.sidebar');
        if (view === 'calls') {
          sidebar?.classList.remove('mobile-contacts-view');
          sidebar?.classList.remove('mobile-settings-view');
          $('#settings-panel') && ($('#settings-panel').style.display = 'none');
          $$('.sidebar > *:not(#calls-panel)').forEach((n) => {
            if (n.id === 'calls-panel') return;
            n.dataset.prevDisplay = n.style.display;
            n.style.display = 'none';
          });
          if (panel) panel.style.display = 'block';
          renderCallsList();
        } else if (panel) {
          panel.style.display = 'none';
          $$('.sidebar > *').forEach((n) => {
            if (n.id === 'calls-panel') return;
            if (n.classList?.contains('section-title-users') || n.id === 'users-list') return;
            if (n.id === 'settings-panel') return;
            n.style.display = '';
          });
        }
      });
    });
  }

  /* ---------- Settings: expand sections inline, no nested small window ---------- */
  function setupInlineSettings() {
    const panel = $('#settings-panel');
    if (!panel || panel.__emSet) return;
    panel.__emSet = true;

    // Intercept section opens: show inline instead of modal where possible
    panel.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('[data-sp]');
        if (!btn) return;
        const a = btn.getAttribute('data-sp');
        const inlineKeys = ['security', 'chat', 'language', 'sound', 'anim', 'notif'];
        if (!inlineKeys.includes(a)) return;

        e.preventDefault();
        e.stopPropagation();

        // Toggle inline block
        let block = panel.querySelector('.sp-inline[data-for="' + a + '"]');
        if (!block) {
          block = document.createElement('div');
          block.className = 'sp-inline';
          block.dataset.for = a;
          block.innerHTML = inlineSettingsHtml(a);
          btn.after(block);
          bindInlineControls(block, a);
        }
        // close others
        panel.querySelectorAll('.sp-inline').forEach((b) => {
          if (b !== block) b.classList.remove('open');
        });
        block.classList.toggle('open');
      },
      true
    );
  }

  function inlineSettingsHtml(a) {
    if (a === 'security') {
      return `
        <label class="set-row"><span>Облачный пароль</span><input type="password" id="em-cloud" placeholder="Новый"></label>
        <label class="set-row"><span>Код-пароль</span><input type="password" id="em-passcode" maxlength="6" placeholder="4–6 цифр"></label>
        <label class="set-row"><span>Кто видит номер</span><select id="em-priv-phone"><option value="all">Все</option><option value="contacts" selected>Контакты</option><option value="nobody">Никто</option></select></label>
        <label class="set-row"><span>Кто видит онлайн</span><select id="em-priv-online"><option value="all" selected>Все</option><option value="contacts">Контакты</option><option value="nobody">Никто</option></select></label>
        <p style="font-size:12px;opacity:.65;padding:8px 0">Полные настройки приватности — в профиле после сохранения на сервере.</p>`;
    }
    if (a === 'chat') {
      return `
        <label class="set-row"><span>Шрифт</span><select id="em-font"><option value="14">S</option><option value="15" selected>M</option><option value="17">L</option><option value="19">XL</option></select></label>
        <label class="set-row"><span>Плотность</span><select id="em-density"><option value="compact">Компактно</option><option value="normal" selected>Обычная</option><option value="relaxed">Свободная</option></select></label>`;
    }
    if (a === 'language') {
      return `<label class="set-row"><span>Язык</span><select id="em-lang"><option value="ru" selected>Русский</option><option value="en">English</option><option value="uk">Українська</option></select></label>`;
    }
    if (a === 'sound') {
      return `
        <label class="set-row"><span>Звук отправки</span><input type="checkbox" id="em-snd-send" checked></label>
        <label class="set-row"><span>Звук входящих</span><input type="checkbox" id="em-snd-recv" checked></label>`;
    }
    if (a === 'anim') {
      return `
        <label class="set-row"><span>Анимации</span><input type="checkbox" id="em-anim" checked></label>
        <label class="set-row"><span>Меньше движения</span><input type="checkbox" id="em-reduce"></label>`;
    }
    if (a === 'notif') {
      return `
        <label class="set-row"><span>В браузере</span><input type="checkbox" id="em-notif" checked></label>
        <label class="set-row"><span>Не беспокоить</span><input type="checkbox" id="em-dnd"></label>`;
    }
    return '';
  }

  function bindInlineControls(block, a) {
    if (a === 'chat') {
      $('#em-font', block)?.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--msg-font', e.target.value + 'px');
        $$('.message').forEach((m) => (m.style.fontSize = e.target.value + 'px'));
      });
    }
  }

  function trackChat() {
    document.addEventListener(
      'click',
      (e) => {
        const item = e.target.closest('#chats-list .list-item');
        if (item?.dataset?.chatId) window.__currentChatId = +item.dataset.chatId;
      },
      true
    );
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  function init() {
    setupComposer();
    watchMessages();
    setupProfileOpen();
    setupCallsTab();
    setupInlineSettings();
    trackChat();
    // Re-try settings panel after mobile-nav creates it
    setTimeout(setupInlineSettings, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
  setTimeout(init, 400);
  setTimeout(init, 1200);
})();
