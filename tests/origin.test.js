import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const scenario of [
  { name: 'Render HTTPS without TRUST_PROXY', env: { RENDER_EXTERNAL_URL: 'https://cipherion.onrender.com' }, origin: 'https://cipherion.onrender.com' },
  { name: 'explicit custom origin overrides Render and normalizes trailing slash', env: { RENDER_EXTERNAL_URL: 'https://cipherion.onrender.com', PUBLIC_ORIGIN: 'https://chat.example.com/' }, origin: 'https://chat.example.com', rejected: 'https://cipherion.onrender.com' },
  { name: 'local HTTP', env: {} },
  { name: 'trusted HTTPS proxy', env: { TRUST_PROXY: '1' }, proxy: true },
]) {
  test(scenario.name + ': registration, login and CSRF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cipherion-origin-'));
    const server = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PUBLIC_ORIGIN: '', RENDER_EXTERNAL_URL: '', TRUST_PROXY: '0', DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', ...scenario.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const base = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
        server.once('error', error => { clearTimeout(timeout); reject(error); });
        server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exit ' + code)); });
        server.stdout.on('data', chunk => {
          const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
          if (match) { clearTimeout(timeout); resolve(match[0]); }
        });
      });
      const origin = scenario.origin || (scenario.proxy ? base.replace('http:', 'https:') : base);
      const auth = (requestOrigin, register) => fetch(base + '/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(scenario.proxy ? { 'X-Forwarded-Proto': 'https' } : {}) },
        body: JSON.stringify({ register, username: 'origin_test', name: 'Test', password: 'test-password-12345' }),
      });
      const registration = await auth(origin, true);
      assert.equal(registration.status, 200, await registration.text());
      assert.match(registration.headers.get('set-cookie'), /session=/);
      const login = await auth(origin, false);
      assert.equal(login.status, 200, await login.text());
      for (const badOrigin of ['https://attacker.invalid', 'null', origin + '.attacker.invalid', ...(scenario.rejected ? [scenario.rejected] : [])]) {
        const rejected = await auth(badOrigin, false);
        assert.equal(rejected.status, 403);
        assert.equal((await rejected.json()).error, 'Недопустимый источник запроса');
      }
      if (!scenario.origin && !scenario.proxy) {
        const spoofed = await fetch(base + '/api/auth', {
          method: 'POST', headers: { Origin: base.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, body: '{}',
        });
        assert.equal(spoofed.status, 403, 'Untrusted proxy header must not enable HTTPS origins');
      }
    } finally {
      if (server.exitCode === null) {
        const exited = new Promise(resolve => server.once('exit', resolve));
        server.kill();
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
}
