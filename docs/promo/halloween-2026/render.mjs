// Рендер промо-ролика: node docs/promo/halloween-2026/render.mjs [выход.mp4] [--from=сек --to=сек]
// Нужны Playwright (Chromium) и ffmpeg. Кадры снимаются по одному: сцена перематывается на
// нужное время через window.render(t), поэтому ролик выходит ровным при любой скорости машины.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const out = path.resolve(args.find(a => !a.startsWith('--')) || path.join(here, 'cipherion-halloween-2026.mp4'));
const FPS = Number(flag('fps') || 30);

const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/docs/promo/halloween-2026/index.html?render`;

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
catch { ({ chromium } = await import('playwright')); }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.evaluate(() => window.ready);
const duration = await page.evaluate(() => window.DURATION);
const from = Number(flag('from') || 0), to = Math.min(Number(flag('to') || duration), duration);
const frames = Math.round((to - from) * FPS);

const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((resolve, reject) => ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));

for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.render(t), from + i / FPS);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 93 });
  if (!ffmpeg.stdin.write(jpg)) await new Promise(r => ffmpeg.stdin.once('drain', r));
  if (i % FPS === 0) process.stdout.write(`\r${(from + i / FPS).toFixed(0)}s / ${to}s`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
server.close();
console.log(`\nГотово: ${out}`);
