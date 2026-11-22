// New Year season (1 December – 14 January): snow, a garland over the chat list, a countdown banner,
// «Что нового», two winter themes and «Итоги года» — full-screen slides with the person's year in numbers.
// The server decides whether the season is on (/api/me → newYear.active); the user can switch the decoration off.
import {$,esc,api,modal,guard,toast,avatar} from './ui.js';

export const NEW_YEAR_THEMES=['Зимняя ночь','Ёлка'];
const STAMP=state=>String(state?.newYear?.year||new Date().getFullYear());
const calm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export const newYearOpen=state=>state?.newYear?.active===true;
export function newYearActive(server,settings){return server?.newYear?.active===true&&settings?.newYear!==false;}

// Days left until 1 January, Moscow midnight (server sends the exact moment).
export function daysLeft(at,time=Date.now()){return Math.max(0,Math.ceil((at-time)/86400000));}
export function plural(n,one,few,many){const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many;}
export const fmt=n=>Number(n||0).toLocaleString('ru-RU');

// ---------- Decoration: body class, snow, garland, banner, theme restore ----------
export function syncNewYear(state,save){
  const on=newYearActive(state,state.settings),s=state.settings;
  document.body.classList.toggle('newyear',on);
  const fx=on&&s.newYearFx!==false&&s.animations!==false&&!calm();
  let snow=document.querySelector('.ny-snow');
  if(fx&&!snow){
    const flakes=Array.from({length:42},(_,i)=>{const size=(4+((i*7)%9)).toFixed(0),left=((i*37)%100)+(i%3)*.3,dur=(9+((i*13)%11)).toFixed(1),delay=(-((i*17)%19)).toFixed(1),drift=((i%5)-2)*14;
      return `<i style="--s:${size}px;--x:${left}vw;--t:${dur}s;--d:${delay}s;--w:${drift}px;--o:${(.35+((i*11)%6)/10).toFixed(2)}"></i>`;}).join('');
    document.body.insertAdjacentHTML('beforeend',`<div class="ny-snow" aria-hidden="true">${flakes}</div>`);
  }
  if(!fx)snow?.remove();
  garland(on&&s.newYearGarland!==false);
  banner(state,save);
  scheduleMidnight(state);
  // A theme switched on from «Что нового» goes back to the previous one after the season.
  if(!newYearOpen(state)&&s.newYearPrevTheme!==undefined){
    if(NEW_YEAR_THEMES.includes(s.theme))s.theme=s.newYearPrevTheme||'Emerald';
    delete s.newYearPrevTheme;save?.().catch(()=>{});
  }
}
function garland(show){
  const header=document.querySelector('.side-header'),old=document.querySelector('.ny-garland');
  if(!show||!header){old?.remove();return;}
  if(old)return;
  header.insertAdjacentHTML('afterbegin',`<div class="ny-garland" aria-hidden="true">${Array.from({length:16},(_,i)=>`<span class="c${i%4}" style="--i:${i}"></span>`).join('')}</div>`);
}
function banner(state,save){
  const header=document.querySelector('.side-header'),old=document.querySelector('.ny-banner');
  const show=newYearActive(state,state.settings)&&state.settings.newYearBanner!==STAMP(state)&&header;
  if(!show){old?.remove();return;}
  const left=daysLeft(state.newYear.at),year=state.newYear.year;
  const count=left>0?`До Нового года ${left} ${plural(left,'день','дня','дней')}`:'С Новым годом! 🎆';
  const html=`<span class="ny-banner-tree" aria-hidden="true">🎄</span><span class="ny-banner-text"><b>Ваши итоги ${esc(year)}</b><small>${count} · посмотрите, каким был ваш год</small></span><button type="button" class="ny-banner-close" aria-label="Скрыть баннер">✕</button>`;
  if(old){old.innerHTML=html;return;}
  header.insertAdjacentHTML('beforeend',`<div class="ny-banner" role="button" tabindex="0" aria-label="Итоги года в Cipherion">${html}</div>`);
  const el=document.querySelector('.ny-banner');
  el.onclick=guard(async e=>{if(e.target.closest('.ny-banner-close')){e.stopPropagation();state.settings.newYearBanner=STAMP(state);el.remove();await save();return;}await openYearReview(state);});
  el.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===el){e.preventDefault();el.click();}};
}
// Salute at midnight for those who meet the New Year with the app open.
let midnight=null;
function scheduleMidnight(state){
  clearTimeout(midnight);midnight=null;
  if(!newYearActive(state,state.settings))return;
  const wait=state.newYear.at-Date.now();
  if(wait>0&&wait<86400000)midnight=setTimeout(()=>{fireworks(5200);toast('🎆 С Новым годом!');banner(state,state.saveSettings||(async()=>{}));},wait);
}

// ---------- «Что нового» ----------
export function maybeNewYearNews(state,save){
  if(!newYearActive(state,state.settings)||state.settings.newYearSeen===STAMP(state))return;
  setTimeout(()=>{if(!document.querySelector('#modal')?.open&&!document.querySelector('.yr'))newYearNews(state,save);},1100);
}
export function newYearNews(state,save){
  const s=state.settings,themed=NEW_YEAR_THEMES.includes(s.theme),year=state.newYear?.year||'';
  const feature=(icon,title,text)=>`<div class="ny-feature"><span aria-hidden="true">${icon}</span><div><b>${title}</b><small>${text}</small></div></div>`;
  const el=modal('Новый год в Cipherion',`<div class="ny-news"><div class="ny-news-hero" aria-hidden="true">🎄</div><p class="ny-news-lead">С 1 декабря по 14 января</p>
    ${feature('✨',`Итоги ${esc(year)}`,'Сколько вы написали, с кем общались чаще всего, любимый стикер и кто вы в этом году.')}
    ${feature('❄️','Снег и гирлянда','Снегопад на фоне и огоньки над списком чатов. Отключаются в настройках.')}
    ${feature('🌌','Темы «Зимняя ночь» и «Ёлка»','Ледяное сияние или ёлочная зелень с золотом.')}
    ${feature('🎆','Обратный отсчёт и салют','Баннер считает дни до праздника, а в полночь — салют.')}
    <p class="ny-news-note">${themed?'Тема уже включена.':'Если включить тему здесь, после праздников вернётся ваша прежняя.'}</p>
    <button class="primary" id="ny-review">Смотреть мои итоги</button>${themed?'':'<button class="secondary" id="ny-theme-on">Включить «Зимнюю ночь»</button>'}<button class="secondary" id="ny-later">Позже</button></div>`);
  const done=async()=>{if(s.newYearSeen!==STAMP(state)){s.newYearSeen=STAMP(state);await save();}};
  el.addEventListener('close',()=>{done().catch(()=>{});},{once:true});
  $('#ny-later').onclick=()=>el.close();
  $('#ny-review').onclick=guard(async()=>{el.close();await openYearReview(state);});
  if($('#ny-theme-on'))$('#ny-theme-on').onclick=guard(async()=>{s.newYearPrevTheme=s.theme||'Emerald';s.theme='Зимняя ночь';delete s.accent;s.newYear=true;s.newYearSeen=STAMP(state);await save();el.close();toast('Тема «Зимняя ночь» включена ❄️');});
}

// ---------- Settings ----------
export function newYearSettings(state,save){
  const s=state.settings,row=(key,title,detail,value)=>`<label class="setting-row"><div>${title}<small>${detail}</small></div><input type="checkbox" data-ny="${key}" ${value?'checked':''}></label>`;
  modal('🎄 Новый год',`<button class="primary ny-open-review" id="ny-settings-review">✨ Мои итоги ${esc(state.newYear?.year||'')}</button>
    <div class="settings-group">${row('newYear','Новогоднее оформление','Баннер с отсчётом и итогами до 14 января',s.newYear!==false)}${row('newYearFx','Снегопад','Снежинки на фоне приложения',s.newYearFx!==false)}${row('newYearGarland','Гирлянда','Огоньки над списком чатов',s.newYearGarland!==false)}</div>
    <h3 class="group-caption">Темы</h3><div class="ny-theme-row">${NEW_YEAR_THEMES.map(name=>`<button type="button" class="ny-theme-card ${s.theme===name?'selected':''}" data-ny-theme="${esc(name)}"><span>${name==='Ёлка'?'🎄':'❄️'}</span>${esc(name)}</button>`).join('')}</div>
    <button class="secondary" id="ny-news">Что нового</button>`);
  document.querySelectorAll('[data-ny]').forEach(el=>el.onchange=guard(async()=>{s[el.dataset.ny]=el.checked;await save();}));
  document.querySelectorAll('[data-ny-theme]').forEach(el=>el.onclick=guard(async()=>{if(!NEW_YEAR_THEMES.includes(s.theme))s.newYearPrevTheme=s.theme||'Emerald';s.theme=el.dataset.nyTheme;delete s.accent;await save();document.querySelectorAll('[data-ny-theme]').forEach(b=>b.classList.toggle('selected',b===el));}));
  $('#ny-news').onclick=()=>newYearNews(state,save);
  $('#ny-settings-review').onclick=guard(async()=>{$('#modal').close();await openYearReview(state);});
}

// ---------- «Итоги года» ----------
const KIND_LABELS=[['text','Текст','💬'],['media','Фото и видео','📸'],['voice','Голосовые и кружочки','🎙️'],['sticker','Стикеры','🎨'],['file','Файлы','📎'],['other','Опросы и другое','📊']];
const MONTH_SHORT=['Я','Ф','М','А','М','И','И','А','С','О','Н','Д'];
const MONTH_IN=['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
const WEEKDAY_ON=['по воскресеньям','по понедельникам','по вторникам','по средам','по четвергам','по пятницам','по субботам'];
const hourText=h=>h===null?'':`${String(h).padStart(2,'0')}:00–${String((h+1)%24).padStart(2,'0')}:00`;

// The slides, built only from what the year actually has: an empty category is skipped, not shown as zero.
export function reviewSlides(r,me){
  const slides=[],y=esc(r.year);
  slides.push({tone:'intro',html:`<div class="yr-hero">${avatar(me?.name||'',me?.avatar,'large')}<p class="yr-kicker">Cipherion · итоги</p><h1 class="yr-year">${y}</h1><p class="yr-lead">${esc(me?.name||'')}, вот каким был ваш год в переписке</p></div>`});
  if(!r.messages){
    slides.push({tone:'quiet',html:`<div class="yr-center"><div class="yr-emoji">🌱</div><h2>Год только начинается</h2><p>В ${y} году вы ещё не писали сообщений. Напишите кому-нибудь «С наступающим!» — и итоги оживут.</p></div>`});
    return slides;
  }
  const perDay=r.activeDays?Math.max(1,Math.round(r.messages/r.activeDays)):0;
  slides.push({tone:'messages',html:`<div class="yr-center"><p class="yr-kicker">Вы отправили</p><div class="yr-big" data-count="${r.messages}">${fmt(r.messages)}</div><h2>${plural(r.messages,'сообщение','сообщения','сообщений')}</h2>
    ${r.percentile!==null&&r.percentile>=50?`<p class="yr-pill">Больше, чем ${r.percentile}% пользователей Cipherion</p>`:''}<p>${r.chats?`в ${fmt(r.chats)} ${plural(r.chats,'чате','чатах','чатах')} · `:''}около ${fmt(perDay)} в активный день</p></div>`});
  const kinds=KIND_LABELS.filter(([k])=>r.kinds[k]>0),top=Math.max(...kinds.map(([k])=>r.kinds[k]));
  if(kinds.length>1)slides.push({tone:'kinds',html:`<div class="yr-block"><p class="yr-kicker">Из чего состоял ваш год</p><h2>${KIND_LABELS.find(([k])=>r.kinds[k]===top)[2]} ${esc(KIND_LABELS.find(([k])=>r.kinds[k]===top)[1])} — ваш главный жанр</h2>
    <div class="yr-bars">${kinds.map(([k,label,em])=>`<div class="yr-bar"><span>${em} ${esc(label)}</span><i style="--w:${Math.max(4,Math.round(r.kinds[k]/top*100))}%"></i><b>${fmt(r.kinds[k])}</b></div>`).join('')}</div></div>`});
  const peak=Math.max(...r.months);
  slides.push({tone:'rhythm',html:`<div class="yr-block"><p class="yr-kicker">Ваш ритм</p><h2>Больше всего вы писали в ${MONTH_IN[r.peakMonth]}</h2>
    <div class="yr-months" role="img" aria-label="Сообщения по месяцам">${r.months.map((n,i)=>`<span class="${i===r.peakMonth?'peak':''}" style="--h:${peak?Math.max(3,Math.round(n/peak*100)):3}%"><i></i><small>${MONTH_SHORT[i]}</small></span>`).join('')}</div>
    <div class="yr-facts"><div><b>${fmt(r.activeDays)}</b><small>${plural(r.activeDays,'день','дня','дней')} на связи</small></div><div><b>${fmt(r.streak)}</b><small>${plural(r.streak,'день','дня','дней')} подряд — рекорд</small></div><div><b>${hourText(r.peakHour)}</b><small>любимое время, чаще ${WEEKDAY_ON[r.peakWeekday]||''}</small></div></div></div>`});
  if(r.people?.length){
    const [first,...rest]=r.people;
    slides.push({tone:'people',html:`<div class="yr-block"><p class="yr-kicker">Ваши люди года</p><div class="yr-best">${avatar(first.user?.name||'',first.user?.avatar,'large')}<h2>${esc(first.user?.name||'Собеседник')}</h2><p>${fmt(first.messages)} ${plural(first.messages,'сообщение','сообщения','сообщений')} на двоих</p></div>
      ${rest.length?`<ol class="yr-people">${rest.map((p,i)=>`<li><span class="yr-rank">${i+2}</span>${avatar(p.user?.name||'',p.user?.avatar)}<span>${esc(p.user?.name||'Собеседник')}</span><b>${fmt(p.messages)}</b></li>`).join('')}</ol>`:''}</div>`});
  }
  const extras=[];
  if(r.reactions?.given)extras.push(`<div class="yr-tile"><span class="yr-tile-emoji">${r.reactions.top.map(t=>esc(t.emoji)).join(' ')}</span><b>${fmt(r.reactions.given)}</b><small>${plural(r.reactions.given,'реакция','реакции','реакций')} от вас${r.reactions.received?` · ${fmt(r.reactions.received)} получено`:''}</small></div>`);
  if(r.sticker)extras.push(`<div class="yr-tile">${r.sticker.source?`<img class="yr-sticker" src="${esc(r.sticker.source)}" alt="${esc(r.sticker.label)}">`:`<span class="yr-tile-emoji">${esc(r.sticker.emoji||'🎨')}</span>`}<b>${fmt(r.sticker.count)} ${plural(r.sticker.count,'раз','раза','раз')}</b><small>любимый стикер${r.sticker.label?` «${esc(r.sticker.label)}»`:''}</small></div>`);
  if(r.calls?.count)extras.push(`<div class="yr-tile"><span class="yr-tile-emoji">📞</span><b>${r.calls.minutes>=60?`${fmt(Math.round(r.calls.minutes/60))} ч`:`${fmt(r.calls.minutes)} мин`}</b><small>в звонках · ${fmt(r.calls.count)} ${plural(r.calls.count,'звонок','звонка','звонков')}</small></div>`);
  if(r.stories)extras.push(`<div class="yr-tile"><span class="yr-tile-emoji">🌀</span><b>${fmt(r.stories)}</b><small>${plural(r.stories,'история','истории','историй')}</small></div>`);
  if(extras.length)slides.push({tone:'extras',html:`<div class="yr-block"><p class="yr-kicker">А ещё</p><h2>Год в деталях</h2><div class="yr-tiles">${extras.join('')}</div></div>`});
  slides.push({tone:'persona',html:`<div class="yr-center"><p class="yr-kicker">В ${y} году вы —</p><div class="yr-emoji yr-pop">${esc(r.persona.emoji)}</div><h2 class="yr-title">${esc(r.persona.title)}</h2><p>${esc(r.persona.text)}</p></div>`});
  slides.push({tone:'final',final:true,html:`<div class="yr-block"><div class="yr-card" id="yr-card"><div class="yr-card-head">${avatar(me?.name||'',me?.avatar)}<div><b>${esc(me?.name||'')}</b><small>Итоги ${y} · Cipherion</small></div></div>
    <div class="yr-card-grid"><div><b>${fmt(r.messages)}</b><small>сообщений</small></div><div><b>${fmt(r.activeDays)}</b><small>дней на связи</small></div><div><b>${fmt(r.chats)}</b><small>чатов</small></div><div><b>${esc(r.persona.emoji)}</b><small>${esc(r.persona.title)}</small></div></div>
    ${r.people?.[0]?`<p class="yr-card-line">Человек года: <b>${esc(r.people[0].user?.name||'')}</b></p>`:''}</div>
    <h2 class="yr-wish">С Новым годом! 🎄</h2><div class="yr-actions"><button type="button" class="primary" id="yr-share">Поделиться</button><button type="button" class="secondary" id="yr-again">Смотреть снова</button></div></div>`});
  return slides;
}
export function shareText(r){
  const lines=[`Мои итоги ${r.year} в Cipherion ✨`,`💬 ${fmt(r.messages)} ${plural(r.messages,'сообщение','сообщения','сообщений')}`,`📅 ${fmt(r.activeDays)} ${plural(r.activeDays,'день','дня','дней')} на связи, рекорд — ${fmt(r.streak)} подряд`];
  if(r.peakMonth!==null&&r.messages)lines.push(`🔥 Самый активный месяц — ${r.peakMonthName}`);
  lines.push(`${r.persona.emoji} ${r.persona.title}`);
  return lines.join('\n');
}

export async function openYearReview(state){
  if(document.querySelector('.yr'))return;
  const data=await api('/year-review');
  const slides=reviewSlides(data,state.user);
  const el=document.createElement('dialog');el.className='yr';el.setAttribute('aria-label',`Итоги ${data.year}`);
  el.innerHTML=`<div class="yr-stage"><div class="yr-progress">${slides.map(()=>'<span><i></i></span>').join('')}</div><button type="button" class="yr-close" aria-label="Закрыть">✕</button>
    <div class="yr-flakes" aria-hidden="true">${Array.from({length:18},(_,i)=>`<i style="--x:${(i*53)%100}%;--t:${7+(i*7)%8}s;--d:${-(i*3)%9}s;--s:${3+(i%4)*2}px"></i>`).join('')}</div>
    <div class="yr-slides">${slides.map((s,i)=>`<section class="yr-slide tone-${s.tone}" data-i="${i}" aria-hidden="true">${s.html}</section>`).join('')}</div>
    <button type="button" class="yr-nav prev" aria-label="Назад"></button><button type="button" class="yr-nav next" aria-label="Дальше"></button></div>`;
  document.body.append(el);el.showModal();
  const SLIDE=calm()?9000:6500;let at=-1,start=0,paused=false,elapsed=0,frame=0,closed=false;
  const bars=[...el.querySelectorAll('.yr-progress i')],sections=[...el.querySelectorAll('.yr-slide')];
  const close=()=>{if(closed)return;closed=true;cancelAnimationFrame(frame);el.close();el.remove();};
  function show(i){
    if(i<0)i=0;if(i>=slides.length){close();return;}
    at=i;elapsed=0;start=performance.now();
    sections.forEach((s,n)=>{s.classList.toggle('active',n===i);s.setAttribute('aria-hidden',String(n!==i));});
    bars.forEach((b,n)=>b.style.width=n<i?'100%':'0%');
    const big=sections[i].querySelector('[data-count]');if(big)countUp(big);
    if(slides[i].final&&!calm()&&!sections[i].querySelector('canvas'))fireworks(3600,sections[i]);
  }
  function tick(t){
    if(closed)return;
    if(!paused&&!slides[at]?.final){elapsed=t-start;bars[at].style.width=Math.min(100,elapsed/SLIDE*100)+'%';if(elapsed>=SLIDE)show(at+1);}
    else if(slides[at]?.final)bars[at].style.width='100%';
    frame=requestAnimationFrame(tick);
  }
  const hold=on=>{if(on){paused=true;}else if(paused){paused=false;start=performance.now()-elapsed;}};
  el.querySelector('.yr-close').onclick=close;
  el.querySelector('.yr-nav.prev').onclick=()=>show(at-1);
  el.querySelector('.yr-nav.next').onclick=()=>{if(!slides[at].final)show(at+1);};
  el.addEventListener('cancel',e=>{e.preventDefault();close();});
  el.addEventListener('keydown',e=>{if(e.key==='ArrowRight')show(at+1);if(e.key==='ArrowLeft')show(at-1);});
  el.addEventListener('pointerdown',e=>{if(e.target.closest('.yr-nav'))hold(true);});
  el.addEventListener('pointerup',()=>hold(false));el.addEventListener('pointercancel',()=>hold(false));
  const share=el.querySelector('#yr-share'),again=el.querySelector('#yr-again');
  if(share)share.onclick=guard(async()=>{const text=shareText(data);if(navigator.share){try{await navigator.share({title:`Итоги ${data.year}`,text});return;}catch(e){if(e?.name==='AbortError')return;}}await navigator.clipboard?.writeText(text);toast('Итоги скопированы — вставьте в любой чат');});
  if(again)again.onclick=()=>show(0);
  show(0);frame=requestAnimationFrame(tick);
}
function countUp(el){
  const target=Number(el.dataset.count)||0;if(calm()||target<10){el.textContent=fmt(target);return;}
  const t0=performance.now(),dur=1400;
  const step=t=>{const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(Math.round(target*e));if(p<1&&el.isConnected)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}

// Canvas salute: a few rockets that burst into sparks. Removes itself.
export function fireworks(ms=4000,host=document.body){
  if(calm())return;
  const c=document.createElement('canvas');c.className='ny-fireworks';c.setAttribute('aria-hidden','true');host.prepend(c);
  const ctx=c.getContext('2d');if(!ctx){c.remove();return;}
  const dpr=Math.min(2,window.devicePixelRatio||1),box=host===document.body?{width:innerWidth,height:innerHeight}:host.getBoundingClientRect(),W=c.width=Math.round(box.width*dpr),H=c.height=Math.round(box.height*dpr);
  const colors=['#ffd166','#ff6b9a','#7cf2c4','#8ab8ff','#ffffff','#ff9f43'],sparks=[];let last=0,stop=performance.now()+ms;
  const burst=()=>{const x=W*(.15+Math.random()*.7),y=H*(.12+Math.random()*.35),color=colors[Math.floor(Math.random()*colors.length)];
    for(let i=0;i<48;i++){const a=Math.PI*2*i/48,v=(1.4+Math.random()*2.2)*dpr;sparks.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:1,color});}};
  const draw=t=>{
    ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation='lighter';
    if(t<stop&&t-last>420){burst();last=t;}
    for(let i=sparks.length-1;i>=0;i--){const p=sparks[i];p.x+=p.vx;p.y+=p.vy;p.vy+=.035*dpr;p.vx*=.985;p.life-=.014;
      if(p.life<=0){sparks.splice(i,1);continue;}ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,1.8*dpr,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    if(t<stop||sparks.length)requestAnimationFrame(draw);else c.remove();
  };
  requestAnimationFrame(draw);
}
