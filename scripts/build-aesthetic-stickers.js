// Original animated vector stickers: «Облачко Мими», «Аура» and «Слова».
// Every sticker is a self-contained SVG (CSS keyframes + a little SMIL), so it animates inside <img>
// without scripts. A "-still" twin with animation removed is used as a poster and for reduced motion.
import {writeFileSync,mkdirSync} from 'node:fs';
const out='public/stickers-v3';
mkdirSync(out,{recursive:true});

const css=`<style>
.a{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.bob{animation-name:bob;animation-duration:2.6s}.shadow{animation-name:shadow;animation-duration:2.6s}
.breathe{animation-name:breathe;animation-duration:3.6s;transform-origin:50% 100%}
.blink{animation-name:blink;animation-duration:4.2s}.pulse{animation-name:pulse;animation-duration:1.1s}
.twinkle{animation-name:twinkle;animation-duration:1.8s}.rise{animation-name:rise;animation-duration:2.8s;animation-timing-function:ease-out}
.wave{animation-name:wave;animation-duration:.9s}.shake{animation-name:shake;animation-duration:.35s}
.laugh{animation-name:laugh;animation-duration:.5s}.drip{animation-name:drip;animation-duration:1.3s;animation-timing-function:ease-in}
.spin{animation-name:spin;animation-duration:9s;animation-timing-function:linear}.sway{animation-name:sway;animation-duration:3s}
.flap{animation-name:flap;animation-duration:.7s}.flicker{animation-name:flicker;animation-duration:.6s;transform-origin:50% 100%}
.steam{animation-name:steam;animation-duration:2.4s;animation-timing-function:ease-out}.bow{animation-name:bow;animation-duration:2.4s}
.pop{animation-name:pop;animation-duration:2.8s}.fall{animation-name:fall;animation-duration:2.2s;animation-timing-function:linear}
.ring{animation-name:ring;animation-duration:2.2s;animation-timing-function:ease-out}.draw{animation-name:draw;animation-duration:3.2s}
.drift{animation-name:drift;animation-duration:6s}.glow{animation-name:glow;animation-duration:1.8s}
.wobble{animation-name:wobble;animation-duration:2.2s}.slide{animation-name:slide;animation-duration:2.8s;animation-timing-function:linear}
.hop{animation-name:hop;animation-duration:1.2s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:.18}50%{transform:scaleX(.82);opacity:.1}}
@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}
@keyframes blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
@keyframes pulse{0%,100%{transform:scale(1)}30%{transform:scale(1.14)}55%{transform:scale(.97)}}
@keyframes twinkle{0%,100%{transform:scale(.35) rotate(0);opacity:.2}50%{transform:scale(1) rotate(25deg);opacity:1}}
@keyframes rise{0%{transform:translateY(30px) scale(.4);opacity:0}25%{opacity:1}100%{transform:translateY(-150px) scale(1.05);opacity:0}}
@keyframes wave{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(26deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
@keyframes laugh{0%,100%{transform:rotate(-3deg) translateY(0)}50%{transform:rotate(3deg) translateY(-8px)}}
@keyframes drip{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(70px) scale(1);opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes sway{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}
@keyframes flap{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.35)}}
@keyframes flicker{0%,100%{transform:scale(1,1) skewX(0)}33%{transform:scale(.94,1.08) skewX(3deg)}66%{transform:scale(1.04,.95) skewX(-3deg)}}
@keyframes steam{0%{transform:translateY(10px);opacity:0}30%{opacity:.85}100%{transform:translateY(-60px);opacity:0}}
@keyframes bow{0%,20%,100%{transform:rotate(0)}45%,70%{transform:rotate(14deg)}}
@keyframes pop{0%{transform:scale(0);opacity:0}18%{transform:scale(1.15);opacity:1}28%,82%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes fall{0%{transform:translateY(-60px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(200px) rotate(320deg);opacity:0}}
@keyframes ring{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.5);opacity:0}}
@keyframes draw{0%{stroke-dashoffset:600}45%,85%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
@keyframes drift{0%,100%{transform:translateX(-12px)}50%{transform:translateX(12px)}}
@keyframes glow{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.08)}}
@keyframes wobble{0%,100%{transform:rotate(-3deg) scale(1)}50%{transform:rotate(3deg) scale(1.04)}}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-120px)}}
@keyframes hop{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.06,.94)}50%{transform:translateY(-26px) scale(.97,1.03)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;
const still='<style>*{animation:none!important}</style>';
const svg=(body,defs='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${css}<defs>${defs}</defs>${body}</svg>`;
const anim=(cls,body,{delay=0,origin,dur}={})=>`<g class="a ${cls}" style="${delay?`animation-delay:${delay}s;`:''}${dur?`animation-duration:${dur}s;`:''}${origin?`transform-box:view-box;transform-origin:${origin};`:''}">${body}</g>`;
const at=(x,y,s,body,r=0)=>`<g transform="translate(${x} ${y})${r?` rotate(${r})`:''}${s!==1?` scale(${s})`:''}">${body}</g>`;
const heartD='M0 10C0-4-20-12-22 4-23 16-8 24 0 34 8 24 23 16 22 4 20-12 0-4 0 10Z';
const sparkD='M0-24C3-4 4-3 24 0 4 3 3 4 0 24-3 4-4 3-24 0-4-3-3-4 0-24Z';
const heart=(x,y,s,fill='#ff6b9a')=>at(x,y,s,`<path d="${heartD}" fill="${fill}"/>`);
const spark=(x,y,s,fill='#ffd36e')=>at(x,y,s,`<path d="${sparkD}" fill="${fill}"/>`);
const twinkles=(list,fill)=>list.map(([x,y,s],i)=>anim('twinkle',spark(x,y,s,fill),{delay:i*.45})).join('');
const rising=(list,fill)=>list.map(([x,y,s],i)=>anim('rise',heart(x,y,s,fill),{delay:i*.7})).join('');

/* ---------------- «Облачко Мими» ---------------- */
const INK='#3a2d5c';
function mimiDefs(top='#ffffff',mid='#f4ecff',edge='#d8c6ff'){
  return `<radialGradient id="mb" gradientUnits="userSpaceOnUse" cx="220" cy="220" r="260"><stop offset="0" stop-color="${top}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${edge}"/></radialGradient>
<linearGradient id="cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9e6"/><stop offset="1" stop-color="#ff9fbf"/></linearGradient>
<linearGradient id="hat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ee7ff"/><stop offset="1" stop-color="#b590ff"/></linearGradient>
<radialGradient id="hrt" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffc4d8"/><stop offset=".55" stop-color="#ff6b9a"/><stop offset="1" stop-color="#e2407a"/></radialGradient>`;
}
const cloudShapes=`<circle cx="170" cy="300" r="82"/><circle cx="256" cy="240" r="108"/><circle cx="342" cy="300" r="82"/><rect x="150" y="280" width="212" height="120" rx="60"/>`;
const cloud=(stroke='#c7b2f4')=>`<g fill="${stroke}" stroke="${stroke}" stroke-width="16" stroke-linejoin="round">${cloudShapes}</g><g fill="url(#mb)">${cloudShapes}</g><ellipse cx="205" cy="190" rx="34" ry="18" fill="#fff" opacity=".85" transform="rotate(-25 205 190)"/>`;
const arm=(x,y,r=0)=>`<ellipse cx="${x}" cy="${y}" rx="26" ry="19" transform="rotate(${r} ${x} ${y})" fill="url(#mb)" stroke="#c7b2f4" stroke-width="8"/>`;
const eye={
  open:(x,y)=>anim('blink',`<ellipse cx="${x}" cy="${y}" rx="14" ry="19" fill="${INK}"/><circle cx="${x-4}" cy="${y-7}" r="5.5" fill="#fff"/><circle cx="${x+5}" cy="${y+6}" r="2.5" fill="#fff" opacity=".8"/>`),
  up:(x,y)=>anim('blink',`<ellipse cx="${x}" cy="${y}" rx="14" ry="19" fill="${INK}"/><circle cx="${x+3}" cy="${y-10}" r="5.5" fill="#fff"/>`),
  happy:(x,y)=>`<path d="M${x-16} ${y+5}Q${x} ${y-15} ${x+16} ${y+5}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  closed:(x,y)=>`<path d="M${x-16} ${y-2}Q${x} ${y+12} ${x+16} ${y-2}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  heart:(x,y)=>anim('pulse',heart(x,y-14,.85,'url(#hrt)')),
  angry:(x,y,left)=>`<ellipse cx="${x}" cy="${y+4}" rx="12" ry="15" fill="${INK}"/><circle cx="${x-3}" cy="${y-2}" r="4" fill="#fff"/><path d="M${x-20} ${y+(left?-24:-14)}L${x+20} ${y+(left?-14:-24)}" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`,
};
const mouth={
  smile:`<path d="M240 318Q256 334 272 318" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
  open:`<path d="M234 314Q256 360 278 314Z" fill="#7a3456" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M244 336Q256 330 268 336Q262 348 256 348Q250 348 244 336Z" fill="#ff8fae"/>`,
  sad:`<path d="M240 332Q256 316 272 332" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
  o:`<ellipse cx="256" cy="326" rx="8" ry="10" fill="#7a3456"/>`,
  cat:`<path d="M238 318Q247 330 256 318Q265 330 274 318" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  grr:`<path d="M238 332Q256 318 274 332" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
};
const blush=(o=.75)=>`<ellipse cx="196" cy="326" rx="20" ry="11" fill="#ffadc6" opacity="${o}"/><ellipse cx="316" cy="326" rx="20" ry="11" fill="#ffadc6" opacity="${o}"/>`;
const face=(l,r,m,extra='')=>`${eye[l](222,288,true)}${eye[r](290,288,false)}${blush()}${mouth[m]}${extra}`;
const shadow=`${anim('shadow',`<ellipse cx="256" cy="440" rx="130" ry="16" fill="#6b4bb8"/>`)}`;
function mimi({face:f,arms=[arm(150,352,-20),arm(362,352,20)],front='',back='',over='',body='bob',defs}){
  return svg(`${shadow}${back}${anim(body,`${arms.join('')}${cloud()}${f}${front}`)}${over}`,defs||mimiDefs());
}
const zzz=[0,1,2].map(i=>anim('rise',`<text x="${360+i*22}" y="${190-i*10}" font-family="system-ui,sans-serif" font-weight="900" font-size="${34+i*8}" fill="#9d86e6">z</text>`,{delay:i*.8})).join('');
const confetti=[[90,40,'#ff8fb3',0],[160,20,'#8fd8ff',.5],[330,30,'#ffd36e',1],[420,60,'#b590ff',.3],[250,10,'#7ee0b5',1.2],[60,110,'#ffd36e',1.6],[450,130,'#ff8fb3',.9]]
  .map(([x,y,c,d],i)=>anim('fall',`<rect x="${x}" y="${y}" width="${i%2?14:10}" height="${i%2?8:18}" rx="3" fill="${c}"/>`,{delay:d})).join('');
const mimiSet=[
  ['Привет',mimi({face:face('open','open','open'),arms:[arm(150,352,-20),anim('wave',arm(424,226,-40),{origin:'392px 268px'})],over:twinkles([[420,150,1],[90,170,.7],[440,300,.55]],'#ffd36e')})],
  ['Люблю',mimi({face:face('heart','heart','smile'),front:anim('pulse',at(256,372,2.1,`<path d="${heartD}" fill="url(#hrt)" stroke="#fff" stroke-width="3"/>`)),arms:[arm(206,400,-50),arm(306,400,50)],over:rising([[110,250,1.2],[400,230,1],[160,170,.8],[360,150,.9]],'#ff7aa6')})],
  ['Ахаха',mimi({body:'laugh',face:face('happy','happy','open',`${anim('drip',`<ellipse cx="190" cy="286" rx="8" ry="11" fill="#8fd8ff"/>`)}${anim('drip',`<ellipse cx="322" cy="286" rx="8" ry="11" fill="#8fd8ff"/>`,{delay:.6})}`),over:`<g font-family="system-ui,sans-serif" font-weight="900" fill="#b590ff">${anim('pop',`<text x="370" y="150" font-size="44" transform="rotate(14 370 150)">ха</text>`)}${anim('pop',`<text x="70" y="170" font-size="36" transform="rotate(-14 70 170)">ха</text>`,{delay:.5})}</g>`})],
  ['Плачу',mimi({defs:mimiDefs('#ffffff','#eef2ff','#c3cdf7'),face:face('closed','closed','sad',`<path d="M206 294q-8 30 0 60M306 294q8 30 0 60" stroke="#8fd8ff" stroke-width="12" stroke-linecap="round" opacity=".85"/>${anim('drip',`<ellipse cx="200" cy="360" rx="9" ry="12" fill="#8fd8ff"/>`)}${anim('drip',`<ellipse cx="312" cy="360" rx="9" ry="12" fill="#8fd8ff"/>`,{delay:.5})}`),
    over:anim('drift',`<g fill="#b9c3e6"><circle cx="230" cy="80" r="30"/><circle cx="268" cy="66" r="36"/><circle cx="304" cy="84" r="26"/><rect x="200" y="80" width="130" height="30" rx="15"/></g>${[0,1,2].map(i=>anim('drip',`<path d="M${236+i*30} 118q-6 10 0 16q6-6 0-16Z" fill="#8fd8ff"/>`,{delay:i*.4})).join('')}`)})],
  ['Злюсь',mimi({body:'shake',defs:mimiDefs('#fff3f3','#ffd9d9','#ff9a9a'),face:face('angry','angry','grr').replace(/#ffadc6/g,'#ff7b7b'),
    over:[[150,150,0],[362,150,.5]].map(([x,y,d])=>anim('steam',`<g fill="#e9e3f5"><circle cx="${x}" cy="${y}" r="20"/><circle cx="${x+18}" cy="${y-16}" r="16"/><circle cx="${x-14}" cy="${y-20}" r="13"/></g>`,{delay:d})).join('')+`<g fill="#ff5d6c">${anim('pulse',`<path d="M392 210l18-18m-6 30 22-4m-40-34 2-22" stroke="#ff5d6c" stroke-width="9" stroke-linecap="round"/>`)}</g>`})],
  ['Сплю',mimi({body:'breathe',face:face('closed','closed','o'),back:`<path d="M110 110A56 56 0 1 0 160 190A46 46 0 0 1 110 110Z" fill="#ffe08a"/>`+twinkles([[160,90,.5],[60,220,.4]],'#ffe08a'),
    front:`<path d="M300 150Q340 60 410 120L380 170Z" fill="url(#hat)" stroke="#9b85e8" stroke-width="5" stroke-linejoin="round"/><circle cx="414" cy="118" r="16" fill="#fff" stroke="#c7b2f4" stroke-width="4"/>`,over:zzz})],
  ['Спасибо',mimi({body:'bow',face:face('happy','happy','cat'),arms:[arm(220,392,-60),arm(292,392,60)],front:`<g transform="translate(256 400)">${[[-30,'#ff9fbf'],[0,'#ffd36e'],[30,'#b590ff']].map(([dx,c],i)=>anim('pop',`<g transform="translate(${dx} ${-8-(i===1?14:0)})">${[0,72,144,216,288].map(a=>`<ellipse rx="10" ry="16" cy="-14" fill="${c}" transform="rotate(${a})"/>`).join('')}<circle r="8" fill="#fff6c8"/></g>`,{delay:i*.3})).join('')}</g>`,
    over:twinkles([[100,160,.8],[420,170,.9],[400,400,.5]],'#ffd36e')})],
  ['Ура',mimi({body:'hop',face:face('happy','happy','open'),arms:[anim('wave',arm(88,226,40),{origin:'120px 268px'}),anim('wave',arm(424,226,-40),{origin:'392px 268px',delay:.45})],
    front:`<path d="M256 52L214 150H298Z" fill="url(#hat)" stroke="#9b85e8" stroke-width="5" stroke-linejoin="round"/><path d="M234 104h44M224 128h64" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8"/><circle cx="256" cy="50" r="13" fill="#ffd36e"/>`,over:confetti})],
  ['Кофе',mimi({face:face('happy','open','smile'),arms:[arm(196,404,-60),arm(316,404,60)],front:`<path d="M206 370h100l-10 70q-2 14-16 14h-48q-14 0-16-14Z" fill="url(#cup)" stroke="#e57da2" stroke-width="5" stroke-linejoin="round"/><path d="M304 386q30 0 26 24t-28 22" fill="none" stroke="#e57da2" stroke-width="9" stroke-linecap="round"/><ellipse cx="256" cy="372" rx="48" ry="8" fill="#9b6a4f"/>${anim('pulse',heart(256,402,.7,'#fff'))}`,
    over:rising([[130,300,.7],[386,290,.6]],'#ff9fbf')+twinkles([[420,150,.7]],'#ffd36e')})],
  ['Супер',mimi({face:face('happy','open','open'),over:`${anim('spin',`<g>${[0,90,180,270].map(a=>`<g transform="rotate(${a} 256 280)">${spark(256,40,.9,'#ffd36e')}</g>`).join('')}</g>`,{origin:'256px 280px'})}<g font-family="system-ui,sans-serif" font-weight="900">${anim('pop',`<text x="256" y="490" text-anchor="middle" font-size="56" fill="#b590ff" stroke="#fff" stroke-width="10" paint-order="stroke">СУПЕР!</text>`)}</g>`})],
  ['Думаю',mimi({face:face('up','up','o'),arms:[arm(150,352,-20),arm(300,350,40)],over:`${anim('bob',`<text x="380" y="150" font-family="system-ui,sans-serif" font-weight="900" font-size="90" fill="#b590ff" stroke="#fff" stroke-width="8" paint-order="stroke">?</text>`)}${[[360,190,9],[340,214,6]].map(([x,y,r],i)=>anim('twinkle',`<circle cx="${x}" cy="${y}" r="${r}" fill="#c7b2f4"/>`,{delay:i*.4})).join('')}`})],
  ['Обнимаю',mimi({body:'sway',face:face('happy','happy','cat'),arms:[anim('wave',arm(76,286,-60),{origin:'110px 320px'}),anim('wave',arm(436,286,60),{origin:'402px 320px',delay:.45})],over:rising([[120,220,.9],[392,210,1],[256,120,.8]],'#ff7aa6')})],
];

/* ---------------- «Аура» ---------------- */
const auraDefs=`<radialGradient id="glass" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffd1e3"/><stop offset=".5" stop-color="#ff6fa3"/><stop offset="1" stop-color="#9b5cff"/></radialGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#ffb3d1" stop-opacity=".8"/><stop offset="1" stop-color="#ffb3d1" stop-opacity="0"/></radialGradient>
<radialGradient id="halo2"><stop offset="0" stop-color="#ffe9a6" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a6" stop-opacity="0"/></radialGradient>
<linearGradient id="moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset="1" stop-color="#ffc56b"/></linearGradient>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f6bff"/><stop offset=".5" stop-color="#ff8ab8"/><stop offset="1" stop-color="#ffc58f"/></linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset="1" stop-color="#ff8f6b"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5cff"/><stop offset="1" stop-color="#2d2a7a"/></linearGradient>
<linearGradient id="petal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe1ec"/><stop offset="1" stop-color="#ff7fae"/></linearGradient>
<linearGradient id="wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fe3ff"/><stop offset=".5" stop-color="#b48cff"/><stop offset="1" stop-color="#ff8fc8"/></linearGradient>
<linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".5" stop-color="#ff9f43"/><stop offset="1" stop-color="#ffe66d"/></linearGradient>
<linearGradient id="flame2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#fff6b3"/></linearGradient>
<linearGradient id="wax" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe9f2"/><stop offset=".6" stop-color="#ffd0e2"/><stop offset="1" stop-color="#f3a9c8"/></linearGradient>
<linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6fbff"/><stop offset=".5" stop-color="#7fd6ff"/><stop offset="1" stop-color="#8a7dff"/></linearGradient>
<linearGradient id="env" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7fb"/><stop offset="1" stop-color="#ffd6e6"/></linearGradient>
<linearGradient id="mug" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9f7f0"/><stop offset="1" stop-color="#b9e6d3"/></linearGradient>
<mask id="crescent"><rect width="512" height="512" fill="#fff"/><circle cx="320" cy="200" r="138" fill="#000"/></mask><clipPath id="win"><circle cx="256" cy="256" r="190"/></clipPath><clipPath id="gemclip"><path d="M256 96 380 200 256 420 132 200Z"/></clipPath>`;
const aura=(body)=>svg(body,auraDefs);
const halo=(id='halo',r=200)=>anim('glow',`<circle cx="256" cy="256" r="${r}" fill="url(#${id})"/>`);
const auraSet=[
  ['Сердце',aura(`${halo()}${anim('ring',`<path d="${heartD}" transform="translate(256 220) scale(6)" fill="none" stroke="#ff9ec4" stroke-width=".8"/>`)}${anim('pulse',`<path d="${heartD}" transform="translate(256 200) scale(6.2)" fill="url(#glass)"/><path d="M180 205q10-50 60-34" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity=".75"/>`)}${twinkles([[110,110,.8],[410,140,1],[400,400,.6]],'#fff1a8')}`)],
  ['Спокойной ночи',aura(`${halo('halo2',190)}${anim('sway',`<circle cx="240" cy="256" r="160" fill="url(#moon)" mask="url(#crescent)"/><circle cx="210" cy="300" r="14" fill="#ffd98a" opacity=".7"/><circle cx="250" cy="370" r="9" fill="#ffd98a" opacity=".7"/>`)}${twinkles([[400,110,.9],[120,120,.6],[440,260,.5],[350,200,.4]],'#fff4c2')}${anim('drift',`<g fill="#efe7ff" opacity=".95"><circle cx="150" cy="420" r="34"/><circle cx="196" cy="404" r="42"/><circle cx="244" cy="424" r="30"/><rect x="118" y="420" width="150" height="34" rx="17"/></g>`)}`)],
  ['Вау',aura(`${anim('twinkle',spark(256,250,6,'#ffd36e'),{dur:2.2})}${anim('twinkle',spark(370,130,2.4,'#ff9ec4'),{delay:.6,dur:2.2})}${anim('twinkle',spark(130,380,2.8,'#9fdcff'),{delay:1.1,dur:2.2})}${[[120,140],[400,380],[420,250],[90,260]].map(([x,y],i)=>anim('twinkle',`<circle cx="${x}" cy="${y}" r="8" fill="#fff1a8"/>`,{delay:i*.3})).join('')}`)],
  ['Красиво',aura(`<g clip-path="url(#win)"><rect x="60" y="60" width="392" height="392" fill="url(#sky)"/>${anim('bob',`<circle cx="256" cy="290" r="90" fill="url(#sun)"/>`,{dur:5})}<rect x="60" y="300" width="392" height="160" fill="url(#sea)"/>${[318,350,384,418].map((y,i)=>anim('slide',`<path d="M40 ${y}${Array.from({length:8},(_,k)=>`q30 -${8-i} 60 0`).join('')}" fill="none" stroke="#ffd1e3" stroke-width="${5-i}" stroke-linecap="round" opacity="${.9-i*.15}"/>`,{delay:-i*.7,dur:3+i})).join('')}${anim('drift',`<path d="M140 150q20-30 60-14q30-20 56 6q34-2 36 24H130q-18-6 10-16Z" fill="#fff" opacity=".55"/>`)}</g><circle cx="256" cy="256" r="190" fill="none" stroke="#fff" stroke-width="10" opacity=".9"/>`)],
  ['Для тебя',aura(`${halo()}${anim('sway',`<path d="M256 280q-10 90 0 170" fill="none" stroke="#58c08f" stroke-width="12" stroke-linecap="round"/><path d="M256 380q-60-10-80-60q60 0 80 60ZM258 410q60-14 76-64q-58 4-76 64Z" fill="#7ad6a6"/>${anim('spin',`<g>${Array.from({length:8},(_,k)=>`<ellipse cx="256" cy="180" rx="34" ry="62" fill="url(#petal)" transform="rotate(${k*45} 256 240)" opacity=".95"/>`).join('')}</g>`,{origin:'256px 240px',dur:24})}<circle cx="256" cy="240" r="32" fill="#ffe08a"/><circle cx="246" cy="230" r="10" fill="#fff6c8"/>`,{origin:'256px 450px'})}${rising([[150,200,.8],[370,180,.9]],'#ff9ec4')}`)],
  ['Лёгкость',aura(`${halo('halo',170)}${anim('bob',`${anim('flap',`<path d="M256 250C200 120 90 120 100 200c8 50 70 70 156 60Z" fill="url(#wing)"/><path d="M256 262C190 270 130 330 170 370c30 26 80-20 86-100Z" fill="url(#wing)" opacity=".9"/>`,{origin:'256px 256px'})}${anim('flap',`<path d="M256 250C312 120 422 120 412 200c-8 50-70 70-156 60Z" fill="url(#wing)"/><path d="M256 262C322 270 382 330 342 370c-30 26-80-20-86-100Z" fill="url(#wing)" opacity=".9"/>`,{origin:'256px 256px'})}<rect x="246" y="200" width="20" height="150" rx="10" fill="#4b3c7a"/><path d="M250 204q-20-40-40-46M262 204q20-40 40-46" fill="none" stroke="#4b3c7a" stroke-width="5" stroke-linecap="round"/>`,{dur:3})}${twinkles([[120,380,.6],[400,400,.5],[410,110,.6]],'#fff1a8')}`)],
  ['Мечтаю',aura(`${['#ff8fb3','#ffc58f','#ffe66d','#7ee0b5','#8fd8ff','#b590ff'].map((c,i)=>`<path d="M${80+i*18} 340A${176-i*18} ${176-i*18} 0 0 1 ${432-i*18} 340" fill="none" stroke="${c}" stroke-width="18" stroke-linecap="round" class="a draw" style="stroke-dasharray:600;animation-delay:${i*.12}s"/>`).join('')}${[[96,350],[416,350]].map(([x,y],i)=>anim('bob',`<g fill="#fff" stroke="#e7defa" stroke-width="4"><circle cx="${x-26}" cy="${y}" r="26"/><circle cx="${x+4}" cy="${y-14}" r="34"/><circle cx="${x+34}" cy="${y+4}" r="24"/><rect x="${x-50}" y="${y}" width="108" height="34" rx="17"/></g>`,{delay:i*.6})).join('')}${twinkles([[256,110,.9],[150,150,.5],[360,150,.6]],'#ffe66d')}`)],
  ['Уют',aura(`${anim('glow',`<circle cx="256" cy="200" r="150" fill="url(#halo2)"/>`)}<rect x="196" y="250" width="120" height="190" rx="22" fill="url(#wax)"/><path d="M196 276q20 20 30 0t30 6 30-6 30 0" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/><ellipse cx="256" cy="440" rx="110" ry="18" fill="#f3a9c8" opacity=".5"/><path d="M256 250v-26" stroke="#5b4a3a" stroke-width="6" stroke-linecap="round"/>${anim('flicker',`<path d="M256 120C226 170 222 196 256 228 290 196 286 170 256 120Z" fill="url(#flame)"/><path d="M256 168C244 190 244 204 256 220 268 204 268 190 256 168Z" fill="url(#flame2)"/>`)}`)],
  ['Огонь',aura(`${anim('glow',`<circle cx="256" cy="300" r="190" fill="url(#halo2)"/>`)}${anim('flicker',`<path d="M256 60C330 150 400 220 380 320c-16 80-70 120-124 120s-108-40-124-120C112 220 170 170 200 110c10 50 30 70 50 80 0-50-10-90 6-130Z" fill="url(#flame)"/>`)}${anim('flicker',`<path d="M256 220C300 270 320 310 310 360c-8 40-30 60-54 60s-46-20-54-60c-8-40 14-70 30-90 6 24 14 34 24 36-4-30 0-60 0-86Z" fill="url(#flame2)"/>`,{delay:.2})}${[0,1,2].map(i=>anim('steam',`<circle cx="${200+i*56}" cy="120" r="${7-i}" fill="#ffd36e"/>`,{delay:i*.5})).join('')}`)],
  ['Бесценно',aura(`${halo('halo',190)}${anim('wobble',`<path d="M256 96 380 200 256 420 132 200Z" fill="url(#gem)"/><path d="M132 200h248M196 200l60-104 60 104-60 220-60-220" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity=".7"/><g clip-path="url(#gemclip)">${anim('slide',`<rect x="300" y="60" width="40" height="420" fill="#fff" opacity=".55" transform="rotate(20 320 270)"/>`,{dur:2.4})}</g>`)}${twinkles([[400,120,.9],[110,330,.7],[390,390,.5]],'#d6fbff')}`)],
  ['Письмо тебе',aura(`${halo()}${anim('rise',heart(256,250,2.4,'url(#glass)'),{dur:3.2})}<path d="M110 220h292v190q0 20-20 20H130q-20 0-20-20Z" fill="url(#env)" stroke="#f3a9c8" stroke-width="6" stroke-linejoin="round"/><path d="M110 226l146 110 146-110" fill="none" stroke="#f3a9c8" stroke-width="6" stroke-linejoin="round"/><path d="M114 426l110-90m174 90-110-90" stroke="#f3a9c8" stroke-width="6" stroke-linecap="round"/>${anim('pulse',heart(256,340,.9,'#ff6fa3'))}`)],
  ['Доброе утро',aura(`${halo('halo2',190)}<path d="M146 230h220v120q0 70-70 70h-80q-70 0-70-70Z" fill="url(#mug)" stroke="#8fcfb4" stroke-width="6" stroke-linejoin="round"/><path d="M364 262q60-4 52 52t-58 46" fill="none" stroke="#8fcfb4" stroke-width="16" stroke-linecap="round"/><ellipse cx="256" cy="232" rx="110" ry="22" fill="#a8714f"/><ellipse cx="256" cy="230" rx="96" ry="16" fill="#c99470"/>${anim('pulse',`<path d="${heartD}" transform="translate(256 220) scale(1.1 .5)" fill="#fff3e6"/>`)}${[0,1,2].map(i=>anim('steam',`<path d="M${216+i*40} 196q-18-24 0-46t0-46" fill="none" stroke="#e8dcf7" stroke-width="10" stroke-linecap="round"/>`,{delay:i*.7})).join('')}`)],
];

/* ---------------- «Слова» ---------------- */
const wordDefs=(a,b,c)=>`<linearGradient id="tx" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/><animateTransform attributeName="gradientTransform" type="translate" values="-0.5 0;0.5 0;-0.5 0" dur="4s" repeatCount="indefinite"/></linearGradient>`;
const FONT=`font-family="'Nunito','Trebuchet MS','Segoe UI',system-ui,sans-serif" font-weight="900"`;
function words(lines,colors,decor='',size=104){
  const total=lines.length,lh=size*1.08,start=256-(total-1)*lh/2+size*.34;
  const text=lines.map((line,i)=>{const len=Math.min(450,[...line].length*size*.6);return `<text x="256" y="${start+i*lh}" text-anchor="middle" font-size="${size}" ${FONT} textLength="${len}" lengthAdjust="spacingAndGlyphs" fill="url(#tx)" stroke="#fff" stroke-width="18" stroke-linejoin="round" paint-order="stroke">${line}</text>`;}).join('');
  return svg(`${decor}${anim('wobble',`<g opacity=".18" transform="translate(6 10)">${text.replace(/fill="url\(#tx\)"/g,'fill="#4b2c7a"').replace(/stroke="#fff"/g,'stroke="#4b2c7a"')}</g>${text}`)}`,wordDefs(...colors));
}
const wordSet=[
  ['Привет!',words(['Привет!'],['#ff7eb3','#ff9f6b','#ffd36e'],twinkles([[90,130,.9],[430,380,.8]],'#ffd36e'))],
  ['Спасибо',words(['Спасибо'],['#7ee0b5','#5fb8ff','#b590ff'],rising([[100,330,.9],[420,320,.8]],'#ff8fb3'),96)],
  ['Люблю',words(['Люблю'],['#ff5c8a','#ff8fb3','#c26bff'],rising([[110,330,1.2],[400,340,1],[256,130,.8]],'#ff6b9a'),118)],
  ['Обнимаю',words(['Обнимаю'],['#ffb36b','#ff7eb3','#b590ff'],twinkles([[80,120,.7],[440,130,.8],[440,400,.6]],'#ffc8dc'),92)],
  ['Скучаю',words(['Скучаю'],['#8fd8ff','#a68cff','#ff9ec4'],`${anim('drip',`<ellipse cx="420" cy="300" rx="12" ry="16" fill="#8fd8ff"/>`)}${twinkles([[90,140,.7]],'#cfe8ff')}`,104)],
  ['Ахахах',words(['АХАХАХ'],['#ffd36e','#ff9f43','#ff5c8a'],`${anim('laugh',`<g>${spark(100,120,.9,'#ffd36e')}${spark(420,400,.8,'#ff9ec4')}</g>`)}`,104)],
  ['Вау!',words(['ВАУ!'],['#6be3ff','#8a7dff','#ff7eb3'],`${anim('ring',`<circle cx="256" cy="256" r="150" fill="none" stroke="#b590ff" stroke-width="8"/>`)}${twinkles([[110,110,1],[400,120,.8],[410,400,.9],[100,400,.6]],'#ffd36e')}`,140)],
  ['Ок',words(['ОК'],['#7ee0b5','#3ccf91','#5fb8ff'],`${anim('pulse',`<circle cx="256" cy="256" r="170" fill="#e8fff4" stroke="#7ee0b5" stroke-width="10"/>`,{dur:2})}${twinkles([[420,110,.9]],'#ffd36e')}`,170)],
  ['Доброе утро',words(['Доброе','утро'],['#ffb36b','#ff7eb3','#ffd36e'],`${anim('spin',`<g>${Array.from({length:12},(_,k)=>`<path d="M256 26v40" stroke="#ffd36e" stroke-width="12" stroke-linecap="round" transform="rotate(${k*30} 256 256)" opacity=".7"/>`).join('')}</g>`,{origin:'256px 256px',dur:20})}`,100)],
  ['Сладких снов',words(['Сладких','снов'],['#a68cff','#6b8bff','#ff9ec4'],`${anim('sway',`<path d="M400 60a60 60 0 1 0 70 80a50 50 0 0 1-70-80Z" fill="#ffe08a"/>`,{origin:'420px 110px'})}${twinkles([[80,110,.6],[90,420,.5],[430,420,.6]],'#fff4c2')}${zzz.replace(/#9d86e6/g,'#a68cff').replace(/x="(\d+)"/g,(_,x)=>`x="${x-300}"`).replace(/y="(\d+)"/g,(_,y)=>`y="${+y+200}"`)}`,96)],
  ['Ура!',words(['УРА!'],['#ff7eb3','#ffd36e','#7ee0b5'],confetti,150)],
  ['Ты супер',words(['Ты','супер'],['#ff8fb3','#b590ff','#6be3ff'],`${anim('spin',`<g>${[0,120,240].map(a=>`<g transform="rotate(${a} 256 256)">${spark(256,40,.8,'#ffd36e')}</g>`).join('')}</g>`,{origin:'256px 256px'})}`,112)],
];

const packs=[['mimi',mimiSet],['aura',auraSet],['words',wordSet]];
const manifest={};
for(const [slug,set]of packs){
  manifest[slug]=set.map(([label])=>label);
  set.forEach(([,content],n)=>{
    const name=`${out}/${slug}-${String(n).padStart(2,'0')}`;
    writeFileSync(name+'.svg',content);
    writeFileSync(name+'-still.svg',content.replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g,'').replace('</style>',`</style>${still}`));
  });
}
writeFileSync(out+'/packs.json',JSON.stringify(manifest,null,2)+'\n');
console.log(Object.entries(manifest).map(([k,v])=>k+': '+v.length).join(', '));
