// ==================== STATE ====================
let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let username = localStorage.getItem('username');
let myAvatarUrl = localStorage.getItem('avatarUrl') || null;
let isVip = localStorage.getItem('isVip') === '1';
let storyViewerState = { groups: [], groupIdx: 0, storyIdx: 0, timer: null, paused: false };

let myEmojiStatus = localStorage.getItem('emojiStatus') || '';
let currentChatId = null;
let ws = null;
let wsReconnectTimer = null;
let wsIntentionalClose = false;
let wsConnecting = false;
let usersCache = [];
let chatsCache = [];

// ==================== DOM ====================
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

// Drawer
const menuBtn = document.getElementById('menu-btn');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerUsername = document.getElementById('drawer-username');
const drawerAvatar = document.getElementById('drawer-avatar');
const backBtn = document.getElementById('back-btn');
const groupModal = document.getElementById('group-modal');

// ==================== TABS ====================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'login') {
            loginForm.classList.remove('hidden');
            registerForm.classList.add('hidden');
        } else {
            loginForm.classList.add('hidden');
            registerForm.classList.remove('hidden');
        }
        authError.textContent = '';
    });
});

// ==================== AUTH ====================
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = loginForm.querySelector('button[type="submit"]');
    const formData = new FormData();
    formData.append('username', document.getElementById('login-username').value.trim());
    formData.append('password', document.getElementById('login-password').value);
    formData.append('cloud_password', document.getElementById('login-cloud-password').value);
    authError.textContent = '';
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Входим…';
    }
    try {
        const res = await fetch('/token', { method: 'POST', body: formData, credentials: 'same-origin' });
        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await res.json().catch(() => ({}))
            : { detail: 'Сервер вернул некорректный ответ' };
        if (!res.ok) {
            authError.textContent = data.detail || `Не удалось войти (код ${res.status})`;
            return;
        }
        if (!data.access_token || !data.user_id || !data.username) {
            authError.textContent = 'Сервер не вернул данные сессии. Попробуйте ещё раз.';
            return;
        }
        saveAuth(data);
        showApp();
    } catch (err) {
        authError.textContent = 'Нет связи с сервером. Подождите несколько секунд и повторите.';
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Войти';
        }
    }
});

document.getElementById('reg-send-code')?.addEventListener('click', async () => {
    const phone = document.getElementById('reg-phone').value.trim();
    if (phone.length < 10) {
        authError.textContent = 'Введите номер телефона';
        return;
    }
    const fd = new FormData();
    fd.append('phone', phone);
    try {
        const res = await fetch('/auth/send-code', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            authError.textContent = data.detail || 'Не удалось отправить код';
            return;
        }
        const hint = document.getElementById('reg-code-hint');
        if (hint) hint.textContent = data.demo_code ? `Демо-код: ${data.demo_code}` : 'Код отправлен';
        if (data.demo_code) document.getElementById('reg-phone-code').value = data.demo_code;
    } catch (e) {
        authError.textContent = 'Ошибка соединения';
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = registerForm.querySelector('button[type="submit"]');
    const formData = new FormData();
    formData.append('username', document.getElementById('reg-username').value.trim());
    formData.append('password', document.getElementById('reg-password').value);
    formData.append('phone', document.getElementById('reg-phone').value.trim());
    formData.append('email', document.getElementById('reg-email').value.trim());
    formData.append('phone_code', document.getElementById('reg-phone-code').value.trim());
    authError.textContent = '';
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Создаём аккаунт…';
    }

    try {
        const res = await fetch('/register', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        });
        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await res.json().catch(() => ({}))
            : {};

        if (!res.ok) {
            authError.textContent = typeof data.detail === 'string'
                ? data.detail
                : (data.detail?.[0]?.msg || `Ошибка регистрации (код ${res.status})`);
            return;
        }

        // /register returns a ready JWT session. Save it immediately and switch
        // to the application; loading profile/chats happens in showApp().
        if (!data.access_token || !data.user_id || !data.username) {
            authError.textContent = 'Аккаунт создан, но сервер не вернул данные входа. Попробуйте войти вручную.';
            return;
        }
        saveAuth(data);
        showApp();
    } catch (err) {
        authError.textContent = 'Ошибка соединения с сервером. Попробуйте ещё раз.';
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Зарегистрироваться';
        }
    }
});

function saveAuth(data) {
    token = data.access_token;
    userId = String(data.user_id);
    username = data.username;
    localStorage.setItem('token', token);
    localStorage.setItem('userId', userId);
    localStorage.setItem('username', username);
    if (data.handle) localStorage.setItem('handle', data.handle);
    if (data.phone) localStorage.setItem('phone', data.phone);
    if (data.email) localStorage.setItem('email', data.email);
}

function logout() {
    closeDrawer();
    wsIntentionalClose = true;
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { try { ws.close(1000, 'logout'); } catch (e) {} }
    ws = null;
    localStorage.clear();
    token = userId = username = null;
    myAvatarUrl = null;
    isVip = false;
    currentChatId = null;
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
}

// ==================== AVATAR HELPERS ====================
function avatarHTML(name, url, sizeClass = '') {
    const letter = (name || '?')[0].toUpperCase();
    if (url) {
        return `<div class="avatar has-photo ${sizeClass}"><img src="${escapeHtml(url)}" alt=""></div>`;
    }
    return `<div class="avatar ${sizeClass}">${letter}</div>`;
}

function setDrawerAvatar(url) {
    const letterEl = document.getElementById('drawer-avatar-letter');
    const imgEl = document.getElementById('drawer-avatar-img');
    if (url) {
        imgEl.src = url;
        imgEl.classList.remove('hidden');
        drawerAvatar.classList.add('has-photo');
        if (letterEl) letterEl.style.display = 'none';
    } else {
        imgEl.classList.add('hidden');
        imgEl.src = '';
        drawerAvatar.classList.remove('has-photo');
        if (letterEl) {
            letterEl.style.display = '';
            letterEl.textContent = (username || '?')[0].toUpperCase();
        }
    }
}

function setProfilePreview(url) {
    const preview = document.getElementById('profile-photo-preview');
    const letterEl = document.getElementById('profile-letter');
    const imgEl = document.getElementById('profile-img');
    const removeBtn = document.getElementById('remove-avatar-btn');
    if (url) {
        imgEl.src = url;
        imgEl.classList.remove('hidden');
        preview.classList.add('has-photo');
        letterEl.style.display = 'none';
        removeBtn.classList.remove('hidden');
    } else {
        imgEl.classList.add('hidden');
        imgEl.src = '';
        preview.classList.remove('has-photo');
        letterEl.style.display = '';
        letterEl.textContent = (username || '?')[0].toUpperCase();
        removeBtn.classList.add('hidden');
    }
}
