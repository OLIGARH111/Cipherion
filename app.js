/* Cipherion — unified frontend controller. All UI actions use the live API. */
(() => {
  'use strict';

  let token = localStorage.getItem('token');
  let userId = localStorage.getItem('userId');
  let username = localStorage.getItem('username');
  let currentChatId = null;
  let currentChatInfo = null;
  let usersCache = [];
  let chatsCache = [];
  let storiesCache = [];
  let activeStoryGroup = null;
  let activeStoryIndex = 0;
  let recorder = null;
  let recordStream = null;
  let recordChunks = [];
  let recordStartedAt = 0;
  let recordTimer = null;
  let recordingKind = null;

  const $ = id => document.getElementById(id);
  const qa = sel => [...document.querySelectorAll(sel)];
  const authScreen = $('auth-screen');
  const appScreen = $('app-screen');
  const authError = $('auth-error');
  const chatsList = $('chats-list');
  const usersList = $('users-list');
  const messagesEl = $('messages');
  const messageForm = $('message-form');
  const messageInput = $('message-input');

  function setAuthError(text = '') { if (authError) authError.textContent = text; }
  function esc(value) {
    const d = document.createElement('div');
    d.textContent = value == null ? '' : String(value);
    return d.innerHTML;
  }
  function fmtTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  function apiHeaders(extra = {}) { return { Authorization: `Bearer ${token}`, ...extra }; }
  async function api(url, options = {}) {
    if (!token) throw new Error('Сессия отсутствует');
    const res = await fetch(url, { credentials: 'same-origin', ...options, headers: apiHeaders(options.headers || {}) });
    if (res.status === 401) { logout(); throw new Error('Сессия истекла'); }
    return res;
  }
  async function jsonApi(url, options = {}) {
    const res = await api(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Ошибка ${res.status}`);
    return data;
  }

  function showApp() {
    authScreen?.classList.add('hidden');
    authScreen?.style.setProperty('display', 'none', 'important');
    appScreen?.classList.remove('hidden');
    appScreen?.style.setProperty('display', 'flex', 'important');
    $('mobile-bottom-nav')?.style.setProperty('display', 'flex', 'important');
    refreshAll().catch(console.error);
  }
  function showAuth() {
    appScreen?.classList.add('hidden');
    appScreen?.style.setProperty('display', 'none', 'important');
    authScreen?.classList.remove('hidden');
    authScreen?.style.setProperty('display', 'flex', 'important');
    $('mobile-bottom-nav')?.style.setProperty('display', 'none', 'important');
  }
  function saveAuth(data) {
    token = data.access_token; userId = String(data.user_id); username = data.username;
    localStorage.setItem('token', token); localStorage.setItem('userId', userId); localStorage.setItem('username', username);
  }
  function logout() {
    try { window.__cipherionWS && window.__cipherionWS.close(1000, 'logout'); } catch (_) {}
    localStorage.removeItem('token'); localStorage.removeItem('userId'); localStorage.removeItem('username');
    token = userId = username = null; currentChatId = null; currentChatInfo = null;
    showAuth();
  }
  window.logout = logout;

  // Authentication
  qa('.tab').forEach(tab => tab.addEventListener('click', () => {
    qa('.tab').forEach(t => t.classList.remove('active')); tab.classList.add('active');
    $('login-form')?.classList.toggle('hidden', tab.dataset.tab !== 'login');
    $('register-form')?.classList.toggle('hidden', tab.dataset.tab !== 'register');
    setAuthError('');
  }));
  $('login-form')?.addEventListener('submit', async e => {
    e.preventDefault(); setAuthError('');
    const btn = e.currentTarget.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Входим…';
    const fd = new FormData(); fd.append('username', ($('login-username')?.value || '').trim()); fd.append('password', $('login-password')?.value || '');
    const cloud = $('login-cloud-password')?.value || ''; if (cloud) fd.append('cloud_password', cloud);
    try { const r = await fetch('/token', { method: 'POST', body: fd, credentials: 'same-origin' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `Ошибка ${r.status}`); saveAuth(d); showApp(); }
    catch (err) { setAuthError(err.message || 'Не удалось войти'); }
    finally { btn.disabled = false; btn.textContent = 'Войти'; }
  });
  $('register-form')?.addEventListener('submit', async e => {
    e.preventDefault(); setAuthError('');
    const uname = ($('reg-username')?.value || '').trim().replace(/^@/, ''); const pass = $('reg-password')?.value || '';
    if (uname.length < 3) return setAuthError('Логин должен содержать минимум 3 символа');
    if (pass.length < 4) return setAuthError('Пароль должен содержать минимум 4 символа');
    const btn = e.currentTarget.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Создаём…';
    const fd = new FormData(); fd.append('username', uname); fd.append('password', pass);
    try { const r = await fetch('/register', { method: 'POST', body: fd, credentials: 'same-origin' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `Ошибка ${r.status}`); saveAuth(d); showApp(); }
    catch (err) { setAuthError(err.message || 'Не удалось зарегистрироваться'); }
    finally { btn.disabled = false; btn.textContent = 'Зарегистрироваться'; }
  });

  async function refreshAll() {
    if (!token) return;
    try { await loadMe(); } catch (_) {}
    await Promise.allSettled([loadUsers(), loadChats(), loadStories()]);
    connectWebSocket();
    initDrawer(); initNavigation(); initSettings(); initComposer(); initStoryUI();
    renderCurrentMobileView('chats');
  }
  async function loadMe() {
    const me = await jsonApi('/me');
    username = me.username || username; userId = String(me.id || userId);
    localStorage.setItem('username', username || ''); localStorage.setItem('userId', userId || '');
    localStorage.setItem('isVip', me.is_vip ? '1' : '0');
    localStorage.setItem('avatarUrl', me.avatar_url || '');
    updateIdentity(me); return me;
  }
  function updateIdentity(me) {
    if ($('drawer-username')) $('drawer-username').textContent = me.username || username || '';
    const letter = (me.username || username || '?')[0].toUpperCase();
    ['drawer-avatar-letter','profile-letter'].forEach(id => { if ($(id)) $(id).textContent = letter; });
    if ($('drawer-avatar-img')) { $('drawer-avatar-img').classList.toggle('hidden', !me.avatar_url); if (me.avatar_url) $('drawer-avatar-img').src = me.avatar_url; }
    if ($('profile-img')) { $('profile-img').classList.toggle('hidden', !me.avatar_url); if (me.avatar_url) $('profile-img').src = me.avatar_url; }
    if ($('vip-menu-badge')) $('vip-menu-badge').classList.toggle('hidden', !me.is_vip);
  }
  async function loadUsers() { usersCache = await jsonApi('/users'); renderUsers(); }
  async function loadChats() { chatsCache = await jsonApi('/chats'); renderChats(); }
  async function loadStories() { try { storiesCache = await jsonApi('/stories'); renderStories(); } catch (_) { storiesCache = []; } }

  function renderUsers() {
    if (!usersList) return;
    const q = ($('user-search')?.value || '').trim().toLowerCase();
    const list = usersCache.filter(u => !q || (u.username || '').toLowerCase().includes(q) || (u.handle || '').toLowerCase().includes(q));
    usersList.innerHTML = list.map(u => `<div class="list-item" data-user-id="${u.id}"><div class="avatar">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc((u.username || '?')[0].toUpperCase())}</div><div class="item-info"><div class="item-name">${esc(u.username || '')}${u.is_vip ? ' 👑' : ''}</div><div class="item-preview">${u.is_online ? 'онлайн' : (u.handle ? '@' + esc(u.handle) : 'оффлайн')}</div></div></div>`).join('') || '<p class="empty-state">Пользователи не найдены</p>';
    usersList.querySelectorAll('.list-item').forEach(el => el.onclick = () => openPrivateChat(Number(el.dataset.userId)));
  }
  function renderChats() {
    if (!chatsList) return;
    chatsList.innerHTML = chatsCache.map(c => `<div class="list-item ${currentChatId === c.id ? 'active' : ''}" data-chat-id="${c.id}"><div class="avatar">${c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="">` : esc((c.name || '?')[0].toUpperCase())}</div><div class="item-info"><div class="item-name">${esc(c.name || 'Чат')}${c.is_channel ? ' 📢' : c.is_group ? ' 👥' : ''}</div><div class="item-preview">${esc(c.last_message || (c.is_favorites ? 'Сохранённые сообщения' : 'Нет сообщений'))}</div></div><div class="chat-meta">${fmtTime(c.last_message_time)}</div></div>`).join('') || '<p class="empty-state">Пока нет чатов.<br>Выберите контакт ниже.</p>';
    chatsList.querySelectorAll('.list-item').forEach(el => el.onclick = () => openChat(Number(el.dataset.chatId)));
  }
  $('user-search')?.addEventListener('input', renderUsers);

  async function openPrivateChat(uid) {
    try { const d = await jsonApi(`/chats/private/${uid}`, { method: 'POST' }); await loadChats(); await openChat(d.chat_id); }
    catch (e) { alert(e.message); }
  }
  async function openFavorites() {
    try { const d = await jsonApi('/chats/favorites', { method: 'POST' }); await loadChats(); await openChat(d.chat_id); }
    catch (e) { alert(e.message); }
  }
  async function openChat(chatId) {
    currentChatId = Number(chatId); window.__currentChatId = currentChatId; renderChats();
    $('no-chat')?.classList.add('hidden'); $('chat-view')?.classList.remove('hidden'); document.querySelector('.sidebar')?.classList.add('hidden-mobile');
    try {
      currentChatInfo = await jsonApi(`/chats/${currentChatId}/info`);
      if ($('chat-title')) $('chat-title').textContent = currentChatInfo.name || 'Чат';
      if ($('chat-status')) $('chat-status').textContent = currentChatInfo.is_group ? `${currentChatInfo.member_count} участников` : currentChatInfo.is_channel ? 'канал' : currentChatInfo.other_user?.is_online ? 'в сети' : 'был(а) недавно';
      setAvatar($('chat-peer-avatar'), currentChatInfo.avatar_url || currentChatInfo.other_user?.avatar_url, currentChatInfo.name);
      const infoBtn = $('chat-info-btn'); if (infoBtn) infoBtn.classList.toggle('hidden', false);
      const msgs = await jsonApi(`/chats/${currentChatId}/messages`); renderMessages(msgs); markRead(msgs);
      $('message-input')?.focus();
    } catch (e) { alert(e.message); }
  }
  function setAvatar(el, url, name) { if (!el) return; el.innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc((name || '?')[0].toUpperCase()); }
  function renderMessages(messages) { if (!messagesEl) return; messagesEl.innerHTML = ''; messages.forEach(appendMessage); messagesEl.scrollTop = messagesEl.scrollHeight; }
  function appendMessage(m) {
    if (!messagesEl || messagesEl.querySelector(`[data-msg-id="${m.id}"]`)) return;
    const mine = String(m.sender_id) === String(userId); const div = document.createElement('div'); div.className = `message ${mine ? 'mine' : 'theirs'}`; div.dataset.msgId = m.id;
    let body = '';
    if (!mine && m.sender_name) body += `<div class="message-sender">${esc(m.sender_name)}</div>`;
    if (m.message_type === 'image' && m.media_url) body += `<img class="message-image" src="${esc(m.media_url)}" alt="Фото" loading="lazy">`;
    else if (m.message_type === 'voice' && m.media_url) body += `<div class="voice-message"><button type="button" class="voice-play">▶</button><audio preload="metadata" src="${esc(m.media_url)}"></audio><span>🎤 ${esc(m.content || '0')} сек</span>${m.transcript ? `<div class="voice-transcript">${esc(m.transcript)}</div>` : `<button type="button" class="transcribe-btn">Расшифровать</button>`}</div>`;
    else if (m.message_type === 'video_note' && m.media_url) body += `<video class="video-note-message" controls playsinline preload="metadata" src="${esc(m.media_url)}"></video>`;
    else if (m.message_type === 'sticker') body += `<div class="message-sticker">${esc(m.content || '')}</div>`;
    else body += `<div class="message-text">${esc(m.content || '')}</div>`;
    body += `<div class="message-footer"><span class="message-time">${fmtTime(m.created_at)}</span>${mine ? `<span class="read-mark">${m.read_status === 'read' ? '✓✓' : '✓'}</span>` : ''}${m.is_pinned ? '<span>📌</span>' : ''}</div>`;
    div.innerHTML = body; messagesEl.appendChild(div);
    div.addEventListener('contextmenu', e => { e.preventDefault(); messageMenu(m, div); });
    let press; div.addEventListener('touchstart', () => { press = setTimeout(() => messageMenu(m, div), 550); }, { passive: true }); div.addEventListener('touchend', () => clearTimeout(press));
    div.querySelector('.voice-play')?.addEventListener('click', () => div.querySelector('audio')?.play());
    div.querySelector('.transcribe-btn')?.addEventListener('click', async () => { try { const d = await jsonApi(`/messages/${m.id}/transcribe`, { method: 'POST' }); div.querySelector('.transcribe-btn')?.remove(); const p = document.createElement('div'); p.className = 'voice-transcript'; p.textContent = d.transcript; div.querySelector('.voice-message')?.appendChild(p); } catch (e) { alert(e.message); } });
  }
  function messageMenu(m, div) {
    qa('.message-context').forEach(x => x.remove()); const menu = document.createElement('div'); menu.className = 'message-context';
    const canDelete = String(m.sender_id) === String(userId) || currentChatInfo?.is_admin;
    menu.innerHTML = `${canDelete ? '<button data-a="delete">🗑 Удалить</button>' : ''}<button data-a="pin">📌 ${m.is_pinned ? 'Открепить' : 'Закрепить'}</button>${m.content ? '<button data-a="copy">📋 Копировать</button>' : ''}`;
    document.body.appendChild(menu); const r = div.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(innerWidth - 190, r.left)) + 'px'; menu.style.top = Math.max(8, r.top - menu.offsetHeight - 6) + 'px';
    menu.onclick = async e => { const a = e.target.closest('button')?.dataset.a; if (!a) return; try { if (a === 'delete') await jsonApi(`/messages/${m.id}/delete`, { method: 'POST' }); else if (a === 'pin') await jsonApi(`/messages/${m.id}/pin`, { method: 'POST' }); else if (a === 'copy') await navigator.clipboard?.writeText(m.content || ''); await openChat(currentChatId); } catch (err) { alert(err.message); } finally { menu.remove(); } };
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  async function markRead(msgs) { const last = msgs?.[msgs.length - 1]; if (!last || !currentChatId) return; try { const fd = new FormData(); fd.append('last_message_id', String(last.id)); await api(`/chats/${currentChatId}/read`, { method: 'POST', body: fd }); } catch (_) {} }

  // Composer, image upload, voice and video notes
  function initComposer() {
    if (!messageForm || messageForm.__cipherionInit) return; messageForm.__cipherionInit = true;
    $('attach-btn')?.addEventListener('click', () => $('image-input')?.click());
    $('image-input')?.addEventListener('change', async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await uploadMedia('/upload/image', f); });
    $('sticker-btn')?.addEventListener('click', toggleStickerPanel);
    $('video-note-btn')?.addEventListener('click', () => startRecording('video'));
    $('voice-btn')?.addEventListener('click', () => { if (recordingKind) stopRecording(true); else startRecording('voice'); });
    $('cancel-rec-btn')?.addEventListener('click', () => stopRecording(false));
    $('send-rec-btn')?.addEventListener('click', () => stopRecording(true));
    messageForm.addEventListener('submit', sendText);
    messageInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); messageForm.requestSubmit(); } });
  }
  async function sendText(e) {
    e.preventDefault(); const content = (messageInput?.value || '').trim(); if (!content || !currentChatId) return;
    const fd = new FormData(); fd.append('chat_id', String(currentChatId)); fd.append('content', content);
    const btn = messageForm.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    try { const m = await jsonApi('/messages', { method: 'POST', body: fd }); messageInput.value = ''; appendMessage(m); messagesEl.scrollTop = messagesEl.scrollHeight; await loadChats(); }
    catch (e) { alert(e.message); }
    finally { if (btn) btn.disabled = false; }
  }
  async function uploadMedia(endpoint, file) {
    if (!currentChatId) return alert('Сначала выберите чат');
    const fd = new FormData(); fd.append('chat_id', String(currentChatId)); fd.append('file', file);
    try { const m = await jsonApi(endpoint, { method: 'POST', body: fd }); appendMessage(m); messagesEl.scrollTop = messagesEl.scrollHeight; await loadChats(); }
    catch (e) { alert(e.message); }
  }
  async function startRecording(kind) {
    if (!currentChatId) return alert('Сначала выберите чат');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return alert('Запись медиа не поддерживается этим браузером');
    if (recordingKind) return;
    recordingKind = kind; recordChunks = []; recordStartedAt = Date.now();
    try {
      recordStream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true });
      const mime = kind === 'video' ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : '') : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '');
      recorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = e => { if (e.data.size) recordChunks.push(e.data); };
      recorder.onstop = async () => {
        const duration = Math.max(1, Math.round((Date.now() - recordStartedAt) / 1000)); const blob = new Blob(recordChunks, { type: recorder.mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm') });
        const file = new File([blob], kind === 'video' ? 'video-note.webm' : 'voice.webm', { type: blob.type });
        const endpoint = kind === 'video' ? '/upload/video_note' : '/upload/voice';
        const fd = new FormData(); fd.append('chat_id', String(currentChatId)); fd.append('duration', String(duration)); fd.append('file', file);
        try { const m = await jsonApi(endpoint, { method: 'POST', body: fd }); appendMessage(m); messagesEl.scrollTop = messagesEl.scrollHeight; await loadChats(); } catch (e) { alert(e.message); }
        cleanupRecording();
      };
      recorder.start(250);
      const ind = $('recording-indicator'); ind?.classList.remove('hidden'); if ($('rec-timer')) $('rec-timer').textContent = '0:00';
      recordTimer = setInterval(() => { const s = Math.floor((Date.now() - recordStartedAt) / 1000); if ($('rec-timer')) $('rec-timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
      if (kind === 'video' && $('video-note-overlay')) { $('video-note-overlay').classList.remove('hidden'); const v = $('video-note-preview'); if (v) { v.srcObject = recordStream; v.play().catch(() => {}); } }
    } catch (e) { cleanupRecording(); alert('Нет доступа к микрофону/камере'); }
  }
  function stopRecording(send) { if (!recorder) return; if (!send) { recorder.onstop = () => cleanupRecording(); } try { recorder.stop(); } catch (_) { cleanupRecording(); } }
  function cleanupRecording() { try { recordStream?.getTracks().forEach(t => t.stop()); } catch (_) {} recordStream = null; recorder = null; recordingKind = null; clearInterval(recordTimer); recordTimer = null; $('recording-indicator')?.classList.add('hidden'); $('video-note-overlay')?.classList.add('hidden'); const v = $('video-note-preview'); if (v) v.srcObject = null; }
  window.startRecording = startRecording; window.stopRecording = stopRecording;

  function toggleStickerPanel() {
    const p = $('sticker-panel'); if (!p) return; if (!p.innerHTML) p.innerHTML = ['😀','😂','❤️','🔥','👍','🎉','😎','🤔','😭','🥳','👏','🚀','👑','💎','🥂','🎩'].map(x => `<button type="button">${x}</button>`).join('');
    p.classList.toggle('hidden'); p.querySelectorAll('button').forEach(b => b.onclick = async () => { if (!currentChatId) return; const fd = new FormData(); fd.append('chat_id', String(currentChatId)); fd.append('content', b.textContent); try { const m = await jsonApi('/messages', { method: 'POST', body: fd }); m.message_type = 'sticker'; appendMessage(m); p.classList.add('hidden'); } catch (e) { alert(e.message); } });
  }

  // Drawer and mobile navigation
  function initDrawer() {
    if ($('menu-btn') && !$('menu-btn').__init) { $('menu-btn').__init = true; $('menu-btn').onclick = () => { $('drawer')?.classList.add('open'); $('drawer-overlay')?.classList.remove('hidden'); }; }
    if ($('drawer-overlay') && !$('drawer-overlay').__init) { $('drawer-overlay').__init = true; $('drawer-overlay').onclick = closeDrawer; }
    if ($('logout-btn') && !$('logout-btn').__init) { $('logout-btn').__init = true; $('logout-btn').onclick = logout; }
    $('menu-new-group')?.addEventListener('click', openGroupModal, { once: true });
    $('menu-new-channel')?.addEventListener('click', openChannelModal, { once: true });
    $('menu-saved')?.addEventListener('click', openFavorites, { once: true });
    $('menu-settings')?.addEventListener('click', openProfileModal, { once: true });
    $('menu-vip')?.addEventListener('click', openVipModal, { once: true });
    $('menu-app-settings')?.addEventListener('click', () => openModal('app-settings-modal'), { once: true });
    $('menu-theme')?.addEventListener('click', toggleTheme, { once: true });
    $('chat-info-btn')?.addEventListener('click', () => currentChatId && openChatInfo(), { once: true });
    $('chat-title')?.addEventListener('click', () => currentChatId && openChatInfo(), { once: true });
    $('back-btn')?.addEventListener('click', () => { currentChatId = null; window.__currentChatId = null; $('chat-view')?.classList.add('hidden'); $('no-chat')?.classList.remove('hidden'); document.querySelector('.sidebar')?.classList.remove('hidden-mobile'); });
  }
  function closeDrawer() { $('drawer')?.classList.remove('open'); $('drawer-overlay')?.classList.add('hidden'); }
  function openModal(id) { $(id)?.classList.remove('hidden'); document.body.classList.add('modal-open'); }
  function closeModal(id) { $(id)?.classList.add('hidden'); document.body.classList.remove('modal-open'); }
  qa('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));
  qa('[id$="-cancel"], #settings-close, #app-settings-close, #vip-close, #vip-close-x, #group-settings-cancel').forEach(b => b.addEventListener('click', () => { const m = b.closest('.modal'); if (m) m.classList.add('hidden'); }));

  function initNavigation() {
    qa('.mobile-nav-item').forEach(b => { if (b.__init) return; b.__init = true; b.onclick = () => { qa('.mobile-nav-item').forEach(x => x.classList.remove('active')); b.classList.add('active'); renderCurrentMobileView(b.dataset.mobileView); }; });
  }
  function renderCurrentMobileView(view) {
    const sidebar = document.querySelector('.sidebar'); const chat = document.querySelector('.chat-area'); const nav = $('mobile-bottom-nav');
    if (!token) { nav?.style.setProperty('display','none','important'); return; } nav?.style.setProperty('display','flex','important');
    if (view === 'calls') { renderCallsPanel(); return; }
    if (view === 'settings') { openModal('app-settings-modal'); return; }
    if (view === 'contacts') { closeDrawer(); sidebar?.classList.remove('hidden-mobile'); $('users-list')?.scrollIntoView({ block:'start' }); return; }
    sidebar?.classList.remove('hidden-mobile'); if (!currentChatId) chat?.querySelector('#chat-view')?.classList.add('hidden');
  }

  // Profile and application settings
  function initSettings() {
    if ($('avatar-input') && !$('avatar-input').__init) { $('avatar-input').__init = true; $('avatar-input').onchange = async e => { const f = e.target.files?.[0]; e.target.value=''; if (!f) return; const fd = new FormData(); fd.append('file', f); try { const d = await jsonApi('/upload/avatar', { method:'POST', body:fd }); localStorage.setItem('avatarUrl', d.avatar_url); await loadMe(); } catch (err) { alert(err.message); } }; }
    if ($('settings-save') && !$('settings-save').__init) { $('settings-save').__init = true; $('settings-save').onclick = saveProfile; }
    if ($('app-settings-save') && !$('app-settings-save').__init) { $('app-settings-save').__init = true; $('app-settings-save').onclick = saveAppSettings; }
    qa('.app-set-nav').forEach(b => { if (b.__init) return; b.__init=true; b.onclick=()=>{ qa('.app-set-nav').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const target=b.dataset.section==='language'?'set-lang-section':'set-'+b.dataset.section; qa('.app-set-section').forEach(x=>x.classList.toggle('hidden',x.id!==target)); }; });
    loadLocalSettings();
  }
  async function openProfileModal() { closeDrawer(); try { const me = await loadMe(); $('settings-username').value=me.username||''; $('settings-handle').value=me.handle||''; $('settings-bio').value=me.bio||''; openModal('settings-modal'); } catch (e) { alert(e.message); } }
  async function saveProfile() { try { const d=await jsonApi('/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:$('settings-handle')?.value||'',bio:$('settings-bio')?.value||''})}); updateIdentity(d); closeModal('settings-modal'); } catch(e){alert(e.message);} }
  function loadLocalSettings() { const font=localStorage.getItem('cipherion_font'); if(font) document.documentElement.style.setProperty('--cipherion-font-size',font+'px'); const bubble=localStorage.getItem('cipherion_bubble'); if(bubble) document.body.dataset.bubble=bubble; const lang=localStorage.getItem('cipherion_language'); if($('set-language')&&lang) $('set-language').value=lang; if(localStorage.getItem('cipherion_reduce_motion')==='1') document.body.classList.add('reduce-motion'); }
  function saveAppSettings() { const font=$('set-font-size')?.value||'15'; localStorage.setItem('cipherion_font',font); document.documentElement.style.setProperty('--cipherion-font-size',font+'px'); const bubble=$('set-bubble-color')?.value||'default'; localStorage.setItem('cipherion_bubble',bubble); document.body.dataset.bubble=bubble; const lang=$('set-language')?.value||'ru'; localStorage.setItem('cipherion_language',lang); const reduce=$('set-reduce-motion')?.checked; localStorage.setItem('cipherion_reduce_motion',reduce?'1':'0'); document.body.classList.toggle('reduce-motion',!!reduce); localStorage.setItem('cipherion_sound_send',$('set-sound-send')?.checked?'1':'0'); localStorage.setItem('cipherion_autoplay_voice',$('set-autoplay-voice')?.checked?'1':'0'); localStorage.setItem('cipherion_notif_preview',$('set-notif-preview')?.checked?'1':'0'); closeModal('app-settings-modal'); }
  function toggleTheme() { const light=!document.body.classList.contains('light-theme'); document.body.classList.toggle('light-theme',light); localStorage.setItem('cipherion_theme',light?'light':'dark'); if($('theme-label')) $('theme-label').textContent=light?'Тёмный режим':'Светлый режим'; if($('theme-icon')) $('theme-icon').textContent=light?'🌙':'☀️'; closeDrawer(); }
  if(localStorage.getItem('cipherion_theme')==='light') document.body.classList.add('light-theme');

  // Groups / channels
  async function openGroupModal() { closeDrawer(); if (!usersCache.length) await loadUsers(); const box=$('group-users-list'); if(box) box.innerHTML=usersCache.map(u=>`<label class="group-user-option"><input type="checkbox" value="${u.id}"><span>${esc(u.username)}</span></label>`).join(''); openModal('group-modal'); }
  $('group-create')?.addEventListener('click', async () => { const name=($('group-name')?.value||'').trim(); const ids=qa('#group-users-list input:checked').map(x=>Number(x.value)); if(!name||!ids.length)return alert('Укажите название и выберите участников'); try{const d=await jsonApi('/chats/group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,user_ids:ids})}); $('group-name').value=''; closeModal('group-modal'); await loadChats(); await openChat(d.chat_id);}catch(e){alert(e.message);} });
  async function openChannelModal(){closeDrawer();openModal('channel-modal');}
  $('channel-create')?.addEventListener('click',async()=>{const name=($('channel-name')?.value||'').trim();const description=($('channel-desc')?.value||'').trim();if(!name)return alert('Введите название канала');try{const d=await jsonApi('/chats/channel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description})});$('channel-name').value='';$('channel-desc').value='';closeModal('channel-modal');await loadChats();await openChat(d.chat_id);}catch(e){alert(e.message);}});

  async function openChatInfo(){ try { const info=await jsonApi(`/chats/${currentChatId}/info`); currentChatInfo=info; showInfoSheet(info); } catch(e){alert(e.message);} }
  function showInfoSheet(info){ qa('.info-sheet').forEach(x=>x.remove()); const el=document.createElement('div');el.className='info-sheet';const other=info.other_user;let rows=`<div class="info-hero"><div class="info-avatar">${info.avatar_url?`<img src="${esc(info.avatar_url)}">`:esc((info.name||'?')[0].toUpperCase())}</div><h2>${esc(info.name||'Чат')}</h2><p>${info.is_group?'Группа':info.is_channel?'Канал':info.is_favorites?'Избранное':other?.is_online?'в сети':'был(а) недавно'}</p></div>`;if(other){if(other.handle)rows+=`<div class="info-row"><b>Ник</b><span>@${esc(other.handle)}</span></div>`;if(other.bio)rows+=`<div class="info-row"><b>О себе</b><span>${esc(other.bio)}</span></div>`;}if(info.description)rows+=`<div class="info-row"><b>Описание</b><span>${esc(info.description)}</span></div>`;if(info.member_count)rows+=`<div class="info-row"><b>Участники</b><span>${info.member_count}</span></div>`;if(info.message_count!=null)rows+=`<div class="info-row"><b>Сообщений</b><span>${info.message_count}</span></div>`;if(info.members?.length)rows+=`<div class="info-members">${info.members.map(m=>`<div><span>${esc(m.username)}</span>${m.is_admin?' <small>админ</small>':''}</div>`).join('')}</div>`;if(other)rows+=`<button class="btn-primary info-call-btn" type="button">📞 Позвонить</button>`;rows+='<button class="btn-secondary info-close-btn" type="button">Закрыть</button>';el.innerHTML=rows;document.body.appendChild(el);el.querySelector('.info-close-btn').onclick=()=>el.remove();el.querySelector('.info-call-btn')?.addEventListener('click',()=>{if(window.__cipherionStartCall)window.__cipherionStartCall({name:other.username,avatar:other.avatar_url,userId:other.id,chatId:info.id});else alert('Модуль звонков ещё загружается');});}

  // VIP
  function openVipModal(){closeDrawer();const vip=localStorage.getItem('isVip')==='1';$('vip-status-active')?.classList.toggle('hidden',!vip);$('vip-status-inactive')?.classList.toggle('hidden',vip);openModal('vip-modal');}
  $('vip-activate-btn')?.addEventListener('click',async()=>{try{await jsonApi('/vip/activate',{method:'POST'});localStorage.setItem('isVip','1');await loadMe();openVipModal();}catch(e){alert(e.message);}});
  $('vip-deactivate-btn')?.addEventListener('click',async()=>{try{await jsonApi('/vip/deactivate',{method:'POST'});localStorage.setItem('isVip','0');await loadMe();openVipModal();}catch(e){alert(e.message);}});
  $('vip-save-status')?.addEventListener('click',()=>alert('VIP уже активен и сохранён на сервере'));
  $('vip-add-story')?.addEventListener('click',()=>{closeModal('vip-modal');openModal('story-compose-modal');});

  // Stories
  function renderStories(){const row=$('stories-row');if(!row)return;row.classList.toggle('hidden',!storiesCache.length);row.innerHTML=`<div class="story-bubble story-add" id="story-add">＋<span>Ваша</span></div>`+storiesCache.map((g,i)=>`<div class="story-bubble" data-story-group="${i}"><div class="story-ring"><div class="story-ring-inner">${g.avatar_url?`<img src="${esc(g.avatar_url)}">`:esc((g.username||'?')[0].toUpperCase())}</div></div><span>${esc(g.username)}</span></div>`).join('');$('story-add')?.addEventListener('click',()=>{if(localStorage.getItem('isVip')!=='1')return openVipModal();openModal('story-compose-modal');});row.querySelectorAll('[data-story-group]').forEach(x=>x.onclick=()=>showStory(Number(x.dataset.storyGroup),0));}
  function showStory(groupIndex,index){const g=storiesCache[groupIndex];if(!g?.stories?.length)return;activeStoryGroup=groupIndex;activeStoryIndex=Math.max(0,Math.min(index,g.stories.length-1));const s=g.stories[activeStoryIndex];$('story-viewer-name').textContent=g.username;$('story-viewer-time').textContent=fmtTime(s.created_at);const body=$('story-viewer-body');body.innerHTML=s.media_url?`<img src="${esc(s.media_url)}" alt="">`:'';if(s.content){const p=document.createElement('div');p.className='story-text';p.textContent=s.content;p.style.left=(s.text_x||50)+'%';p.style.top=(s.text_y||70)+'%';body.appendChild(p);}if(s.sticker){const p=document.createElement('div');p.className='story-sticker';p.textContent=s.sticker;body.appendChild(p);}openModal('story-viewer');jsonApi(`/stories/${s.id}/view`,{method:'POST'}).catch(()=>{});}
  function initStoryUI(){if($('story-viewer-close')&&!$('story-viewer-close').__init){$('story-viewer-close').__init=true;$('story-viewer-close').onclick=()=>closeModal('story-viewer');$('story-prev').onclick=()=>moveStory(-1);$('story-next').onclick=()=>moveStory(1);qa('.story-reactions-bar button').forEach(b=>b.onclick=()=>reactStory(b.dataset.re));$('story-reply-send').onclick=replyStory;$('story-compose-send').onclick=createStory;$('story-compose-cancel').onclick=()=>closeModal('story-compose-modal');}}
  function moveStory(delta){const g=storiesCache[activeStoryGroup];if(!g)return;let ni=activeStoryIndex+delta;if(ni<0)ni=g.stories.length-1;if(ni>=g.stories.length)ni=0;showStory(activeStoryGroup,ni);}
  async function reactStory(emoji){const g=storiesCache[activeStoryGroup];const s=g?.stories?.[activeStoryIndex];if(!s)return;const fd=new FormData();fd.append('emoji',emoji);try{await jsonApi(`/stories/${s.id}/react`,{method:'POST',body:fd});}catch(e){alert(e.message);}}
  async function replyStory(){const g=storiesCache[activeStoryGroup];const s=g?.stories?.[activeStoryIndex];const input=$('story-reply-input');const text=input?.value.trim();if(!s||!text)return;const fd=new FormData();fd.append('content',text);try{await jsonApi(`/stories/${s.id}/reply`,{method:'POST',body:fd});input.value='';}catch(e){alert(e.message);}}
  async function createStory(){const text=$('story-compose-text')?.value.trim()||'';const file=$('story-compose-file')?.files?.[0];if(!text&&!file)return alert('Добавьте текст или фото');const fd=new FormData();if(text)fd.append('content',text);if(file)fd.append('file',file);try{await jsonApi('/stories',{method:'POST',body:fd});$('story-compose-text').value='';$('story-compose-file').value='';closeModal('story-compose-modal');await loadStories();}catch(e){alert(e.message);}}

  // Calls history panel; WebRTC module provides real calls.
  function renderCallsPanel(){let panel=$('calls-panel');if(!panel){panel=document.createElement('div');panel.id='calls-panel';panel.className='calls-panel';document.body.appendChild(panel);}const list=(()=>{try{return JSON.parse(localStorage.getItem('cipherion_call_history')||'[]')}catch{return[]}})();panel.innerHTML=`<div class="calls-panel-inner"><div class="calls-title">Звонки <button type="button" id="calls-close">×</button></div>${list.length?list.map(c=>`<div class="call-history-item"><span>${c.direction==='in'?'📥':'📤'}</span><div><b>${esc(c.name||'Абонент')}</b><small>${new Date(c.at).toLocaleString('ru-RU')} · ${c.status==='answered'?Math.floor((c.duration||0)/60)+':'+String((c.duration||0)%60).padStart(2,'0'):esc(c.status||'')}</small></div><button data-call="${esc(JSON.stringify({name:c.name,avatar:c.avatar,userId:c.userId,chatId:c.chatId}))}">📞</button></div>`).join(''):'<div class="empty-state">Нет звонков</div>'}</div>`;panel.querySelector('#calls-close').onclick=()=>panel.remove();panel.querySelectorAll('[data-call]').forEach(b=>b.onclick=()=>{try{const p=JSON.parse(b.dataset.call);window.__cipherionStartCall?.(p)}catch(_){}});}
  window.__renderCallsList=renderCallsPanel;

  // WebSocket: one connection for messages, presence and WebRTC signaling.
  function connectWebSocket(){if(!token)return;if(window.__cipherionWS&&(window.__cipherionWS.readyState===1||window.__cipherionWS.readyState===0))return;const protocol=location.protocol==='https:'?'wss':'ws';const ws=new WebSocket(`${protocol}://${location.host}/ws/${encodeURIComponent(token)}`);window.__cipherionWS=ws;ws.onopen=()=>console.log('[Cipherion] realtime connected');ws.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return};window.dispatchEvent(new CustomEvent('cipherion-ws-message',{detail:e.data}));if(d.type==='new_message'){loadChats();if(Number(d.chat_id)===Number(currentChatId))appendMessage(d);}else if(d.type==='message_deleted'||d.type==='message_pinned'){if(Number(d.chat_id)===Number(currentChatId))openChat(currentChatId);else loadChats();}else if(d.type==='user_status'){const u=usersCache.find(x=>x.id===d.user_id);if(u){u.is_online=d.is_online;renderUsers();}if(currentChatInfo?.other_user?.id===d.user_id){currentChatInfo.other_user.is_online=d.is_online;$('chat-status').textContent=d.is_online?'в сети':'был(а) недавно';}}else if(d.type==='messages_read'){if(Number(d.chat_id)===Number(currentChatId))openChat(currentChatId);}};ws.onclose=()=>{if(window.__cipherionWS===ws)window.__cipherionWS=null;if(token)setTimeout(connectWebSocket,3000);};ws.onerror=()=>{};}

  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();qa('.modal').forEach(m=>m.classList.add('hidden'));qa('.message-context').forEach(m=>m.remove());}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('user-search')?.focus();}});

  // Start
  if (token && userId && username) showApp(); else showAuth();
})();
