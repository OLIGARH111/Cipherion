// Cipherion app - auth-safe build
let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let username = localStorage.getItem('username');
let myAvatarUrl = localStorage.getItem('avatarUrl') || null;
let isVip = localStorage.getItem('isVip') === '1';
let currentChatId = null;
let ws = null;
let wsReconnectTimer = null;
let wsIntentionalClose = false;
let wsConnecting = false;
let usersCache = [];
let chatsCache = [];

const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const chatsList = document.getElementById('chats-list');
const usersList = document.getElementById('users-list');
const noChat = document.getElementById('no-chat');
const chatView = document.getElementById('chat-view');
const chatTitle = document.getElementById('chat-title');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const userSearch = document.getElementById('user-search');
const backBtn = document.getElementById('back-btn');

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tab.dataset.tab === 'login') {
      loginForm?.classList.remove('hidden');
      registerForm?.classList.add('hidden');
    } else {
      loginForm?.classList.add('hidden');
      registerForm?.classList.remove('hidden');
    }
    if (authError) authError.textContent = '';
  });
});

function saveAuth(data) {
  token = data.access_token;
  userId = String(data.user_id);
  username = data.username;
  localStorage.setItem('token', token);
  localStorage.setItem('userId', userId);
  localStorage.setItem('username', username);
}

function logout() {
  wsIntentionalClose = true;
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) { try { ws.close(1000, 'logout'); } catch (e) {} }
  ws = null;
  localStorage.clear();
  token = userId = username = null;
  myAvatarUrl = null;
  isVip = false;
  currentChatId = null;
  authScreen?.classList.remove('hidden');
  appScreen?.classList.add('hidden');
}

async function api(url, options = {}) {
  if (!token) throw new Error('No active session');
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (res.status === 401) {
    logout();
    if (authError) authError.textContent = 'Сессия истекла. Войдите ещё раз.';
    throw new Error('Unauthorized');
  }
  return res;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  const btn = loginForm.querySelector('button[type="submit"]');
  const fd = new FormData();
  fd.append('username', (document.getElementById('login-username')?.value || '').trim());
  fd.append('password', document.getElementById('login-password')?.value || '');
  const cloud = document.getElementById('login-cloud-password')?.value || '';
  if (cloud) fd.append('cloud_password', cloud);
  if (authError) authError.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Входим…'; }
  try {
    const res = await fetch('/token', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (authError) authError.textContent = data.detail || ('Ошибка ' + res.status);
      return;
    }
    if (!data.access_token || !data.user_id || !data.username) {
      if (authError) authError.textContent = 'Сервер не вернул данные сессии';
      return;
    }
    saveAuth(data);
    showApp();
  } catch (err) {
    if (authError) authError.textContent = err.message || 'Нет связи с сервером';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
  }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  const btn = registerForm.querySelector('button[type="submit"]');
  const uname = (document.getElementById('reg-username')?.value || '').trim();
  const pass = document.getElementById('reg-password')?.value || '';
  if (uname.length < 3) { if (authError) authError.textContent = 'Имя слишком короткое (мин. 3)'; return; }
  if (pass.length < 4) { if (authError) authError.textContent = 'Пароль слишком короткий (мин. 4)'; return; }
  const fd = new FormData();
  fd.append('username', uname);
  fd.append('password', pass);
  if (authError) authError.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Создаём…'; }
  try {
    const res = await fetch('/register', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (authError) authError.textContent = typeof data.detail === 'string' ? data.detail : ('Ошибка ' + res.status);
      return;
    }
    if (!data.access_token || !data.user_id || !data.username) {
      if (authError) authError.textContent = 'Сервер не вернул данные сессии';
      return;
    }
    saveAuth(data);
    showApp();
  } catch (err) {
    if (authError) authError.textContent = err.message || 'Нет связи с сервером';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Зарегистрироваться'; }
  }
});

function showApp() {
  authScreen?.classList.add('hidden');
  appScreen?.classList.remove('hidden');
  loadMe().then(ok => {
    if (!ok || !token) return;
    connectWebSocket();
    loadUsers();
    loadChats();
  });
}

async function loadMe() {
  try {
    const res = await api('/me');
    if (!res.ok) return false;
    const data = await res.json();
    if (data.avatar_url) {
      myAvatarUrl = data.avatar_url;
      localStorage.setItem('avatarUrl', myAvatarUrl);
    }
    isVip = !!data.is_vip;
    localStorage.setItem('isVip', isVip ? '1' : '0');
    return true;
  } catch (e) { return false; }
}

async function loadUsers() {
  try {
    const res = await api('/users');
    usersCache = await res.json();
    renderUsers(usersCache);
  } catch (e) {}
}

async function loadChats() {
  try {
    const res = await api('/chats');
    chatsCache = await res.json();
    renderChats(chatsCache);
  } catch (e) {}
}

function renderUsers(users) {
  if (!usersList) return;
  const q = (userSearch?.value || '').toLowerCase().trim();
  const filtered = q ? users.filter(u => (u.username || '').toLowerCase().includes(q) || (u.handle || '').toLowerCase().includes(q)) : users;
  usersList.innerHTML = filtered.map(u => `
    <div class="list-item" data-user-id="${u.id}">
      <div class="avatar">${escapeHtml((u.username || '?')[0].toUpperCase())}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(u.username || '')}</div>
        <div class="item-preview">${u.is_online ? 'онлайн' : 'оффлайн'}</div>
      </div>
    </div>`).join('');
  usersList.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => openPrivateChat(+el.dataset.userId));
  });
}

function renderChats(chats) {
  if (!chatsList) return;
  chatsList.innerHTML = chats.map(c => `
    <div class="list-item ${currentChatId === c.id ? 'active' : ''}" data-chat-id="${c.id}">
      <div class="avatar">${escapeHtml((c.name || '?')[0].toUpperCase())}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(c.name || 'Чат')}</div>
        <div class="item-preview">${escapeHtml(c.last_message || 'Нет сообщений')}</div>
      </div>
    </div>`).join('');
  chatsList.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => openChat(+el.dataset.chatId, el.querySelector('.item-name')?.textContent || 'Чат'));
  });
}

userSearch?.addEventListener('input', () => renderUsers(usersCache));

async function openPrivateChat(targetUserId) {
  try {
    const res = await api(`/chats/private/${targetUserId}`, { method: 'POST' });
    const data = await res.json();
    const user = usersCache.find(u => u.id === targetUserId);
    openChat(data.chat_id, user ? user.username : 'Чат');
    loadChats();
  } catch (e) {}
}

async function openChat(chatId, title) {
  currentChatId = chatId;
  noChat?.classList.add('hidden');
  chatView?.classList.remove('hidden');
  if (chatTitle) chatTitle.textContent = title;
  document.querySelector('.sidebar')?.classList.add('hidden-mobile');
  renderChats(chatsCache);
  try {
    const res = await api(`/chats/${chatId}/messages`);
    const messages = await res.json();
    if (messagesEl) {
      messagesEl.innerHTML = '';
      messages.forEach(m => appendMessage(m));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (e) {}
  messageInput?.focus();
}

function appendMessage(m) {
  if (!messagesEl) return;
  const isMine = String(m.sender_id) === String(userId);
  const div = document.createElement('div');
  div.className = `message ${isMine ? 'mine' : 'theirs'}`;
  div.dataset.msgId = m.id;
  let html = '';
  if (!isMine) html += `<div class="message-sender">${escapeHtml(m.sender_name || '')}</div>`;
  if (m.message_type === 'image' && m.media_url) {
    html += `<img class="message-image" src="${escapeHtml(m.media_url)}" alt="">`;
  } else if (m.message_type === 'voice') {
    html += `<div>🎤 Голосовое</div>`;
  } else if (m.message_type === 'sticker') {
    html += `<div class="message-sticker">${escapeHtml(m.content || '')}</div>`;
  } else {
    html += `<div>${escapeHtml(m.content || '')}</div>`;
  }
  html += `<div class="message-time">${formatTime(m.created_at)}</div>`;
  div.innerHTML = html;
  messagesEl.appendChild(div);
}

messageForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = (messageInput?.value || '').trim();
  if (!content || !currentChatId || !token) return;
  const chatId = currentChatId;
  messageInput.value = '';
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('content', content);
  try {
    const res = await fetch('/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (messageInput) messageInput.value = content;
      alert(data.detail || 'Не удалось отправить');
      return;
    }
    if (data.chat_id === undefined) data.chat_id = chatId;
    if (data.chat_id === currentChatId) {
      const exists = messagesEl?.querySelector(`[data-msg-id="${data.id}"]`);
      if (!exists) {
        appendMessage(data);
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
    loadChats();
  } catch (err) {
    if (messageInput) messageInput.value = content;
    alert('Ошибка соединения');
  }
});

function connectWebSocket() {
  if (!token || wsConnecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  wsIntentionalClose = false;
  wsConnecting = true;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(token)}`);
  ws.onopen = () => { wsConnecting = false; };
  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    if (data.type === 'new_message') {
      loadChats();
      if (data.chat_id === currentChatId) {
        const exists = messagesEl?.querySelector(`[data-msg-id="${data.id}"]`);
        if (!exists) {
          appendMessage(data);
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    }
  };
  ws.onclose = () => {
    wsConnecting = false;
    if (wsIntentionalClose || !token) return;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      if (token && !wsIntentionalClose) connectWebSocket();
    }, 3000);
  };
  ws.onerror = () => { wsConnecting = false; };
}

backBtn?.addEventListener('click', () => {
  currentChatId = null;
  chatView?.classList.add('hidden');
  noChat?.classList.remove('hidden');
  document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
});

if (token && userId && username) {
  showApp();
} else {
  authScreen?.classList.remove('hidden');
}
