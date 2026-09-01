/* Minimal independent authentication fallback. Keeps sign-in and registration usable
   even if a nonessential UI enhancement fails. */
(() => {
  const byId = (id) => document.getElementById(id);
  const error = (message) => {
    const box = byId('auth-error');
    if (box) box.textContent = message || '';
  };
  const detail = async (response, fallback) => {
    const body = await response.json().catch(() => ({}));
    return body.detail || fallback || 'Не удалось выполнить запрос';
  };
  const setBusy = (form, busy, label) => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Подождите…' : label;
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

  byId('reg-send-code')?.addEventListener('click', async () => {
    const phone = byId('reg-phone')?.value.trim() || '';
    if (phone.length < 10) return error('Введите корректный номер телефона');
    error('');
    const data = new FormData();
    data.append('phone', phone);
    try {
      const response = await fetch('/auth/send-code', { method: 'POST', body: data });
      if (!response.ok) throw new Error(await detail(response));
      const result = await response.json();
      const hint = byId('reg-code-hint');
      if (hint) hint.textContent = result.demo_code ? 'Демо-код: ' + result.demo_code : 'Код отправлен';
      if (result.demo_code && byId('reg-phone-code')) byId('reg-phone-code').value = result.demo_code;
    } catch (err) {
      error(err.message || 'Сервер недоступен. Повторите попытку.');
    }
  }, true);

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
      localStorage.setItem('token', result.access_token);
      localStorage.setItem('userId', String(result.user_id));
      localStorage.setItem('username', result.username);
      location.reload();
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
    const data = new FormData();
    data.append('username', byId('reg-username')?.value.trim() || '');
    data.append('password', byId('reg-password')?.value || '');
    data.append('phone', byId('reg-phone')?.value.trim() || '');
    data.append('email', byId('reg-email')?.value.trim() || '');
    data.append('phone_code', byId('reg-phone-code')?.value.trim() || '');
    error('');
    setBusy(form, true, 'Зарегистрироваться');
    try {
      const response = await fetch('/register', { method: 'POST', body: data, credentials: 'same-origin' });
      if (!response.ok) throw new Error(await detail(response));
      const result = await response.json();
      localStorage.setItem('token', result.access_token);
      localStorage.setItem('userId', String(result.user_id));
      localStorage.setItem('username', result.username);
      location.reload();
    } catch (err) {
      error(err.message || 'Нет связи с сервером');
    } finally {
      setBusy(form, false, 'Зарегистрироваться');
    }
  }, true);
})();