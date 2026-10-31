import {accountURL} from './account-context.js';
import {emojiCategories,searchEmoji} from './emoji-data.js';
import {esc,api,icon,toast,vipBadge} from './ui.js';
import {VIP_BADGES} from './vip-badges.js';
import {renderCustom} from './stickers.js';

// VIP badge picker ("premium emoji" next to the name): quick badges, any emoji from the
// catalogue or any sticker / custom emoji the person can see. Opens as its own sheet so it
// works on top of the profile, editor or studio. Resolves with the value or null when cancelled.
export function pickBadge(current='✦'){
 return new Promise(resolve=>{
  const sheet=document.createElement('dialog');sheet.className='badge-sheet';
  let tab='badges',packs=null,packId='recent',done=false;const cache=new Map();
  sheet.innerHTML=`<div class="ess-head"><b>Значок у имени</b><button type="button" class="ess-close" aria-label="Закрыть">${icon('close')}</button></div>
   <div class="ess-current"><span class="ess-preview">${vipBadge({vip:true,vipBadge:current})}</span><small>Сейчас рядом с именем</small>${current&&current!=='✦'?'<button type="button" class="pe-text-button" data-ess-clear>Вернуть VIP</button>':''}</div>
   <input class="ess-search" type="search" placeholder="Поиск эмодзи" autocomplete="off">
   <div class="ess-tabs" role="tablist"><button type="button" data-ess-tab="badges">Значки</button><button type="button" data-ess-tab="emoji">Эмодзи</button><button type="button" data-ess-tab="stickers">Стикеры</button></div>
   <div class="ess-body"></div>`;
  document.body.append(sheet);
  const body=sheet.querySelector('.ess-body'),search=sheet.querySelector('.ess-search');
  const finish=value=>{if(done)return;done=true;sheet.close?.();sheet.remove();resolve(value);};
  const cell=value=>`<button type="button" class="ess-cell ${value===current?'active':''}" data-ess-value="${esc(value)}">${renderCustom(value)}</button>`;
  const stickerCell=s=>`<button type="button" class="ess-cell ess-sticker ${':ce['+s.id+']'===current?'active':''}" data-ess-value=":ce[${esc(s.id)}]" title="${esc(s.label||'')}"><img src="${esc(accountURL(s.poster||s.url))}" alt="${esc(s.label||'Стикер')}" loading="lazy" decoding="async"></button>`;
  function drawBadges(){body.innerHTML=`<div class="ess-grid ess-badges">${VIP_BADGES.map(([symbol,label])=>`<button type="button" class="ess-cell ${symbol===current?'active':''}" data-ess-value="${esc(symbol)}" title="${esc(label)}">${vipBadge({vip:true,vipBadge:symbol})}</button>`).join('')}</div><p class="ess-empty">Или выберите любой эмодзи, эмодзи из пака или стикер на соседних вкладках</p>`;}
  function drawEmoji(){const q=search.value.trim();
   if(q){const found=searchEmoji(q);body.innerHTML=found.length?`<div class="ess-grid">${found.map(cell).join('')}</div>`:'<p class="ess-empty">Ничего не найдено</p>';return;}
   body.innerHTML=emojiCategories.map(({title,list})=>`<h5>${esc(title)}</h5><div class="ess-grid">${(Array.isArray(list)?list:String(list).split(/\s+/)).filter(Boolean).map(cell).join('')}</div>`).join('');}
  async function items(id){if(cache.has(id))return cache.get(id);let list=[];
   if(id==='recent'||id==='favorites')list=await api('/stickers/'+id).catch(()=>[]);else list=(await api('/packs/'+encodeURIComponent(id))).items||[];
   cache.set(id,list);return list;}
  async function drawStickers(){
   if(!packs){body.innerHTML='<p class="ess-empty">Загружаем наборы…</p>';const seen=new Set();packs=[];
    for(const mode of ['installed','mine',''])for(const p of await api('/packs'+(mode?'?mode='+mode:'')).catch(()=>[]))if(!seen.has(p.id)){seen.add(p.id);packs.push(p);}}
   if(tab!=='stickers')return;const q=search.value.trim().toLowerCase();
   const list=[{id:'recent',title:'Недавние'},{id:'favorites',title:'Избранные'},...packs.filter(p=>!q||p.title.toLowerCase().includes(q))];
   if(!list.some(p=>p.id===packId))packId='recent';
   body.innerHTML=`<div class="ess-packs">${list.map(p=>`<button type="button" class="ess-pack ${p.id===packId?'active':''}" data-ess-pack="${esc(p.id)}" title="${esc(p.title)}">${p.cover?`<img src="${esc(accountURL(p.cover))}" alt="">`:p.id==='recent'?icon('clock'):p.id==='favorites'?icon('star'):''}<small>${esc(p.title)}</small></button>`).join('')}</div><div class="ess-grid ess-stickers"><p class="ess-empty">Загрузка…</p></div>`;
   body.querySelectorAll('[data-ess-pack]').forEach(b=>b.onclick=()=>{packId=b.dataset.essPack;drawStickers();});
   const id=packId,rows=await items(id).catch(()=>[]);if(id!==packId||tab!=='stickers')return;
   const grid=body.querySelector('.ess-stickers');if(grid)grid.innerHTML=rows.length?rows.map(stickerCell).join(''):`<p class="ess-empty">${id==='recent'?'Здесь появятся стикеры, которые вы отправляли':id==='favorites'?'Добавьте стикеры в избранное':'Набор пуст'}</p>`;}
  function draw(){sheet.querySelectorAll('[data-ess-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.essTab===tab);b.setAttribute('aria-selected',b.dataset.essTab===tab);});
   search.hidden=tab==='badges';search.placeholder=tab==='emoji'?'Поиск эмодзи':'Поиск наборов';if(tab==='badges')drawBadges();else if(tab==='emoji')drawEmoji();else drawStickers().catch(e=>{body.innerHTML=`<p class="ess-empty">${esc(e.message||'Не удалось загрузить')}</p>`;});}
  sheet.querySelectorAll('[data-ess-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.essTab;search.value='';draw();});
  search.oninput=draw;
  body.addEventListener('click',e=>{const b=e.target.closest('[data-ess-value]');if(b){navigator.vibrate?.(8);finish(b.dataset.essValue);}});
  sheet.querySelector('[data-ess-clear]')?.addEventListener('click',()=>finish('✦'));
  sheet.querySelector('.ess-close').onclick=()=>finish(null);
  sheet.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  sheet.addEventListener('click',e=>{if(e.target===sheet)finish(null);});
  draw();if(sheet.showModal)sheet.showModal();else sheet.setAttribute('open','');
 });
}

// Pick and save straight away; returns the saved value or null when nothing changed.
export async function setBadge(current='✦'){
 const value=await pickBadge(current||'✦');if(value===null||value===(current||'✦'))return null;
 await api('/profile','PATCH',{badge:value});window.dispatchEvent(new Event('profile-saved'));toast('Значок у имени обновлён');return value;
}
