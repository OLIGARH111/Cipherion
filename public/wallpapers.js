// Chat wallpapers: built-in vector wallpapers, AI-generated ones and per-chat choices.
// Every wallpaper except a photo is a small JSON spec drawn here as SVG, so it costs
// no upload, scales to any screen and syncs between devices inside the settings.
import {accountURL} from './account-context.js';
import {$,esc,icon,api,upload,modal,guard,toast} from './ui.js';

export const MOTIFS=['aurora','waves','dunes','stars','mesh','bokeh','poly','flow'];
export const SYSTEM_WALLPAPERS=[
  {id:'aurora',name:'Северное сияние',motif:'aurora',colors:['#06141b','#0b2e33','#2de1a4','#7b5cff'],seed:7},
  {id:'emerald',name:'Изумрудные волны',motif:'waves',colors:['#04201a','#0b3d30','#1fb57d','#9bf0c8'],seed:3},
  {id:'sunset',name:'Закат',motif:'dunes',colors:['#2b1055','#7597de','#ff7e5f','#feb47b'],seed:11},
  {id:'cosmos',name:'Глубокий космос',motif:'stars',colors:['#05060f','#151a3a','#6a5cff','#ff6ec7'],seed:21},
  {id:'peach',name:'Персик',motif:'mesh',colors:['#fff1e0','#ffd1b3','#ffb3c6','#c3b5ff'],seed:5},
  {id:'lagoon',name:'Лагуна',motif:'mesh',colors:['#002f38','#07575b','#3fb6b2','#c4dfe6'],seed:14},
  {id:'city',name:'Огни города',motif:'bokeh',colors:['#0d0a1a','#1d1438','#ffb347','#ff5e8a'],seed:9},
  {id:'crystal',name:'Кристалл',motif:'poly',colors:['#0f2027','#203a43','#2c5364','#7fd8ff'],seed:4},
  {id:'lavender',name:'Лаванда',motif:'flow',colors:['#f6f0ff','#e3d6ff','#a88bff','#ff9fd6'],seed:12},
  {id:'desert',name:'Пустыня',motif:'dunes',colors:['#ffe8c7','#ffd29c','#e08a5a','#fff4d6'],seed:2},
  {id:'neon',name:'Неон',motif:'flow',colors:['#07040f','#1a0b2e','#00e5ff','#ff2bd6'],seed:8},
  {id:'mint',name:'Мята',motif:'bokeh',colors:['#effff8','#cdf5e5','#5fd4a8','#2a9d8f'],seed:6}
];

const W=1200,H=1600;
function random(seed){let a=(Number(seed)>>>0)||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v+(rgb(b)[i]-v)*t).toString(16).padStart(2,'0')).join('');
const f=n=>Math.round(n*10)/10;
const linear=(id,a,b,angle='0,0,0,1')=>{const [x1,y1,x2,y2]=angle.split(',');return`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;};
const glow=(id,color,opacity=1)=>`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
function wave(rnd,y,amp,fill,opacity){const phase=rnd()*6.28,len=W/(1+rnd()*1.5);let d=`M0 ${H}L0 ${f(y)}`;for(let x=0;x<=W;x+=40)d+=`L${x} ${f(y+Math.sin(x/len*6.28+phase)*amp+Math.sin(x/len*2.1+phase*2)*amp*.35)}`;return`<path d="${d}L${W} ${H}Z" fill="${fill}" opacity="${opacity}"/>`;}

const draw={
  aurora(c,r){let defs=linear('bg',c[0],c[1])+glow('g1',c[2],.75)+glow('g2',c[3],.7)+glow('g3',mix(c[2],c[3],.5),.55),body='<rect width="100%" height="100%" fill="url(#bg)"/>';
    for(let i=0;i<5;i++){const g=['g1','g2','g3'][i%3];body+=`<ellipse cx="${f(r()*W)}" cy="${f(H*.12+r()*H*.45)}" rx="${f(W*(.35+r()*.4))}" ry="${f(H*(.08+r()*.12))}" fill="url(#${g})" transform="rotate(${f(-30+r()*60)} ${W/2} ${H/3})"/>`;}
    for(let i=0;i<90;i++)body+=`<circle cx="${f(r()*W)}" cy="${f(r()*H*.7)}" r="${f(.6+r()*1.6)}" fill="#fff" opacity="${f(.15+r()*.6)}"/>`;return[defs,body];},
  waves(c,r){let defs=linear('bg',c[0],c[1]),body='<rect width="100%" height="100%" fill="url(#bg)"/>';
    for(let i=0;i<7;i++)body+=wave(r,H*(.3+i*.1),30+r()*60,mix(c[2],c[3],i/6),f(.18+i*.08));return[defs,body];},
  dunes(c,r){const sx=W*(.25+r()*.5),sy=H*(.3+r()*.1);let defs=linear('bg',c[0],c[1])+glow('sun',c[3],.95)+glow('halo',c[3],.35),body=`<rect width="100%" height="100%" fill="url(#bg)"/><circle cx="${f(sx)}" cy="${f(sy)}" r="${W*.55}" fill="url(#halo)"/><circle cx="${f(sx)}" cy="${f(sy)}" r="${W*.13}" fill="url(#sun)"/>`;
    for(let i=0;i<6;i++){const y=H*(.48+i*.09),amp=40+r()*70,ph=r()*W;let d=`M0 ${H}L0 ${f(y)}`;for(let x=0;x<=W+200;x+=300)d+=`Q${f(x+150)} ${f(y-amp+((x+ph)%600<300?amp*2:0))} ${x+300} ${f(y+r()*30)}`;body+=`<path d="${d}L${W} ${H}Z" fill="${mix(c[2],c[0],i/7)}" opacity="${f(.55+i*.08)}"/>`;}return[defs,body];},
  stars(c,r){let defs=`<radialGradient id="bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[0]}"/></radialGradient>`+glow('n1',c[2],.45)+glow('n2',c[3],.35)+glow('st','#ffffff',.9),body='<rect width="100%" height="100%" fill="url(#bg)"/>';
    for(let i=0;i<4;i++)body+=`<ellipse cx="${f(r()*W)}" cy="${f(r()*H)}" rx="${f(W*(.3+r()*.4))}" ry="${f(W*(.2+r()*.3))}" fill="url(#${i%2?'n2':'n1'})"/>`;
    for(let i=0;i<240;i++)body+=`<circle cx="${f(r()*W)}" cy="${f(r()*H)}" r="${f(.5+r()*r()*2.4)}" fill="#fff" opacity="${f(.25+r()*.75)}"/>`;
    for(let i=0;i<7;i++)body+=`<circle cx="${f(r()*W)}" cy="${f(r()*H)}" r="${f(10+r()*16)}" fill="url(#st)"/>`;return[defs,body];},
  mesh(c,r){let defs=c.map((color,i)=>glow('m'+i,color,.95)).join(''),body=`<rect width="100%" height="100%" fill="${c[0]}"/>`;
    for(let i=0;i<7;i++)body+=`<circle cx="${f(r()*W)}" cy="${f(r()*H)}" r="${f(W*(.45+r()*.4))}" fill="url(#m${1+i%3})"/>`;return[defs,body];},
  bokeh(c,r){let defs=linear('bg',c[0],c[1])+glow('b1',c[2],.6)+glow('b2',c[3],.6),body='<rect width="100%" height="100%" fill="url(#bg)"/>';
    for(let i=0;i<46;i++){const rad=14+r()*r()*150;body+=`<circle cx="${f(r()*W)}" cy="${f(r()*H)}" r="${f(rad)}" fill="url(#${r()<.5?'b1':'b2'})" opacity="${f(.35+r()*.6)}"/>`;}return[defs,body];},
  poly(c,r){const cols=7,rows=10,pts=[];for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const edgeX=x===0||x===cols,edgeY=y===0||y===rows;pts.push([x*W/cols+(edgeX?0:(r()-.5)*W/cols*.8),y*H/rows+(edgeY?0:(r()-.5)*H/rows*.8)]);}
    let body='';const at=(x,y)=>pts[y*(cols+1)+x],tri=(a,b,d)=>{const cx=(a[0]+b[0]+d[0])/3/W,cy=(a[1]+b[1]+d[1])/3/H,t=Math.min(1,Math.max(0,(cx+cy)/2+(r()-.5)*.18)),color=t<.5?mix(c[1],c[2],t*2):mix(c[2],c[3],(t-.5)*2);body+=`<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(d[0])} ${f(d[1])}Z" fill="${mix(color,c[0],r()*.35)}" stroke="${mix(color,c[0],.2)}" stroke-width="1"/>`;};
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=at(x,y),b=at(x+1,y),d=at(x,y+1),e=at(x+1,y+1);if(r()<.5){tri(a,b,e);tri(a,e,d);}else{tri(a,b,d);tri(b,e,d);}}
    return['',body];},
  flow(c,r){let defs=linear('bg',c[0],c[1])+linear('ln',c[2],c[3],'0,0,1,0'),body='<rect width="100%" height="100%" fill="url(#bg)"/>';const base=H*(.2+r()*.3),amp=H*(.15+r()*.15),ph=r()*6.28;
    for(let i=0;i<44;i++){const y=base+i*H*.012,a=amp*(1-i/80);let d=`M-20 ${f(y+Math.sin(ph)*a)}`;for(let x=0;x<=W+40;x+=60)d+=`L${x} ${f(y+Math.sin(x/W*5.2+ph+i*.06)*a+Math.cos(x/W*2+i*.1)*a*.3)}`;body+=`<path d="${d}" fill="none" stroke="url(#ln)" stroke-width="${f(1+r()*2.2)}" opacity="${f(.15+r()*.5)}"/>`;}return[defs,body];}
};

const cache=new Map();
export function wallpaperSVG(spec){
  const motif=MOTIFS.includes(spec?.motif)?spec.motif:'mesh',colors=[...(spec?.colors||[])].filter(v=>/^#[0-9a-f]{6}$/i.test(v));
  while(colors.length<4)colors.push(colors.length?mix(colors[colors.length-1],'#ffffff',.25):'#0b1716');
  const [defs,body]=draw[motif](colors.slice(0,4),random(spec.seed));
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
}
// Resolves any stored wallpaper value to a spec with a drawable shape.
export function resolveWallpaper(value){
  if(!value)return null;
  if(typeof value==='string')return{kind:'photo',src:value};
  if(value.kind==='preset'){const preset=SYSTEM_WALLPAPERS.find(p=>p.id===value.id);return preset?{...preset,kind:'preset',dim:value.dim}:null;}
  if(value.kind==='photo'&&typeof value.src==='string')return value;
  if(value.kind==='ai'&&Array.isArray(value.colors))return value;
  return null;
}
function imageOf(spec){
  if(spec.kind==='photo')return`url("${accountURL(spec.src)}")`;
  const key=JSON.stringify([spec.motif,spec.colors,spec.seed]);
  if(!cache.has(key)){if(cache.size>40)cache.delete(cache.keys().next().value);cache.set(key,`url("data:image/svg+xml,${encodeURIComponent(wallpaperSVG(spec))}")`);}
  return cache.get(key);
}
// CSS background-image layers for a wallpaper value, or 'none'.
export function wallpaperCSS(value){
  const spec=resolveWallpaper(value);if(!spec)return'none';
  const dim=Math.min(.7,Math.max(0,Number(spec.dim)||0)),image=imageOf(spec);
  return dim?`linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),${image}`:image;
}
const isLight=spec=>{if(!spec||spec.kind==='photo')return false;const [r,g,b]=rgb(spec.colors[0]);return(r*.2126+g*.7152+b*.0722)>150&&!(Number(spec.dim)>.25);};

// Applies this chat's own wallpaper to the open conversation, if it has one.
export function applyChatWallpaper(state,chatId){
  const el=$('.conversation');if(!el)return;
  const value=state.settings.chatWallpapers?.[chatId],css=wallpaperCSS(value);
  el.classList.toggle('has-chat-wallpaper',css!=='none');el.classList.toggle('light-wallpaper',css!=='none'&&isLight(resolveWallpaper(value)));
  if(css==='none')el.style.removeProperty('--chat-wallpaper');else el.style.setProperty('--chat-wallpaper',css);
}

const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const tile=(value,label,selected,attrs='')=>`<button type="button" class="wp-tile${selected?' selected':''}" ${attrs} aria-pressed="${selected}" style="--wp:${esc(wallpaperCSS(value))}"><span>${esc(label)}</span></button>`;

// Opens the wallpaper picker. `chat` set: wallpaper of that chat; otherwise the general one.
export function wallpaperPicker(state,save,{chat=null,onApplied}={}){
  const original=chat?state.settings.chatWallpapers?.[chat.id]:state.settings.wallpaper;
  let draft=original?structuredClone(original):null,results=[],prompt='';
  const strip=v=>{if(!v||typeof v==='string')return v;const {dim,...rest}=v;return rest;};
  const render=()=>{
    const spec=resolveWallpaper(draft),dim=Number(spec?.dim)||0,mine=state.settings.aiWallpapers||[];
    const preview=draft?wallpaperCSS(draft):'none';
    modal(chat?'Обои чата':'Обои',`<div class="wp-preview${preview==='none'?' empty':''}${isLight(spec)?' light':''}" style="--wp:${esc(preview)}"><div class="wp-bubble in">Привет! Как тебе новые обои?</div><div class="wp-bubble out">${spec?esc(spec.name||(spec.kind==='photo'?'Ваша фотография':'Обои')):(chat?'Как в общих настройках':'Без обоев')}</div></div>
      <label class="setting-row wp-dim">Затемнение<input type="range" id="wp-dim" min="0" max="0.7" step="0.05" value="${dim}" ${draft?'':'disabled'}></label>
      <h3 class="wp-head">${icon('sparkles')} Создать с ИИ</h3>
      <form class="wp-ai" id="wp-ai"><input id="wp-prompt" maxlength="200" value="${esc(prompt)}" placeholder="Например: ночной Токио в неоне" aria-label="Описание обоев" autocomplete="off"><button class="primary" id="wp-generate">Создать</button></form>
      ${results.length?`<div class="wp-grid">${results.map((v,i)=>tile(v,v.name,same(strip(draft),v),`data-result="${i}"`)).join('')}</div>`:''}
      ${mine.length?`<h3 class="wp-head">Мои ИИ-обои</h3><div class="wp-grid">${mine.map((v,i)=>tile(v,v.name,same(strip(draft),v),`data-mine="${i}"`)).join('')}</div>`:''}
      <h3 class="wp-head">Системные</h3><div class="wp-grid">${SYSTEM_WALLPAPERS.map(p=>tile({kind:'preset',id:p.id},p.name,draft?.kind==='preset'&&draft.id===p.id,`data-preset="${p.id}"`)).join('')}</div>
      <div class="wp-actions"><button type="button" class="secondary" id="wp-photo">${icon('image')}Своё фото</button>${spec&&spec.kind!=='photo'?`<button type="button" class="secondary" id="wp-shuffle">${icon('sparkles')}Другой вариант</button>`:''}<button type="button" class="secondary" id="wp-none">${chat?'Как в общих настройках':'Без обоев'}</button></div>
      <button class="primary wide-button" id="wp-apply">Применить</button>`);
    const pick=value=>{const keep=Number(draft?.dim)||0;draft=value?{...value,...(keep?{dim:keep}:{})}:null;render();};
    document.querySelectorAll('[data-preset]').forEach(el=>el.onclick=()=>pick({kind:'preset',id:el.dataset.preset}));
    document.querySelectorAll('[data-result]').forEach(el=>el.onclick=()=>pick(results[el.dataset.result]));
    document.querySelectorAll('[data-mine]').forEach(el=>el.onclick=()=>pick(mine[el.dataset.mine]));
    $('#wp-none').onclick=()=>pick(null);
    $('#wp-dim').oninput=e=>{if(!draft||typeof draft==='string')draft={kind:'photo',src:draft};draft.dim=Number(e.target.value)||0;if(!draft.dim)delete draft.dim;$('.wp-preview').style.setProperty('--wp',wallpaperCSS(draft));};
    if($('#wp-shuffle'))$('#wp-shuffle').onclick=()=>{const {kind,id,dim:_,...rest}=spec;pick({kind:'ai',name:rest.name,motif:rest.motif,colors:rest.colors,seed:Math.floor(Math.random()*1e9)});};
    $('#wp-photo').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.onchange=guard(async()=>{const file=input.files[0];if(!file)return;const media=await upload(file);pick({kind:'photo',src:'/api/media/'+media.id});});input.click();};
    $('#wp-prompt').oninput=e=>{prompt=e.target.value;};
    $('#wp-ai').onsubmit=guard(async e=>{e.preventDefault();prompt=$('#wp-prompt').value.trim();if(!prompt){$('#wp-prompt').focus();return;}
      const button=$('#wp-generate');button.disabled=true;button.textContent='Рисую…';
      try{const data=await api('/ai/wallpaper','POST',{prompt});results=(data.variants||[]).map(v=>({kind:'ai',name:v.name,motif:v.motif,colors:v.colors,seed:v.seed}));
        if(!results.length)throw new Error('ИИ не предложил вариантов. Попробуйте другое описание.');pick(results[0]);}
      finally{if(button.isConnected){button.disabled=false;button.textContent='Создать';}}});
    $('#wp-apply').onclick=guard(async()=>{
      const settings=structuredClone(state.settings);
      if(chat){settings.chatWallpapers={...(settings.chatWallpapers||{})};if(draft)settings.chatWallpapers[chat.id]=draft;else delete settings.chatWallpapers[chat.id];}
      else{if(draft)settings.wallpaper=draft;else delete settings.wallpaper;}
      // Keep the last AI wallpapers the person applied so they can reuse them in other chats.
      if(draft?.kind==='ai'){const plain=strip(draft);settings.aiWallpapers=[plain,...(settings.aiWallpapers||[]).filter(v=>!same(v,plain))].slice(0,12);}
      const previous=state.settings;state.settings=settings;
      try{await save();}catch(error){state.settings=previous;throw error;}
      $('#modal').close();toast(draft?'Обои установлены':'Обои убраны');onApplied?.();
    });
  };
  render();
}
