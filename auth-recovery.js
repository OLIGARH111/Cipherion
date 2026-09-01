/* Simple auth: username + password only. Overrides older handlers. */
(() => {
  const byId = (id) => document.getElementById(id);
  const error = (message) => {
    const box = byId('auth-error');
    if (box) box.textContent = message || '';
  };
  const detail = async (response, fallback) => {
    let body = {};
    try {
      const text = await response.text();
      try { body = JSON.parse(text); } catch (_) { body = { detail: text || fallback }; }
    } catch (_) {}
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
    if (body.error) return String(body.error);
    return fallback || ('Ошибка ' + response.status);
  };
  const setBusy = (form, busy, label) => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Подождите…' : label;
  };
  const saveSession = (result) => {
    if (!result?.access_token || !result?.user_id || !result?.username) {
      throw new Error('Сервер не вернул данные сессии');
    }
    localStorage.setItem('token', result.access_token);
    localStorage.setItem('userId', String(result.user_id));
    localStorage.setItem('username', result.username);
    // Keep in-memory vars in sync if app.js already ran
    try {
      if (typeof window !== 'undefined') {
        window.token = result.access_token;
      }
    } catch (_) {}
  };
  const enterApp = () => {
    // Prefer soft enter if app.js functions exist
    try {
      if (typeof showApp === 'function') {
        const auth = byId('auth-screen');
        const app = byId('app-screen');
        if (auth) auth.classList.add('hidden');
        if (app) app.classList.remove('hidden');
        // Re-read from storage for app.js globals
        if (typeof token !== 'undefined') {
          token = localStorage.getItem('token');
          userId = localStorage.getItem('userId');
          username = localStorage.getItem('username');
        }
        showApp();
        return;
      }
    } catch (e) {
      console.warn('soft enter failed', e);
    }
    location.reload();
  };

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const login = tab.dataset.tab === 'login';
      byId('login-form')?.classList.toggle('hidden', !login);
      byId('register-form')?.classList.toggle('hidden', login);
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      error('');
    }, true);
  });

  byId('login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.currentTarget;
    const username = byId('login-username')?.value.trim() || '';
    const password = byId('login-password')?.value || '';
    if (!username || !password) {
      error('Введите логин и пароль');
      return;
    }
    const data = new FormData();
    data.append('username', username);
    data.append('password', password);
    const cloud = byId('login-cloud-password')?.value || '';
    if (cloud) data.append('cloud_password', cloud);
    error('');
    setBusy(form, true, 'Войти');
    try {
      const response = await fetch('/token', {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(await detail(response, 'Неверный логин или пароль'));
      const result = await response.json();
      saveSession(result);
      enterApp();
    } catch (err) {
      console.error('Login error:', err);
      error(err.message || 'Нет связи с сервером');
    } finally {
      setBusy(form, false, 'Войти');
    }
  }, true);

  byId('register-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.currentTarget;
    const username = byId('reg-username')?.value.trim() || '';
    const password = byId('reg-password')?.value || '';
    if (username.length < 3) {
      error('Имя пользователя слишком короткое (мин. 3)');
      return;
    }
    if (password.length < 4) {
      error('Пароль слишком короткий (мин. 4)');
      return;
    }
    const data = new FormData();
    data.append('username', username);
    data.append('password', password);
    error('');
    setBusy(form, true, 'Зарегистрироваться');
    try {
      const response = await fetch('/register', {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error(await detail(response, 'Ошибка регистрации'));
      const result = await response.json();
      saveSession(result);
      enterApp();
    } catch (err) {
      console.error('Registration error:', err);
      error(err.message || 'Нет связи с сервером. Попробуйте ещё раз.');
    } finally {
      setBusy(form, false, 'Зарегистрироваться');
    }
  }, true);
})();
