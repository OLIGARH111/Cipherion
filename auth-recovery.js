/* Simple auth: only username + password. Overrides any older registration handlers. */
(() => {
  const byId = (id) => document.getElementById(id);
  const error = (message) => {
    const box = byId('auth-error');
    if (box) box.textContent = message || '';
  };
  const detail = async (response, fallback) => {
    const body = await response.json().catch(() => ({}));
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
    return fallback || 'Не удалось выполнить запрос';
  };
  const setBusy = (form, busy, label) => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Подождите…' : label;
  };
  const saveAndEnter = (result) => {
    localStorage.setItem('token', result.access_token);
    localStorage.setItem('userId', String(result.user_id));
    localStorage.setItem('username', result.username);
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
    const data = new FormData();
    data.append('username', byId('login-username')?.value.trim() || '');
    data.append('password', byId('login-password')?.value || '');
    data.append('cloud_password', byId('login-cloud-password')?.value || '');
    error('');
    setBusy(form, true, 'Войти');
    try {
      const response = await fetch('/token', { method: 'POST', body: data, credentials: 'same-origin' });
      if (!response.ok) throw new Error(await detail(response, 'Неверный логин или пароль'));
      const result = await response.json();
      if (!result.access_token || !result.user_id || !result.username) throw new Error('Сервер не вернул сессию');
      saveAndEnter(result);
    } catch (err) {
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
      error('Имя пользователя слишком короткое');
      return;
    }
    if (password.length < 4) {
      error('Пароль слишком короткий');
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
      if (!result.access_token || !result.user_id || !result.username) {
        throw new Error('Сервер создал аккаунт, но не вернул сессию');
      }
      saveAndEnter(result);
    } catch (err) {
      console.error('Registration error:', err);
      error(err.message || 'Нет связи с сервером. Попробуйте ещё раз.');
    } finally {
      setBusy(form, false, 'Зарегистрироваться');
    }
  }, true);
})();
