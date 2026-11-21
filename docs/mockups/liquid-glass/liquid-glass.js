// @ts-check
/**
 * Cipherion Liquid Glass mock.
 * Tab bar: no backdrop blur of the page. The lens blurs a clone of the bar's
 * own icons, then stretches and bounces with a spring.
 * Buttons: Cipherion glyphs stay put. Highlight, scale, stretch and bounce
 * are a glass effect on press, not a new button shape.
 * Switches and sliders: blur only on the moving knob.
 */

const DEVICE_W = 360;
const DEVICE_H = 780;
const LENS_W = 76;

const TABS = [
  { id: "contacts", label: "Контакты", icon: "users" },
  { id: "calls", label: "Звонки", icon: "phone" },
  { id: "chats", label: "Чаты", icon: "chats" },
  { id: "settings", label: "Настройки", icon: "gear" },
];

/** @type {Record<string, string>} */
const ICONS = {
  users: '<path d="M16 20v-1.2A3.8 3.8 0 0 0 12.2 15H7.8A3.8 3.8 0 0 0 4 18.8V20"/><circle cx="10" cy="8" r="3.1"/><path d="M20 20v-1.1A3.2 3.2 0 0 0 17.4 16"/><path d="M16.2 5.1a2.6 2.6 0 0 1 0 4.8"/>',
  phone: '<path d="M7.2 3.8h2.2l1.3 3.2-1.5 1a12 12 0 0 0 5.8 5.8l1-1.5 3.2 1.3v2.2a1.6 1.6 0 0 1-1.7 1.6A15.2 15.2 0 0 1 5.6 5.5a1.6 1.6 0 0 1 1.6-1.7z"/>',
  chats: '<path d="M6.2 17.6 4.2 20c-.4.4-1.1.1-1.1-.5V7.6A2.6 2.6 0 0 1 5.7 5h12.6A2.6 2.6 0 0 1 21 7.6v6.2a2.6 2.6 0 0 1-2.6 2.6H8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.5 1.5M16.4 16.4l1.5 1.5M17.9 6.1l-1.5 1.5M7.6 16.4l-1.5 1.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  pen: '<path d="M4 20h4l10.2-10.2a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/><path d="m13 6 5 5"/>',
  clip: '<path d="m8 12.5 6.2-6.2a3 3 0 0 1 4.2 4.2l-7.4 7.4a4 4 0 0 1-5.6-5.6l7-7"/>',
  mic: '<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20"/>',
  video: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="m15 11 6-3v8l-6-3z"/>',
  send: '<path d="M4 12 20 4l-6 16-2.5-6.5z"/>',
  cam: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="m4 16 4.5-4 3 3 2.2-2 6.3 5"/>',
  file: '<path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V9h5"/>',
  pin: '<path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z"/><circle cx="12" cy="11" r="1.6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  phoneOut: '<path d="M7 17 17 7M9 7h8v8"/>',
  phoneIn: '<path d="M17 7 7 17M7 9v8h8"/>',
  ticks: '<path d="m2 7 3 3 5-6"/><path d="m8 7 3 3 6-7"/>',
  battery: '<rect x="1" y="2" width="14" height="8" rx="1.6"/><rect x="2.4" y="3.4" width="9" height="5.2" rx="0.6" fill="currentColor" stroke="none"/><path d="M16 4.5v3"/>',
  signal: '<path d="M2 10.5h1.6v1H2zM5 8.2h1.6v3.3H5zM8 6h1.6v5.5H8zM11 3.6h1.6V11.5H11z" fill="currentColor" stroke="none"/>',
  wifi: '<path d="M2.2 6.2a12 12 0 0 1 12.6 0"/><path d="M4.4 8.5a8 8 0 0 1 8.2 0"/><path d="M6.6 10.6a4.2 4.2 0 0 1 3.8 0"/><circle cx="8.5" cy="13" r="0.8" fill="currentColor" stroke="none"/>',
};

/**
 * @param {string} name
 * @param {number} [size]
 */
function svg(name, size) {
  const body = ICONS[name] ?? "";
  const s = size ?? 24;
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/**
 * @param {string} action
 * @param {string} icon
 * @param {string} label
 * @param {string} [extra]
 */
function glassBtn(action, icon, label, extra) {
  const cls = extra ? `lg-btn ${extra}` : "lg-btn";
  return `<button type="button" class="${cls}" data-action="${action}" aria-label="${label}">${svg(icon)}<i class="lg-fx" aria-hidden="true"></i><i class="glint" aria-hidden="true"></i><i class="flash" aria-hidden="true"></i></button>`;
}

class Spring {
  /**
   * @param {number} x
   * @param {number} k
   * @param {number} d
   */
  constructor(x, k, d) {
    this.x = x;
    this.v = 0;
    this.target = x;
    this.k = k;
    this.d = d;
  }
  /** @param {number} dt */
  step(dt) {
    const a = -this.k * (this.x - this.target) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  settled() {
    return Math.abs(this.x - this.target) < 0.0015 && Math.abs(this.v) < 0.02;
  }
}

/** @param {number} n @param {number} a @param {number} b */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {Array<(dt: number) => boolean>} */
const systems = [];
let raf = 0;
let running = false;

function kick() {
  if (running) return;
  running = true;
  let last = performance.now();
  const loop = (/** @type {number} */ now) => {
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    let alive = false;
    for (const sys of systems) {
      if (sys(dt)) alive = true;
    }
    if (alive) raf = requestAnimationFrame(loop);
    else running = false;
  };
  raf = requestAnimationFrame(loop);
}

function statusbar() {
  return `<div class="statusbar"><span class="time">9:41</span><span class="sig">${svg("signal", 17)}${svg("wifi", 17)}${svg("battery", 18)}</span></div><div class="island"></div>`;
}

/** @param {number} tone */
function toneVars(tone) {
  const pairs = [
    ["#f07d6e", "#c03a56"],
    ["#eba04a", "#b9601a"],
    ["#9a8af5", "#5d43cf"],
    ["#43c486", "#1d7f50"],
    ["#36c2b6", "#167f7b"],
    ["#56aef2", "#2a6fca"],
    ["#e07ccb", "#a63f93"],
  ];
  const pair = pairs[tone % pairs.length] ?? pairs[0];
  return `--a1:${pair[0]};--a2:${pair[1]}`;
}

function chatsView() {
  const rows = [
    ["Избранное", "Заметка: линза не блюрит список", "21:40", "", "saved", ""],
    ["Мария Ковалёва", "Потяни микрофон — он растянется", "20:41", "2", "6", "online"],
    ["Cypher", "Голосовое сообщение", "19:18", "", "4", ""],
    ["Лаборатория", "Алексей: бегунок — единственный blur", "18:05", "4", "2", ""],
    ["Новости Cipherion", "Макет готов, main не трогаем", "вчера", "", "3", ""],
    ["Дизайн", "не блюрить фон таб-бара", "вчера", "", "1", "draft"],
    ["Семья", "Фото", "пн", "", "0", ""],
    ["Голосовые", "Видеосообщение · 0:08", "пн", "", "5", ""],
    ["Поддержка", "Список под баром остаётся резким", "вс", "", "4", ""],
  ];
  const html = rows
    .map((r) => {
      const name = r[0] ?? "";
      const preview = r[1] ?? "";
      const time = r[2] ?? "";
      const unread = r[3] ?? "";
      const tone = r[4] ?? "";
      const flag = r[5] ?? "";
      const av =
        flag === "saved"
          ? `<span class="avatar saved" aria-hidden="true">${svg("chats", 22)}</span>`
          : `<span class="avatar ${flag === "online" ? "online" : ""}" style="${toneVars(Number(tone))}" aria-hidden="true">${name.slice(0, 1)}</span>`;
      const prev =
        flag === "draft"
          ? `<span><span class="draft">Черновик: </span>${preview}</span>`
          : `<span>${preview}</span>`;
      const badge = unread ? `<i class="badge">${unread}</i>` : "";
      return `<button type="button" class="row">${av}<span class="who"><span class="who-top"><b>${name}</b><time>${time}</time></span><span class="who-bot">${prev}${badge}</span></span></button>`;
    })
    .join("");
  return `<div class="view chats is-on" data-view="chats"><div class="large-title"><h2>Чаты</h2>${glassBtn("plain", "pen", "Новый чат")}</div><div class="search">${svg("search")}Поиск</div>${html}</div>`;
}

function contactsView() {
  const people = [
    ["Мария Ковалёва", "в сети", 6],
    ["Алексей Морозов", "был недавно", 2],
    ["Cypher", "бот", 4],
    ["Ирина", "была давно", 0],
    ["Студия", "8 участников", 3],
  ];
  const html = people
    .map(
      (p) =>
        `<div class="row"><span class="avatar" style="${toneVars(Number(p[2]))}">${String(p[0]).slice(0, 1)}</span><span class="who"><span class="who-top"><b>${p[0]}</b></span><span class="who-bot"><span>${p[1]}</span></span></span></div>`,
    )
    .join("");
  return `<div class="view" data-view="contacts"><div class="large-title"><h2>Контакты</h2></div><div class="search">${svg("search")}Поиск</div>${html}</div>`;
}

function callsView() {
  const items = [
    ["Мария Ковалёва", "исходящий", "20:12", false, 6],
    ["Лаборатория", "входящий", "вчера", false, 2],
    ["Ирина", "пропущенный", "пн", true, 0],
  ];
  const html = items
    .map((c) => {
      const icon = c[3] ? "phoneIn" : "phoneOut";
      const cls = c[3] ? "call-dir missed" : "call-dir";
      return `<div class="row"><span class="avatar" style="${toneVars(Number(c[4]))}">${String(c[0]).slice(0, 1)}</span><span class="who"><span class="who-top"><b>${c[0]}</b><time>${c[2]}</time></span><span class="who-bot"><span class="${cls}">${svg(icon, 14)} ${c[1]}</span></span></span></div>`;
    })
    .join("");
  return `<div class="view" data-view="calls"><div class="large-title"><h2>Звонки</h2></div>${html}</div>`;
}

/** @param {boolean} detailed */
function settingsView(detailed) {
  const switches = detailed
    ? [
        ["Уведомления", true],
        ["Предпросмотр текста", false],
        ["Вибрация", true],
      ]
    : [
        ["Уведомления", true],
        ["Предпросмотр", false],
      ];
  const sw = switches
    .map(
      ([label, on]) =>
        `<div class="set-row"><span>${label}</span><button type="button" class="lg-switch" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${label}"><span class="lg-switch-track"></span><span class="lg-knob"><i class="glint"></i><i class="flash"></i></span></button></div>`,
    )
    .join("");
  const sliders = detailed
    ? `<div class="set-label">Оформление</div><div class="group"><div class="set-row slider-row"><span>Размер текста</span><span class="val" data-val>16</span></div><div class="lg-slider" data-slider data-min="12" data-max="24" data-value="16"><div class="lg-slider-track"><div class="lg-slider-fill"></div></div><div class="lg-thumb"><i class="glint"></i><i class="flash"></i></div></div><div class="set-row slider-row"><span>Сжатие медиа</span><span class="val" data-val>70%</span></div><div class="lg-slider" data-slider data-min="0" data-max="100" data-value="70" data-suffix="%"><div class="lg-slider-track"><div class="lg-slider-fill"></div></div><div class="lg-thumb"><i class="glint"></i><i class="flash"></i></div></div></div>`
    : `<div class="group" style="margin-top:12px"><div class="set-row slider-row"><span>Размер текста</span><span class="val" data-val>16</span></div><div class="lg-slider" data-slider data-min="12" data-max="24" data-value="16"><div class="lg-slider-track"><div class="lg-slider-fill"></div></div><div class="lg-thumb"><i class="glint"></i><i class="flash"></i></div></div></div>`;
  return `<div class="view settings" data-view="settings"><div class="large-title"><h2>Настройки</h2></div><div class="profile"><span class="avatar" style="${toneVars(5)}">А</span><span><b>Алекс</b><small>@alex · Cipherion</small></span></div><div class="set-label">Уведомления</div><div class="group">${sw}</div>${sliders}</div>`;
}

/** @param {number} startIndex */
function tabbar(startIndex) {
  const real = TABS.map((tab, i) => {
    const on = i === startIndex ? " is-on" : "";
    return `<button type="button" class="lg-tab${on}" data-tab="${tab.id}"><span class="ico">${svg(tab.icon)}</span><span>${tab.label}</span></button>`;
  }).join("");
  const clone = TABS.map((tab, i) => {
    const on = i === startIndex ? " is-on" : "";
    return `<div class="lg-tab${on}"><span class="ico">${svg(tab.icon)}</span><span>${tab.label}</span></div>`;
  }).join("");
  return `<div class="lg-tabbar" data-tabbar data-start="${startIndex}"><div class="lg-lens" aria-hidden="true"><div class="lg-lens-clone">${clone}</div><div class="lg-shine"></div><div class="lg-rim"></div></div><div class="lg-tabs">${real}</div></div>`;
}

function chatScreen() {
  return `<div class="screen chat-screen">${statusbar()}
    <div class="chat-head"><button type="button" class="icon-plain" aria-label="Назад">${svg("back")}</button><span class="avatar sm online" style="${toneVars(6)}">М</span><span class="peer"><b>Мария Ковалёва</b><small>в сети</small></span>${glassBtn("plain", "phone", "Звонок")}${glassBtn("plain", "video", "Видеозвонок")}</div>
    <div class="view chats is-on" data-view="thread"><div class="msgs" data-msgs>
      <div class="day">Сегодня</div>
      <div class="msg"><div class="bubble">Смотри, как линза едет между вкладками.<span class="meta">20:12</span></div></div>
      <div class="msg"><div class="bubble">Фон под баром остаётся резким — блюра там нет.<span class="meta">20:12</span></div></div>
      <div class="msg own"><div class="bubble">А кнопки внизу?<span class="meta">20:18 ${svg("ticks", 16)}</span></div></div>
      <div class="msg"><div class="bubble">Скрепка, микрофон и видео — кнопки Cipherion. Стекло вспыхивает только пока палец на кнопке.<span class="meta">20:19</span></div></div>
      <div class="msg own"><div class="bubble">Переключатели тоже?<span class="meta">20:36 ${svg("ticks", 16)}</span></div></div>
      <div class="msg"><div class="bubble">Блюр только у бегунка. Дорожка сплошная.<span class="meta">20:37</span></div></div>
    </div></div>
    <div class="video-bubble" data-video-bubble><small>REC</small><b data-vtime>0:00</b></div>
    <div class="composer" data-composer>
      <div class="attach-wrap">
        <div class="lg-menu" data-menu>
          <div class="lg-pop">${glassBtn("pop", "cam", "Камера", "lg-fill")}<em>Камера</em></div>
          <div class="lg-pop">${glassBtn("pop", "image", "Галерея", "lg-fill")}<em>Галерея</em></div>
          <div class="lg-pop">${glassBtn("pop", "file", "Файл", "lg-fill")}<em>Файл</em></div>
          <div class="lg-pop">${glassBtn("pop", "pin", "Геопозиция", "lg-fill")}<em>Гео</em></div>
        </div>
        ${glassBtn("attach", "clip", "Прикрепить")}
      </div>
      <label class="field"><input data-input placeholder="Сообщение" aria-label="Сообщение" /></label>
      <div class="rec-strip"><i class="rec-dot"></i><span class="rec-time" data-rec-time>0:00</span><span class="rec-hint" data-rec-hint>Влево — отмена</span></div>
      ${glassBtn("video", "video", "Видеосообщение")}
      <button type="button" class="lg-btn lg-mic" data-action="mic" aria-label="Голосовое"><span class="mic-ico">${svg("mic")}</span><span class="send-ico">${svg("send")}</span><i class="lg-fx" aria-hidden="true"></i><i class="glint" aria-hidden="true"></i><i class="flash" aria-hidden="true"></i></button>
    </div>
    <div class="home-ind"></div>
  </div>`;
}

/**
 * @param {"chats"|"settings"} mode
 */
function listScreen(mode) {
  const start = mode === "settings" ? 3 : 2;
  return `<div class="screen">${statusbar()}
    ${contactsView()}
    ${callsView()}
    ${chatsView()}
    ${settingsView(mode === "settings")}
    ${tabbar(start)}
    <div class="home-ind"></div>
  </div>`;
}

function shell() {
  return `<div class="studio">
    <header class="studio-head">
      <p class="kicker">Cipherion · макет</p>
      <h1>Liquid Glass</h1>
      <p class="lede">Линза, подсветка, масштаб, растяжение и пружина — без системного стекла, на iOS 18 и старше. Кнопки остаются кнопками Cipherion: жидкое стекло только в момент нажатия. Ветка макета, в main ничего не влито.</p>
    </header>
    <div class="rules">
      <div class="rule"><b>Таб-бар</b><span>Сама панель не блюрит фон. Линза блюрит только иконки бара, тянется по скорости и пружинит.</span></div>
      <div class="rule"><b>Кнопки</b><span>Скрепка, звонок, микрофон и видео — как в Cipherion. Стекло не заменяет их: вспышка, увеличение, растяжение и отскок только пока палец на кнопке.</span></div>
      <div class="rule"><b>Тумблеры и слайдеры</b><span>Дорожка сплошная. Блюр, блик и растяжение только у движущейся ручки.</span></div>
    </div>
    <div class="board">
      <figure class="slot"><div class="scaler"><div class="device" data-phone="chats">${listScreen("chats")}</div></div><figcaption><b>Чаты</b>Нажмите вкладки — линза едет, тянется и отскакивает. Текст под баром остаётся резким.</figcaption></figure>
      <figure class="slot"><div class="scaler"><div class="device" data-phone="chat">${chatScreen()}</div></div><figcaption><b>Кнопки Cipherion</b>Форма своя. Зажмите микрофон или видео — линза вспыхивает, тянется и пружинит. Скрепка открывает меню вложений.</figcaption></figure>
      <figure class="slot"><div class="scaler"><div class="device" data-phone="settings">${listScreen("settings")}</div></div><figcaption><b>Переключатели</b>Потяните ручку: она увеличивается, тянется и блюрит только себя.</figcaption></figure>
    </div>
  </div>`;
}

/**
 * @param {HTMLElement} phone
 * @param {HTMLElement} bar
 */
function bindTabs(phone, bar) {
  const lens = bar.querySelector(".lg-lens");
  const clone = bar.querySelector(".lg-lens-clone");
  const shine = bar.querySelector(".lg-shine");
  if (!(lens instanceof HTMLElement) || !(clone instanceof HTMLElement) || !(shine instanceof HTMLElement)) return;
  const lensEl = lens;
  const cloneEl = clone;
  const shineEl = shine;
  const tabs = [...bar.querySelectorAll(".lg-tabs .lg-tab")];
  const clones = [...bar.querySelectorAll(".lg-lens-clone .lg-tab")];
  const start = Number(bar.dataset.start ?? "2");
  const pos = new Spring(0, 420, 26);
  const press = new Spring(1, 460, 16);
  const flash = new Spring(0, 70, 12);
  let stretch = 0;

  function index() {
    const i = tabs.findIndex((t) => t.classList.contains("is-on"));
    return i < 0 ? start : i;
  }
  /** @param {number} i */
  function targetFor(i) {
    const w = bar.clientWidth || 1;
    const tabW = w / tabs.length;
    return tabW * i + (tabW - LENS_W) / 2;
  }
  function apply() {
    const sx = press.x * (1 + Math.abs(stretch));
    const sy = press.x * (1 - Math.abs(stretch) * 0.45);
    lensEl.style.transform = `translate3d(${pos.x}px,0,0) scale(${sx},${sy})`;
    cloneEl.style.width = `${bar.clientWidth}px`;
    cloneEl.style.transform = `translate3d(${-pos.x}px,0,0)`;
    shineEl.style.opacity = String(clamp(flash.x, 0, 1));
  }
  function snap() {
    pos.target = targetFor(index());
    pos.x = pos.target;
    pos.v = 0;
    apply();
  }
  /**
   * @param {number} i
   * @param {boolean} fromPress
   */
  function select(i, fromPress) {
    tabs.forEach((t, n) => t.classList.toggle("is-on", n === i));
    clones.forEach((t, n) => t.classList.toggle("is-on", n === i));
    phone.querySelectorAll(":scope > .screen > .view").forEach((view) => {
      if (!(view instanceof HTMLElement)) return;
      view.classList.toggle("is-on", view.dataset.view === TABS[i]?.id);
    });
    pos.target = targetFor(i);
    if (fromPress) {
      press.target = 1.08;
      flash.x = 1;
      flash.v = 0;
      flash.target = 0;
    }
    kick();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("pointerdown", () => select(i, true));
    tab.addEventListener("pointerup", () => {
      press.target = 1;
      kick();
    });
    tab.addEventListener("pointercancel", () => {
      press.target = 1;
      kick();
    });
  });
  // Initial view follows the starting tab, not the chats markup default.
  select(start, false);
  snap();

  systems.push((dt) => {
    if (reduce) {
      pos.x = pos.target;
      press.x = press.target;
      flash.x = flash.target;
      stretch = 0;
      apply();
      return false;
    }
    pos.step(dt);
    press.step(dt);
    flash.step(dt);
    const goal = clamp(pos.v * 0.0036, -0.42, 0.42);
    stretch += (goal - stretch) * Math.min(1, dt * 16);
    apply();
    return !pos.settled() || !press.settled() || flash.x > 0.01 || Math.abs(stretch) > 0.01;
  });
  return snap;
}

/**
 * @param {HTMLElement} phone
 */
function bindButtons(phone) {
  /** @type {Array<{el: HTMLButtonElement, scale: Spring, stretch: Spring, flash: Spring, action: string, down: boolean, dx: number, hold: number, recording: boolean, pointer: number}>} */
  const items = [];
  const composer = phone.querySelector("[data-composer]");
  const input = phone.querySelector("[data-input]");
  const menu = phone.querySelector("[data-menu]");
  const hint = phone.querySelector("[data-rec-hint]");
  const recTime = phone.querySelector("[data-rec-time]");
  const bubble = phone.querySelector("[data-video-bubble]");
  const vtime = phone.querySelector("[data-vtime]");
  const msgs = phone.querySelector("[data-msgs]");
  const bubbleSpring = new Spring(0, 380, 18);
  let recT = 0;

  phone.querySelectorAll(".lg-btn").forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    const flashEl = node.querySelector(".flash");
    const action = node.dataset.action ?? "plain";
    const item = {
      el: node,
      scale: new Spring(1, 440, 15),
      stretch: new Spring(0, 280, 16),
      flash: new Spring(0, 80, 14),
      action,
      down: false,
      dx: 0,
      hold: 0,
      recording: false,
      pointer: -1,
    };
    node.addEventListener("pointerdown", (e) => {
      if (item.action === "mic" && node.classList.contains("is-send")) return;
      item.down = true;
      item.dx = 0;
      item.hold = 0;
      item.pointer = e.pointerId;
      item.scale.target = 1.16;
      item.flash.x = 1;
      item.flash.v = 0;
      item.flash.target = 0;
      node.setPointerCapture(e.pointerId);
      kick();
    });
    node.addEventListener("pointermove", (e) => {
      if (!item.down || e.pointerId !== item.pointer) return;
      item.dx += e.movementX;
      item.stretch.target = clamp(item.dx / 90, -0.48, 0.48);
      if (item.recording && item.action === "mic" && hint instanceof HTMLElement) {
        hint.classList.toggle("armed", item.dx < -64);
        hint.textContent = item.dx < -64 ? "Отпустите — отмена" : "Влево — отмена";
      }
      kick();
    });
    const end = () => {
      if (!item.down) return;
      item.down = false;
      item.scale.target = 1;
      item.stretch.target = 0;
      const held = item.hold > 0.18;
      const cancel = item.dx < -64;
      if (item.action === "attach" && menu instanceof HTMLElement) {
        menu.classList.toggle("open");
      }
      if (item.action === "pop" && menu instanceof HTMLElement) {
        menu.classList.remove("open");
      }
      if (item.action === "mic") {
        if (item.recording) {
          item.recording = false;
          node.classList.remove("is-rec");
          if (composer instanceof HTMLElement) composer.classList.remove("is-recording");
          if (!cancel) appendVoice(Math.max(1, Math.round(recT)));
          recT = 0;
          if (hint instanceof HTMLElement) {
            hint.classList.remove("armed");
            hint.textContent = "Влево — отмена";
          }
        }
      }
      if (item.action === "video" && item.recording) {
        item.recording = false;
        bubbleSpring.target = 0;
        if (!cancel) appendVideo(Math.max(1, Math.round(recT)));
        recT = 0;
      }
      item.hold = 0;
      kick();
    };
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    items.push(item);
    if (flashEl instanceof HTMLElement) {
      item.el.dataset.bound = "1";
    }
  });

  if (input instanceof HTMLInputElement) {
    const mic = phone.querySelector('.lg-btn[data-action="mic"]');
    input.addEventListener("input", () => {
      if (mic instanceof HTMLElement) mic.classList.toggle("is-send", input.value.trim().length > 0);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendText();
      }
    });
  }

  function sendText() {
    if (!(input instanceof HTMLInputElement) || !(msgs instanceof HTMLElement)) return;
    const text = input.value.trim();
    if (!text) return;
    msgs.appendChild(textBubble(text, true));
    input.value = "";
    const mic = phone.querySelector('.lg-btn[data-action="mic"]');
    if (mic instanceof HTMLElement) mic.classList.remove("is-send");
    const scroller = msgs.closest(".view");
    if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight;
  }
  /** @param {number} sec */
  function appendVoice(sec) {
    if (!(msgs instanceof HTMLElement)) return;
    const row = document.createElement("div");
    row.className = "msg own";
    const bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble voice";
    const wave = document.createElement("span");
    wave.className = "wave";
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("b");
      b.style.height = `${6 + ((i * 17) % 16)}px`;
      wave.appendChild(b);
    }
    const play = document.createElement("i");
    play.className = "play";
    const em = document.createElement("em");
    em.textContent = `0:${String(sec).padStart(2, "0")}`;
    bubbleEl.append(play, wave, em);
    row.appendChild(bubbleEl);
    msgs.appendChild(row);
    const scroller = msgs.closest(".view");
    if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight;
  }
  /** @param {number} sec */
  function appendVideo(sec) {
    if (!(msgs instanceof HTMLElement)) return;
    const row = document.createElement("div");
    row.className = "msg own";
    const bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble vnote";
    const orb = document.createElement("i");
    const em = document.createElement("em");
    em.textContent = `Видеосообщение 0:${String(sec).padStart(2, "0")}`;
    bubbleEl.append(orb, em);
    row.appendChild(bubbleEl);
    msgs.appendChild(row);
  }
  /**
   * @param {string} text
   * @param {boolean} own
   */
  function textBubble(text, own) {
    const row = document.createElement("div");
    row.className = own ? "msg own" : "msg";
    const bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble";
    bubbleEl.append(document.createTextNode(text));
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = "9:41";
    bubbleEl.appendChild(meta);
    row.appendChild(bubbleEl);
    return row;
  }

  const micBtn = phone.querySelector('.lg-btn[data-action="mic"]');
  if (micBtn instanceof HTMLButtonElement && input instanceof HTMLInputElement) {
    micBtn.addEventListener("pointerup", () => {
      if (micBtn.classList.contains("is-send")) sendText();
    });
  }

  systems.push((dt) => {
    let alive = false;
    if (!reduce) bubbleSpring.step(dt);
    else bubbleSpring.x = bubbleSpring.target;
    if (bubble instanceof HTMLElement) {
      bubble.style.opacity = String(clamp(bubbleSpring.x, 0, 1));
      bubble.style.transform = `scale(${0.2 + bubbleSpring.x * 0.8})`;
    }
    if (!bubbleSpring.settled()) alive = true;
    let anyRec = false;
    for (const item of items) {
      if (item.down) {
        item.hold += dt;
        if (!item.recording && item.hold > 0.2 && (item.action === "mic" || item.action === "video")) {
          item.recording = true;
          recT = 0;
          item.scale.target = item.action === "mic" ? 1.28 : 1.18;
          if (item.action === "mic") {
            item.el.classList.add("is-rec");
            if (composer instanceof HTMLElement) composer.classList.add("is-recording");
            if (menu instanceof HTMLElement) menu.classList.remove("open");
          }
          if (item.action === "video") bubbleSpring.target = 1;
        }
      }
      if (item.recording) anyRec = true;
      if (!reduce) {
        item.scale.step(dt);
        item.stretch.step(dt);
        item.flash.step(dt);
      } else {
        item.scale.x = item.scale.target;
        item.stretch.x = 0;
        item.flash.x = 0;
      }
      const sx = item.scale.x * (1 + Math.abs(item.stretch.x));
      const sy = item.scale.x * (1 - Math.abs(item.stretch.x) * 0.42);
      item.el.style.transform = `scale(${sx}, ${sy})`;
      const pressAmt = clamp((item.scale.x - 1) / 0.16, 0, 1);
      const glass = clamp(Math.max(item.flash.x, item.down || item.recording ? 1 : 0, pressAmt), 0, 1);
      item.el.style.setProperty("--lg", glass.toFixed(3));
      item.el.style.setProperty("--sx", item.stretch.x.toFixed(3));
      const flashEl = item.el.querySelector(".flash");
      if (flashEl instanceof HTMLElement) flashEl.style.opacity = String(clamp(item.flash.x, 0, 1));
      if (!item.scale.settled() || !item.stretch.settled() || item.flash.x > 0.01 || item.down) alive = true;
    }
    if (anyRec) {
      recT += dt;
      const label = `0:${String(Math.floor(recT)).padStart(2, "0")}`;
      if (recTime) recTime.textContent = label;
      if (vtime) vtime.textContent = label;
      alive = true;
    }
    return alive;
  });
}

/** @param {HTMLElement} phone */
function bindSwitches(phone) {
  phone.querySelectorAll(".lg-switch").forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    const knob = node.querySelector(".lg-knob");
    const flash = node.querySelector(".flash");
    if (!(knob instanceof HTMLElement)) return;
    const knobEl = knob;
    const travel = 20;
    const on = node.getAttribute("aria-checked") === "true";
    const pos = new Spring(on ? travel : 0, 520, 22);
    const press = new Spring(1, 480, 16);
    const flashS = new Spring(0, 80, 14);
    const stretch = new Spring(0, 260, 15);
    let down = false;
    let moved = false;
    let origin = 0;
    let grabbed = pos.x;
    /** @type {number} */
    let last = pos.x;

    function paint() {
      const sx = 1 + Math.abs(stretch.x);
      const sy = 1 - Math.abs(stretch.x) * 0.55;
      knobEl.style.transform = `translate3d(${pos.x}px,0,0) scale(${press.x * sx}, ${press.x * sy})`;
      if (flash instanceof HTMLElement) flash.style.opacity = String(clamp(flashS.x, 0, 1));
      node.setAttribute("aria-checked", pos.target > travel / 2 ? "true" : "false");
    }
    paint();
    node.addEventListener("pointerdown", (e) => {
      down = true;
      moved = false;
      origin = e.clientX;
      grabbed = pos.x;
      last = pos.x;
      press.target = 1.2;
      flashS.x = 1;
      flashS.target = 0;
      node.setPointerCapture(e.pointerId);
      kick();
    });
    node.addEventListener("pointermove", (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - origin) > 4) moved = true;
      pos.target = clamp(grabbed + (e.clientX - origin), 0, travel);
      pos.x = pos.target;
      const vel = pos.x - last;
      last = pos.x;
      stretch.target = clamp(vel * 0.18, -0.35, 0.35);
      kick();
    });
    const release = () => {
      if (!down) return;
      down = false;
      press.target = 1;
      stretch.target = 0;
      if (!moved) pos.target = pos.target > travel / 2 ? 0 : travel;
      else pos.target = pos.x > travel / 2 ? travel : 0;
      kick();
    };
    node.addEventListener("pointerup", release);
    node.addEventListener("pointercancel", release);
    node.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      const next = node.getAttribute("aria-checked") !== "true";
      pos.target = next ? travel : 0;
      flashS.x = 1;
      flashS.target = 0;
      press.target = 1.16;
      press.x = 1.16;
      kick();
      setTimeout(() => {
        press.target = 1;
        kick();
      }, 80);
    });
    systems.push((dt) => {
      if (reduce) {
        pos.x = pos.target;
        press.x = 1;
        stretch.x = 0;
        flashS.x = 0;
        paint();
        return false;
      }
      if (!down) pos.step(dt);
      press.step(dt);
      stretch.step(dt);
      flashS.step(dt);
      if (!down) stretch.target = clamp(pos.v * 0.012, -0.32, 0.32);
      paint();
      return down || !pos.settled() || !press.settled() || !stretch.settled() || flashS.x > 0.01;
    });
  });
}

/** @param {HTMLElement} phone */
function bindSliders(phone) {
  phone.querySelectorAll("[data-slider]").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const fill = node.querySelector(".lg-slider-fill");
    const thumb = node.querySelector(".lg-thumb");
    const flash = node.querySelector(".flash");
    const valEl = node.previousElementSibling?.querySelector("[data-val]");
    if (!(fill instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return;
    const fillEl = fill;
    const thumbEl = thumb;
    const min = Number(node.dataset.min ?? "0");
    const max = Number(node.dataset.max ?? "100");
    const suffix = node.dataset.suffix ?? "";
    let value = Number(node.dataset.value ?? String(min));
    const press = new Spring(1, 460, 16);
    const flashS = new Spring(0, 80, 14);
    const stretch = new Spring(0, 240, 14);
    let down = false;
    let lastX = 0;

    function paint() {
      const pct = ((value - min) / (max - min)) * 100;
      fillEl.style.width = `${pct}%`;
      const sx = 1 + Math.abs(stretch.x);
      const sy = 1 - Math.abs(stretch.x) * 0.5;
      thumbEl.style.left = `calc(${pct}% - 13px)`;
      thumbEl.style.transform = `scale(${press.x * sx}, ${press.x * sy})`;
      if (flash instanceof HTMLElement) flash.style.opacity = String(clamp(flashS.x, 0, 1));
      if (valEl) valEl.textContent = `${Math.round(value)}${suffix}`;
    }
    /** @param {number} clientX */
    function setFromClient(clientX) {
      const rect = node.getBoundingClientRect();
      const p = clamp((clientX - rect.left) / rect.width, 0, 1);
      value = min + p * (max - min);
      paint();
    }
    paint();
    node.addEventListener("pointerdown", (e) => {
      down = true;
      lastX = e.clientX;
      press.target = 1.2;
      flashS.x = 1;
      flashS.target = 0;
      setFromClient(e.clientX);
      node.setPointerCapture(e.pointerId);
      kick();
    });
    node.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      stretch.target = clamp(dx * 0.05, -0.4, 0.4);
      setFromClient(e.clientX);
      kick();
    });
    const release = () => {
      if (!down) return;
      down = false;
      press.target = 1;
      stretch.target = 0;
      kick();
    };
    node.addEventListener("pointerup", release);
    node.addEventListener("pointercancel", release);
    systems.push((dt) => {
      if (reduce) {
        press.x = 1;
        stretch.x = 0;
        flashS.x = 0;
        paint();
        return false;
      }
      press.step(dt);
      stretch.step(dt);
      flashS.step(dt);
      if (!down) stretch.target *= 0.001;
      paint();
      return down || !press.settled() || !stretch.settled() || flashS.x > 0.01 || Math.abs(stretch.x) > 0.01;
    });
  });
}

/** @param {HTMLElement} root */
function fit(root) {
  root.querySelectorAll(".slot").forEach((slot) => {
    if (!(slot instanceof HTMLElement)) return;
    const scaler = slot.querySelector(".scaler");
    const device = slot.querySelector(".device");
    if (!(scaler instanceof HTMLElement) || !(device instanceof HTMLElement)) return;
    const scale = slot.clientWidth / DEVICE_W;
    device.style.transform = `scale(${scale})`;
    scaler.style.height = `${DEVICE_H * scale}px`;
  });
}

export function liquidGlassMarkup() {
  return shell();
}

/** @param {HTMLElement} root */
export function mountLiquidGlass(root) {
  if (!root.querySelector(".studio")) root.innerHTML = shell();
  systems.length = 0;
  /** @type {Array<() => void>} */
  const snaps = [];
  root.querySelectorAll("[data-phone]").forEach((phone) => {
    if (!(phone instanceof HTMLElement)) return;
    const bar = phone.querySelector("[data-tabbar]");
    if (bar instanceof HTMLElement) {
      const snap = bindTabs(phone, bar);
      if (snap) snaps.push(snap);
    }
    bindButtons(phone);
    bindSwitches(phone);
    bindSliders(phone);
  });
  const refit = () => {
    fit(root);
    snaps.forEach((s) => s());
  };
  refit();
  const ro = new ResizeObserver(refit);
  ro.observe(root);
  window.addEventListener("resize", refit);
  return () => {
    cancelAnimationFrame(raf);
    running = false;
    systems.length = 0;
    ro.disconnect();
    window.removeEventListener("resize", refit);
    root.innerHTML = "";
  };
}
