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
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        await showApp();
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
        const res = await fetch('/auth/send-code', { method: 'POST', body: fd });
        const data = await res.json();
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
    e.stopImmediatePropagation();
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
            headers: { 'Accept': 'application/json' },
            redirect: 'error'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            authError.textContent = typeof data.detail === 'string'
                ? data.detail
                : (data.detail?.[0]?.msg || `Ошибка регистрации (код ${res.status})`);
            return;
        }
        if (!data.access_token || !data.user_id || !data.username) {
            authError.textContent = 'Сервер создал аккаунт, но не вернул данные сессии.';
            return;
        }
        saveAuth(data);
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        await showApp();
    } catch (err) {
        console.error('Registration error:', err);
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

// ==================== APP ====================
function statusHTML(userLike) {
    // Показываем только выбранный пользователем эмодзи-статус (не дефолтный)
    if (userLike && userLike.emoji_status) {
        return `<span class="emoji-status">${escapeHtml(userLike.emoji_status)}</span>`;
    }
    return '';
}

function updateVipUI() {
    const badge = document.getElementById('vip-menu-badge');
    if (badge) {
        if (isVip) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
    
    if (drawerUsername) {
        const st = myEmojiStatus
            ? `<span class="emoji-status">${escapeHtml(myEmojiStatus)}</span>`
            : '';
        drawerUsername.innerHTML = `${escapeHtml(username || '')}${st}`;
    }
    
    const active = document.getElementById('vip-status-active');
    const inactive = document.getElementById('vip-status-inactive');
    if (active && inactive) {
        if (isVip) {
            active.classList.remove('hidden');
            inactive.classList.add('hidden');
            const inp = document.getElementById('vip-emoji-status');
            if (inp) inp.value = myEmojiStatus || '';
        } else {
            active.classList.add('hidden');
            inactive.classList.remove('hidden');
        }
    }
    
    // Sticker constants appear later in this single-file script. Deferring the
    // rendering prevents an early login/state update from entering their TDZ.
    setTimeout(() => {
        try { renderStickerPanel?.(); } catch (e) { console.warn(e); }
        try { renderStoryStickerPicker?.(); } catch (e) {}
    }, 0);
    try { loadStories(); } catch (e) {}
}

function showApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    
    drawerUsername.textContent = username;
    setDrawerAvatar(myAvatarUrl);
    updateVipUI();
    
    loadMe().then(ok => {
        if (!ok || !token) return;
        connectWebSocket();
        loadUsers();
        loadChats();
    });
    
    // Периодически обновляем онлайн-статусы
    if (window.__onlinePoll) clearInterval(window.__onlinePoll);
    window.__onlinePoll = setInterval(() => {
        if (token) loadUsers();
    }, 15000);
}

async function loadMe() {
    try {
        const res = await api('/me');
        if (!res.ok) return false;
        const data = await res.json();
        if (data.avatar_url) {
            myAvatarUrl = data.avatar_url;
            localStorage.setItem('avatarUrl', myAvatarUrl);
            setDrawerAvatar(myAvatarUrl);
        }
        isVip = !!data.is_vip;
        myEmojiStatus = data.emoji_status || '';
        localStorage.setItem('isVip', isVip ? '1' : '0');
        localStorage.setItem('emojiStatus', myEmojiStatus);
        updateVipUI();
        return true;
    } catch (e) {
        return false;
    }
}

// ==================== DRAWER ====================
function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
    // небольшой delay чтобы transition сработал
    requestAnimationFrame(() => {
        drawerOverlay.classList.add('visible');
    });
}

function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('visible');
    setTimeout(() => {
        if (!drawer.classList.contains('open')) {
            drawerOverlay.classList.add('hidden');
        }
    }, 280);
}

menuBtn.addEventListener('click', openDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

document.getElementById('logout-btn')?.addEventListener('click', logout);

// Новая группа
document.getElementById('menu-new-group')?.addEventListener('click', () => {
    closeDrawer();
    openGroupModal();
});

document.getElementById('menu-saved')?.addEventListener('click', async () => {
    closeDrawer();
    try {
        const res = await api('/chats/favorites', { method: 'POST' });
        if (!res.ok) {
            alert('Не удалось открыть Избранное');
            return;
        }
        const data = await res.json();
        await loadChats();
        openChat(data.chat_id, data.name || '⭐ Избранное');
    } catch (e) {
        alert('Не удалось открыть Избранное');
    }
});

document.getElementById('menu-settings')?.addEventListener('click', () => {
    closeDrawer();
    openSettings();
});


async function loadPrivacyIntoForm() {
    try {
        const res = await api('/privacy');
        if (!res.ok) return;
        const p = await res.json();
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        set('set-privacy-phone', p.privacy_phone);
        set('set-privacy-email', p.privacy_email);
        set('set-privacy-online', p.privacy_online);
        set('set-privacy-avatar', p.privacy_avatar);
        set('set-privacy-bio', p.privacy_bio);
        set('set-privacy-invite', p.privacy_invite);
        try {
            const bl = await api('/blacklist');
            const blData = bl.ok ? await bl.json() : [];
            const box = document.getElementById('blacklist-box');
            if (box) {
                box.innerHTML = blData.length
                    ? blData.map(u => `<div class="group-user-item"><span>${escapeHtml(u.username)}</span><button type="button" data-unbl="${u.id}">Разблок.</button></div>`).join('')
                    : '<p class="photo-hint">Пусто</p>';
                box.querySelectorAll('[data-unbl]').forEach(b => b.addEventListener('click', async () => {
                    await fetch(`/blacklist/${b.dataset.unbl}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                    loadPrivacyIntoForm();
                }));
            }
        } catch (e) {}
        try {
            const sess = await api('/sessions');
            const sData = sess.ok ? await sess.json() : [];
            const sbox = document.getElementById('sessions-box');
            if (sbox) {
                sbox.innerHTML = (sData || []).map(s =>
                    `<div class="group-user-item"><span>${escapeHtml(s.device_name || 'Устройство')}</span><span class="photo-hint">${escapeHtml(s.last_active || '')}</span></div>`
                ).join('') || '<p class="photo-hint">Этот браузер</p>';
            }
        } catch (e) {}
    } catch (e) {
        console.warn('privacy load', e);
    }
}

// ==================== APP SETTINGS 4.3 ====================
const APP_SETTINGS_KEY = 'cipherion_settings_v43';
const defaultAppSettings = {
    showLock: true, lockBlur: false, autoLogout: '0',
    fontSize: '15', msgDensity: 'normal', bubbleColor: 'default', showTime: true,
    language: 'ru',
    soundSend: true, soundRecv: true, autoplayVoice: false, photoQuality: 'high',
    animations: true, bigStickers: true, stickerAnim: true, reduceMotion: false,
    browserNotif: true, notifPreview: true, notifMention: false, dnd: false
};

function loadAppSettings() {
    try {
        return { ...defaultAppSettings, ...JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') };
    } catch {
        return { ...defaultAppSettings };
    }
}

function applyLanguage(lang) {
    const dict = {
        ru: { search: 'Поиск', chats: 'Чаты', users: 'Пользователи', msg: 'Сообщение' },
        en: { search: 'Search', chats: 'Chats', users: 'Users', msg: 'Message' },
        uk: { search: 'Пошук', chats: 'Чати', users: 'Користувачі', msg: 'Повідомлення' }
    };
    const t = dict[lang] || dict.ru;
    const search = document.getElementById('user-search');
    if (search) search.placeholder = t.search;
    const titles = document.querySelectorAll('.sidebar .section-title');
    if (titles[0]) titles[0].textContent = t.chats;
    if (titles[1]) titles[1].textContent = t.users;
    const mi = document.getElementById('message-input');
    if (mi) mi.placeholder = t.msg;
}

function applyAppSettings(s) {
    document.body.style.fontSize = (s.fontSize || 15) + 'px';
    document.body.classList.remove('bubble-blue', 'bubble-green', 'bubble-rose', 'density-compact', 'density-relaxed');
    if (s.bubbleColor === 'blue') document.body.classList.add('bubble-blue');
    if (s.bubbleColor === 'green') document.body.classList.add('bubble-green');
    if (s.bubbleColor === 'rose') document.body.classList.add('bubble-rose');
    if (s.msgDensity === 'compact') document.body.classList.add('density-compact');
    if (s.msgDensity === 'relaxed') document.body.classList.add('density-relaxed');
    document.body.classList.toggle('no-animations', !s.animations || s.reduceMotion);
    document.body.classList.toggle('big-stickers', !!s.bigStickers);
    document.body.classList.toggle('small-stickers', !s.bigStickers);
    document.body.classList.toggle('hide-locks', !s.showLock);
    document.body.classList.toggle('hide-msg-time', !s.showTime);
    window.__cipherionSettings = s;
    applyLanguage(s.language);
}

function fillAppSettingsForm(s) {
    const el = (id) => document.getElementById(id);
    const setVal = (id, v) => { const e = el(id); if (!e) return; if (e.type === 'checkbox') e.checked = !!v; else e.value = v; };
    setVal('set-font-size', s.fontSize);
    setVal('set-msg-density', s.msgDensity);
    setVal('set-bubble-color', s.bubbleColor);
    setVal('set-show-time', s.showTime);
    setVal('set-language', s.language);
    setVal('set-sound-send', s.soundSend);
    setVal('set-sound-recv', s.soundRecv);
    setVal('set-autoplay-voice', s.autoplayVoice);
    setVal('set-photo-quality', s.photoQuality);
    setVal('set-animations', s.animations);
    setVal('set-big-stickers', s.bigStickers);
    setVal('set-sticker-anim', s.stickerAnim);
    setVal('set-reduce-motion', s.reduceMotion);
    setVal('set-browser-notif', s.browserNotif);
    setVal('set-notif-preview', s.notifPreview);
    setVal('set-notif-mention', s.notifMention);
    setVal('set-dnd', s.dnd);
}

function readAppSettingsForm() {
    const el = (id) => document.getElementById(id);
    const val = (id, def) => {
        const e = el(id);
        if (!e) return def;
        if (e.type === 'checkbox') return e.checked;
        return e.value;
    };
    return {
        showLock: false,
        lockBlur: false,
        autoLogout: '0',
        fontSize: val('set-font-size', '15'),
        msgDensity: val('set-msg-density', 'normal'),
        bubbleColor: val('set-bubble-color', 'default'),
        showTime: val('set-show-time', true),
        language: val('set-language', 'ru'),
        soundSend: val('set-sound-send', true),
        soundRecv: val('set-sound-recv', true),
        autoplayVoice: val('set-autoplay-voice', false),
        photoQuality: val('set-photo-quality', 'high'),
        animations: val('set-animations', true),
        bigStickers: val('set-big-stickers', true),
        stickerAnim: val('set-sticker-anim', true),
        reduceMotion: val('set-reduce-motion', false),
        browserNotif: val('set-browser-notif', true),
        notifPreview: val('set-notif-preview', true),
        notifMention: val('set-notif-mention', false),
        dnd: val('set-dnd', false)
    };
}

document.getElementById('menu-app-settings')?.addEventListener('click', async () => {
    closeDrawer();
    try { fillAppSettingsForm(loadAppSettings()); } catch (e) { console.warn(e); }
    try { await loadPrivacyIntoForm(); } catch (e) { console.warn(e); }
    document.querySelectorAll('.app-set-nav').forEach((b, i) => b.classList.toggle('active', i === 0));
    document.querySelectorAll('.app-set-section').forEach((s, i) => s.classList.toggle('hidden', i !== 0));
    document.getElementById('app-settings-modal')?.classList.remove('hidden');
});

document.getElementById('app-settings-close')?.addEventListener('click', () => {
    document.getElementById('app-settings-modal').classList.add('hidden');
});

document.getElementById('app-settings-save')?.addEventListener('click', async () => {
    try {
        const s = readAppSettingsForm();
        localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(s));
        applyAppSettings(s);
    } catch (e) { console.warn(e); }
    try {
        await api('/privacy', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                privacy_phone: document.getElementById('set-privacy-phone')?.value,
                privacy_email: document.getElementById('set-privacy-email')?.value,
                privacy_online: document.getElementById('set-privacy-online')?.value,
                privacy_avatar: document.getElementById('set-privacy-avatar')?.value,
                privacy_bio: document.getElementById('set-privacy-bio')?.value,
                privacy_invite: document.getElementById('set-privacy-invite')?.value,
                cloud_password: document.getElementById('set-cloud-password')?.value || undefined,
                passcode: document.getElementById('set-passcode')?.value || undefined
            })
        });
    } catch (e) { console.warn(e); }
    document.getElementById('app-settings-modal')?.classList.add('hidden');
});

document.querySelectorAll('.app-set-nav').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.app-set-nav').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const map = {
            security: 'set-security',
            'chat-style': 'set-chat-style',
            language: 'set-lang-section',
            av: 'set-av',
            anim: 'set-anim',
            notif: 'set-notif'
        };
        document.querySelectorAll('.app-set-section').forEach(s => s.classList.add('hidden'));
        document.getElementById(map[btn.dataset.section])?.classList.remove('hidden');
    });
});

document.getElementById('set-test-notif')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
        alert('Уведомления не поддерживаются');
        return;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm === 'granted') {
        new Notification('Cipherion', { body: 'Тестовое уведомление 4.3' });
    } else {
        alert('Разрешите уведомления в браузере');
    }
});

applyAppSettings(loadAppSettings());

// Cipherion VIP
document.getElementById('menu-vip')?.addEventListener('click', () => {
    closeDrawer();
    updateVipUI();
    document.getElementById('vip-modal').classList.remove('hidden');
});

function closeVipModal() {
    document.getElementById('vip-modal')?.classList.add('hidden');
}
document.getElementById('vip-close')?.addEventListener('click', closeVipModal);
document.getElementById('vip-close-x')?.addEventListener('click', closeVipModal);
document.getElementById('vip-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'vip-modal') closeVipModal();
});

document.getElementById('vip-activate-btn')?.addEventListener('click', async () => {
    try {
        const res = await api('/vip/activate', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.detail || 'Не удалось активировать VIP');
            return;
        }
        isVip = true;
        localStorage.setItem('isVip', '1');
        try { updateVipUI(); } catch (e) { console.warn(e); }
        try { loadUsers(); } catch (e) {}
        alert(data.message || 'VIP активирован');
    } catch (e) {
        console.error(e);
        alert('Ошибка активации VIP');
    }
});

document.getElementById('vip-deactivate-btn')?.addEventListener('click', async () => {
    try {
        const res = await api('/vip/deactivate', { method: 'POST' });
        if (!res.ok) return;
        isVip = false;
        myEmojiStatus = '';
        localStorage.setItem('isVip', '0');
        localStorage.setItem('emojiStatus', '');
        updateVipUI();
        loadUsers();
    } catch (e) {}
});

const EMOJI_STATUS_OPTIONS = ['🔥','😎','💼','🎮','💜','🚀','😴','💪','✨','🎯','🎵','☕'];

(function initEmojiPicker() {
    const picker = document.getElementById('emoji-status-picker');
    if (!picker) return;
    picker.innerHTML = EMOJI_STATUS_OPTIONS.map(e =>
        `<button type="button" data-e="${e}">${e}</button>`
    ).join('');
    picker.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('vip-emoji-status').value = btn.dataset.e;
        });
    });
})();

document.getElementById('vip-save-status')?.addEventListener('click', async () => {
    const emoji = document.getElementById('vip-emoji-status').value.trim();
    try {
        const res = await api('/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji_status: emoji })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка');
            return;
        }
        const data = await res.json();
        myEmojiStatus = data.emoji_status || '';
        localStorage.setItem('emojiStatus', myEmojiStatus);
        updateVipUI();
        alert('Статус сохранён');
    } catch (e) {
        alert('Ошибка сохранения статуса');
    }
});

document.getElementById('vip-add-story')?.addEventListener('click', () => {
    if (!isVip) {
        alert('Истории доступны только Cipherion VIP');
        return;
    }
    document.getElementById('vip-modal')?.classList.add('hidden');
    document.getElementById('story-compose-text').value = '';
    document.getElementById('story-compose-file').value = '';
    document.getElementById('story-compose-modal').classList.remove('hidden');
});

document.getElementById('story-compose-cancel')?.addEventListener('click', () => {
    document.getElementById('story-compose-modal').classList.add('hidden');
});

(function initStoryComposer() {
    const fonts = document.querySelectorAll('.font-btn');
    fonts.forEach(btn => btn.addEventListener('click', () => {
        fonts.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const ta = document.getElementById('story-compose-text');
        ta.className = 'story-font-' + btn.dataset.font;
    }));
    // The sticker catalogue is initialized later in the file.
    setTimeout(() => renderStoryStickerPicker?.(), 0);
})();

document.getElementById('story-compose-send')?.addEventListener('click', async () => {
    if (!isVip) {
        alert('Истории доступны только Cipherion VIP');
        return;
    }
    const text = document.getElementById('story-compose-text').value.trim();
    const fileInput = document.getElementById('story-compose-file');
    const font = document.querySelector('.font-btn.active')?.dataset.font || 'default';
    const sticker = document.getElementById('story-compose-sticker').value || '';
    const formData = new FormData();
    formData.append('content', text);
    formData.append('font_style', font);
    formData.append('sticker', sticker);
    formData.append('text_x', document.getElementById('story-text-x')?.value || '50');
    formData.append('text_y', document.getElementById('story-text-y')?.value || '70');
    if (fileInput.files[0]) formData.append('file', fileInput.files[0]);
    await postStory(formData);
    document.getElementById('story-compose-modal').classList.add('hidden');
});

document.querySelectorAll('.story-reactions-bar button').forEach(btn => {
    btn.addEventListener('click', async () => {
        pauseStoryTimer();
        const st = storyViewerState;
        const story = st.groups?.[st.groupIdx]?.stories?.[st.storyIdx];
        if (!story) return;
        const fd = new FormData();
        fd.append('emoji', btn.dataset.re);
        try {
            await fetch(`/stories/${story.id}/react`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd
            });
            story.reactions = (story.reactions || []).filter(r => String(r.user_id) !== String(userId));
            story.reactions.push({ user_id: +userId, username: username, emoji: btn.dataset.re });
            story.reaction_count = story.reactions.length;
            // обновить только summary без полного рестарта таймера
            const body = document.getElementById('story-viewer-body');
            let sum = body.querySelector('.story-react-summary');
            if (!sum) {
                sum = document.createElement('div');
                sum.className = 'story-react-summary';
                body.appendChild(sum);
            }
            sum.innerHTML = `${story.reactions.map(r => r.emoji).join(' ')} <span>${story.reactions.length}</span>`;
        } catch (e) {}
        resumeStoryTimer(10000);
    });
});

document.getElementById('story-reply-input')?.addEventListener('focus', () => pauseStoryTimer());
document.getElementById('story-reply-input')?.addEventListener('blur', () => {
    if (!storyViewerState.paused) return;
});

document.getElementById('story-reply-send')?.addEventListener('click', async () => {
    const input = document.getElementById('story-reply-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    pauseStoryTimer();
    const st = storyViewerState;
    const story = st.groups?.[st.groupIdx]?.stories?.[st.storyIdx];
    if (!story) return;
    const fd = new FormData();
    fd.append('content', text);
    try {
        const res = await fetch(`/stories/${story.id}/reply`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd
        });
        if (res.ok) {
            input.value = '';
            const tip = document.getElementById('story-reply-tip');
            if (tip) {
                tip.textContent = 'Ответ отправлен';
                tip.classList.remove('hidden');
                setTimeout(() => tip.classList.add('hidden'), 2000);
            }
        }
    } catch (e) {}
    resumeStoryTimer(12000);
});

function openStoryViewer(groupIdx, storyIdx) {
    const groups = window.__storyGroups || [];
    if (!groups[groupIdx] || !groups[groupIdx].stories?.length) return;
    storyViewerState = { groups, groupIdx, storyIdx, timer: null };
    document.getElementById('story-viewer').classList.remove('hidden');
    renderStoryFrame();
}

function closeStoryViewer() {
    if (storyViewerState.timer) clearTimeout(storyViewerState.timer);
    document.getElementById('story-viewer').classList.add('hidden');
}

function pauseStoryTimer() {
    if (storyViewerState.timer) {
        clearTimeout(storyViewerState.timer);
        storyViewerState.timer = null;
    }
    storyViewerState.paused = true;
}

function resumeStoryTimer(ms) {
    pauseStoryTimer();
    storyViewerState.paused = false;
    storyViewerState.timer = setTimeout(() => storyNext(), ms || 8000);
}

function renderStoryFrame() {
    const { groups, groupIdx, storyIdx } = storyViewerState;
    const g = groups[groupIdx];
    const s = g.stories[storyIdx];
    if (!s) { closeStoryViewer(); return; }
    
    document.getElementById('story-viewer-name').textContent = g.username || '';
    document.getElementById('story-viewer-time').textContent = s.created_at
        ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    
    const prog = document.getElementById('story-progress');
    prog.innerHTML = g.stories.map((_, i) =>
        `<span class="${i < storyIdx ? 'done' : ''}"><i id="story-prog-${i}"></i></span>`
    ).join('');
    requestAnimationFrame(() => {
        const bar = document.getElementById(`story-prog-${storyIdx}`);
        if (bar) {
            bar.style.width = '0';
            bar.style.transition = 'none';
            requestAnimationFrame(() => {
                bar.style.transition = 'width 8s linear';
                bar.style.width = '100%';
            });
        }
    });
    
    const body = document.getElementById('story-viewer-body');
    const fontClass = 'story-font-' + (s.font_style || 'default');
    const tx = s.text_x != null ? s.text_x : 50;
    const ty = s.text_y != null ? s.text_y : 70;
    let inner = '<div class="story-stage">';
    if (s.media_url) {
        inner += `<img class="story-stage-img" src="${escapeHtml(s.media_url)}" alt="">`;
    } else {
        inner += `<div class="story-stage-bg"></div>`;
    }
    if (s.sticker) {
        const anim = (typeof stickerAnimClass === 'function') ? stickerAnimClass(s.sticker) : '';
        inner += `<div class="story-stage-sticker" style="left:${tx}%;top:${Math.max(5, ty - 18)}%"><span class="sticker-anim ${anim}">${escapeHtml(s.sticker)}</span></div>`;
    }
    if (s.content) {
        inner += `<div class="story-stage-text ${fontClass}" style="left:${tx}%;top:${ty}%">${escapeHtml(s.content)}</div>`;
    }
    inner += '</div>';
    
    // реакции текущей истории
    const myReact = (s.reactions || []).find(r => String(r.user_id) === String(userId));
    const isOwner = String(g.user_id) === String(userId);
    let meta = '';
    if ((s.reactions || []).length) {
        meta += `<div class="story-react-summary">${(s.reactions || []).map(r => r.emoji).join(' ')} <span>${s.reactions.length}</span></div>`;
    }
    if (isOwner) {
        meta += `<button type="button" class="story-insights-btn" id="story-insights-btn">👁 ${(s.view_count||0)} · ${(s.reaction_count||s.reactions?.length||0)} реакций</button>`;
    }
    body.innerHTML = inner + meta;
    
    document.getElementById('story-insights-btn')?.addEventListener('click', async () => {
        pauseStoryTimer();
        try {
            const res = await api(`/stories/${s.id}/insights`);
            const data = await res.json();
            const views = (data.views || []).map(v => v.username).join(', ') || 'пока никто';
            const reacts = (data.reactions || []).map(r => `${r.username} ${r.emoji}`).join('\n') || 'пока нет';
            alert(`Просмотры:\n${views}\n\nРеакции:\n${reacts}`);
            resumeStoryTimer(10000);
        } catch (e) {
            resumeStoryTimer(8000);
        }
    });
    
    // отметить просмотр
    if (!isOwner) {
        fetch(`/stories/${s.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    
    resumeStoryTimer(8000);
}

function storyNext() {
    const st = storyViewerState;
    const g = st.groups[st.groupIdx];
    if (st.storyIdx + 1 < g.stories.length) {
        st.storyIdx++;
        renderStoryFrame();
    } else if (st.groupIdx + 1 < st.groups.length) {
        st.groupIdx++;
        st.storyIdx = 0;
        renderStoryFrame();
    } else {
        closeStoryViewer();
    }
}

function storyPrev() {
    const st = storyViewerState;
    if (st.storyIdx > 0) {
        st.storyIdx--;
        renderStoryFrame();
    } else if (st.groupIdx > 0) {
        st.groupIdx--;
        st.storyIdx = st.groups[st.groupIdx].stories.length - 1;
        renderStoryFrame();
    }
}

document.getElementById('story-viewer-close')?.addEventListener('click', closeStoryViewer);
document.getElementById('story-next')?.addEventListener('click', storyNext);
document.getElementById('story-prev')?.addEventListener('click', storyPrev);

async function postStory(formData) {
    try {
        const res = await fetch('/stories', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.detail || 'Не удалось создать историю');
            return;
        }
        document.getElementById('vip-modal').classList.add('hidden');
        loadStories();
    } catch (e) {
        alert('Ошибка создания истории');
    }
}

// storyViewerState declared at top

async function loadStories() {
    const row = document.getElementById('stories-row');
    if (!row) return;
    try {
        const res = await api('/stories');
        const groups = await res.json();
        window.__storyGroups = groups;
        
        if (!groups.length && !isVip) {
            row.classList.add('hidden');
            row.innerHTML = '';
            return;
        }
        
        row.classList.remove('hidden');
        let html = '';
        
        if (isVip) {
            html += `
                <div class="story-bubble" id="story-add-btn">
                    <div class="story-ring"><div class="story-ring-inner story-add">+</div></div>
                    <div class="story-name">Ваша</div>
                </div>`;
        }
        
        html += groups.map((g, gi) => {
            const av = g.avatar_url
                ? `<img src="${escapeHtml(g.avatar_url)}" alt="">`
                : escapeHtml((g.username || '?')[0].toUpperCase());
            return `
                <div class="story-bubble" data-group-idx="${gi}">
                    <div class="story-ring"><div class="story-ring-inner">${av}</div></div>
                    <div class="story-name">${escapeHtml(g.username)}</div>
                </div>`;
        }).join('');
        
        row.innerHTML = html;
        
        document.getElementById('story-add-btn')?.addEventListener('click', () => {
            if (!isVip) {
                alert('Истории доступны только Cipherion VIP');
                return;
            }
            document.getElementById('story-compose-text').value = '';
            document.getElementById('story-compose-file').value = '';
            document.getElementById('story-compose-modal').classList.remove('hidden');
        });
        
        row.querySelectorAll('.story-bubble[data-group-idx]').forEach(el => {
            el.addEventListener('click', () => {
                openStoryViewer(+el.dataset.groupIdx, 0);
            });
        });
    } catch (e) {
        row.classList.add('hidden');
    }
}

// ==================== SETTINGS / МОЙ ПРОФИЛЬ ====================
var settingsModal = document.getElementById('settings-modal');
let myProfile = {};

async function openSettings() {
    document.getElementById('settings-username').value = username || '';
    setProfilePreview(myAvatarUrl);
    
    try {
        const res = await api('/me');
        myProfile = await res.json();
        document.getElementById('settings-handle').value = (myProfile.handle || '').replace(/^@/, '');
        document.getElementById('settings-phone').value = myProfile.phone || '';
        document.getElementById('settings-email').value = myProfile.email || '';
        document.getElementById('settings-bio').value = myProfile.bio || '';
        document.getElementById('settings-birthday').value = myProfile.birthday || '';
        if (myProfile.avatar_url) {
            myAvatarUrl = myProfile.avatar_url;
            setProfilePreview(myAvatarUrl);
            setDrawerAvatar(myAvatarUrl);
        }
    } catch (e) {}
    
    settingsModal.classList.remove('hidden');
}

document.getElementById('settings-close')?.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

document.getElementById('settings-save')?.addEventListener('click', async () => {
    const body = {
        handle: document.getElementById('settings-handle').value.trim(),
        phone: document.getElementById('settings-phone').value.trim(),
        email: document.getElementById('settings-email').value.trim(),
        bio: document.getElementById('settings-bio').value.trim(),
        birthday: document.getElementById('settings-birthday').value
    };
    
    try {
        const res = await api('/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(typeof err.detail === 'string' ? err.detail : 'Ошибка сохранения');
            return;
        }
        
        myProfile = await res.json();
        settingsModal.classList.add('hidden');
    } catch (e) {
        alert('Ошибка сохранения профиля');
    }
});

document.getElementById('avatar-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Выберите изображение');
        return;
    }
    
    if (file.size > 3 * 1024 * 1024) {
        alert('Файл слишком большой (макс 3 МБ)');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch('/upload/avatar', {
            credentials: 'same-origin',
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка загрузки');
            return;
        }
        
        const data = await res.json();
        myAvatarUrl = data.avatar_url;
        localStorage.setItem('avatarUrl', myAvatarUrl);
        setProfilePreview(myAvatarUrl);
        setDrawerAvatar(myAvatarUrl);
        
    } catch (err) {
        alert('Ошибка загрузки фото');
    }
    
    e.target.value = '';
});

document.getElementById('remove-avatar-btn')?.addEventListener('click', async () => {
    // Просто убираем локально — полный remove можно добавить на бэк
    // Пока загружаем прозрачный 1x1 не будем — просто сбросим отображение
    // Для полного удаления нужен DELETE endpoint; сделаем через повторную загрузку позже
    alert('Чтобы сменить фото — выберите новое. Удаление будет в следующей версии.');
});

// Тема
function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light');
        const icon = document.getElementById('theme-icon');
        const label = document.getElementById('theme-label');
        if (icon) icon.textContent = '🌙';
        if (label) label.textContent = 'Тёмный режим';
    } else {
        document.body.classList.remove('light');
        const icon = document.getElementById('theme-icon');
        const label = document.getElementById('theme-label');
        if (icon) icon.textContent = '☀️';
        if (label) label.textContent = 'Светлый режим';
    }
    localStorage.setItem('theme', theme);
}

applyTheme(localStorage.getItem('theme') || 'dark');

document.getElementById('menu-theme')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    try { closeDrawer(); } catch (err) {}
});

// Создать канал
document.getElementById('menu-new-channel')?.addEventListener('click', () => {
    closeDrawer();
    document.getElementById('channel-name').value = '';
    document.getElementById('channel-desc').value = '';
    document.getElementById('channel-modal').classList.remove('hidden');
});

document.getElementById('channel-cancel')?.addEventListener('click', () => {
    document.getElementById('channel-modal')?.classList.add('hidden');
});
document.getElementById('channel-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'channel-modal') e.target.classList.add('hidden');
});
document.getElementById('group-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'group-modal') e.target.classList.add('hidden');
});

document.getElementById('channel-create')?.addEventListener('click', async () => {
    const name = document.getElementById('channel-name').value.trim();
    const description = document.getElementById('channel-desc').value.trim();
    if (!name) {
        alert('Введите название канала');
        return;
    }
    try {
        const res = await api('/chats/channel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка создания канала');
            return;
        }
        const data = await res.json();
        document.getElementById('channel-modal').classList.add('hidden');
        loadChats();
        openChat(data.chat_id, data.name);
    } catch (e) {
        alert('Ошибка создания канала');
    }
});

// Назад (мобильный)
backBtn.addEventListener('click', () => {
    currentChatId = null;
    chatView.classList.add('hidden');
    noChat.classList.remove('hidden');
    document.querySelector('.sidebar')?.classList.remove('hidden-mobile');
});

async function api(url, options = {}) {
    if (!token) {
        throw new Error('No active session');
    }
    const res = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            ...(options.headers || {})
        }
    });

    if (res.status === 401) {
        logout();
        authError.textContent = 'Сессия истекла. Войдите в аккаунт ещё раз.';
        throw new Error('Unauthorized');
    }

    return res;
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

function normalizePhone(p) {
    return String(p || '').replace(/[\s\-\(\)]/g, '');
}

function renderUsers(users) {
    const query = userSearch.value.toLowerCase().trim();
    const queryPhone = normalizePhone(query);
    
    const filtered = query
        ? users.filter(u => {
            const name = (u.username || '').toLowerCase();
            const handle = (u.handle || '').toLowerCase();
            const phone = normalizePhone(u.phone);
            return name.includes(query)
                || handle.includes(query)
                || (queryPhone && phone.includes(queryPhone));
        })
        : users;
    
    usersList.innerHTML = filtered.map(u => {
        const online = !!u.is_online;
        const av = u.avatar_url
            ? `<div class="avatar has-photo"><img src="${escapeHtml(u.avatar_url)}" alt=""><span class="status-dot ${online ? 'online' : ''}"></span></div>`
            : `<div class="avatar">${u.username[0].toUpperCase()}<span class="status-dot ${online ? 'online' : ''}"></span></div>`;
        return `
        <div class="list-item" data-user-id="${u.id}">
            ${av}
            <div class="item-info">
                <div class="item-name">${escapeHtml(u.username)}${statusHTML(u)}</div>
                <div class="item-preview">${u.handle ? '@' + escapeHtml(u.handle) + ' · ' : ''}${online ? 'онлайн' : 'оффлайн'}</div>
            </div>
        </div>`;
    }).join('');
    
    usersList.querySelectorAll('.list-item').forEach(el => {
        el.addEventListener('click', () => openPrivateChat(+el.dataset.userId));
    });
}

function renderChats(chats) {
    chatsList.innerHTML = chats.map(c => {
        let avHtml;
        if (c.avatar_url) {
            avHtml = `<div class="avatar has-photo"><img src="${escapeHtml(c.avatar_url)}" alt=""></div>`;
        } else {
            avHtml = `<div class="avatar">${(c.name || '?')[0].toUpperCase()}</div>`;
        }
        return `
        <div class="list-item ${currentChatId === c.id ? 'active' : ''}" data-chat-id="${c.id}">
            ${avHtml}
            <div class="item-info">
                <div class="item-name">${escapeHtml(c.name || 'Чат')}${c.is_favorites ? '' : (c.is_channel ? ' 📢' : (c.is_group ? ' 👥' : ''))}</div>
                <div class="item-preview">${escapeHtml(c.last_message || 'Нет сообщений')}</div>
            </div>
        </div>`;
    }).join('');
    
    chatsList.querySelectorAll('.list-item').forEach(el => {
        el.addEventListener('click', () => openChat(+el.dataset.chatId, el.querySelector('.item-name').textContent.replace(' 👥', '').replace(' 📢', '')));
    });
}

userSearch.addEventListener('input', () => renderUsers(usersCache));

async function openPrivateChat(targetUserId) {
    try {
        const res = await api(`/chats/private/${targetUserId}`, { method: 'POST' });
        const data = await res.json();
        const user = usersCache.find(u => u.id === targetUserId);
        openChat(data.chat_id, user ? user.username : 'Чат');
        loadChats();
    } catch (e) {}
}

var currentChatInfo = null;

async function openChat(chatId, title) {
    currentChatId = chatId;
    noChat.classList.add('hidden');
    chatView.classList.remove('hidden');
    chatTitle.textContent = title;
    
    if (window.innerWidth <= 700) {
        document.querySelector('.sidebar')?.classList.add('hidden-mobile');
    }
    
    renderChats(chatsCache);
    
    // Загружаем инфо о чате (для кнопки настроек группы)
    try {
        const infoRes = await api(`/chats/${chatId}/info`);
        currentChatInfo = await infoRes.json();
        const infoBtn = document.getElementById('chat-info-btn');
        if (currentChatInfo.is_group || currentChatInfo.is_channel) {
            infoBtn.classList.remove('hidden');
        } else {
            infoBtn.classList.add('hidden');
        }
        
        // В канале подписчики не пишут
        updateChannelComposer();
    } catch (e) {
        currentChatInfo = null;
        document.getElementById('chat-info-btn').classList.add('hidden');
    }
    
    try {
        const res = await api(`/chats/${chatId}/messages`);
        const messages = await res.json();
        messagesEl.innerHTML = '';
        messages.forEach(m => appendMessage(m));
        scrollToBottom();
        
        if (messages.length) {
            const lastId = messages[messages.length - 1].id;
            markChatRead(chatId, lastId);
        }
    } catch (e) {}
    
    messageInput.focus();
}

async function markChatRead(chatId, lastMessageId) {
    if (!chatId || !lastMessageId) return;
    try {
        const fd = new FormData();
        fd.append('last_message_id', String(lastMessageId));
        await fetch(`/chats/${chatId}/read`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
    } catch (e) {}
}

// ==================== GROUP MODAL ====================
function openGroupModal() {
    const list = document.getElementById('group-users-list');
    if (!list) {
        alert('Ошибка интерфейса группы');
        return;
    }
    list.innerHTML = (usersCache || []).map(u => `
        <label class="group-user-item">
            <input type="checkbox" value="${u.id}">
            <div class="avatar" style="width:32px;height:32px;font-size:13px">${u.username[0].toUpperCase()}</div>
            <span>${escapeHtml(u.username)}</span>
        </label>
    `).join('') || '<p style="color:#71717a;padding:8px">Нет пользователей</p>';
    
    document.getElementById('group-name').value = '';
    groupModal.classList.remove('hidden');
}

document.getElementById('group-cancel')?.addEventListener('click', () => {
    document.getElementById('group-modal')?.classList.add('hidden');
});

document.getElementById('group-create')?.addEventListener('click', async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) {
        alert('Введите название группы');
        return;
    }
    
    const checked = [...document.querySelectorAll('#group-users-list input:checked')]
        .map(el => parseInt(el.value));
    
    if (checked.length === 0) {
        alert('Выберите хотя бы одного участника');
        return;
    }
    
    try {
        const res = await api('/chats/group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, user_ids: checked })
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка создания группы');
            return;
        }
        
        const data = await res.json();
        groupModal.classList.add('hidden');
        loadChats();
        openChat(data.chat_id, data.name);
    } catch (e) {
        alert('Ошибка создания группы');
    }
});

function appendMessage(m) {
    const isMine = String(m.sender_id) === String(userId);
    const div = document.createElement('div');
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;
    
    let html = '';
    if (!isMine) {
        html += `<div class="message-sender">${escapeHtml(m.sender_name)}</div>`;
    }
    
    if (m.message_type === 'voice' && m.media_url) {
        const duration = m.content || '0';
        html += `
            <div class="voice-message" data-url="${escapeHtml(m.media_url)}" data-duration="${escapeHtml(duration)}">
                <button class="voice-play-btn" type="button">▶</button>
                <div class="voice-wave">${generateWaveBars()}</div>
                <span class="voice-duration">${formatDuration(duration)}</span>
            </div>
        `;
        if (isVip) {
            html += `<button type="button" class="voice-transcribe-btn" data-msg-id="${m.id}">✨ Расшифровать</button>`;
            if (m.transcript) {
                html += `<div class="voice-transcript">${escapeHtml(m.transcript)}</div>`;
            }
        }
    } else if (m.message_type === 'image' && m.media_url) {
        html += `<img class="message-image" src="${escapeHtml(m.media_url)}" alt="Фото" loading="lazy">`;
    } else if (m.message_type === 'video_note' && m.media_url) {
        html += `<video class="message-video-note" src="${escapeHtml(m.media_url)}" playsinline muted></video>`;
    } else if (m.message_type === 'sticker') {
        div.classList.add('sticker-msg');
        const anim = (typeof stickerAnimClass === 'function') ? stickerAnimClass(m.content) : '';
        html += `<div class="message-sticker"><span class="sticker-anim ${anim}">${escapeHtml(m.content)}</span></div>`;
    } else {
        html += `<div>${escapeHtml(m.content)}</div>`;
    }
    
    if (m.is_pinned) div.classList.add('pinned-msg');
    html += `<div class="msg-actions">
        <button type="button" class="msg-pin" data-id="${m.id}">📌</button>
        <button type="button" class="msg-del" data-id="${m.id}">🗑</button>
    </div>`;
    
    let statusHtml = '';
    if (String(m.sender_id) === String(userId) && m.read_status && m.read_status !== 'none') {
        if (m.read_status === 'read') {
            statusHtml = '<span class="message-status read" title="Прочитано">✓✓</span>';
        } else if (m.read_status === 'delivered') {
            statusHtml = '<span class="message-status delivered" title="Доставлено">✓✓</span>';
        } else {
            statusHtml = '<span class="message-status sent" title="Отправлено">✓</span>';
        }
    }
    html += `<div class="message-time">${formatTime(m.created_at)}${statusHtml}</div>`;
    
    div.innerHTML = html;
    div.dataset.msgId = m.id;
    messagesEl.appendChild(div);
    
    if (m.message_type === 'voice' && isVip) {
        const tb = div.querySelector('.voice-transcribe-btn');
        if (tb) {
            tb.addEventListener('click', async () => {
                tb.disabled = true;
                tb.textContent = 'Расшифровка…';
                try {
                    const res = await api(`/messages/${m.id}/transcribe`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) {
                        alert(data.detail || 'Ошибка');
                        tb.disabled = false;
                        tb.textContent = '✨ Расшифровать';
                        return;
                    }
                    let tr = div.querySelector('.voice-transcript');
                    if (!tr) {
                        tr = document.createElement('div');
                        tr.className = 'voice-transcript';
                        tb.after(tr);
                    }
                    tr.textContent = data.transcript;
                    tb.textContent = '✓ Расшифровано';
                } catch (e) {
                    tb.disabled = false;
                    tb.textContent = '✨ Расшифровать';
                }
            });
        }
    }
    
    if (m.message_type === 'video_note') {
        const v = div.querySelector('.message-video-note');
        if (v) {
            v.addEventListener('ended', () => {
                v.pause();
                v.currentTime = 0;
            });
            v.addEventListener('click', () => {
                if (v.paused) {
                    v.muted = false;
                    v.play();
                } else {
                    v.pause();
                }
            });
        }
    }
    
    div.querySelector('.msg-pin')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api(`/messages/${m.id}/pin`, { method: 'POST' });
    });
    div.querySelector('.msg-del')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Удалить сообщение?')) return;
        const res = await api(`/messages/${m.id}/delete`, { method: 'POST' });
        if (res.ok) div.remove();
    });
    
    if (m.message_type === 'image') {
        const img = div.querySelector('.message-image');
        if (img) {
            img.addEventListener('click', () => openLightbox(m.media_url));
        }
    }
    
    // Привязываем плеер
    if (m.message_type === 'voice') {
        const playBtn = div.querySelector('.voice-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => toggleVoicePlay(playBtn, m.media_url));
        }
    }
}

function generateWaveBars() {
    let bars = '';
    for (let i = 0; i < 24; i++) {
        const h = 6 + Math.floor(Math.random() * 18);
        bars += `<span style="height:${h}px"></span>`;
    }
    return bars;
}

function formatDuration(sec) {
    const s = Math.floor(parseFloat(sec) || 0);
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}:${rs.toString().padStart(2, '0')}`;
}

// ===== Voice player =====
let currentAudio = null;
let currentPlayBtn = null;

function toggleVoicePlay(btn, url) {
    // Останавливаем предыдущий
    if (currentAudio && currentPlayBtn === btn) {
        currentAudio.pause();
        currentAudio = null;
        btn.textContent = '▶';
        currentPlayBtn = null;
        return;
    }
    
    if (currentAudio) {
        currentAudio.pause();
        if (currentPlayBtn) currentPlayBtn.textContent = '▶';
    }
    
    currentAudio = new Audio(url);
    currentPlayBtn = btn;
    btn.textContent = '⏸';
    
    currentAudio.play();
    
    currentAudio.onended = () => {
        btn.textContent = '▶';
        currentAudio = null;
        currentPlayBtn = null;
    };
    
    currentAudio.onerror = () => {
        btn.textContent = '▶';
        currentAudio = null;
        currentPlayBtn = null;
        alert('Не удалось воспроизвести голосовое сообщение');
    };
}

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content || !currentChatId || !token) return;

    const chatId = currentChatId;
    messageInput.value = '';

    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('content', content);

    try {
        const res = await fetch('/messages', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            messageInput.value = content;
            alert(data.detail || 'Не удалось отправить сообщение');
            return;
        }

        // Если WebSocket временно недоступен, REST уже сохранил сообщение.
        // Если WebSocket работает, сервер доставит его всем участникам, включая отправителя.
        if (data.chat_id === undefined) data.chat_id = chatId;
        if (data.chat_id === currentChatId) {
            const exists = messagesEl.querySelector(`[data-msg-id="${data.id}"]`);
            if (!exists) {
                appendMessage(data);
                scrollToBottom();
            }
        }
        loadChats();
    } catch (err) {
        messageInput.value = content;
        alert('Ошибка соединения с сервером');
    }
});

// ==================== WEBSOCKET ====================
function connectWebSocket() {
    if (!token || wsConnecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
    wsIntentionalClose = false;
    wsConnecting = true;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const safeToken = encodeURIComponent(token);
    ws = new WebSocket(`${protocol}//${location.host}/ws/${safeToken}`);
    
    ws.onopen = () => {
        wsConnecting = false;
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'new_message') {
            loadChats();
            if (typeof notifyNewMessage === 'function') notifyNewMessage(data);
            
            if (data.chat_id === currentChatId) {
                if (!data.read_status && String(data.sender_id) === String(userId)) {
                    data.read_status = 'delivered';
                }
                const exists = messagesEl.querySelector(`[data-msg-id="${data.id}"]`);
                if (!exists) {
                    appendMessage(data);
                    scrollToBottom();
                }
                if (String(data.sender_id) !== String(userId)) {
                    markChatRead(data.chat_id, data.id);
                }
            }
        }
        
        if (data.type === 'messages_read') {
            if (data.chat_id === currentChatId) {
                // Обновляем галочки у своих сообщений
                messagesEl.querySelectorAll('.message.mine').forEach(el => {
                    const mid = parseInt(el.dataset.msgId || '0');
                    if (mid && mid <= data.last_message_id) {
                        const st = el.querySelector('.message-status');
                        if (st) {
                            st.className = 'message-status read';
                            st.textContent = '✓✓';
                            st.title = 'Прочитано';
                        }
                    }
                });
            }
        }
        
        if (data.type === 'message_deleted' && data.chat_id === currentChatId) {
            document.querySelector(`[data-msg-id="${data.message_id}"]`)?.remove();
        }
        if (data.type === 'message_pinned' && data.chat_id === currentChatId) {
            const el = document.querySelector(`[data-msg-id="${data.message_id}"]`);
            if (el) el.classList.toggle('pinned-msg', !!data.is_pinned);
        }
        
        if (data.type === 'user_status') {
            const uid = Number(data.user_id);
            const user = usersCache.find(u => Number(u.id) === uid);
            if (user) {
                user.is_online = !!data.is_online;
                renderUsers(usersCache);
            } else {
                // Обновим список, если пользователя ещё не было в кэше
                loadUsers();
            }
        }
    };
    
    ws.onclose = () => {
        wsConnecting = false;
        if (wsIntentionalClose || !token) return;
        console.log('WebSocket closed, reconnecting in 3s...');
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null;
            if (token && !wsIntentionalClose) connectWebSocket();
        }, 3000);
    };
    
    ws.onerror = (event) => {
        wsConnecting = false;
        console.warn('WebSocket error', event);
    };
}

// ==================== HELPERS ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ==================== VOICE RECORDING ====================
const voiceBtn = document.getElementById('voice-btn');
const recordingIndicator = document.getElementById('recording-indicator');
const recTimerEl = document.getElementById('rec-timer');
const cancelRecBtn = document.getElementById('cancel-rec-btn');

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recStartTime = 0;
let recTimerInterval = null;
let recCancelled = false;

async function startRecording() {
    if (!currentChatId) {
        alert('Сначала выберите чат');
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Предпочитаем webm/opus, fallback на другие
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'audio/ogg;codecs=opus';
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    mimeType = '';
                }
            }
        }
        
        mediaRecorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        
        audioChunks = [];
        recCancelled = false;
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            
            const mime = mediaRecorder?.mimeType || 'audio/webm';
            
            if (recCancelled || audioChunks.length === 0) {
                resetRecordingUI();
                return;
            }
            
            const durationSec = ((Date.now() - recStartTime) / 1000).toFixed(1);
            const blob = new Blob(audioChunks, { type: mime });
            
            if (parseFloat(durationSec) < 0.4 || blob.size < 100) {
                resetRecordingUI();
                alert('Слишком короткое сообщение. Нажмите 🎤, поговорите и нажмите ещё раз или ➤');
                return;
            }
            
            await uploadVoice(blob, durationSec);
            resetRecordingUI();
        };
        
        // timeslice помогает собирать чанки на всех браузерах
        try {
            mediaRecorder.start(250);
        } catch (e) {
            mediaRecorder.start();
        }
        isRecording = true;
        recStartTime = Date.now();
        
        // UI
        voiceBtn.classList.add('recording');
        messageForm.classList.add('recording-mode');
        recordingIndicator.classList.remove('hidden');
        
        recTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            recTimerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }, 200);
        
    } catch (err) {
        console.error(err);
        alert('Не удалось получить доступ к микрофону. Разрешите доступ в браузере.');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        isRecording = false;
        mediaRecorder.stop();
    }
}

function cancelRecording() {
    recCancelled = true;
    if (mediaRecorder && isRecording) {
        isRecording = false;
        mediaRecorder.stop();
    } else {
        resetRecordingUI();
    }
}

function resetRecordingUI() {
    voiceBtn.classList.remove('recording');
    messageForm.classList.remove('recording-mode');
    recordingIndicator.classList.add('hidden');
    recTimerEl.textContent = '0:00';
    if (recTimerInterval) {
        clearInterval(recTimerInterval);
        recTimerInterval = null;
    }
    mediaRecorder = null;
    audioChunks = [];
    isRecording = false;
}

async function uploadVoice(blob, duration) {
    if (!currentChatId) {
        alert('Сначала выберите чат');
        return;
    }
    
    // Правильное имя файла по типу blob
    let filename = 'voice.webm';
    const type = (blob.type || '').toLowerCase();
    if (type.includes('ogg')) filename = 'voice.ogg';
    else if (type.includes('mp4') || type.includes('m4a')) filename = 'voice.m4a';
    else if (type.includes('mpeg') || type.includes('mp3')) filename = 'voice.mp3';
    else if (type.includes('wav')) filename = 'voice.wav';
    
    const formData = new FormData();
    formData.append('chat_id', String(currentChatId));
    formData.append('duration', String(duration));
    formData.append('file', blob, filename);
    
    try {
        const res = await fetch('/upload/voice', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const detail = typeof err.detail === 'string' ? err.detail : (err.detail ? JSON.stringify(err.detail) : 'Ошибка отправки голосового');
            alert(detail);
            return;
        }
        
        loadChats();
        
    } catch (e) {
        console.error(e);
        alert('Ошибка отправки голосового сообщения. Проверьте микрофон и соединение.');
    }
}

// Голосовые: клик = начать / клик снова = отправить (надёжнее, чем зажать)
voiceBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

document.getElementById('send-rec-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopRecording();
});

cancelRecBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelRecording();
});

// ==================== STICKERS ====================
const STICKERS = [
    '😀','😂','🤣','😊','😍','🥰','😘','😜','🤔','😎',
    '😢','😭','😡','🤯','😴','🤗','👍','👎','👏','🙏',
    '🔥','💯','⭐','✨','🎉','❤️','💔','🌹','🎂','🍕',
    '🐱','🐶','🦊','🐻','🐼','🐨','🦁','🐸','🦄','🐝',
    '👻','🤖','👽','🎃','💀','😈','🤙','💪','👀','🌟',
    '🌈','☀️','🌙','⚡','❄️','🌊','🎵','🎮','🚀','🏆'
];

const VIP_STICKERS = [
    '👑','💎','🥂','🍾','🤑','🎩','💍','🏎️','💰','🏛️',
    '🔮','🪄','🧿','💠','🥇','🏅','🟣','🌌','🦄','🐉'
];

// Анимированные стикеры (CSS-анимации)
const ANIMATED_STICKERS = [
    { e: '🔥', anim: 'anim-pulse' },
    { e: '❤️', anim: 'anim-heartbeat' },
    { e: '😂', anim: 'anim-bounce' },
    { e: '✨', anim: 'anim-sparkle' },
    { e: '🎉', anim: 'anim-wiggle' },
    { e: '🚀', anim: 'anim-fly' },
    { e: '⚡', anim: 'anim-flash' },
    { e: '🌊', anim: 'anim-wave' },
    { e: '👻', anim: 'anim-float' },
    { e: '🦄', anim: 'anim-bounce' },
    { e: '🌟', anim: 'anim-sparkle' },
    { e: '💯', anim: 'anim-pulse' },
    { e: '👏', anim: 'anim-wiggle' },
    { e: '🤯', anim: 'anim-shake' },
    { e: '🥳', anim: 'anim-bounce' },
    { e: '💫', anim: 'anim-spin' },
    { e: '🎈', anim: 'anim-float' },
    { e: '🌈', anim: 'anim-wave' },
    { e: '👑', anim: 'anim-sparkle' },
    { e: '💎', anim: 'anim-pulse' }
];

const ANIM_MAP = Object.fromEntries(ANIMATED_STICKERS.map(s => [s.e, s.anim]));

function allStickersForStories() {
    const set = new Set([...STICKERS, ...ANIMATED_STICKERS.map(s => s.e)]);
    if (isVip) VIP_STICKERS.forEach(s => set.add(s));
    return [...set];
}

function stickerAnimClass(emoji) {
    return ANIM_MAP[emoji] || '';
}

function renderAnimatedStickerHTML(emoji, extraClass = '') {
    const anim = stickerAnimClass(emoji);
    return `<span class="sticker-anim ${anim} ${extraClass}">${escapeHtml(emoji)}</span>`;
}

var stickerPanel = document.getElementById('sticker-panel');
const stickerBtn = document.getElementById('sticker-btn');

function renderStickerPanel() {
    if (!stickerPanel) return;
    let html = `<div class="sticker-vip-label">✨ Анимированные</div>`;
    html += ANIMATED_STICKERS.map(s =>
        `<button type="button" class="sticker-item sticker-animated" data-sticker="${s.e}" data-anim="${s.anim}"><span class="sticker-anim ${s.anim}">${s.e}</span></button>`
    ).join('');
    
    html += `<div class="sticker-vip-label">Обычные</div>`;
    html += STICKERS.map(s =>
        `<button type="button" class="sticker-item" data-sticker="${s}">${s}</button>`
    ).join('');
    
    if (isVip) {
        html += `<div class="sticker-vip-label">👑 Эксклюзив Cipherion VIP</div>`;
        html += VIP_STICKERS.map(s =>
            `<button type="button" class="sticker-item vip-only" data-sticker="${s}"><span class="sticker-anim ${stickerAnimClass(s) || 'anim-pulse'}">${s}</span></button>`
        ).join('');
    }
    
    stickerPanel.innerHTML = html;
    
    stickerPanel.querySelectorAll('.sticker-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const sticker = btn.dataset.sticker;
            if (VIP_STICKERS.includes(sticker) && !isVip) {
                alert('Этот стикер только для Cipherion VIP');
                return;
            }
            sendSticker(sticker);
            stickerPanel.classList.add('hidden');
        });
    });
}

function renderStoryStickerPicker() {
    const box = document.getElementById('story-compose-stickers');
    if (!box) return;
    const list = allStickersForStories();
    box.innerHTML = `<div class="story-sticker-hint">Любой стикер на историю (включая анимированные)</div>` +
        list.map(s => {
            const anim = stickerAnimClass(s);
            return `<button type="button" data-s="${s}" class="${anim ? 'has-anim' : ''}"><span class="sticker-anim ${anim}">${s}</span></button>`;
        }).join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.getElementById('story-compose-sticker').value = b.dataset.s;
    }));
}

renderStickerPanel();
renderStoryStickerPicker();

stickerBtn?.addEventListener('click', () => {
    if (!currentChatId) {
        alert('Сначала выберите чат');
        return;
    }
    if (currentChatInfo?.is_channel && !currentChatInfo?.is_admin) {
        alert('В канале писать может только администратор');
        return;
    }
    stickerPanel.classList.toggle('hidden');
});

// ==================== NOTIFICATIONS ====================
function ensureNotifPermission() {
    if (!('Notification' in window)) return Promise.resolve(false);
    if (Notification.permission === 'granted') return Promise.resolve(true);
    if (Notification.permission === 'denied') return Promise.resolve(false);
    return Notification.requestPermission().then(p => p === 'granted');
}

function showInAppToast(title, body) {
    let host = document.getElementById('toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toast-host';
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'cipherion-toast';
    el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body || '')}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

function notifyNewMessage(data) {
    if (String(data.sender_id) === String(userId)) return;
    const s = window.__cipherionSettings || {};
    if (s.dnd) return;
    
    let body = data.content || '';
    if (data.message_type === 'voice') body = '🎤 Голосовое';
    else if (data.message_type === 'image') body = '📷 Фото';
    else if (data.message_type === 'video_note') body = '📷 Кружок';
    else if (data.message_type === 'sticker') body = data.content || 'Стикер';
    if (!s.notifPreview && s.notifPreview !== undefined) body = 'Новое сообщение';
    
    const title = data.sender_name || 'Cipherion';
    showInAppToast(title, body);
    
    if (s.browserNotif === false) return;
    if (document.hidden || data.chat_id !== currentChatId) {
        ensureNotifPermission().then(ok => {
            if (!ok) return;
            try {
                const n = new Notification(title, {
                    body: body.slice(0, 120),
                    tag: 'cipherion-' + (data.chat_id || 'msg'),
                    silent: s.soundRecv === false
                });
                n.onclick = () => { window.focus(); n.close(); };
            } catch (e) {}
        });
    }
}

// request permission once after login
setTimeout(() => { if (token) ensureNotifPermission(); }, 2000);

// ==================== VIDEO NOTE (кружочки) ====================
let videoNoteRecorder = null;
let videoNoteStream = null;
let videoNoteChunks = [];
let videoNoteStart = 0;
let videoNoteTimerIv = null;

document.getElementById('video-note-btn')?.addEventListener('click', async () => {
    if (!currentChatId) {
        alert('Сначала выберите чат');
        return;
    }
    if (currentChatInfo?.is_channel && !currentChatInfo?.is_admin) {
        alert('В канале писать может только администратор');
        return;
    }
    try {
        videoNoteStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 480, height: 480 },
            audio: true
        });
        const preview = document.getElementById('video-note-preview');
        preview.srcObject = videoNoteStream;
        document.getElementById('video-note-overlay').classList.remove('hidden');
        
        videoNoteChunks = [];
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';
        videoNoteRecorder = new MediaRecorder(videoNoteStream, { mimeType: mime });
        videoNoteRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) videoNoteChunks.push(e.data);
        };
        videoNoteRecorder.onstop = async () => {
            const blob = new Blob(videoNoteChunks, { type: 'video/webm' });
            const duration = Math.max(1, Math.round((Date.now() - videoNoteStart) / 1000));
            stopVideoNotePreview();
            await uploadVideoNote(blob, duration);
        };
        videoNoteStart = Date.now();
        videoNoteRecorder.start();
        document.getElementById('video-note-timer').textContent = '0:00';
        videoNoteTimerIv = setInterval(() => {
            const sec = Math.floor((Date.now() - videoNoteStart) / 1000);
            if (sec >= 60) {
                document.getElementById('video-note-stop')?.click();
                return;
            }
            document.getElementById('video-note-timer').textContent =
                `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        }, 250);
    } catch (e) {
        alert('Нет доступа к камере/микрофону');
    }
});

function stopVideoNotePreview() {
    if (videoNoteTimerIv) clearInterval(videoNoteTimerIv);
    videoNoteTimerIv = null;
    if (videoNoteStream) {
        videoNoteStream.getTracks().forEach(t => t.stop());
        videoNoteStream = null;
    }
    const preview = document.getElementById('video-note-preview');
    if (preview) preview.srcObject = null;
    document.getElementById('video-note-overlay')?.classList.add('hidden');
}

document.getElementById('video-note-cancel')?.addEventListener('click', () => {
    try { if (videoNoteRecorder && videoNoteRecorder.state !== 'inactive') videoNoteRecorder.stop(); } catch (e) {}
    videoNoteChunks = [];
    stopVideoNotePreview();
});

document.getElementById('video-note-stop')?.addEventListener('click', () => {
    if (videoNoteRecorder && videoNoteRecorder.state !== 'inactive') {
        videoNoteRecorder.stop();
    } else {
        stopVideoNotePreview();
    }
});

async function uploadVideoNote(blob, duration) {
    const fd = new FormData();
    fd.append('chat_id', String(currentChatId));
    fd.append('duration', String(duration));
    fd.append('file', blob, 'note.webm');
    try {
        const res = await fetch('/upload/video_note', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Не удалось отправить видеокружок');
            return;
        }
        // Не дублируем: сообщение придёт по WebSocket / один ответ сервера
        const data = await res.json();
        if (data.chat_id === currentChatId) {
            const exists = messagesEl.querySelector(`[data-msg-id="${data.id}"]`);
            if (!exists) {
                appendMessage(data);
                scrollToBottom();
            }
        }
        loadChats();
    } catch (e) {
        alert('Ошибка отправки видеокружка');
    }
}

function sendSticker(sticker) {
    if (!currentChatId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type: 'sticker',
        chat_id: currentChatId,
        content: sticker
    }));
}

// ==================== IMAGE ATTACH ====================
const attachBtn = document.getElementById('attach-btn');
const imageInput = document.getElementById('image-input');

attachBtn.addEventListener('click', () => {
    if (!currentChatId) {
        alert('Сначала выберите чат');
        return;
    }
    imageInput.click();
});

imageInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentChatId) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Выберите изображение');
        return;
    }
    
    if (file.size > 8 * 1024 * 1024) {
        alert('Файл слишком большой (макс 8 МБ)');
        return;
    }
    
    const formData = new FormData();
    formData.append('chat_id', currentChatId);
    formData.append('file', file);
    
    try {
        const res = await fetch('/upload/image', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка отправки фото');
        }
        // Сообщение придёт через WebSocket
        loadChats();
    } catch (err) {
        alert('Ошибка отправки фото');
    }
    
    e.target.value = '';
});

// Lightbox
function openLightbox(url) {
    let lb = document.getElementById('lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'lightbox';
        lb.className = 'lightbox';
        lb.innerHTML = '<img alt="">';
        lb.addEventListener('click', () => lb.classList.add('hidden'));
        document.body.appendChild(lb);
    }
    lb.querySelector('img').src = url;
    lb.classList.remove('hidden');
}

// ==================== GROUP SETTINGS ====================
const groupSettingsModal = document.getElementById('group-settings-modal');
const chatInfoBtn = document.getElementById('chat-info-btn');

chatInfoBtn.addEventListener('click', () => {
    if (currentChatInfo && (currentChatInfo.is_group || currentChatInfo.is_channel)) {
        openGroupSettings();
    }
});

function updateChannelComposer() {
    let notice = document.getElementById('channel-readonly');
    const form = document.getElementById('message-form');
    const stickerPanel = document.getElementById('sticker-panel');
    
    if (currentChatInfo && currentChatInfo.is_channel && !currentChatInfo.is_admin) {
        form.classList.add('hidden');
        if (stickerPanel) stickerPanel.classList.add('hidden');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'channel-readonly';
            notice.className = 'channel-readonly';
            notice.textContent = 'Только администратор может публиковать в канале';
            form.parentNode.insertBefore(notice, form);
        }
        notice.classList.remove('hidden');
    } else {
        form.classList.remove('hidden');
        if (notice) notice.classList.add('hidden');
    }
}

async function openGroupSettings() {
    if (!currentChatId) return;
    
    try {
        const res = await api(`/chats/${currentChatId}/info`);
        currentChatInfo = await res.json();
    } catch (e) {
        alert('Не удалось загрузить информацию');
        return;
    }
    
    const info = currentChatInfo;
    document.getElementById('group-settings-name').value = info.name || '';
    const descEl = document.getElementById('group-settings-desc');
    if (descEl) descEl.value = info.description || '';
    const typeEl = document.getElementById('group-settings-type');
    if (typeEl) typeEl.value = info.is_public ? 'public' : 'private';
    const reacEl = document.getElementById('group-settings-reactions');
    if (reacEl) reacEl.value = info.allowed_reactions || '👍,❤️,😂,😮,😢,🔥';
    const adminsList = document.getElementById('group-admins-list');
    if (adminsList) {
        adminsList.innerHTML = (info.members || []).map(m => {
            const checked = m.is_admin ? 'checked' : '';
            return `<label class="group-user-item"><input type="checkbox" class="admin-check" value="${m.id}" ${checked}><span>${m.username}</span></label>`;
        }).join('');
    }
    
    const modalTitle = groupSettingsModal.querySelector('h3');
    if (modalTitle) {
        modalTitle.textContent = info.is_channel ? 'Настройки канала' : 'Настройки группы';
    }
    
    // Фото группы / канала
    const preview = document.getElementById('group-photo-preview');
    const letterEl = document.getElementById('group-letter');
    const imgEl = document.getElementById('group-img');
    
    if (info.avatar_url) {
        imgEl.src = info.avatar_url;
        imgEl.classList.remove('hidden');
        preview.classList.add('has-photo');
        letterEl.style.display = 'none';
    } else {
        imgEl.classList.add('hidden');
        preview.classList.remove('has-photo');
        letterEl.style.display = '';
        letterEl.textContent = (info.name || '?')[0].toUpperCase();
    }
    
    // Участники
    const membersList = document.getElementById('group-members-list');
    membersList.innerHTML = (info.members || []).map(m => {
        const av = m.avatar_url
            ? `<div class="avatar has-photo" style="width:32px;height:32px"><img src="${escapeHtml(m.avatar_url)}" alt=""></div>`
            : `<div class="avatar" style="width:32px;height:32px;font-size:13px">${m.username[0].toUpperCase()}</div>`;
        const badge = info.created_by === m.id ? ' <span style="color:#a78bfa;font-size:11px">админ</span>' : '';
        return `<div class="group-user-item">${av}<span>${escapeHtml(m.username)}${badge}</span></div>`;
    }).join('');
    
    // Добавить участников (только админ)
    const addList = document.getElementById('group-add-users-list');
    const nameInput = document.getElementById('group-settings-name');
    const avatarInput = document.getElementById('group-avatar-input');
    const saveBtn = document.getElementById('group-settings-save');
    
    if (info.is_admin) {
        nameInput.readOnly = false;
        avatarInput.disabled = false;
        saveBtn.style.display = '';
        
        const memberIds = new Set((info.members || []).map(m => m.id));
        const available = usersCache.filter(u => !memberIds.has(u.id));
        
        addList.innerHTML = available.length
            ? available.map(u => `
                <label class="group-user-item">
                    <input type="checkbox" value="${u.id}">
                    <div class="avatar" style="width:32px;height:32px;font-size:13px">${u.username[0].toUpperCase()}</div>
                    <span>${escapeHtml(u.username)}</span>
                </label>
            `).join('')
            : '<p style="color:#71717a;padding:8px;font-size:13px">Все пользователи уже в группе</p>';
    } else {
        nameInput.readOnly = true;
        avatarInput.disabled = true;
        saveBtn.style.display = 'none';
        addList.innerHTML = '<p style="color:#71717a;padding:8px;font-size:13px">Только создатель может добавлять участников</p>';
    }
    
    groupSettingsModal.classList.remove('hidden');
}

document.getElementById('group-settings-cancel')?.addEventListener('click', () => {
    groupSettingsModal.classList.add('hidden');
});

document.getElementById('group-avatar-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentChatId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch(`/chats/${currentChatId}/avatar`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка загрузки');
            return;
        }
        
        const data = await res.json();
        const preview = document.getElementById('group-photo-preview');
        const imgEl = document.getElementById('group-img');
        const letterEl = document.getElementById('group-letter');
        
        imgEl.src = data.avatar_url;
        imgEl.classList.remove('hidden');
        preview.classList.add('has-photo');
        letterEl.style.display = 'none';
        
        loadChats();
    } catch (err) {
        alert('Ошибка загрузки фото группы');
    }
    
    e.target.value = '';
});

document.getElementById('group-settings-save')?.addEventListener('click', async () => {
    if (!currentChatId || !currentChatInfo?.is_admin) return;
    
    const name = document.getElementById('group-settings-name').value.trim();
    const checked = [...document.querySelectorAll('#group-add-users-list input:checked')]
        .map(el => parseInt(el.value));
    
    try {
        const res = await api(`/chats/${currentChatId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: document.getElementById('group-settings-desc')?.value || '', is_public: document.getElementById('group-settings-type')?.value === 'public', allowed_reactions: document.getElementById('group-settings-reactions')?.value || '', admin_user_ids: [...document.querySelectorAll('#group-admins-list .admin-check:checked')].map(el => +el.value), add_user_ids: checked })
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Ошибка сохранения');
            return;
        }
        
        const data = await res.json();
        chatTitle.textContent = data.name;
        groupSettingsModal.classList.add('hidden');
        loadChats();
        
        // Обновляем инфо
        const infoRes = await api(`/chats/${currentChatId}/info`);
        currentChatInfo = await infoRes.json();
        
    } catch (e) {
        alert('Ошибка сохранения');
    }
});

// ==================== INIT ====================
if (token && userId && username) {
    showApp();
} else {
    authScreen.classList.remove('hidden');
}


document.getElementById('chat-title')?.addEventListener('click', () => {
    if (currentChatInfo && (currentChatInfo.is_group || currentChatInfo.is_channel)) {
        openGroupSettings();
    }
});

document.getElementById('group-delete-btn')?.addEventListener('click', async () => {
    if (!currentChatId || !confirm('Удалить группу безвозвратно?')) return;
    const res = await api(`/chats/${currentChatId}`, { method: 'DELETE' });
    if (res.ok) {
        document.getElementById('group-settings-modal').classList.add('hidden');
        currentChatId = null;
        loadChats();
        document.getElementById('chat-view')?.classList.add('hidden');
        document.getElementById('no-chat')?.classList.remove('hidden');
    }
});

document.getElementById('group-start-call')?.addEventListener('click', () => {
    alert('Видеочат: откройте ссылку для участников (демо).\nВ полной версии здесь WebRTC-комната группы.');
});


// Закрытие модалок по затемнению + прокрутка
function bindModalBackdrop(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
}
bindModalBackdrop('settings-modal');
bindModalBackdrop('group-settings-modal');
bindModalBackdrop('app-settings-modal');
bindModalBackdrop('story-compose-modal');
bindModalBackdrop('channel-modal');
bindModalBackdrop('group-modal');
bindModalBackdrop('vip-modal');


// Превью позиции текста в редакторе истории
function updateStoryComposePreview() {
    const preview = document.getElementById('story-compose-preview-text');
    if (!preview) return;
    const text = document.getElementById('story-compose-text')?.value || 'Текст на фото';
    const x = document.getElementById('story-text-x')?.value || 50;
    const y = document.getElementById('story-text-y')?.value || 70;
    const font = document.querySelector('.font-btn.active')?.dataset.font || 'default';
    preview.textContent = text || 'Текст на фото';
    preview.style.left = x + '%';
    preview.style.top = y + '%';
    preview.className = 'story-compose-preview-text story-font-' + font;
}
['story-compose-text','story-text-x','story-text-y'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateStoryComposePreview);
});
document.querySelectorAll('.font-btn').forEach(b => b.addEventListener('click', () => setTimeout(updateStoryComposePreview, 0)));

// Mobile Telegram-style bottom navigation
(function(){
  function setupMobileNav(){
    const nav=document.getElementById('mobile-bottom-nav');
    if(!nav) return;
    nav.querySelectorAll('.mobile-nav-item').forEach(btn=>btn.addEventListener('click',()=>{
      nav.querySelectorAll('.mobile-nav-item').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      const view=btn.dataset.mobileView;
      const sidebar=document.querySelector('.sidebar'), chat=document.querySelector('.chat-area');
      if(view==='chats'){
        sidebar?.classList.remove('mobile-contacts-view');
        if(chat) chat.classList.remove('chat-open');
      } else if(view==='contacts'){
        sidebar?.classList.add('mobile-contacts-view');
        if(chat) chat.classList.remove('chat-open');
        document.getElementById('users-list')?.scrollIntoView({behavior:'smooth',block:'start'});
      } else if(view==='settings'){
        document.getElementById('menu-app-settings')?.click();
      } else if(view==='calls'){
        // Calls UI can be added without breaking the existing chat logic.
        const title=document.querySelector('.section-title');
        if(title) title.textContent='Звонки';
      }
    }));
  }
  document.addEventListener('DOMContentLoaded',setupMobileNav);
  window.addEventListener('load',setupMobileNav);
})();
