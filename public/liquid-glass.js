// Liquid glass on the controls Cipherion already has.
// The tab bar does not blur the page. A lens blurs a clone of the bar's own
// icons, then stretches and bounces. Buttons keep their shape; glass is only
// the press. Switch and slider knobs are the only blurred part of those controls.

const reduceQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const calm = () => !!reduceQuery?.matches || document.body.classList.contains('no-motion');
const enabled = () => document.body.classList.contains('glass-ui');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const frame = fn => (globalThis.requestAnimationFrame || (cb => setTimeout(() => cb(performance.now()), 16)))(fn);

class Spring {
  constructor(x, k, d) {
    this.x = x;
    this.v = 0;
    this.target = x;
    this.k = k;
    this.d = d;
  }
  step(dt) {
    const a = -this.k * (this.x - this.target) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  settled() {
    return Math.abs(this.x - this.target) < 0.0015 && Math.abs(this.v) < 0.02;
  }
}

const systems = [];
let running = false;

function kick() {
  if (running) return;
  running = true;
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    let alive = false;
    for (let i = systems.length - 1; i >= 0; i--) {
      const sys = systems[i];
      if (sys.el && !sys.el.isConnected) {
        systems.splice(i, 1);
        continue;
      }
      try {
        if (sys(dt)) alive = true;
      } catch {
        systems.splice(i, 1);
      }
    }
    if (alive) frame(loop);
    else running = false;
  };
  frame(loop);
}

const PRESS = '#attach,#record,#emoji,#composer-ai,.composer>.send,.composer>.icon-button,.header-actions>.icon-button,.pill-head>.mobile-back,.side-actions>.icon-button';
const SWITCH = '.setting-row input[type=checkbox],.tg-switch input[type=checkbox],.nav-editor-row input[type=checkbox]';

function bindNav(nav) {
  if (nav.dataset.lgNav === '1') return;
  nav.dataset.lgNav = '1';
  const pos = new Spring(0, 420, 26);
  const posY = new Spring(0, 420, 26);
  const press = new Spring(1, 460, 16);
  const flash = new Spring(0, 70, 12);
  let stretch = 0;
  let ready = false;

  const lensOf = () => nav.querySelector(':scope>.lg-lens');
  const place = () => {
    const lens = lensOf();
    const clone = lens?.querySelector('.lg-lens-clone');
    const shine = lens?.querySelector('.lg-shine');
    if (!lens || !clone) return;
    const buttons = [...nav.querySelectorAll(':scope>button')];
    const active = buttons.find(b => b.classList.contains('active')) || buttons[0];
    if (!active) return;
    const nr = nav.getBoundingClientRect();
    const br = active.getBoundingClientRect();
    const pad = 3;
    const x = br.left - nr.left + pad;
    const y = br.top - nr.top + pad;
    if (!ready) {
      pos.x = x;
      posY.x = y;
      ready = nr.width > 0;
    }
    pos.target = x;
    posY.target = y;
    lens.style.width = Math.max(8, br.width - pad * 2) + 'px';
    lens.style.height = Math.max(8, br.height - pad * 2) + 'px';
    clone.style.width = nr.width + 'px';
    clone.style.height = nr.height + 'px';
    clone.innerHTML = buttons.map(b => {
      const r = b.getBoundingClientRect();
      return `<div class="lg-clone-tab${b.classList.contains('active') ? ' active' : ''}" style="left:${r.left - nr.left}px;top:${r.top - nr.top}px;width:${r.width}px;height:${r.height}px">${b.innerHTML}</div>`;
    }).join('');
    if (shine) shine.style.opacity = '0';
    kick();
  };
  const paint = () => {
    const lens = lensOf();
    const clone = lens?.querySelector('.lg-lens-clone');
    const shine = lens?.querySelector('.lg-shine');
    if (!lens || !clone) return;
    const horizontal = Math.abs(pos.v) >= Math.abs(posY.v);
    const mag = Math.abs(stretch);
    const sx = press.x * (horizontal ? 1 + mag : 1 - mag * 0.45);
    const sy = press.x * (horizontal ? 1 - mag * 0.45 : 1 + mag);
    lens.style.transform = `translate3d(${pos.x}px,${posY.x}px,0) scale(${sx},${sy})`;
    clone.style.transform = `translate3d(${-pos.x}px,${-posY.x}px,0)`;
    if (shine) shine.style.opacity = String(clamp(flash.x, 0, 1));
  };
  const ensure = () => {
    if (!enabled()) {
      lensOf()?.remove();
      ready = false;
      return;
    }
    if (lensOf()) return;
    const lens = document.createElement('div');
    lens.className = 'lg-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<div class="lg-lens-clone"></div><div class="lg-shine"></div><div class="lg-rim"></div>';
    nav.prepend(lens);
    ready = false;
  };
  let framing = false;
  const rebuild = () => {
    if (framing) return;
    framing = true;
    ensure();
    if (enabled()) place();
    framing = false;
  };
  nav.addEventListener('pointerdown', e => {
    if (!enabled() || !e.target.closest?.('button')) return;
    press.target = 1.08;
    flash.x = 1;
    flash.v = 0;
    flash.target = 0;
    kick();
  });
  nav.addEventListener('pointerup', () => { press.target = 1; kick(); });
  nav.addEventListener('pointercancel', () => { press.target = 1; kick(); });
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target?.closest?.('.lg-lens'))) return;
    rebuild();
  });
  observer.observe(nav, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  if (globalThis.ResizeObserver) new ResizeObserver(rebuild).observe(nav);
  rebuild();

  const sys = dt => {
    if (!enabled() || !lensOf()) return false;
    if (calm()) {
      pos.x = pos.target;
      posY.x = posY.target;
      press.x = 1;
      flash.x = 0;
      stretch = 0;
      paint();
      return false;
    }
    pos.step(dt);
    posY.step(dt);
    press.step(dt);
    flash.step(dt);
    const speed = Math.abs(pos.v) >= Math.abs(posY.v) ? pos.v : posY.v;
    stretch += (clamp(speed * 0.0036, -0.42, 0.42) - stretch) * Math.min(1, dt * 16);
    paint();
    return !pos.settled() || !posY.settled() || !press.settled() || flash.x > 0.01 || Math.abs(stretch) > 0.01;
  };
  sys.el = nav;
  systems.push(sys);
}

function trackPress(el) {
  if (el.dataset.lgPress === '1') return;
  el.dataset.lgPress = '1';
  if (!el.querySelector(':scope>.lg-fx')) el.insertAdjacentHTML('beforeend', '<i class="lg-fx" aria-hidden="true"></i><i class="lg-glint" aria-hidden="true"></i><i class="lg-flash" aria-hidden="true"></i>');
  const scale = new Spring(1, 440, 15);
  const stretch = new Spring(0, 280, 16);
  const flash = new Spring(0, 80, 14);
  let down = false;
  let originX = 0;
  let originY = 0;
  let pointer = -1;
  const paint = () => {
    const sx = scale.x * (1 + Math.abs(stretch.x));
    const sy = scale.x * (1 - Math.abs(stretch.x) * 0.42);
    el.style.transform = `scale(${sx}, ${sy})`;
    const glass = clamp(Math.max(flash.x, down ? 0.85 : 0, (scale.x - 1) / 0.16), 0, 1);
    el.style.setProperty('--lg', glass.toFixed(3));
    el.style.setProperty('--sx', stretch.x.toFixed(3));
  };
  const end = e => {
    if (!down || (e && e.pointerId !== pointer)) return;
    down = false;
    scale.target = 1;
    stretch.target = 0;
    kick();
  };
  el.addEventListener('pointerdown', e => {
    if (!enabled() || e.button > 0) return;
    down = true;
    pointer = e.pointerId;
    originX = e.clientX;
    originY = e.clientY;
    scale.target = el.id === 'record' ? 1.22 : 1.16;
    flash.x = 1;
    flash.v = 0;
    flash.target = 0;
    el.classList.add('lg-hot');
    paint();
    kick();
  });
  el.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== pointer) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    stretch.target = clamp((Math.abs(dx) > Math.abs(dy) ? dx : dy) / 90, -0.48, 0.48);
    kick();
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  const sys = dt => {
    if (!down && scale.settled() && stretch.settled() && flash.x <= 0.01) {
      el.style.transform = '';
      el.style.removeProperty('--lg');
      el.style.removeProperty('--sx');
      el.classList.remove('lg-hot');
      return false;
    }
    if (calm()) {
      scale.x = down ? scale.target : 1;
      stretch.x = 0;
      flash.x = 0;
      paint();
      return down;
    }
    scale.step(dt);
    stretch.step(dt);
    flash.step(dt);
    paint();
    return true;
  };
  sys.el = el;
  systems.push(sys);
}

function knobTravel(input) {
  const w = input.getBoundingClientRect().width;
  return w > 8 ? Math.max(10, w - 28) : 18;
}

function bindSwitch(input) {
  if (input.dataset.lgSwitch === '1') return;
  input.dataset.lgSwitch = '1';
  const pos = new Spring(input.checked ? 1 : 0, 520, 22);
  const press = new Spring(1, 480, 16);
  const stretch = new Spring(0, 260, 15);
  const flash = new Spring(0, 80, 14);
  let down = false;
  let moved = false;
  let origin = 0;
  let grabbed = 0;
  const paint = () => {
    const sx = press.x * (1 + Math.abs(stretch.x));
    const sy = press.x * (1 - Math.abs(stretch.x) * 0.55);
    input.style.setProperty('--kx', (pos.x * knobTravel(input)).toFixed(2) + 'px');
    input.style.setProperty('--ks', sx.toFixed(3));
    input.style.setProperty('--ky', sy.toFixed(3));
    input.style.setProperty('--flash', clamp(flash.x, 0, 1).toFixed(3));
  };
  const settle = () => {
    input.style.removeProperty('--kx');
    input.style.removeProperty('--ks');
    input.style.removeProperty('--ky');
    input.style.removeProperty('--flash');
    input.classList.remove('lg-hot');
  };
  input.addEventListener('pointerdown', e => {
    if (!enabled()) return;
    down = true;
    moved = false;
    origin = e.clientX;
    grabbed = pos.x;
    press.target = 1.2;
    flash.x = 1;
    flash.target = 0;
    input.classList.add('lg-hot');
    paint();
    kick();
  });
  input.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - origin;
    if (Math.abs(dx) > 4) moved = true;
    pos.target = clamp(grabbed + dx / knobTravel(input), 0, 1);
    pos.x = pos.target;
    stretch.target = clamp(dx / 80, -0.35, 0.35);
    paint();
    kick();
  });
  const release = () => {
    if (!down) return;
    down = false;
    press.target = 1;
    stretch.target = 0;
    if (moved) {
      const next = pos.x > 0.5;
      pos.target = next ? 1 : 0;
      input.dataset.lgDrag = '1';
      if (input.checked !== next) {
        input.checked = next;
        input.dispatchEvent(new Event('change', {bubbles: true}));
      }
    }
    kick();
  };
  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
  input.addEventListener('click', e => {
    if (input.dataset.lgDrag !== '1') return;
    e.preventDefault();
    e.stopPropagation();
    input.dataset.lgDrag = '0';
  }, true);
  input.addEventListener('change', () => {
    if (input.dataset.lgDrag === '1') return;
    pos.target = input.checked ? 1 : 0;
    if (!down) {
      flash.x = Math.max(flash.x, 0.8);
      flash.target = 0;
      input.classList.add('lg-hot');
      kick();
    }
  });
  const sys = dt => {
    const resting = !down && pos.settled() && press.settled() && stretch.settled() && flash.x <= 0.01;
    if (resting) {
      settle();
      return false;
    }
    if (calm()) {
      pos.x = pos.target;
      press.x = 1;
      stretch.x = 0;
      flash.x = 0;
      settle();
      return false;
    }
    if (!down) pos.step(dt);
    press.step(dt);
    stretch.step(dt);
    flash.step(dt);
    if (!down) stretch.target = clamp(pos.v * 0.01, -0.32, 0.32);
    paint();
    return true;
  };
  sys.el = input;
  systems.push(sys);
}

function bindRange(input) {
  if (input.dataset.lgRange === '1') return;
  input.dataset.lgRange = '1';
  const press = new Spring(1, 460, 16);
  const stretch = new Spring(0, 240, 14);
  const flash = new Spring(0, 80, 14);
  let down = false;
  let lastX = 0;
  const sync = () => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--pct', pct.toFixed(2) + '%');
  };
  const paint = () => {
    input.style.setProperty('--ks', (press.x * (1 + Math.abs(stretch.x))).toFixed(3));
    input.style.setProperty('--ky', (press.x * (1 - Math.abs(stretch.x) * 0.5)).toFixed(3));
    input.style.setProperty('--flash', clamp(flash.x, 0, 1).toFixed(3));
    sync();
  };
  sync();
  input.addEventListener('input', sync);
  input.addEventListener('pointerdown', e => {
    if (!enabled()) return;
    down = true;
    lastX = e.clientX;
    press.target = 1.2;
    flash.x = 1;
    flash.target = 0;
    input.classList.add('lg-hot');
    paint();
    kick();
  });
  input.addEventListener('pointermove', e => {
    if (!down) return;
    stretch.target = clamp((e.clientX - lastX) * 0.05, -0.4, 0.4);
    lastX = e.clientX;
    kick();
  });
  const release = () => {
    if (!down) return;
    down = false;
    press.target = 1;
    stretch.target = 0;
    kick();
  };
  input.addEventListener('pointerup', release);
  input.addEventListener('pointercancel', release);
  const sys = dt => {
    if (!down && press.settled() && stretch.settled() && flash.x <= 0.01) {
      input.style.removeProperty('--ks');
      input.style.removeProperty('--ky');
      input.style.removeProperty('--flash');
      input.classList.remove('lg-hot');
      return false;
    }
    if (calm()) {
      press.x = 1;
      stretch.x = 0;
      flash.x = 0;
      paint();
      return down;
    }
    press.step(dt);
    stretch.step(dt);
    flash.step(dt);
    if (!down) stretch.target *= 0.02;
    paint();
    return true;
  };
  sys.el = input;
  systems.push(sys);
}

let scanQueued = false;
function scan() {
  scanQueued = false;
  if (!document.body) return;
  document.querySelectorAll('.nav').forEach(bindNav);
  if (!enabled()) {
    document.querySelectorAll('.lg-lens').forEach(node => node.remove());
    return;
  }
  document.querySelectorAll(PRESS).forEach(node => { if (node instanceof HTMLElement) trackPress(node); });
  document.querySelectorAll(SWITCH).forEach(node => { if (node instanceof HTMLInputElement) bindSwitch(node); });
  document.querySelectorAll('input[type=range]').forEach(node => { if (node instanceof HTMLInputElement) bindRange(node); });
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  frame(scan);
}

let started = false;
export function installLiquidGlass() {
  if (started || !document.body) return;
  started = true;
  const rootObs = new MutationObserver(records => {
    const useful = records.some(r => {
      const t = r.target;
      if (!t || t.nodeType !== 1 || typeof t.closest !== 'function') return true;
      return !t.closest('.messages, .chat-list, .stories-strip, .ep-body');
    });
    if (useful) scheduleScan();
  });
  rootObs.observe(document.body, {childList: true, subtree: true});
  new MutationObserver(scheduleScan).observe(document.body, {attributes: true, attributeFilter: ['class']});
  scan();
}
