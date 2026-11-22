// «Новый год» — a seasonal animated pack drawn from scratch for Cipherion. Like the other vector
// packs every sticker is a self-contained SVG with CSS keyframes that animates inside <img>;
// the "-still" twin is the poster and the reduced-motion frame. Run: node scripts/build-newyear-stickers.js
import {writeFileSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
const out='public/stickers-v5';
mkdirSync(out,{recursive:true});

const css=`<style>
.a{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.bob{animation-name:bob;animation-duration:2.4s}.shadow{animation-name:shadow;animation-duration:2.4s}
.wave{animation-name:wave;animation-duration:.8s;transform-origin:15% 90%}.blink{animation-name:blink;animation-duration:3.8s}
.twinkle{animation-name:twinkle;animation-duration:1.4s}.glow{animation-name:glow;animation-duration:1.6s}
.lid{animation-name:lid;animation-duration:2.2s;transform-origin:50% 100%}.spin{animation-name:spin;animation-duration:9s;animation-timing-function:linear}
.swing{animation-name:swing;animation-duration:2.6s;transform-origin:50% 0%}.steam{animation-name:steam;animation-duration:2.6s;animation-timing-function:ease-out}
.clinkL{animation-name:clinkL;animation-duration:1.6s;transform-origin:50% 100%}.clinkR{animation-name:clinkR;animation-duration:1.6s;transform-origin:50% 100%}
.rise{animation-name:rise;animation-duration:1.8s;animation-timing-function:ease-out}.burst{animation-name:burst;animation-duration:1.8s;animation-timing-function:ease-out}
.cross{animation-name:cross;animation-duration:3.4s;animation-timing-function:cubic-bezier(.3,0,.4,1)}.ear{animation-name:ear;animation-duration:2.2s}
.float{animation-name:float;animation-duration:3s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-10px) rotate(3deg)}}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:.25}50%{transform:scaleX(.82);opacity:.13}}
@keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-24deg)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.45);opacity:.35}}
@keyframes glow{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes lid{0%,55%,100%{transform:translateY(0) rotate(0)}70%{transform:translateY(-46px) rotate(-7deg)}82%{transform:translateY(-30px) rotate(4deg)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes swing{0%,100%{transform:rotate(9deg)}50%{transform:rotate(-9deg)}}
@keyframes steam{0%{transform:translateY(20px);opacity:0}30%{opacity:.85}100%{transform:translateY(-60px);opacity:0}}
@keyframes clinkL{0%,100%{transform:rotate(0)}45%{transform:rotate(14deg)}55%{transform:rotate(10deg)}}
@keyframes clinkR{0%,100%{transform:rotate(0)}45%{transform:rotate(-14deg)}55%{transform:rotate(-10deg)}}
@keyframes rise{0%{transform:translateY(0) scale(.5);opacity:0}25%{opacity:1}100%{transform:translateY(-110px) scale(1);opacity:0}}
@keyframes burst{0%{transform:scale(.15);opacity:0}25%{opacity:1}100%{transform:scale(1.12);opacity:0}}
@keyframes cross{0%{transform:translate(-200px,120px);opacity:0}15%{opacity:1}80%{opacity:1}100%{transform:translate(170px,-100px);opacity:0}}
@keyframes ear{0%,80%,100%{transform:rotate(0)}88%{transform:rotate(-12deg)}}
</style>`;
const still='<style>*{animation:none!important}</style>';
const svg=(body,{motion=true}={})=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${css}${motion?'':still}<defs>
<radialGradient id="snow" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4e2fb"/></radialGradient>
<linearGradient id="tree" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4bdc86"/><stop offset="1" stop-color="#138048"/></linearGradient>
<radialGradient id="red" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#ff7b7b"/><stop offset="1" stop-color="#c62a33"/></radialGradient>
<radialGradient id="gold" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#fff1b0"/><stop offset="1" stop-color="#f0ac35"/></radialGradient>
<radialGradient id="orange" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#ffcf70"/><stop offset=".65" stop-color="#ff951f"/><stop offset="1" stop-color="#e96b0c"/></radialGradient>
<radialGradient id="blue" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#c9e8ff"/><stop offset=".55" stop-color="#5aa8ff"/><stop offset="1" stop-color="#2c5fd6"/></radialGradient>
<radialGradient id="skin" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#ffe6d6"/><stop offset="1" stop-color="#f6b99c"/></radialGradient>
<radialGradient id="fur" cx="40%" cy="35%" r="80%"><stop offset="0" stop-color="#c58a57"/><stop offset="1" stop-color="#8a5530"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#ffd166" stop-opacity=".55"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
<radialGradient id="redhalo"><stop offset="0" stop-color="#ff4d4d" stop-opacity=".6"/><stop offset="1" stop-color="#ff4d4d" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></linearGradient>
<linearGradient id="fizz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset="1" stop-color="#f2b84b"/></linearGradient>
<linearGradient id="cocoa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b6440"/><stop offset="1" stop-color="#5c3420"/></linearGradient>
</defs>${body}</svg>`;

// ---------- helpers ----------
const shadow=(y=470,w=120)=>`<ellipse class="a shadow" cx="256" cy="${y}" rx="${w}" ry="16" fill="#000" opacity=".22"/>`;
const star=(cx,cy,R,r=R*.42)=>{const p=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,d=i%2?r:R;p.push(`${(cx+Math.cos(a)*d).toFixed(1)},${(cy+Math.sin(a)*d).toFixed(1)}`);}return p.join(' ');};
const sparkle=(x,y,s,color='#fff',delay=0)=>`<path class="a twinkle" style="animation-delay:${delay}s" d="M${x} ${y-s}Q${x+s*.18} ${y-s*.18} ${x+s} ${y}Q${x+s*.18} ${y+s*.18} ${x} ${y+s}Q${x-s*.18} ${y+s*.18} ${x-s} ${y}Q${x-s*.18} ${y-s*.18} ${x} ${y-s}z" fill="${color}"/>`;
const eyes=(y,gap=26,r=11,color='#1e2a40',x=256)=>`<g class="a blink"><circle cx="${x-gap}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x+gap}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x-gap+4}" cy="${y-4}" r="${r*.32}" fill="#fff"/><circle cx="${x+gap+4}" cy="${y-4}" r="${r*.32}" fill="#fff"/></g>`;
const cheeks=(y,gap=50,x=256)=>`<ellipse cx="${x-gap}" cy="${y}" rx="16" ry="10" fill="#ff8fa3" opacity=".6"/><ellipse cx="${x+gap}" cy="${y}" rx="16" ry="10" fill="#ff8fa3" opacity=".6"/>`;
const rays=(cx,cy,n,r1,r2,color,width=8)=>Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n,c=Math.cos(a),s=Math.sin(a);return `<path d="M${(cx+c*r1).toFixed(1)} ${(cy+s*r1).toFixed(1)}L${(cx+c*r2).toFixed(1)} ${(cy+s*r2).toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/><circle cx="${(cx+c*(r2+14)).toFixed(1)}" cy="${(cy+s*(r2+14)).toFixed(1)}" r="${width*.6}" fill="${color}"/>`;}).join('');
const glass=(fill)=>`<path d="M-52-150h104q4 118-52 140-56-22-52-140z" fill="#ffffff2e" stroke="#eaf4ff" stroke-width="7" stroke-linejoin="round"/><path d="M-48-96h96q-4 72-48 84-44-12-48-84z" fill="${fill}"/><path d="M0-10v96" stroke="#eaf4ff" stroke-width="9" stroke-linecap="round"/><ellipse cx="0" cy="90" rx="40" ry="10" fill="#eaf4ff"/><path d="M-34-138q-4 50 8 90" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".55" fill="none"/>`;
const flakeArm=`<path d="M256 256V92M256 142l-30-28M256 142l30-28M256 196l-24-20M256 196l24-20" stroke="#eaf6ff" stroke-width="18" stroke-linecap="round" fill="none"/><path d="M256 256V92M256 142l-30-28M256 142l30-28M256 196l-24-20M256 196l24-20" stroke="#7cc4ff" stroke-width="7" stroke-linecap="round" fill="none"/>`;

const stickers=[
 ['Привет','⛄',`${shadow(474,130)}<g class="a bob">
  <circle cx="256" cy="372" r="104" fill="url(#snow)"/><circle cx="256" cy="212" r="76" fill="url(#snow)"/>
  <path d="M160 338l-74-48M108 304l-26-2M108 304l-6-26" stroke="#7a4b2a" stroke-width="11" stroke-linecap="round" fill="none"/>
  <g class="a wave"><path d="M352 330l76-64M404 286l26 2M404 286l2-26" stroke="#7a4b2a" stroke-width="11" stroke-linecap="round" fill="none"/></g>
  <path d="M184 268q72 30 144 0l-4 30q-68 24-136 0z" fill="#e63946"/><path d="M296 282l22 74-30 6-16-70z" fill="#c62a33"/><path d="M300 300l18 4M304 318l18 4" stroke="#fff" stroke-width="5"/>
  <circle cx="256" cy="344" r="10" fill="#26324a"/><circle cx="256" cy="384" r="10" fill="#26324a"/><circle cx="256" cy="424" r="10" fill="#26324a"/>
  ${eyes(198,26,10)}<path d="M256 214l52 14-52 12z" fill="#ff8a1a"/>${cheeks(230,46)}
  ${[[226,246],[240,254],[256,257],[272,254],[286,246]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="5" fill="#26324a"/>`).join('')}
  <rect x="198" y="134" width="116" height="18" rx="8" fill="#26324a"/><rect x="216" y="62" width="80" height="80" rx="10" fill="#26324a"/><rect x="216" y="116" width="80" height="16" fill="#e63946"/><circle cx="292" cy="124" r="9" fill="#7fd08a"/></g>
  ${sparkle(110,150,16,'#cfe6ff',0)}${sparkle(410,170,12,'#cfe6ff',.6)}`],

 ['С Новым годом!','🎄',`${shadow(476,150)}<circle class="a glow" cx="256" cy="96" r="80" fill="url(#halo)"/>
  <rect x="230" y="410" width="52" height="54" rx="8" fill="#7a4b2a"/>
  <path d="M256 92l-96 126h44l-78 104h48l-92 118h348l-92-118h48l-78-104h44z" fill="url(#tree)" stroke="#0f6b3b" stroke-width="6" stroke-linejoin="round"/>
  <path d="M190 236q66 34 132-6M150 336q106 44 214-10M110 428q146 30 292-14" stroke="#ffd166" stroke-width="8" fill="none" stroke-linecap="round"/>
  ${[[206,244,'#ff5a6e',0],[256,256,'#6ab7ff',.3],[304,236,'#ffd166',.6],[176,344,'#6ab7ff',.9],[228,360,'#ff5a6e',.2],[282,360,'#ffd166',.5],[334,340,'#ff5a6e',.8],[146,430,'#ffd166',.4],[210,440,'#ff5a6e',1],[300,438,'#6ab7ff',.1],[366,424,'#ffd166',.7]].map(([x,y,c,d])=>`<circle class="a twinkle" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="12" fill="${c}"/>`).join('')}
  <circle cx="246" cy="190" r="15" fill="url(#red)"/><circle cx="196" cy="296" r="16" fill="url(#gold)"/><circle cx="318" cy="292" r="16" fill="url(#blue)"/><circle cx="262" cy="398" r="17" fill="url(#red)"/>
  <polygon class="a glow" points="${star(256,92,44)}" fill="url(#gold)" stroke="#e89a1c" stroke-width="5" stroke-linejoin="round"/>`],

 ['Подарок','🎁',`${shadow(474,130)}${sparkle(150,150,18,'#ffd166',.2)}${sparkle(370,120,14,'#ffd166',.7)}${sparkle(320,70,10,'#fff',1.1)}
  <rect x="152" y="252" width="208" height="196" rx="16" fill="url(#red)"/><rect x="236" y="252" width="40" height="196" fill="url(#gold)"/><rect x="152" y="252" width="208" height="22" fill="#00000022"/>
  <path d="M176 300l20 0M178 340l14 0M320 380l18 0M330 420l14 0" stroke="#ffffff55" stroke-width="8" stroke-linecap="round"/>
  <g class="a lid"><rect x="136" y="200" width="240" height="62" rx="14" fill="url(#red)"/><rect x="236" y="200" width="40" height="62" fill="url(#gold)"/>
  <path d="M256 198q-70-70-92-30t92 30zM256 198q70-70 92-30t-92 30z" fill="url(#gold)" stroke="#e0951f" stroke-width="5" stroke-linejoin="round"/><circle cx="256" cy="196" r="18" fill="#f0ac35"/></g>`],

 ['Ура!','🥂',`<circle class="a glow" cx="256" cy="120" r="70" fill="url(#halo)"/>
  ${[[214,250,0],[232,230,.6],[290,250,.3],[276,236,1.1],[300,226,.9]].map(([x,y,d])=>`<circle class="a rise" style="animation-delay:${d}s" cx="${x}" cy="${y}" r="7" fill="#fff6d0"/>`).join('')}
  <g class="a clinkL"><g transform="translate(196 300) rotate(-18)">${glass('url(#fizz)')}</g></g>
  <g class="a clinkR"><g transform="translate(316 300) rotate(18)">${glass('#ff9ec0')}</g></g>
  ${sparkle(256,116,30,'#fff',0)}${sparkle(214,84,14,'#ffd166',.5)}${sparkle(304,80,12,'#ffd166',.9)}`],

 ['Салют','🎆',`<g class="a burst" style="animation-delay:0s">${rays(176,170,12,22,92,'#ff6b9a')}</g>
  <g class="a burst" style="animation-delay:.6s">${rays(346,200,12,20,82,'#ffd166')}</g>
  <g class="a burst" style="animation-delay:1.2s">${rays(256,330,14,24,104,'#7cf2c4')}</g>
  ${sparkle(110,380,12,'#8ab8ff',.3)}${sparkle(420,360,14,'#ff6b9a',.8)}${sparkle(256,90,10,'#fff',1.3)}${sparkle(430,90,10,'#7cf2c4',.1)}`],

 ['Мандаринка','🍊',`${shadow(470,120)}<g class="a bob">
  <circle cx="256" cy="286" r="148" fill="url(#orange)"/>
  ${[[190,200],[320,210],[170,300],[350,320],[230,390],[300,380],[200,250],[330,270]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4" fill="#e97a10" opacity=".55"/>`).join('')}
  <ellipse cx="196" cy="208" rx="38" ry="22" fill="#fff" opacity=".35" transform="rotate(-30 196 208)"/>
  <path d="M256 146q-4-30 10-46" stroke="#4a7a23" stroke-width="12" stroke-linecap="round" fill="none"/>
  <g class="a float"><path d="M262 130q60-60 120-30-30 60-120 30z" fill="#4fb85a"/><path d="M270 126q50-14 96-22" stroke="#2f8a3c" stroke-width="5" fill="none" stroke-linecap="round"/></g>
  <path d="M206 276q20-22 40 0M266 276q20-22 40 0" stroke="#5a2a08" stroke-width="11" fill="none" stroke-linecap="round"/>${cheeks(306,64)}
  <path d="M226 318q30 34 60 0z" fill="#7a2a0a"/><path d="M240 330q16 10 32 0" stroke="#ff8fa3" stroke-width="8" stroke-linecap="round"/></g>`],

 ['Дед Мороз','🎅',`${shadow(476,130)}<g class="a bob">
  <path d="M152 236q-14 160 104 226 118-66 104-226z" fill="url(#snow)"/>
  <circle cx="256" cy="246" r="92" fill="url(#skin)"/>
  <path d="M150 236q4-170 160-150 70 10 92 90l-34 0q-20-60-60-70z" fill="url(#red)"/><g class="a float"><circle cx="404" cy="190" r="26" fill="url(#snow)"/></g>
  <rect x="142" y="208" width="228" height="44" rx="22" fill="url(#snow)"/>
  ${eyes(270,32,10)}<path d="M216 254q14-10 28 0M268 254q14-10 28 0" stroke="#e8eef8" stroke-width="8" stroke-linecap="round" fill="none"/>
  ${cheeks(300,56)}<circle cx="256" cy="300" r="20" fill="#ff9a86"/>
  <path d="M256 318q-30-18-70 8 30 24 70 0zM256 318q30-18 70 8-30 24-70 0z" fill="#fff"/><path d="M240 346q16 12 32 0" stroke="#c4475a" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M196 380q60 40 120 0M216 420q40 22 80 0" stroke="#dfe7f5" stroke-width="7" stroke-linecap="round" fill="none"/></g>`],

 ['Снежинка','❄️',`<circle cx="256" cy="256" r="160" fill="#6ab7ff" opacity=".12"/>
  <g class="a spin">${[0,60,120,180,240,300].map(a=>`<g transform="rotate(${a} 256 256)">${flakeArm}</g>`).join('')}<circle cx="256" cy="256" r="26" fill="#eaf6ff" stroke="#7cc4ff" stroke-width="7"/></g>
  ${sparkle(100,110,16,'#cfe6ff',0)}${sparkle(420,130,12,'#fff',.5)}${sparkle(420,400,16,'#cfe6ff',1)}${sparkle(96,400,12,'#fff',.8)}`],

 ['Тепло','☕',`${shadow(470,140)}
  ${[[220,0],[256,.8],[292,1.6]].map(([x,d])=>`<path class="a steam" style="animation-delay:${d}s" d="M${x} 200q-18-24 0-48t0-48" stroke="#ffffffcc" stroke-width="12" stroke-linecap="round" fill="none"/>`).join('')}
  <path d="M346 270q70-6 66 60t-74 60" stroke="#c62a33" stroke-width="26" fill="none" stroke-linecap="round"/>
  <path d="M156 236h200v160q0 60-60 60h-80q-60 0-60-60z" fill="url(#red)"/>
  <path d="M156 300h200v34h-200z" fill="#fff" opacity=".92"/>${[180,214,248,282,316].map(x=>`<path d="M${x} 300l14 17-14 17" stroke="#e63946" stroke-width="6" fill="none"/>`).join('')}
  <ellipse cx="256" cy="238" rx="100" ry="24" fill="url(#cocoa)"/>
  <g class="a float"><rect x="206" y="214" width="34" height="28" rx="9" fill="#fff"/><rect x="250" y="208" width="34" height="28" rx="9" fill="#ffe4ee"/><rect x="290" y="218" width="30" height="24" rx="8" fill="#fff"/></g>
  ${eyes(372,28,9)}${cheeks(392,52)}<path d="M244 392q12 10 24 0" stroke="#5a1a1a" stroke-width="7" stroke-linecap="round" fill="none"/>`],

 ['Шарик','🔴',`<g class="a swing"><path d="M256 0v150" stroke="#c9d6ee" stroke-width="5"/><path d="M240 136q16-30 32 0" stroke="#f0ac35" stroke-width="8" fill="none"/>
  <rect x="226" y="148" width="60" height="38" rx="8" fill="url(#gold)"/><path d="M234 156v22M248 156v22M262 156v22M276 156v22" stroke="#d28a1d" stroke-width="4"/>
  <circle cx="256" cy="310" r="132" fill="url(#blue)"/>
  <path d="M128 296l32-22 32 22 32-22 32 22 32-22 32 22 32-22 32 22" stroke="url(#gold)" stroke-width="12" fill="none" stroke-linejoin="round"/>
  <path d="M136 344l32 22 32-22 32 22 32-22 32 22 32-22 32 22 32-22" stroke="#ffffffaa" stroke-width="7" fill="none" stroke-linejoin="round"/>
  <ellipse cx="196" cy="236" rx="36" ry="22" fill="#fff" opacity=".55" transform="rotate(-35 196 236)"/>
  <polygon points="${star(256,410,22)}" fill="#fff7d6"/>
  ${sparkle(330,230,14,'#fff',.3)}</g>`],

 ['Олень','🦌',`${shadow(474,110)}<g class="a bob">
  <g stroke="#6b4226" stroke-width="18" stroke-linecap="round" fill="none"><path d="M206 178q-30-60-8-118M200 128q-44-8-62-52M206 92q-28-20-26-52"/><path d="M306 178q30-60 8-118M312 128q44-8 62-52M306 92q28-20 26-52"/></g>
  <g class="a ear"><ellipse cx="150" cy="216" rx="50" ry="22" fill="url(#fur)" transform="rotate(-24 150 216)"/><ellipse cx="152" cy="216" rx="30" ry="11" fill="#f0b8a0" transform="rotate(-24 152 216)"/></g>
  <g class="a ear" style="animation-delay:.3s"><ellipse cx="362" cy="216" rx="50" ry="22" fill="url(#fur)" transform="rotate(24 362 216)"/><ellipse cx="360" cy="216" rx="30" ry="11" fill="#f0b8a0" transform="rotate(24 360 216)"/></g>
  <ellipse cx="256" cy="282" rx="104" ry="122" fill="url(#fur)"/><ellipse cx="256" cy="352" rx="70" ry="54" fill="#ecc8a2"/>
  ${eyes(258,40,13)}${cheeks(306,66)}
  <circle class="a glow" cx="256" cy="330" r="46" fill="url(#redhalo)"/><circle cx="256" cy="330" r="24" fill="url(#red)"/><circle cx="248" cy="322" r="7" fill="#fff" opacity=".7"/>
  <path d="M236 372q20 16 40 0" stroke="#5a2a10" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M176 400q80 40 160 0l-6 28q-74 34-148 0z" fill="#2f9e6a"/><circle cx="216" cy="416" r="6" fill="#ffd166"/><circle cx="256" cy="424" r="6" fill="#ffd166"/><circle cx="296" cy="416" r="6" fill="#ffd166"/></g>`],

 ['Желание','🌠',`${sparkle(110,120,10,'#fff',0)}${sparkle(400,90,8,'#fff',.4)}${sparkle(430,300,10,'#cfe6ff',.9)}${sparkle(90,330,8,'#fff',1.2)}${sparkle(300,420,10,'#cfe6ff',.6)}${sparkle(180,440,7,'#fff',1.5)}
  <g class="a cross"><path d="M290 220L96 360l-14-22z" fill="url(#trail)" opacity=".9"/><path d="M286 236L120 384l-6-10z" fill="url(#trail)" opacity=".55"/>
  <circle class="a glow" cx="300" cy="214" r="74" fill="url(#halo)"/><polygon points="${star(300,214,52)}" fill="url(#gold)" stroke="#e89a1c" stroke-width="5" stroke-linejoin="round"/>
  <path d="M286 220q14 12 28 0" stroke="#7a4a08" stroke-width="6" stroke-linecap="round" fill="none"/><circle cx="286" cy="204" r="5" fill="#7a4a08"/><circle cx="314" cy="204" r="5" fill="#7a4a08"/></g>`]
];

const pack=stickers.map(([label,emoji])=>({label,emoji}));
stickers.forEach(([,,body],n)=>{const name=`ny-${String(n).padStart(2,'0')}`;writeFileSync(`${out}/${name}.svg`,svg(body));writeFileSync(`${out}/${name}-still.svg`,svg(body,{motion:false}));});
// packs.json holds every seasonal pack: keep the others when this one is rebuilt.
const packs=existsSync(`${out}/packs.json`)?JSON.parse(readFileSync(`${out}/packs.json`,'utf8')):{};
writeFileSync(`${out}/packs.json`,JSON.stringify({...packs,newyear:pack},null,2)+'\n');
console.log(`Wrote ${stickers.length} stickers to ${out}`);
