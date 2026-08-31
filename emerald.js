/* Cipherion emerald UX: composer, polls, calls UI, profile, settings */
(function () {
  const CALLS_KEY = 'cipherion_call_history';
  const POLL_KEY = 'cipherion_poll_votes';
  let mediaMode = 'voice';
  let holdTimer = null;
  let holdStarted = false;
  let recordingActive = false;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [...(r || document).querySelectorAll(s)]; }
  function tok() { return localStorage.getItem('token'); }
  function chatId() {
    return window.__currentChatId || (+($('#chats-list .list-item.active')?.dataset?.chatId) || null);
  }

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

    let sendBtn = $('#send-main-btn');
    if (!sendBtn) {
      sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.id = 'send-main-btn';
      sendBtn.title = 'Отправить';
      sendBtn.innerHTML = '✈';
      form.appendChild(sendBtn);
    }
    if (nativeSubmit) nativeSubmit.style.display = 'none';
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
        recordingActive = false;
        form.classList.remove('is-recording');
        if (typeof stopRecording === 'function') stopRecording();
        syncSendMode();
        return;
      }
      const text = (input?.value || '').trim();
      if (!text) return;
      if (nativeSubmit) nativeSubmit.click();
      else form.requestSubmit?.();
      setTimeout(syncSendMode, 50);
    });

    if (voice) {
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
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };

      v.addEventListener('pointerup', (e) => {
        cancelHold();
        if (holdStarted) { holdStarted = false; return; }
        mediaMode = mediaMode === 'voice' ? 'circle' : 'voice';
        v.classList.toggle('mode-circle', mediaMode === 'circle');
        v.textContent = mediaMode === 'circle' ? '🔵' : '🎤';
        v.title = mediaMode === 'circle' ? 'Кружок — удерживайте 2 сек' : 'Голосовое — удерживайте 2 сек';
      });
      v.addEventListener('pointerleave', cancelHold);
      v.addEventListener('pointercancel', cancelHold);
      v.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
    }

    const sendRec = $('#send-rec-btn');
    if (sendRec) sendRec.style.display = 'none';

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

    $('#cancel-rec-btn')?.addEventListener('click', () => {
      recordingActive = false;
      form.classList.remove('is-recording');
      syncSendMode();
    });

    syncSendMode();
  }

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
          saveVote(id, +btn.dataset.i);
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
      const payload = {
        name,
        avatar: av,
        userId: other?.id,
        chatId: info.id
      };
      if (typeof window.__cipherionStartCall === 'function') {
        window.__cipherionStartCall(payload);
      } else if (typeof window.startCall === 'function') {
        window.startCall(payload);
      } else {
        alert('Модуль звонков ещё загружается…');
      }
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

  function loadCalls() {
    try {
      return JSON.parse(localStorage.getItem(CALLS_KEY) || '[]');
    } catch {
      return [];
    }
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
        const st = c.status === 'answered' ? formatDur(c.duration) : (c.status || '');
        return `<div class="call-item">
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
          const p = JSON.parse(btn.getAttribute('data-recall'));
          if (window.__cipherionStartCall) window.__cipherionStartCall(p);
        } catch {}
      });
    });
  }

  window.__renderCallsList = renderCallsList;

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
          if ($('#settings-panel')) $('#settings-panel').style.display = 'none';
          $$('.sidebar > *:not(#calls-panel)').forEach((n) => {
            n.style.display = 'none';
          });
          if (panel) panel.style.display = 'block';
          renderCallsList();
        } else if (panel) {
          panel.style.display = 'none';
          $$('.sidebar > *').forEach((n) => {
            if (n.id === 'calls-panel' || n.id === 'settings-panel') return;
            if (n.classList?.contains('section-title-users') || n.id === 'users-list') return;
            n.style.display = '';
          });
        }
      });
    });
  }

  function setupInlineSettings() {
    const panel = $('#settings-panel');
    if (!panel || panel.__emSet) return;
    panel.__emSet = true;

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
        let block = panel.querySelector('.sp-inline[data-for="' + a + '"]');
        if (!block) {
          block = document.createElement('div');
          block.className = 'sp-inline';
          block.dataset.for = a;
          block.innerHTML = inlineSettingsHtml(a);
          btn.after(block);
        }
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
        <label class="set-row"><span>Облачный пароль</span><input type="password" placeholder="Новый"></label>
        <label class="set-row"><span>Код-пароль</span><input type="password" maxlength="6"></label>`;
    }
    if (a === 'chat') {
      return `<label class="set-row"><span>Шрифт</span><select id="em-font"><option value="14">S</option><option value="15" selected>M</option><option value="17">L</option></select></label>`;
    }
    if (a === 'language') {
      return `<label class="set-row"><span>Язык</span><select><option selected>Русский</option><option>English</option></select></label>`;
    }
    if (a === 'sound') {
      return `<label class="set-row"><span>Звук входящих</span><input type="checkbox" checked></label>`;
    }
    if (a === 'anim') {
      return `<label class="set-row"><span>Анимации</span><input type="checkbox" checked></label>`;
    }
    if (a === 'notif') {
      return `<label class="set-row"><span>Уведомления</span><input type="checkbox" checked></label>`;
    }
    return '';
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
    setTimeout(setupInlineSettings, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('load', init);
  setTimeout(init, 400);
  setTimeout(init, 1200);
})();
