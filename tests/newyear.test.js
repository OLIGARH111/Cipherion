import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newYearSeason, reviewYear, nextNewYear, longestStreak, persona } from '../server/newyear.js';
import { newYearActive, daysLeft, plural, reviewSlides, shareText } from '../public/newyear.js';
import { EVENTS } from '../server/updates.js';

test('season covers 1 December – 14 January in Moscow time and can be forced', () => {
  const at = s => Date.parse(s);
  assert.equal(newYearSeason(at('2026-11-30T20:59:00Z'), {}), false);
  assert.equal(newYearSeason(at('2026-11-30T21:00:00Z'), {}), true);
  assert.equal(newYearSeason(at('2026-12-31T23:00:00Z'), {}), true);
  assert.equal(newYearSeason(at('2027-01-14T20:59:00Z'), {}), true);
  assert.equal(newYearSeason(at('2027-01-14T21:00:00Z'), {}), false);
  assert.equal(newYearSeason(at('2026-07-01T00:00:00Z'), { NEWYEAR: 'on' }), true);
  assert.equal(newYearSeason(at('2026-12-15T00:00:00Z'), { NEWYEAR: 'off' }), false);
});

test('«Итоги» in January are about the year that has just ended; the countdown aims at Moscow midnight', () => {
  assert.equal(reviewYear(Date.parse('2026-12-20T12:00:00Z')), 2026);
  assert.equal(reviewYear(Date.parse('2027-01-05T12:00:00Z')), 2026);
  assert.equal(reviewYear(Date.parse('2026-11-22T12:00:00Z')), 2026);
  assert.equal(nextNewYear(Date.parse('2026-12-20T12:00:00Z')), Date.parse('2026-12-31T21:00:00Z'));
  assert.equal(daysLeft(Date.parse('2026-12-31T21:00:00Z'), Date.parse('2026-12-30T21:00:00Z')), 1);
  assert.equal(daysLeft(0, 5), 0);
});

test('streaks, Russian plurals and personas', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak([1, 2, 3, 5, 6, 10]), 3);
  assert.deepEqual([1, 2, 5, 11, 21, 22].map(n => plural(n, 'день', 'дня', 'дней')), ['день', 'дня', 'дней', 'дней', 'день', 'дня']);
  const base = { messages: 100, kinds: { text: 100, media: 0, voice: 0, sticker: 0, file: 0, other: 0 }, groupMessages: 0, streak: 2, peakHour: 14 };
  assert.equal(persona({ ...base, messages: 3 }).id, 'newcomer');
  assert.equal(persona({ ...base, kinds: { ...base.kinds, voice: 40 } }).id, 'voice');
  assert.equal(persona({ ...base, peakHour: 1 }).id, 'owl');
  assert.equal(persona({ ...base, peakHour: 7 }).id, 'lark');
  assert.equal(persona(base).id, 'friend');
});

test('client switch and slides skip what the year does not have', () => {
  assert.equal(newYearActive({ newYear: { active: true } }, {}), true);
  assert.equal(newYearActive({ newYear: { active: true } }, { newYear: false }), false);
  assert.equal(newYearActive({}, {}), false);
  const empty = reviewSlides({ year: 2026, messages: 0 }, { name: 'Аня' });
  assert.equal(empty.length, 2);
  const full = { year: 2026, messages: 1234, kinds: { text: 1000, media: 200, voice: 34, sticker: 0, file: 0, other: 0 }, groupMessages: 10, activeDays: 120, streak: 9, peakHour: 21, peakWeekday: 5, peakMonth: 11, peakMonthName: 'декабрь', months: Array(12).fill(5), chats: 7, people: [], reactions: { given: 0, received: 0, top: [] }, calls: { count: 0, minutes: 0 }, stories: 0, sticker: null, percentile: 80, persona: { emoji: '💬', title: 'Верный собеседник', text: '' } };
  const slides = reviewSlides(full, { name: 'Аня' });
  assert.deepEqual(slides.map(s => s.tone), ['intro', 'messages', 'kinds', 'rhythm', 'persona', 'final']);
  assert.match(slides[1].html, /Больше, чем 80%/);
  assert.match(shareText(full), /1\s?234 сообщения/);
});

test('the New Year event waits for 1 December', () => {
  const event = EVENTS.find(e => e.id === 'newyear-2026');
  assert.equal(event.from, Date.parse('2026-11-30T21:00:00Z'));
  assert.ok(event.until > event.from);
});

let server, base, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cipherion-newyear-'));
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', NEWYEAR: 'on' }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000); server.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } }); server.once('exit', code => reject(new Error('Server exit ' + code))); });
});
after(async () => { server?.kill(); await new Promise(resolve => server?.exitCode !== null ? resolve() : server.once('exit', resolve)); await rm(dir, { recursive: true, force: true }); });
async function request(path, cookie, method = 'GET', data) { const response = await fetch(base + '/api' + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; }
const account = username => request('/auth', null, 'POST', { register: true, username, name: username, password: 'test-password-12345' });

test('«Итоги года» through the API', async () => {
  const a = await account('newyeara'), b = await account('newyearb'), c = await account('newyearc');
  const me = (await request('/me', a.cookie)).data;
  assert.equal(me.newYear.active, true);
  assert.ok(me.newYear.at > Date.now());
  const ab = (await request('/chats', a.cookie, 'POST', { kind: 'direct', users: [b.data.user.id] })).data;
  const ac = (await request('/chats', a.cookie, 'POST', { kind: 'direct', users: [c.data.user.id] })).data;
  for (let i = 0; i < 4; i++) await request(`/chats/${ab.id}/messages`, a.cookie, 'POST', { body: 'привет ' + i });
  const reply = await request(`/chats/${ab.id}/messages`, b.cookie, 'POST', { body: 'и тебе' });
  await request(`/chats/${ac.id}/messages`, a.cookie, 'POST', { body: 'с наступающим' });
  await request('/reactions', a.cookie, 'POST', { message: reply.data.id, emoji: '❤️' });

  const review = await request('/year-review', a.cookie);
  assert.equal(review.status, 200);
  assert.equal(review.data.year, me.newYear.year);
  assert.equal(review.data.messages, 5);
  assert.equal(review.data.kinds.text, 5);
  assert.equal(review.data.chats, 2);
  assert.equal(review.data.activeDays, 1);
  assert.equal(review.data.streak, 1);
  assert.equal(review.data.people[0].user.id, b.data.user.id, 'the busiest direct chat comes first');
  assert.equal(review.data.people[0].messages, 5);
  assert.equal(review.data.people[0].mine, 4);
  assert.ok(review.data.persona.title);
  assert.deepEqual(review.data.reactions, { given: 1, received: 0, top: [{ emoji: '❤️', count: 1 }] });
  assert.equal((await request('/year-review', null)).status, 401);
  const empty = await request('/year-review', c.cookie);
  assert.equal(empty.data.messages, 0);
});

test('the «Новый год» sticker pack is offered to everyone', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const packs = JSON.parse(readFileSync('public/stickers-v5/packs.json', 'utf8'));
  assert.equal(packs.newyear.length, 12);
  assert.equal(packs.halloween.length, 12, 'the Halloween pack stays next to it');
  for (let n = 0; n < 12; n++) for (const suffix of ['', '-still']) assert.ok(existsSync(`public/stickers-v5/ny-${String(n).padStart(2, '0')}${suffix}.svg`));
  const a = await account('newyearsticker');
  const installed = (await request('/packs?mode=installed', a.cookie)).data;
  const pack = installed.find(p => p.id === 'v5-newyear');
  assert.ok(pack, 'installed for a new account');
  assert.equal(installed[0].id, 'v5-newyear', 'listed first');
  const items = (await request('/packs/v5-newyear', a.cookie)).data.items;
  assert.deepEqual(items.map(s => s.label).slice(0, 3), ['Привет', 'С Новым годом!', 'Подарок']);
  assert.equal(items[0].poster, '/stickers-v5/ny-00-still.svg');
});
