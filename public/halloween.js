// Halloween season (29 October – 3 November): themes, ambient bats and fog, the chat-list banner,
// «Что нового», ghost messages and the «Сладость или гадость» mini-game. The server decides
// whether the season is on (/api/me → halloween.active); the user can switch the decoration off.
import {$,esc,api,modal,guard,toast} from './ui.js';

export const HALLOWEEN_THEMES=['Ночь тыкв','Зелье'];
const YEAR=String(new Date().getFullYear());
const BAT='<svg viewBox="0 0 64 28" aria-hidden="true"><path d="M32 8c2-4 4-5 5-3l1 4c4-6 12-9 26-5-6 2-9 6-9 12-4-3-8-3-10 1-2-3-5-3-7 1-1-2-3-3-6-3s-5 1-6 3c-2-4-5-4-7-1-2-4-6-4-10-1 0-6-3-10-9-12 14-4 22-1 26 5l1-4c1-2 3-1 5 3z"/></svg>';
const calm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export const seasonOpen=state=>state?.halloween?.active===true;
export function halloweenActive(server,settings){return server?.halloween?.active===true&&settings?.halloween!==false;}
export const ghostAllowed=chat=>!!chat&&['direct','group'].includes(chat.kind);

// ---------- Decoration: body class, ambient layer, banner, theme restore ----------
export function syncHalloween(state,save){
  const on=halloweenActive(state,state.settings),s=state.settings;
  document.body.classList.toggle('halloween',on);
  const fx=on&&s.halloweenFx!==false&&s.animations!==false;
  const ambient=document.querySelector('.ambient');
  let layer=document.querySelector('.hw-layer');
  if(fx&&ambient&&!layer){ambient.insertAdjacentHTML('beforeend','<div class="hw-layer"><div class="hw-moon"></div><div class="hw-fog"></div><div class="hw-fog two"></div></div>');}
  if(!fx)layer?.remove();
  let bats=document.querySelector('.hw-bats');
  if(fx&&!bats)document.body.insertAdjacentHTML('beforeend',`<div class="hw-bats" aria-hidden="true">${[0,1,2].map(i=>`<span class="hw-bat b${i}">${BAT}</span>`).join('')}</div>`);
  if(!fx)bats?.remove();
  banner(state,save);
  // A theme switched on from «Что нового» goes back to the previous one after the season.
  if(!seasonOpen(state)&&s.halloweenPrevTheme!==undefined){
    if(HALLOWEEN_THEMES.includes(s.theme))s.theme=s.halloweenPrevTheme||'Emerald';
    delete s.halloweenPrevTheme;save?.().catch(()=>{});
  }
}
function banner(state,save){
  const header=document.querySelector('.side-header'),old=document.querySelector('.hw-banner');
  const show=halloweenActive(state,state.settings)&&state.settings.halloweenBanner!==YEAR&&header;
  if(!show){old?.remove();return;}
  if(old)return;
  header.insertAdjacentHTML('beforeend',`<div class="hw-banner" role="button" tabindex="0" aria-label="Хэллоуин в Cipherion: что нового"><span class="hw-banner-pumpkin" aria-hidden="true">🎃</span><span class="hw-banner-text"><b>Тыквенная неделя</b><small>Темы, призрачные сообщения и игра «Сладость или гадость»</small></span><button type="button" class="hw-banner-close" aria-label="Скрыть баннер">✕</button></div>`);
  const el=document.querySelector('.hw-banner');
  el.onclick=guard(async e=>{if(e.target.closest('.hw-banner-close')){e.stopPropagation();state.settings.halloweenBanner=YEAR;el.remove();await save();return;}whatsNew(state,save);});
  el.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===el){e.preventDefault();el.click();}};
}

// ---------- «Что нового» ----------
export function maybeWhatsNew(state,save){
  if(!halloweenActive(state,state.settings)||state.settings.halloweenSeen===YEAR)return;
  setTimeout(()=>{if(!document.querySelector('#modal')?.open)whatsNew(state,save);},900);
}
export function whatsNew(state,save){
  const s=state.settings,themed=HALLOWEEN_THEMES.includes(s.theme);
  const feature=(icon,title,text)=>`<div class="hw-feature"><span aria-hidden="true">${icon}</span><div><b>${title}</b><small>${text}</small></div></div>`;
  const el=modal('Хэллоуин в Cipherion',`<div class="hw-news"><div class="hw-news-hero" aria-hidden="true">🎃</div><p class="hw-news-lead">Сезонное обновление до 3 ноября включительно</p>
    ${feature('🌙','Темы «Ночь тыкв» и «Зелье»','Тыквенный или ядовито-зелёный акцент, туман и летучие мыши. Отключается в настройках.')}
    ${feature('👻','Призрачные сообщения','Нажмите 👻 рядом с полем ввода: сообщение исчезнет через минуту после прочтения.')}
    ${feature('🍬','«Сладость или гадость»','Мини-игра в личных чатах и группах — в меню 📎.')}
    ${feature('🦇','Жуткие стикеры','Анимированный набор «Хэллоуин» уже в вашей панели стикеров и останется после праздника.')}
    ${feature('🧙','Рамки профиля','Тыква, слизь, призрак и ведьма — в оформлении профиля VIP.')}
    <p class="hw-news-note">${themed?'Тема уже включена.':'Если включить тему здесь, после праздника вернётся ваша прежняя.'}</p>
    ${themed?'':'<button class="primary" id="hw-theme-on">Включить «Ночь тыкв»</button>'}<button class="secondary" id="hw-later">${themed?'Отлично':'Позже'}</button></div>`);
  const done=async()=>{if(s.halloweenSeen!==YEAR){s.halloweenSeen=YEAR;await save();}};
  el.addEventListener('close',()=>{done().catch(()=>{});},{once:true});
  $('#hw-later').onclick=guard(async()=>{el.close();});
  if($('#hw-theme-on'))$('#hw-theme-on').onclick=guard(async()=>{s.halloweenPrevTheme=s.theme||'Emerald';s.theme='Ночь тыкв';delete s.accent;s.halloween=true;s.halloweenSeen=YEAR;await save();el.close();toast('Тема «Ночь тыкв» включена 🎃');});
}

// ---------- Settings ----------
export function halloweenSettings(state,save){
  const s=state.settings,row=(key,title,detail,value)=>`<label class="setting-row"><div>${title}<small>${detail}</small></div><input type="checkbox" data-hw="${key}" ${value?'checked':''}></label>`;
  modal('🎃 Хэллоуин',`<div class="settings-group">${row('halloween','Хэллоуин-оформление','Баннер, летучие мыши и туман до 3 ноября',s.halloween!==false)}${row('halloweenFx','Летучие мыши и туман','Анимация на фоне приложения',s.halloweenFx!==false)}${row('ghostMessages','Принимать призрачные сообщения','Собеседник увидит, когда вы открыли такое сообщение: с этого момента идёт минута',s.ghostMessages!==false)}</div>
    <h3 class="group-caption">Темы</h3><div class="hw-theme-row">${HALLOWEEN_THEMES.map(name=>`<button type="button" class="hw-theme-card ${s.theme===name?'selected':''}" data-hw-theme="${esc(name)}"><span>${name==='Зелье'?'🧪':'🎃'}</span>${esc(name)}</button>`).join('')}</div>
    <button class="secondary" id="hw-news">Что нового</button>`);
  document.querySelectorAll('[data-hw]').forEach(el=>el.onchange=guard(async()=>{s[el.dataset.hw]=el.checked;await save();}));
  document.querySelectorAll('[data-hw-theme]').forEach(el=>el.onclick=guard(async()=>{if(!HALLOWEEN_THEMES.includes(s.theme))s.halloweenPrevTheme=s.theme||'Emerald';s.theme=el.dataset.hwTheme;delete s.accent;await save();document.querySelectorAll('[data-hw-theme]').forEach(b=>b.classList.toggle('selected',b===el));}));
  $('#hw-news').onclick=()=>whatsNew(state,save);
}

// ---------- Composer: ghost mode and the game ----------
export function decorateComposer(state,chat){
  const form=$('#composer');if(!form)return;
  form.classList.toggle('ghost-mode',!!state.ghostMode);
  if(!seasonOpen(state)||!ghostAllowed(chat)||$('#ghost-toggle'))return;
  form.querySelector('#draft')?.insertAdjacentHTML('afterend',`<button type="button" class="icon-button ghost-toggle" id="ghost-toggle" aria-pressed="${!!state.ghostMode}" title="Призрачное сообщение" aria-label="Призрачное сообщение: исчезнет через минуту после прочтения">👻</button>`);
  $('#ghost-toggle').onclick=()=>{state.ghostMode=!state.ghostMode;const draft=$('#draft');form.classList.toggle('ghost-mode',state.ghostMode);$('#ghost-toggle').setAttribute('aria-pressed',String(state.ghostMode));if(draft)draft.placeholder=state.ghostMode?'Призрачное сообщение':'Сообщение';if(state.ghostMode)toast('👻 Следующие сообщения исчезнут через минуту после прочтения');draft?.focus();};
}
export const treatMenuButton=(state,chat)=>seasonOpen(state)&&ghostAllowed(chat)?'<button id="treat-create"><span class="hw-menu-emoji" aria-hidden="true">🍬</span>Сладость или гадость</button>':'';

// ---------- Messages ----------
export function ghostLine(m){
  if(!m.ghost||m.deleted)return '';
  return `<div class="ghost-line"><span aria-hidden="true">👻</span><small ${m.ghost_until?`data-ghost-until="${Number(m.ghost_until)}"`:''}>${m.ghost_until?countdown(m.ghost_until):'Исчезнет через минуту после прочтения'}</small></div>`;
}
function countdown(until){const left=Math.max(0,Math.ceil((until-Date.now())/1000));return left?`Исчезнет через 0:${String(left).padStart(2,'0')}`.replace('0:60','1:00'):'Исчезает…';}
export function treatCard(m,me){
  const result=m.game?.result,choice={treat:'Сладость',trick:'Гадость'};
  if(result)return `<div class="treat-card done ${result.kind==='treat'?'is-treat':'is-trick'}"><div class="treat-title">🍬 Сладость или гадость?</div><div class="treat-result"><span class="treat-emoji" aria-hidden="true">${esc(result.emoji)}</span><b>${esc(result.text)}</b><small>${esc(result.by===me?'Вы':result.name||'Собеседник')} · выбор «${choice[result.choice]||''}»</small></div></div>`;
  return `<div class="treat-card"><div class="treat-title">🍬 Сладость или гадость?</div>${m.user_id===me||m.pending?'<small class="treat-wait">Ждём, что выберет собеседник…</small>':`<small class="treat-wait">Выберите — и узнаете, что выпало</small><div class="treat-actions"><button type="button" class="primary" data-treat="${m.id}" data-choice="treat">Сладость</button><button type="button" class="secondary" data-treat="${m.id}" data-choice="trick">Гадость</button></div>`}</div>`;
}
export function bindHalloween(box,reload){
  box.querySelectorAll('[data-treat]').forEach(el=>el.onclick=guard(async()=>{
    box.querySelectorAll(`[data-treat="${el.dataset.treat}"]`).forEach(b=>b.disabled=true);
    try{await api(`/messages/${el.dataset.treat}/treat`,'POST',{choice:el.dataset.choice});}
    finally{box.querySelectorAll(`[data-treat="${el.dataset.treat}"]`).forEach(b=>b.disabled=false);}
    const played=await api('/messages/'+el.dataset.treat);burst(played.game?.result?.kind);await reload(false);
  }));
  tickGhosts();
}
let ticker=null;
function tickGhosts(){
  const update=()=>{const els=document.querySelectorAll('[data-ghost-until]');if(!els.length){clearInterval(ticker);ticker=null;return;}els.forEach(el=>{el.textContent=countdown(Number(el.dataset.ghostUntil));el.closest('.message')?.classList.toggle('vanishing',Number(el.dataset.ghostUntil)<=Date.now());});};
  update();if(!ticker&&document.querySelector('[data-ghost-until]'))ticker=setInterval(update,1000);
}
export function burst(kind){
  if(!kind)return;
  if(calm()){toast(kind==='treat'?'🍬 Сладость!':'👻 Гадость!');return;}
  const set=kind==='treat'?['🍬','🍭','🍫','🧁','🍪']:['👻','🦇','🕷️','💀','🎃'];
  const layer=document.createElement('div');layer.className='hw-burst '+kind;layer.setAttribute('aria-hidden','true');
  layer.innerHTML=Array.from({length:22},(_,i)=>`<span style="--x:${Math.round(Math.random()*100)}vw;--d:${(Math.random()*.6).toFixed(2)}s;--r:${Math.round(Math.random()*120-60)}deg">${set[i%set.length]}</span>`).join('')+(kind==='trick'?'<b class="hw-boo">БУ!</b>':'');
  document.body.append(layer);setTimeout(()=>layer.remove(),2400);navigator.vibrate?.(kind==='trick'?[40,30,80]:12);
}
