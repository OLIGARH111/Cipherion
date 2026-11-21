import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><body class="glass-ui"><nav class="nav"><button class="icon-button active" data-tab="chat">Чаты</button><button class="icon-button" data-tab="settings">Настройки</button></nav><form class="composer"><button class="icon-button" id="attach" type="button">+</button><button class="icon-button" id="record" type="button">mic</button></form><label class="setting-row"><input type="checkbox"></label><input id="size" type="range" min="12" max="20" value="16"></body>', {url: 'https://cipherion.example'});
const window = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'getComputedStyle', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: window[key]});
}
globalThis.matchMedia = () => ({matches: false});
after(() => dom.window.close());

test('lens, press glass and knobs attach to the existing controls', async () => {
  const {installLiquidGlass} = await import('../public/liquid-glass.js');
  installLiquidGlass();
  const nav = document.querySelector('.nav');
  assert.ok(nav.querySelector('.lg-lens'), 'tab bar grows a lens');
  assert.equal(nav.querySelectorAll('.lg-lens').length, 1);
  const down = (el, x) => el.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true, clientX: x, clientY: 10}));
  const up = el => el.dispatchEvent(new window.MouseEvent('pointerup', {bubbles: true, clientX: 10, clientY: 10}));
  const attach = document.querySelector('#attach');
  down(attach, 10);
  assert.ok(Number(attach.style.getPropertyValue('--lg')) > 0.5, 'press shows glass without changing the button');
  assert.ok(attach.querySelector('.lg-fx'));
  up(attach);
  const box = document.querySelector('input[type=checkbox]');
  down(box, 4);
  assert.equal(box.classList.contains('lg-hot'), true);
  assert.ok(Number(box.style.getPropertyValue('--flash')) > 0, 'knob flashes on press');
  up(box);
  const range = document.querySelector('#size');
  assert.match(range.style.getPropertyValue('--pct'), /%/, 'slider fill follows the thumb');
  document.body.classList.remove('glass-ui');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(document.querySelector('.lg-lens'), null, 'turning glass off removes the lens');
});
