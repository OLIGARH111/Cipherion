import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHalloween, halloweenSeason, GHOST_SECONDS } from '../server/halloween.js';
import { halloweenActive } from '../public/halloween.js';

test('season covers 1 – 30 November in Moscow time and can be forced', () => {
  const at = s => Date.parse(s);
  assert.equal(halloweenSeason(at('2026-10-31T20:59:00Z'), {}), false);
  assert.equal(halloweenSeason(at('2026-10-31T21:00:00Z'), {}), true);
  assert.equal(halloweenSeason(at('2026-11-15T12:00:00Z'), {}), true);
  assert.equal(halloweenSeason(at('2026-11-30T20:59:00Z'), {}), true);
  assert.equal(halloweenSeason(at('2026-11-30T21:00:00Z'), {}), false);
  assert.equal(halloweenSeason(at('2026-07-01T00:00:00Z'), { HALLOWEEN: 'on' }), true);
  assert.equal(halloweenSeason(at('2026-11-15T00:00:00Z'), { HALLOWEEN: 'off' }), false);
});

test('client season respects the server flag and the user switch', () => {
  assert.equal(halloweenActive({ halloween: { active: true } }, {}), true);
  assert.equal(halloweenActive({ halloween: { active: true } }, { halloween: false }), false);
  assert.equal(halloweenActive({ halloween: { active: false } }, {}), false);
  assert.equal(halloweenActive({}, {}), false);
});

test('ghost timer starts on read by someone else and the sweep deletes the message', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY, chat_id TEXT, user_id TEXT, kind TEXT, body TEXT, created INTEGER, deleted INTEGER DEFAULT 0, transcript TEXT, e2e TEXT)");
  const one = (s, ...p) => db.prepare(s).get(...p), all = (s, ...p) => db.prepare(s).all(...p), run = (s, ...p) => db.prepare(s).run(...p);
  let clock = 1000; const events = [];
  const h = createHalloween({ db, one, all, run, fail: (status, message) => { throw Object.assign(new Error(message), { status }); }, now: () => clock, broadcast: (chat, event, payload) => events.push(payload.id), rate: () => {} });
  run("INSERT INTO messages(id,chat_id,user_id,kind,body,created,ghost) VALUES('g','c','a','text','boo',10,1)");
  run("INSERT INTO messages(id,chat_id,user_id,kind,body,created) VALUES('n','c','a','text','plain',11)");
  h.read('c', 'a', 100);
  assert.equal(one("SELECT ghost_until FROM messages WHERE id='g'").ghost_until, null, 'the author reading does not start the timer');
  h.read('c', 'b', 100);
  assert.equal(one("SELECT ghost_until FROM messages WHERE id='g'").ghost_until, 1000 + GHOST_SECONDS * 1000);
  clock += GHOST_SECONDS * 1000 - 1; h.sweep();
  assert.equal(one("SELECT deleted FROM messages WHERE id='g'").deleted, 0);
  clock += 1; h.sweep();
  assert.deepEqual({ ...one("SELECT deleted,body FROM messages WHERE id='g'") }, { deleted: 1, body: '' });
  assert.equal(one("SELECT deleted FROM messages WHERE id='n'").deleted, 0);
  assert.deepEqual(events, ['g', 'g']);
});

let server, base, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cipherion-halloween-'));
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', HALLOWEEN: 'on' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000); server.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } }); server.once('exit', code => reject(new Error('Server exit ' + code))); });
});
after(async () => { server?.kill(); await new Promise(resolve => server?.exitCode !== null ? resolve() : server.once('exit', resolve)); await rm(dir, { recursive: true, force: true }); });
async function request(path, cookie, method = 'GET', data) { const response = await fetch(base + '/api' + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; }
const account = username => request('/auth', null, 'POST', { register: true, username, name: username, password: 'test-password-12345' });

test('ghost messages and «Сладость или гадость» through the API', async () => {
  const a = await account('ghosta'), b = await account('ghostb');
  assert.equal((await request('/me', a.cookie)).data.halloween.active, true);
  const direct = (await request('/chats', a.cookie, 'POST', { kind: 'direct', users: [b.data.user.id] })).data;

  const ghost = await request(`/chats/${direct.id}/messages`, a.cookie, 'POST', { body: 'угадай, кто я', ghost: true });
  assert.equal(ghost.status, 201); assert.equal(ghost.data.ghost, 1); assert.equal(ghost.data.ghost_until, null);
  assert.equal((await request(`/messages/${ghost.data.id}/forward`, b.cookie, 'POST', { chat: direct.id })).status, 403);
  await request(`/chats/${direct.id}/read`, b.cookie, 'POST', { message: ghost.data.id });
  const started = (await request(`/messages/${ghost.data.id}`, a.cookie)).data;
  assert.ok(started.ghost_until > Date.now());

  // The recipient can refuse ghost messages.
  const settings = (await request('/me', b.cookie)).data.settings;
  await request('/me', b.cookie, 'PATCH', { settings: { ...settings, ghostMessages: false } });
  assert.equal((await request(`/chats/${direct.id}/messages`, a.cookie, 'POST', { body: 'ещё', ghost: true })).status, 403);
  const saved = (await request('/chats', a.cookie, 'POST', { kind: 'saved' })).data;
  assert.equal((await request(`/chats/${saved.id}/messages`, a.cookie, 'POST', { body: 'x', ghost: true })).status, 400);

  const game = await request(`/chats/${direct.id}/messages`, a.cookie, 'POST', { kind: 'treat' });
  assert.equal(game.status, 201); assert.equal(game.data.kind, 'treat'); assert.deepEqual(game.data.game, {});
  assert.equal((await request(`/messages/${game.data.id}/treat`, a.cookie, 'POST', { choice: 'treat' })).status, 400, 'the author cannot play');
  assert.equal((await request(`/messages/${game.data.id}/treat`, b.cookie, 'POST', { choice: 'nope' })).status, 400);
  assert.equal((await request(`/messages/${game.data.id}/treat`, b.cookie, 'POST', { choice: 'trick' })).status, 200);
  const played = (await request(`/messages/${game.data.id}`, a.cookie)).data.game.result;
  assert.equal(played.choice, 'trick'); assert.ok(['treat', 'trick'].includes(played.kind)); assert.ok(played.emoji && played.text);
  assert.equal((await request(`/messages/${game.data.id}/treat`, b.cookie, 'POST', { choice: 'treat' })).status, 409, 'one game, one result');
  assert.equal((await request(`/messages/${game.data.id}`, a.cookie, 'PATCH', { body: 'edit' })).status, 403);
});
