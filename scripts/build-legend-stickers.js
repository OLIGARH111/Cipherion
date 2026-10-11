// «Сифа» — the legendary animated pack: a round mint chick with a sprout on its head, drawn from scratch
// for Cipherion. Like the other vector packs every sticker is a self-contained SVG (CSS keyframes + a
// little SMIL) that animates inside <img>; the "-still" twin is the poster and the reduced-motion frame.
import {writeFileSync,mkdirSync} from 'node:fs';
const out='public/stickers-v4';
mkdirSync(out,{recursive:true});

const css=`<style>
.a{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.bob{animation-name:bob;animation-duration:2.4s}.shadow{animation-name:shadow;animation-duration:2.4s}
.hop{animation-name:hop;animation-duration:1s;transform-origin:50% 100%}.jump{animation-name:jump;animation-duration:.9s;transform-origin:50% 100%}
.breathe{animation-name:breathe;animation-duration:3.4s;transform-origin:50% 100%}.blink{animation-name:blink;animation-duration:3.8s}
.pulse{animation-name:pulse;animation-duration:1s}.beat{animation-name:beat;animation-duration:.8s}
.twinkle{animation-name:twinkle;animation-duration:1.6s}.rise{animation-name:rise;animation-duration:2.6s;animation-timing-function:ease-out}
.wave{animation-name:wave;animation-duration:.6s}.hug{animation-name:hug;animation-duration:1.6s}
.shake{animation-name:shake;animation-duration:.22s}.laugh{animation-name:laugh;animation-duration:.42s}
.jitter{animation-name:jitter;animation-duration:.18s;animation-timing-function:steps(2)}
.drip{animation-name:drip;animation-duration:1.1s;animation-timing-function:ease-in}
.stream{animation-name:stream;animation-duration:.5s;animation-timing-function:linear}
.puddle{animation-name:puddle;animation-duration:1.4s}
.spin{animation-name:spin;animation-duration:7s;animation-timing-function:linear}.sway{animation-name:sway;animation-duration:2.4s}
.flicker{animation-name:flicker;animation-duration:.5s;transform-origin:50% 100%}
.steam{animation-name:steam;animation-duration:1.6s;animation-timing-function:ease-out}
.bow{animation-name:bow;animation-duration:2.6s;transform-origin:50% 100%}
.pop{animation-name:pop;animation-duration:2.2s}.fall{animation-name:fall;animation-duration:2s;animation-timing-function:linear}
.coin{animation-name:coin;animation-duration:1.7s;animation-timing-function:ease-in}
.flip{animation-name:flip;animation-duration:.9s}
.stretch{animation-name:stretch;animation-duration:1.4s;transform-origin:50% 100%}
.tilt{animation-name:tilt;animation-duration:2.8s;transform-origin:50% 100%}
.sip{animation-name:sip;animation-duration:2.4s}
.thumb{animation-name:thumb;animation-duration:1.4s}
.ring{animation-name:ring;animation-duration:1.8s;animation-timing-function:ease-out}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@keyframes shadow{0%,100%{transform:scaleX(1);opacity:.2}50%{transform:scaleX(.84);opacity:.12}}
@keyframes hop{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.08,.92)}45%{transform:translateY(-34px) scale(.96,1.05)}75%{transform:translateY(0) scale(1.04,.96)}}
@keyframes jump{0%,100%{transform:translateY(0) scale(1,1)}15%{transform:translateY(0) scale(1.1,.88)}50%{transform:translateY(-58px) scale(.94,1.08) rotate(-4deg)}80%{transform:translateY(0) scale(1.06,.94)}}
@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.96)}}
@keyframes blink{0%,88%,100%{transform:scaleY(1)}93%{transform:scaleY(.08)}}
@keyframes pulse{0%,100%{transform:scale(1)}30%{transform:scale(1.18)}55%{transform:scale(.96)}}
@keyframes beat{0%,100%{transform:scale(1)}20%{transform:scale(1.22)}40%{transform:scale(.95)}60%{transform:scale(1.12)}}
@keyframes twinkle{0%,100%{transform:scale(.3) rotate(0);opacity:.15}50%{transform:scale(1) rotate(30deg);opacity:1}}
@keyframes rise{0%{transform:translateY(30px) scale(.4);opacity:0}25%{opacity:1}100%{transform:translateY(-170px) scale(1.1);opacity:0}}
@keyframes wave{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(30deg)}}
@keyframes hug{0%,100%{transform:rotate(0)}45%,60%{transform:rotate(-58deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-9px) rotate(-1deg)}75%{transform:translateX(9px) rotate(1deg)}}
@keyframes laugh{0%,100%{transform:rotate(-5deg) translateY(0)}50%{transform:rotate(5deg) translateY(-10px)}}
@keyframes jitter{0%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}100%{transform:translate(-1px,-2px)}}
@keyframes drip{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(80px) scale(1);opacity:0}}
@keyframes stream{to{stroke-dashoffset:-96}}
@keyframes puddle{0%,100%{transform:scale(1,1)}50%{transform:scale(1.12,1.2)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes sway{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes flicker{0%,100%{transform:scale(1,1) skewX(0)}33%{transform:scale(.92,1.1) skewX(4deg)}66%{transform:scale(1.05,.94) skewX(-4deg)}}
@keyframes steam{0%{transform:translateY(10px) scale(.6);opacity:0}30%{opacity:.9}100%{transform:translateY(-80px) scale(1.2);opacity:0}}
@keyframes bow{0%,15%,100%{transform:rotate(0)}40%,70%{transform:rotate(16deg) translateY(10px)}}
@keyframes pop{0%{transform:scale(0) rotate(-20deg);opacity:0}16%{transform:scale(1.2) rotate(6deg);opacity:1}26%,84%{transform:scale(1) rotate(0);opacity:1}100%{transform:scale(1);opacity:0}}
@keyframes fall{0%{transform:translateY(-80px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(420px) rotate(300deg);opacity:0}}
@keyframes coin{0%{transform:translateY(-90px) rotateY(0);opacity:0}10%{opacity:1}100%{transform:translateY(430px);opacity:.2}}
@keyframes flip{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.1)}}
@keyframes stretch{0%,100%{transform:scale(1,1)}20%{transform:scale(.9,1.16) translateY(-10px)}35%{transform:scale(1.05,.95)}50%{transform:scale(1,1)}}
@keyframes tilt{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@keyframes sip{0%,55%,100%{transform:rotate(0) translate(0,0)}70%,85%{transform:rotate(-24deg) translate(-14px,-22px)}}
@keyframes thumb{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-12deg) scale(1.1)}50%{transform:rotate(0) scale(1)}}
@keyframes ring{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.6);opacity:0}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;
const still='<style>*{animation:none!important}</style>';
const FONT='font-family="system-ui,-apple-system,\'Segoe UI\',sans-serif" font-weight="900"';
const svg=(body,defs='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${css}<defs>${DEFS}${defs}</defs>${body}</svg>`;
const anim=(cls,body,{delay=0,origin,dur}={})=>`<g class="a ${cls}" style="${delay?`animation-delay:${delay}s;`:''}${dur?`animation-duration:${dur}s;`:''}${origin?`transform-box:view-box;transform-origin:${origin};`:''}">${body}</g>`;
const at=(x,y,s,body,r=0)=>`<g transform="translate(${x} ${y})${r?` rotate(${r})`:''}${s!==1?` scale(${s})`:''}">${body}</g>`;
const mirror=body=>`<g transform="translate(512 0) scale(-1 1)">${body}</g>`;

const heartD='M0 10C0-4-20-12-22 4-23 16-8 24 0 34 8 24 23 16 22 4 20-12 0-4 0 10Z';
const sparkD='M0-24C3-4 4-3 24 0 4 3 3 4 0 24-3 4-4 3-24 0-4-3-3-4 0-24Z';
const heart=(x,y,s,fill='url(#hrt)')=>at(x,y,s,`<path d="${heartD}" fill="${fill}"/>`);
const spark=(x,y,s,fill='#ffd84d')=>at(x,y,s,`<path d="${sparkD}" fill="${fill}"/>`);
const twinkles=(list,fill)=>list.map(([x,y,s],i)=>anim('twinkle',spark(x,y,s,fill),{delay:i*.4})).join('');
const rising=(list,fill)=>list.map(([x,y,s],i)=>anim('rise',heart(x,y,s,fill),{delay:i*.6})).join('');

const INK='#17302a',LINE='#2c8f6a';
const DEFS=`<radialGradient id="cb" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#f2fff8"/><stop offset=".5" stop-color="#9ff0cd"/><stop offset="1" stop-color="#43b98e"/></radialGradient>
<radialGradient id="cr" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#fff1ee"/><stop offset=".5" stop-color="#ff9f8f"/><stop offset="1" stop-color="#e2453f"/></radialGradient>
<linearGradient id="cw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9f6dc"/><stop offset="1" stop-color="#4cbf93"/></linearGradient>
<linearGradient id="bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd66b"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>
<linearGradient id="lf" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2fa36f"/><stop offset="1" stop-color="#8ee86b"/></linearGradient>
<radialGradient id="hrt" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffc9db"/><stop offset=".55" stop-color="#ff5d8f"/><stop offset="1" stop-color="#d9306b"/></radialGradient>
<radialGradient id="gold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c4"/><stop offset=".6" stop-color="#ffcc33"/><stop offset="1" stop-color="#e09a12"/></radialGradient>
<linearGradient id="fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3d5a"/><stop offset=".5" stop-color="#ff9124"/><stop offset="1" stop-color="#ffe45c"/></linearGradient>
<linearGradient id="fire2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb02e"/><stop offset="1" stop-color="#fff7b8"/></linearGradient>
<linearGradient id="tear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4f2ff"/><stop offset="1" stop-color="#5bc2ff"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3f5c"/><stop offset="1" stop-color="#0d1020"/></linearGradient>`;

/* ---------- the chick ---------- */
const BODY='M256 150C340 150 392 226 392 316C392 400 332 448 256 448S120 400 120 316C120 226 172 150 256 150Z';
const bodyShape=(red)=>`<path d="${BODY}" fill="url(#${red?'cr':'cb'})" stroke="${red?'#b8322f':LINE}" stroke-width="7" stroke-linejoin="round"/><ellipse cx="256" cy="372" rx="86" ry="66" fill="#fff" opacity=".55"/><ellipse cx="196" cy="198" rx="30" ry="16" fill="#fff" opacity=".7" transform="rotate(-30 196 198)"/>`;
const feet=`<g fill="url(#bk)" stroke="#d9781e" stroke-width="5"><ellipse cx="212" cy="448" rx="32" ry="14"/><ellipse cx="300" cy="448" rx="32" ry="14"/></g>`;
const sproutShape=`<path d="M256 156q-4-26 6-48" fill="none" stroke="#2fa36f" stroke-width="8" stroke-linecap="round"/><path d="M262 112c-34-30-70-8-72 6 26 14 56 16 72-6Z" fill="url(#lf)" stroke="#23875a" stroke-width="4" stroke-linejoin="round"/><path d="M262 110c22-38 64-34 70-20-18 22-48 32-70 20Z" fill="url(#lf)" stroke="#23875a" stroke-width="4" stroke-linejoin="round"/>`;
const sprout=(mode='sway')=>mode==='up'?anim('jitter',sproutShape):mode==='droop'?`<g transform="rotate(38 256 156)">${sproutShape}</g>`:anim(mode,sproutShape,{origin:'256px 156px'});
const cheeks=(o=.8,c='#ffa3c0')=>`<ellipse cx="180" cy="318" rx="22" ry="12" fill="${c}" opacity="${o}"/><ellipse cx="332" cy="318" rx="22" ry="12" fill="${c}" opacity="${o}"/>`;

const EL=[212,272],ER=[300,272];
const pupil=(x,y,s=1)=>`<ellipse cx="${x}" cy="${y}" rx="${17*s}" ry="${23*s}" fill="${INK}"/><circle cx="${x-5*s}" cy="${y-9*s}" r="${7*s}" fill="#fff"/><circle cx="${x+6*s}" cy="${y+8*s}" r="${3*s}" fill="#fff" opacity=".85"/>`;
const arc=(x,y,up,w=7)=>`<path d="M${x-17} ${y+(up?6:-4)}Q${x} ${y+(up?-16:14)} ${x+17} ${y+(up?6:-4)}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
const eyes={
  open:()=>anim('blink',pupil(...EL)+pupil(...ER)),
  up:()=>anim('blink',`<ellipse cx="${EL[0]}" cy="${EL[1]}" rx="17" ry="23" fill="${INK}"/><circle cx="${EL[0]+4}" cy="${EL[1]-12}" r="7" fill="#fff"/><ellipse cx="${ER[0]}" cy="${ER[1]}" rx="17" ry="23" fill="${INK}"/><circle cx="${ER[0]+4}" cy="${ER[1]-12}" r="7" fill="#fff"/>`),
  happy:()=>arc(...EL,true)+arc(...ER,true),
  closed:()=>arc(...EL,false)+arc(...ER,false),
  squint:()=>`<path d="M196 260l28 12-28 12M316 260l-28 12 28 12" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
  heart:()=>anim('beat',heart(EL[0],EL[1]-16,1.05))+anim('beat',heart(ER[0],ER[1]-16,1.05),{delay:.1}),
  angry:()=>`${pupil(EL[0],EL[1]+6,.8)}${pupil(ER[0],ER[1]+6,.8)}<path d="M188 242l44 16M324 242l-44 16" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
  wide:()=>`<g stroke="${INK}" stroke-width="6"><ellipse cx="${EL[0]-4}" cy="${EL[1]-6}" rx="30" ry="36" fill="#fff"/><ellipse cx="${ER[0]+4}" cy="${ER[1]-6}" rx="30" ry="36" fill="#fff"/></g>${anim('jitter',`<circle cx="${EL[0]-2}" cy="${EL[1]-4}" r="9" fill="${INK}"/><circle cx="${ER[0]+2}" cy="${ER[1]-4}" r="9" fill="${INK}"/>`)}`,
  cool:()=>`<path d="M168 252h176" stroke="#0d1020" stroke-width="8" stroke-linecap="round"/><path d="M174 250h74q4 34-30 38-38 2-44-38ZM264 250h74q-6 40-44 38-34-4-30-38Z" fill="url(#glass)" stroke="#0d1020" stroke-width="5" stroke-linejoin="round"/>${anim('twinkle',`<path d="M196 262l18-8M286 262l18-8" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".85"/>`,{dur:2.2})}`,
  coin:()=>[EL,ER].map(([x,y],i)=>anim('flip',`<circle cx="${x}" cy="${y-4}" r="25" fill="url(#gold)" stroke="#c98510" stroke-width="5"/><text x="${x}" y="${y+9}" text-anchor="middle" font-size="34" ${FONT} fill="#b06d00">₽</text>`,{delay:i*.15})).join(''),
  wink:()=>anim('blink',pupil(...EL))+arc(...ER,true),
  puppy:()=>[EL,ER].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx="24" ry="28" fill="${INK}"/><circle cx="${x-7}" cy="${y-10}" r="10" fill="#fff"/><circle cx="${x+8}" cy="${y+9}" r="5" fill="#fff"/><circle cx="${x+10}" cy="${y-6}" r="3" fill="#fff"/>`).join('')+`<path d="M190 300q-6-3-4 10" fill="none"/>`,
  cry:()=>`<path d="M192 264q20 14 40 0M280 264q20 14 40 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/><path d="M194 252l34-6M318 252l-34-6" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
};
const beaks={
  closed:`<path d="M234 302Q256 288 278 302Q268 322 256 322Q244 322 234 302Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/>`,
  open:`<path d="M230 300Q256 284 282 300Q256 312 230 300Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><path d="M234 306Q256 360 278 306Q256 316 234 306Z" fill="#c2323f" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><path d="M244 330Q256 322 268 330Q262 344 256 344Q250 344 244 330Z" fill="#ff8fa6"/>`,
  o:`<path d="M236 298Q256 286 276 298Q256 306 236 298Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><ellipse cx="256" cy="320" rx="14" ry="16" fill="#c2323f" stroke="#d9781e" stroke-width="5"/>`,
  sad:`<path d="M234 308Q256 294 278 308Q268 318 256 318Q244 318 234 308Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><path d="M238 330q18-12 36 0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  wail:`<path d="M228 296Q256 280 284 296Q256 306 228 296Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><path d="M232 304Q256 372 280 304Q256 314 232 304Z" fill="#c2323f" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/>`,
  grr:`<path d="M232 300Q256 286 280 300L280 318Q256 330 232 318Z" fill="url(#bk)" stroke="#d9781e" stroke-width="5" stroke-linejoin="round"/><path d="M236 310h40" stroke="#d9781e" stroke-width="4"/>`,
};

// Left wing poses, mirrored for the right side; [shape, shoulder pivot].
const W=(cx,cy,rx,ry,r)=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${cx} ${cy})" fill="url(#cw)" stroke="${LINE}" stroke-width="6"/>`;
const wingPose={
  rest:W(132,334,30,54,18),
  up:W(100,214,28,56,-38),
  hold:W(196,382,26,48,-52),
  chin:W(214,336,24,46,-46),
  out:W(84,300,28,58,-72),
  thumb:`${W(98,236,30,46,-20)}<ellipse cx="86" cy="186" rx="13" ry="24" transform="rotate(-10 86 186)" fill="url(#cw)" stroke="${LINE}" stroke-width="6"/>`,
};
// The right wing is the animated left wing mirrored, so both sides move symmetrically.
function wing(pose,side,motion){
  let shape=wingPose[pose];
  if(motion){const [name,opts={}]=Array.isArray(motion)?motion:[motion];shape=anim(name,shape,{origin:'148px 300px',...opts});}
  return side==='right'?mirror(shape):shape;
}
function chick({eyes:e='open',beak='closed',left=['rest'],right=['rest'],body='bob',red=false,blush=true,top='sway',face='',back='',front='',over='',shadow=true}){
  const shadowEl=shadow?anim(body==='bob'?'shadow':'breathe',`<ellipse cx="256" cy="462" rx="116" ry="14" fill="#1d6b50"/>`,{dur:body==='bob'?undefined:2.4}):'';
  const character=`${feet}${sprout(top)}${bodyShape(red)}${blush?cheeks(red?.5:.8):''}${eyes[e]()}${beaks[beak]}${face}${wing(left[0],'left',left[1])}${wing(right[0],'right',right[1])}${front}`;
  return svg(`${back}${shadowEl}${anim(body,character)}${over}`);
}

/* ---------- props ---------- */
const confetti=[[70,40,'#ff7aa8',0],[150,10,'#7fd8ff',.4],[340,24,'#ffd84d',.9],[430,50,'#b590ff',.2],[250,0,'#7ee0b5',1.1],[40,120,'#ffd84d',1.4],[470,140,'#ff7aa8',.7],[200,60,'#b590ff',1.6]]
  .map(([x,y,c,d],i)=>anim('fall',`<rect x="${x}" y="${y}" width="${i%2?16:10}" height="${i%2?9:20}" rx="3" fill="${c}"/>`,{delay:d})).join('');
const zzz=[0,1,2].map(i=>anim('rise',`<text x="${360+i*26}" y="${200-i*14}" ${FONT} font-size="${36+i*10}" fill="#7f6bd8" stroke="#fff" stroke-width="6" paint-order="stroke">z</text>`,{delay:i*.7})).join('');
const steamPuff=(x,y,d)=>anim('steam',`<g fill="#f1eef8" stroke="#d4cce6" stroke-width="3"><circle cx="${x}" cy="${y}" r="22"/><circle cx="${x+20}" cy="${y-18}" r="17"/><circle cx="${x-16}" cy="${y-22}" r="14"/></g>`,{delay:d});
const bubbleText=(x,y,text,size,fill,r=0)=>`<text x="${x}" y="${y}" text-anchor="middle" ${FONT} font-size="${size}" fill="${fill}" stroke="#fff" stroke-width="10" stroke-linejoin="round" paint-order="stroke"${r?` transform="rotate(${r} ${x} ${y})"`:''}>${text}</text>`;
const flower=(x,y,c)=>at(x,y,1,`${[0,72,144,216,288].map(a=>`<ellipse rx="11" ry="17" cy="-15" fill="${c}" transform="rotate(${a})"/>`).join('')}<circle r="9" fill="#ffd84d"/>`);
const bill=(x,y,r)=>at(x,y,1,`<rect x="-34" y="-18" width="68" height="36" rx="6" fill="#8fe3a6" stroke="#2f9a5c" stroke-width="4"/><circle r="11" fill="none" stroke="#2f9a5c" stroke-width="4"/><text y="7" text-anchor="middle" font-size="18" ${FONT} fill="#2f9a5c">₽</text>`,r);
const coin=(x,y)=>`<circle cx="${x}" cy="${y}" r="20" fill="url(#gold)" stroke="#c98510" stroke-width="4"/><text x="${x}" y="${y+8}" text-anchor="middle" font-size="22" ${FONT} fill="#b06d00">₽</text>`;
const flame=(x,y,s,d)=>anim('flicker',at(x,y,s,`<path d="M0-120C40-70 70-30 62 20c-8 40-34 60-62 60s-54-20-62-60C-70-20-30-50-14-90c4 30 14 40 24 46 0-30-6-50-10-76Z" fill="url(#fire)"/><path d="M0-30C22-6 30 14 26 36c-4 18-14 26-26 26s-22-8-26-26C-30 14-12-2-4-14c2 12 6 16 10 18 0-14-2-24-6-34Z" fill="url(#fire2)"/>`),{delay:d});
const tearStream=(path,d=0)=>`<path d="${path}" fill="none" stroke="url(#tear)" stroke-width="16" stroke-linecap="round" stroke-dasharray="30 18" class="a stream" style="animation-delay:${d}s"/>`;

/* ---------- the pack ---------- */
const set=[
  ['Привет','👋',chick({body:'hop',beak:'open',right:['up',['wave',{dur:.5}]],over:twinkles([[440,110,1],[80,150,.7],[460,300,.5]],'#ffd84d')})],
  ['Люблю','❤️',chick({eyes:'heart',beak:'closed',body:'bob',left:['hold'],right:['hold'],front:anim('beat',at(256,350,2.6,`<path d="${heartD}" fill="url(#hrt)" stroke="#fff" stroke-width="2.5"/>`)),over:rising([[90,280,1.3],[420,260,1.1],[140,180,.9],[380,170,1],[256,90,.8]])})],
  ['Ахаха','😂',chick({eyes:'squint',beak:'open',body:'laugh',face:`${anim('drip',`<ellipse cx="182" cy="290" rx="10" ry="14" fill="url(#tear)"/>`)}${anim('drip',`<ellipse cx="330" cy="290" rx="10" ry="14" fill="url(#tear)"/>`,{delay:.5})}`,left:['up',['wave',{dur:.42}]],right:['up',['wave',{dur:.42,delay:.2}]],
    over:`${anim('pop',bubbleText(400,130,'ХА',58,'#ff9124',14))}${anim('pop',bubbleText(110,110,'ХА',46,'#ff5d8f',-12),{delay:.5})}${anim('pop',bubbleText(430,250,'ХА',38,'#b590ff',8),{delay:1})}`})],
  ['Рыдаю','😭',chick({eyes:'cry',beak:'wail',body:'shake',blush:false,
    back:anim('puddle',`<ellipse cx="256" cy="472" rx="210" ry="26" fill="#8fd6ff" opacity=".75"/><ellipse cx="200" cy="466" rx="60" ry="7" fill="#fff" opacity=".6"/>`),
    face:`${tearStream('M200 276C150 230 80 250 44 330Q30 400 40 460')}${tearStream('M312 276C362 230 432 250 468 330Q482 400 472 460',.25)}`,
    over:[[40,440,0],[470,440,.4],[90,452,.8],[420,456,.2]].map(([x,y,d])=>anim('ring',`<ellipse cx="${x}" cy="${y}" rx="22" ry="6" fill="none" stroke="#5bc2ff" stroke-width="4"/>`,{delay:d})).join('')})],
  ['Злюсь','😡',chick({eyes:'angry',beak:'grr',body:'shake',red:true,top:'up',left:['out',['wave',{dur:.3}]],right:['out',['wave',{dur:.3,delay:.15}]],
    over:`${steamPuff(150,150,0)}${steamPuff(362,150,.6)}${anim('pulse',`<path d="M408 210l22-20m-8 34 28-4m-48-40 4-26" stroke="#ff3d5a" stroke-width="10" stroke-linecap="round"/>`,{dur:.6})}`})],
  ['Сплю','😴',chick({eyes:'closed',beak:'o',body:'breathe',top:'droop',
    back:`${anim('sway',`<path d="M96 96A60 60 0 1 0 156 186A50 50 0 0 1 96 96Z" fill="#ffe08a"/>`,{origin:'110px 140px'})}${twinkles([[176,70,.5],[50,230,.4],[460,90,.45]],'#ffe08a')}`,
    front:`<path d="M300 176Q352 70 430 136L392 190Z" fill="#7f6bd8" stroke="#5b49b0" stroke-width="5" stroke-linejoin="round"/><path d="M300 176q46 18 92 14" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".9"/><circle cx="434" cy="132" r="17" fill="#fff" stroke="#d4cce6" stroke-width="4"/>`+anim('pulse',`<circle cx="282" cy="336" r="16" fill="#d4f2ff" stroke="#8fd6ff" stroke-width="3" opacity=".85"/>`,{dur:3.4}),over:zzz})],
  ['Спасибо','🙏',chick({eyes:'happy',beak:'closed',body:'bow',left:['hold'],right:['hold'],
    front:`<path d="M240 420l16-56 16 56Z" fill="#7ee0b5" stroke="#2fa36f" stroke-width="4" stroke-linejoin="round"/>${anim('pulse',`${flower(226,354,'#ff9fbf')}${flower(286,350,'#b590ff')}${flower(256,326,'#ffb36b')}`,{dur:2.6})}`,
    over:twinkles([[90,150,.8],[430,160,.9],[440,380,.55],[70,360,.5]],'#ffd84d')})],
  ['Ура','🎉',chick({eyes:'happy',beak:'open',body:'jump',left:['up',['wave',{dur:.45}]],right:['up',['wave',{dur:.45,delay:.22}]],top:'sway',
    front:`<path d="M256 40L214 150H298Z" fill="#ff7aa8" stroke="#d94a7f" stroke-width="5" stroke-linejoin="round"/><path d="M232 104h48M222 128h68" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".85"/>${anim('pulse',`<circle cx="256" cy="38" r="15" fill="#ffd84d" stroke="#e0a812" stroke-width="4"/>`,{dur:.45})}`,over:confetti})],
  ['Кофе','☕',chick({eyes:'wide',beak:'closed',body:'jitter',left:['hold'],right:['hold'],top:'up',
    front:anim('sip',`<path d="M206 372h100l-10 66q-2 14-16 14h-48q-14 0-16-14Z" fill="#fff" stroke="#c7a48a" stroke-width="5" stroke-linejoin="round"/><path d="M304 388q32 0 28 24t-30 22" fill="none" stroke="#c7a48a" stroke-width="9" stroke-linecap="round"/><ellipse cx="256" cy="374" rx="48" ry="8" fill="#7a4a2f"/><path d="M226 408q30 12 60 0" stroke="#7ee0b5" stroke-width="8" fill="none" stroke-linecap="round"/>`,{origin:'256px 410px'}),
    over:[0,1,2].map(i=>anim('steam',`<path d="M${228+i*24} 350q-12-20 0-38t0-38" fill="none" stroke="#d9cfc7" stroke-width="8" stroke-linecap="round"/>`,{delay:i*.4})).join('')+anim('pop',bubbleText(420,140,'!!!',64,'#ff9124',10),{dur:1.2})})],
  ['Огонь','🔥',chick({eyes:'cool',beak:'closed',body:'tilt',left:['rest'],right:['thumb',['thumb']],
    back:`${anim('ring',`<circle cx="256" cy="300" r="190" fill="#ffb02e" opacity=".25"/>`,{dur:1.6})}${flame(100,330,1.3,0)}${flame(412,330,1.3,.25)}${flame(170,210,1,.12)}${flame(342,210,1,.37)}${flame(256,170,1.2,.2)}`})],
  ['Шок','😱',chick({eyes:'wide',beak:'o',body:'stretch',top:'up',blush:false,left:['up'],right:['up'],
    face:`<path d="M168 300q-6 26 0 50M344 300q6 26 0 50" stroke="#8fd6ff" stroke-width="7" stroke-linecap="round" opacity=".8"/>`,
    over:`${anim('pop',bubbleText(110,130,'!',96,'#ff3d5a',-12),{dur:1.4})}${anim('pop',bubbleText(410,120,'!',110,'#ff3d5a',12),{dur:1.4,delay:.2})}${[[60,250],[452,250]].map(([x,y],i)=>anim('ring',`<circle cx="${x}" cy="${y}" r="26" fill="none" stroke="#ffd84d" stroke-width="6"/>`,{delay:i*.3,dur:1.4})).join('')}`})],
  ['Думаю','🤔',chick({eyes:'up',beak:'closed',body:'tilt',left:['rest'],right:['chin'],
    over:`${[[352,206,9],[376,170,13]].map(([x,y,r],i)=>anim('twinkle',`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#c9bdf2" stroke-width="4"/>`,{delay:i*.3,dur:1.8})).join('')}${anim('bob',`<path d="M372 60h96q26 0 26 26v40q0 26-26 26h-96q-26 0-26-26V86q0-26 26-26Z" fill="#fff" stroke="#c9bdf2" stroke-width="5"/>${bubbleText(420,132,'?',72,'#7f6bd8')}`,{dur:2})}`})],
  ['Деньги','🤑',chick({eyes:'coin',beak:'open',body:'hop',left:['up',['wave',{dur:.5}]],right:['up',['wave',{dur:.5,delay:.25}]],
    back:[[60,0,-12],[170,.5,8],[340,.25,-6],[450,.75,14],[260,1,4]].map(([x,d,r])=>anim('fall',bill(x,30,r),{delay:d,dur:2.2})).join(''),
    over:[[100,.2],[200,.9],[320,.5],[420,1.2],[50,1.5],[470,.1]].map(([x,d])=>anim('coin',coin(x,40),{delay:d})).join('')})],
  ['Класс','👍',chick({eyes:'wink',beak:'closed',body:'bob',left:['thumb',['thumb']],right:['rest'],
    over:`${anim('spin',`<g>${[0,90,180,270].map(a=>`<g transform="rotate(${a} 256 300)">${spark(256,70,.9,'#ffd84d')}</g>`).join('')}</g>`,{origin:'256px 300px'})}${twinkles([[440,140,.8],[440,380,.6]],'#7fd8ff')}`})],
  ['Скучаю','🥺',chick({eyes:'puppy',beak:'sad',body:'breathe',left:['hold'],right:['hold'],top:'droop',
    face:anim('drip',`<ellipse cx="320" cy="300" rx="9" ry="13" fill="url(#tear)"/>`,{dur:2}),
    front:anim('pulse',at(256,372,1.6,`<path d="${heartD}" fill="#ffb3c9" stroke="#ff7aa8" stroke-width="3"/>`),{dur:2.2}),
    over:anim('bob',`<g opacity=".9"><path d="M410 70q40 0 40 34t-40 34h-22l-18 16 4-18q-24-10-24-32 0-34 40-34Z" fill="#fff" stroke="#c9bdf2" stroke-width="4"/>${heart(410,92,.9,'#ff7aa8')}</g>`,{dur:3})})],
  ['Обнимаю','🤗',chick({eyes:'happy',beak:'closed',body:'bob',left:['out',['hug']],right:['out',['hug',{delay:0}]],
    over:rising([[110,240,1],[400,230,1.1],[256,120,.9],[60,140,.7],[450,130,.7]])})],
];

const manifest={sifa:set.map(([label,emoji])=>({label,emoji}))};
set.forEach(([,,content],n)=>{
  const name=`${out}/sifa-${String(n).padStart(2,'0')}`;
  writeFileSync(name+'.svg',content);
  writeFileSync(name+'-still.svg',content.replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g,'').replace('</style>',`</style>${still}`));
});
writeFileSync(out+'/packs.json',JSON.stringify(manifest,null,2)+'\n');
console.log('sifa: '+set.length);
