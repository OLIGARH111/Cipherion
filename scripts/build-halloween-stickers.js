// «Хэллоуин» — a seasonal animated pack drawn from scratch for Cipherion. Like the other vector
// packs every sticker is a self-contained SVG with CSS keyframes that animates inside <img>;
// the "-still" twin is the poster and the reduced-motion frame. Run: node scripts/build-halloween-stickers.js
import {writeFileSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
const out='public/stickers-v5';
mkdirSync(out,{recursive:true});

const css=`<style>
.a{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.bob{animation-name:bob;animation-duration:2.4s}.float{animation-name:float;animation-duration:3s}
.shadow{animation-name:shadow;animation-duration:2.4s}.shadowf{animation-name:shadow;animation-duration:3s}
.glow{animation-name:glow;animation-duration:1.6s}.wave{animation-name:wave;animation-duration:.7s;transform-origin:20% 90%}
.flapL{animation-name:flapL;animation-duration:.36s;transform-origin:100% 40%}.flapR{animation-name:flapR;animation-duration:.36s;transform-origin:0% 40%}
.tail{animation-name:tail;animation-duration:1.8s;transform-origin:0% 100%}.blink{animation-name:blink;animation-duration:3.6s}
.twinkle{animation-name:twinkle;animation-duration:1.4s}.spin{animation-name:spin;animation-duration:3.2s}
.jaw{animation-name:jaw;animation-duration:.5s}.dangle{animation-name:dangle;animation-duration:2.6s;transform-origin:50% 0%}
.rise{animation-name:rise;animation-duration:2.2s;animation-timing-function:ease-out}.flicker{animation-name:flicker;animation-duration:.45s;transform-origin:50% 100%}
.wobble{animation-name:wobble;animation-duration:1.6s;transform-origin:50% 100%}.cross{animation-name:cross;animation-duration:4s;animation-timing-function:linear}
.legs{animation-name:legs;animation-duration:.4s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-22px) rotate(2deg)}}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:.25}50%{transform:scaleX(.8);opacity:.12}}
@keyframes glow{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-22deg)}}
@keyframes flapL{0%,100%{transform:rotate(0) scaleY(1)}50%{transform:rotate(18deg) scaleY(.7)}}
@keyframes flapR{0%,100%{transform:rotate(0) scaleY(1)}50%{transform:rotate(-18deg) scaleY(.7)}}
@keyframes tail{0%,100%{transform:rotate(0)}50%{transform:rotate(14deg)}}
@keyframes blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.5);opacity:.4}}
@keyframes spin{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(14deg)}}
@keyframes jaw{0%,100%{transform:translateY(0)}50%{transform:translateY(12px)}}
@keyframes dangle{0%,100%{transform:translateY(0) rotate(4deg)}50%{transform:translateY(34px) rotate(-4deg)}}
@keyframes rise{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(-120px) scale(1.1);opacity:0}}
@keyframes flicker{0%,100%{transform:scale(1,1) rotate(-2deg)}50%{transform:scale(.9,1.12) rotate(3deg)}}
@keyframes wobble{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes cross{0%{transform:translate(-260px,40px)}100%{transform:translate(260px,-40px)}}
@keyframes legs{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.92)}}
</style>`;
const still='<style>*{animation:none!important}</style>';
const svg=(body,{motion=true}={})=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${css}${motion?'':still}<defs>
<radialGradient id="pump" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffb04d"/><stop offset=".7" stop-color="#ff7a1a"/><stop offset="1" stop-color="#d9550b"/></radialGradient>
<radialGradient id="ghost" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d2f5"/></radialGradient>
<radialGradient id="fire" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff6c2"/><stop offset=".5" stop-color="#ffc23d"/><stop offset="1" stop-color="#ff7a1a"/></radialGradient>
<radialGradient id="moon" cx="40%" cy="40%" r="60%"><stop offset="0" stop-color="#fff3cf"/><stop offset="1" stop-color="#ffc861"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#ffc23d" stop-opacity=".45"/><stop offset="1" stop-color="#ffc23d" stop-opacity="0"/></radialGradient>
<linearGradient id="slime" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8f06a"/><stop offset="1" stop-color="#4fae2d"/></linearGradient>
<linearGradient id="purple" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#4c1d95"/></linearGradient>
</defs>${body}</svg>`;
const shadow=(cls='shadow',y=470,w=120)=>`<ellipse class="a ${cls}" cx="256" cy="${y}" rx="${w}" ry="16" fill="#000" opacity=".22"/>`;
const face=(y=0)=>`<g transform="translate(0 ${y})"><path class="a glow" d="M186 236l34-40 34 40zM258 236l34-40 34 40z" fill="#3b1600"/><path class="a glow" d="M170 290q86 70 172 0l-20 6-16-16-20 20-20-20-20 20-20-20-20 20-16-16z" fill="#3b1600"/></g>`;
const pumpkin=`<g><path d="M256 140c-8-30 4-52 26-60" stroke="#4a7a23" stroke-width="18" fill="none" stroke-linecap="round"/><ellipse cx="180" cy="270" rx="96" ry="120" fill="url(#pump)"/><ellipse cx="332" cy="270" rx="96" ry="120" fill="url(#pump)"/><ellipse cx="256" cy="270" rx="92" ry="128" fill="url(#pump)"/><path d="M256 146v248M196 156q-30 110 0 230M316 156q30 110 0 230" stroke="#c94f0a" stroke-width="5" fill="none" opacity=".5"/></g>`;

const stickers=[
 ['Привет','🎃',`${shadow()}<g class="a bob">${pumpkin}${face()}<path class="a wave" d="M372 300q40-30 62-80" stroke="#4a7a23" stroke-width="16" fill="none" stroke-linecap="round"/><circle class="a wave" cx="436" cy="214" r="18" fill="#6aa83a"/></g>`],
 ['Бу!','👻',`${shadow('shadowf',474,100)}<g class="a float"><path d="M156 250q0-130 100-130t100 130v170l-34-26-33 30-33-30-33 30-33-30-34 26z" fill="url(#ghost)"/><ellipse class="a blink" cx="220" cy="236" rx="16" ry="24" fill="#1e1530"/><ellipse class="a blink" cx="292" cy="236" rx="16" ry="24" fill="#1e1530"/><ellipse cx="256" cy="300" rx="26" ry="32" fill="#1e1530"/><path class="a wave" d="M352 280q50-10 70-60" stroke="#e9e4fb" stroke-width="30" fill="none" stroke-linecap="round"/></g><text x="380" y="140" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="72" fill="#c4b5fd" class="a twinkle">БУ!</text>`],
 ['Мышка','🦇',`<g class="a bob"><path class="a flapL" d="M236 250q-60-80-200-60 50 30 40 90 30-26 60-6 10-30 40-10 20-30 60-14z" fill="#5b3f8a" stroke="#c4b5fd" stroke-width="5" stroke-linejoin="round"/><path class="a flapR" d="M276 250q60-80 200-60-50 30-40 90-30-26-60-6-10-30-40-10-20-30-60-14z" fill="#5b3f8a" stroke="#c4b5fd" stroke-width="5" stroke-linejoin="round"/><path d="M222 214l-8-40 30 28zM290 214l8-40-30 28z" fill="#7a5bb0"/><ellipse cx="256" cy="262" rx="46" ry="58" fill="#7a5bb0"/><ellipse cx="256" cy="282" rx="26" ry="30" fill="#9c80cc"/><circle cx="238" cy="250" r="9" fill="#ffcc4d"/><circle cx="274" cy="250" r="9" fill="#ffcc4d"/><path d="M244 284l6 12 6-12M256 284l6 12 6-12" fill="#fff"/></g>`],
 ['Кот','🐈‍⬛',`${shadow('shadow',462,110)}<g class="a tail"><path d="M330 410q90 0 80-90t40-110" stroke="#8a78a8" stroke-width="40" fill="none" stroke-linecap="round"/><path d="M330 410q90 0 80-90t40-110" stroke="#2b2238" stroke-width="28" fill="none" stroke-linecap="round"/></g><g class="a wobble"><g stroke="#8a78a8" stroke-width="6" stroke-linejoin="round"><path d="M176 440q-20-140 80-160 100 20 80 160z" fill="#2b2238"/><path d="M182 196l-6-76 64 44zM330 196l6-76-64 44z" fill="#2b2238"/><circle cx="256" cy="230" r="86" fill="#2b2238"/></g><path d="M190 186l-2-44 34 26zM322 186l2-44-34 26z" fill="#ff9ec7" opacity=".6"/><g class="a blink"><ellipse cx="222" cy="232" rx="22" ry="26" fill="#c8f25a"/><ellipse cx="290" cy="232" rx="22" ry="26" fill="#c8f25a"/><ellipse cx="222" cy="232" rx="6" ry="20" fill="#111"/><ellipse cx="290" cy="232" rx="6" ry="20" fill="#111"/></g><path d="M246 270l10 10 10-10z" fill="#ff9ec7"/><path d="M196 276h-60M196 286l-56 14M316 276h60M316 286l56 14" stroke="#7d6e91" stroke-width="4" stroke-linecap="round"/></g>`],
 ['Колдую','🧙',`${shadow('shadow',462,140)}<g class="a bob"><ellipse cx="256" cy="380" rx="170" ry="40" fill="url(#purple)"/><path d="M160 380q40-140 130-260 40-30 60 10-60 20-60 90l20 160z" fill="url(#purple)"/><path d="M168 350q88 26 188 0l6 30q-100 26-200 0z" fill="#ff8a2b"/><rect x="240" y="340" width="40" height="40" rx="6" fill="#ffd166"/><rect x="250" y="350" width="20" height="20" rx="3" fill="#4c1d95"/></g><g fill="#ffd166"><path class="a twinkle" d="M110 150l8 20 20 8-20 8-8 20-8-20-20-8 20-8z"/><path class="a twinkle" style="animation-delay:.5s" d="M400 120l6 15 15 6-15 6-6 15-6-15-15-6 15-6z"/><path class="a twinkle" style="animation-delay:.9s" d="M420 260l5 12 12 5-12 5-5 12-5-12-12-5 12-5z"/></g>`],
 ['Сладость','🍬',`${shadow()}<g class="a spin"><path d="M150 256l-80-56v112zM362 256l80-56v112z" fill="#ff5fa2"/><path d="M150 256l-80-56M150 256l-80 56M362 256l80-56M362 256l80 56" stroke="#d63c84" stroke-width="6"/><circle cx="256" cy="256" r="110" fill="#ff7fb6"/><path d="M256 146a110 110 0 0 1 0 220M200 160q60 96 0 192M312 160q-60 96 0 192" stroke="#fff" stroke-width="22" fill="none" opacity=".9"/><circle cx="216" cy="210" r="18" fill="#fff" opacity=".6"/></g>`],
 ['Ха-ха','💀',`${shadow()}<g class="a bob"><path d="M150 230q0-120 106-120t106 120q0 50-30 70h-152q-30-20-30-70z" fill="#f4f1ea"/><ellipse cx="212" cy="230" rx="32" ry="36" fill="#1e1530"/><ellipse cx="300" cy="230" rx="32" ry="36" fill="#1e1530"/><circle class="a glow" cx="212" cy="236" r="8" fill="#ff8a2b"/><circle class="a glow" cx="300" cy="236" r="8" fill="#ff8a2b"/><path d="M244 288l12-22 12 22z" fill="#1e1530"/><g class="a jaw"><path d="M180 312h152q0 70-76 70t-76-70z" fill="#e8e3d8"/><path d="M206 312v30M232 312v36M256 312v38M280 312v36M306 312v30" stroke="#1e1530" stroke-width="6"/></g></g>`],
 ['Паучок','🕷️',`<path d="M256 0v140" stroke="#c9c2dd" stroke-width="4"/><g class="a dangle"><path d="M256 0v170" stroke="#c9c2dd" stroke-width="4"/><g class="a legs" stroke="#4a3570" stroke-width="12" fill="none" stroke-linecap="round"><path d="M220 230q-60-40-90 0M220 250q-70-10-100 40M222 270q-60 20-70 80M226 286q-40 40-30 90M292 230q60-40 90 0M292 250q70-10 100 40M290 270q60 20 70 80M286 286q40 40 30 90"/></g><ellipse cx="256" cy="270" rx="62" ry="70" fill="#5b3f8a" stroke="#c4b5fd" stroke-width="5"/><circle cx="256" cy="200" r="40" fill="#7a5bb0" stroke="#c4b5fd" stroke-width="5"/><circle cx="242" cy="196" r="10" fill="#fff"/><circle cx="270" cy="196" r="10" fill="#fff"/><circle class="a blink" cx="244" cy="198" r="5" fill="#111"/><circle class="a blink" cx="272" cy="198" r="5" fill="#111"/><path d="M226 254l60 0M236 284h40" stroke="#ff8a2b" stroke-width="8" stroke-linecap="round"/></g>`],
 ['Зелье','🧪',`${shadow('shadow',470,150)}<g><circle class="a rise" cx="216" cy="190" r="18" fill="#b8f06a"/><circle class="a rise" style="animation-delay:.7s" cx="280" cy="200" r="14" fill="#b8f06a"/><circle class="a rise" style="animation-delay:1.3s" cx="250" cy="180" r="22" fill="#9be15d"/><path d="M110 236h292l-20 30q30 70-16 140-50 50-110 50t-110-50q-46-70-16-140z" fill="#2b2238" stroke="#8a78a8" stroke-width="6"/><ellipse cx="256" cy="240" rx="140" ry="26" fill="url(#slime)"/><path d="M150 246q20 30 0 60M360 246q-20 30 0 60" stroke="#9be15d" stroke-width="14" stroke-linecap="round"/><path d="M150 450l-20 30M362 450l20 30" stroke="#1d1626" stroke-width="20" stroke-linecap="round"/><path class="a flicker" d="M200 470q-10-40 20-60 0 30 20 30 0-30 20-50 20 40 10 80z" fill="url(#fire)"/></g>`],
 ['Спокойной ночи','🌕',`<circle cx="256" cy="256" r="150" fill="url(#moon)"/><circle cx="210" cy="210" r="26" fill="#f2c45a" opacity=".6"/><circle cx="310" cy="300" r="34" fill="#f2c45a" opacity=".5"/><circle cx="300" cy="190" r="14" fill="#f2c45a" opacity=".6"/><path d="M196 270q20 18 40 0M276 270q20 18 40 0" stroke="#a86a12" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M236 320q20 12 40 0" stroke="#a86a12" stroke-width="8" fill="none" stroke-linecap="round"/><g class="a cross"><path d="M246 236q-20-24-60-18 14 8 12 24 10-8 20-2 4-8 12-2 8-8 16-2zM266 236q20-24 60-18-14 8-12 24-10-8-20-2-4-8-12-2-8-8-16-2z" fill="#1d1626"/><ellipse cx="256" cy="238" rx="12" ry="14" fill="#1d1626"/></g><text x="370" y="120" font-family="Arial,sans-serif" font-size="56" fill="#ffd166" class="a twinkle">z</text>`],
 ['Свеча','🕯️',`${shadow('shadow',460,90)}<path d="M200 220h112v220h-112z" fill="#f4ede0"/><path d="M200 220q20 40 0 80M312 220q-14 50 0 100M250 220q10 30-4 50" stroke="#e4d8c2" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M256 220v-20" stroke="#3b2b1a" stroke-width="6"/><g class="a flicker"><path d="M256 92q-46 60-30 96 10 20 30 20t30-20q16-36-30-96z" fill="url(#fire)"/><ellipse cx="256" cy="176" rx="12" ry="20" fill="#fff6c2"/></g><circle class="a glow" cx="256" cy="160" r="120" fill="url(#halo)"/>`],
 ['Мумия','🧟',`${shadow()}<g class="a wobble"><rect x="166" y="120" width="180" height="320" rx="90" fill="#efe6d2"/><path d="M166 190l180-30M166 240l180 20M170 300l176-40M170 350l170 20M176 400l160-30" stroke="#cfc2a6" stroke-width="16" stroke-linecap="round"/><rect x="186" y="200" width="140" height="44" rx="22" fill="#1e1530"/><g class="a blink"><circle cx="226" cy="222" r="14" fill="#c8f25a"/><circle cx="286" cy="222" r="10" fill="#c8f25a"/></g><path class="a wave" d="M346 300q50-20 70-60" stroke="#efe6d2" stroke-width="34" fill="none" stroke-linecap="round"/><path d="M420 236l20-20" stroke="#cfc2a6" stroke-width="10" stroke-linecap="round"/></g>`],
];

const pack=stickers.map(([label,emoji])=>({label,emoji}));
stickers.forEach(([,,body],n)=>{const name=`hw-${String(n).padStart(2,'0')}`;writeFileSync(`${out}/${name}.svg`,svg(body));writeFileSync(`${out}/${name}-still.svg`,svg(body,{motion:false}));});
// packs.json holds every seasonal pack: keep the others when this one is rebuilt.
const packs=existsSync(`${out}/packs.json`)?JSON.parse(readFileSync(`${out}/packs.json`,'utf8')):{};
writeFileSync(`${out}/packs.json`,JSON.stringify({...packs,halloween:pack},null,2)+'\n');
console.log(`Wrote ${stickers.length} stickers to ${out}`);
