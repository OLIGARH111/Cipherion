import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A mirror domain proxies to the main server, so its requests must pass the origin check.
let dir, server, base;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cipherion-mirror-'));
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: 'https://main.example', MIRROR_ORIGINS: 'https://mirror.example/, https://other.example' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    server.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    server.once('exit', code => reject(new Error('Server exit ' + code)));
  });
});
after(async () => { server?.kill(); await rm(dir, { recursive: true, force: true }); });

const post = origin => fetch(base + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'x', password: 'short' }) });

test('main and mirror origins pass the origin check, others are rejected', async () => {
  assert.equal((await post('https://main.example')).status, 400);
  assert.equal((await post('https://mirror.example')).status, 400);
  assert.equal((await post('https://other.example')).status, 400);
  assert.equal((await post('https://evil.example')).status, 403);
});
