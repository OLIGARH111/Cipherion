// Full-screen photo and video viewer in the style of the iOS Photos app: a black stage,
// round glass buttons, the author and date in a pill at the top, the caption and a toolbar
// at the bottom. Swipe sideways between the chat's media, swipe down to close, double tap
// or pinch to zoom, a single tap hides the controls.
import {esc,icon,toast} from './ui.js';

const calm=()=>!!globalThis.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches||document.body.classList.contains('no-motion');
const dateLabel=t=>new Date(t).toLocaleDateString('ru',{day:'2-digit',month:'2-digit',year:'2-digit'});
const timeLabel=t=>new Date(t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
const glass=(name,label,attrs='')=>`<button type="button" class="mv-glass" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
let current=null;

export const mediaViewerOpen=()=>!!current;
export function closeMediaViewer(){current?.close();}

/**
 * items: [{id, kind:'photo'|'video', source: string|Promise<string>, name, author, created, caption}]
 * options: {index, locked, canDelete(item), onDelete(item), onReply(item), onForward(item), onShow(item)}
 */
export function openMediaViewer(items,options={}){
  if(!items.length)return;closeMediaViewer();
  let index=Math.max(0,Math.min(items.length-1,options.index||0)),chrome=true,zoom=1,panX=0,panY=0;
  const locked=!!options.locked;
  const root=document.createElement('div');
  root.className='media-viewer'+(locked?' mv-locked':'');
  root.tabIndex=-1;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Просмотр медиа');
  root.innerHTML=`<header class="mv-top">${glass('back','Закрыть','data-mv="close"')}<div class="mv-title"><strong></strong><small></small></div>${glass('more','Ещё','data-mv="more" aria-haspopup="menu"')}</header>
<div class="mv-stage"><div class="mv-track"></div></div>
<footer class="mv-bottom"><p class="mv-caption" hidden></p><div class="mv-bar">${locked?'<span class="mv-spacer"></span>':glass('share','Поделиться','data-mv="share"')}<div class="mv-pill">${options.onReply?glass('reply','Ответить','data-mv="reply"'):''}${locked?'':glass('download','Сохранить','data-mv="save"')}<span class="mv-counter" aria-live="polite"></span></div>${glass('trash','Удалить','data-mv="delete"')}</div></footer>
<div class="mv-menu" role="menu" hidden></div>`;
  const $=s=>root.querySelector(s),track=$('.mv-track'),stage=$('.mv-stage');
  const opener=document.activeElement;
  document.body.append(root);document.body.classList.add('media-viewing');
  requestAnimationFrame(()=>root.classList.add('open'));

  const slides=new Map();
  function slide(i){
    if(slides.has(i))return slides.get(i);
    const item=items[i],el=document.createElement('div');el.className='mv-slide';
    el.innerHTML=item.kind==='video'?`<video playsinline controls preload="metadata"${locked?' controlslist="nodownload noremoteplayback" disablepictureinpicture':''}></video>`:`<img alt="${esc(item.name||'Фотография')}" draggable="false">`;
    el.insertAdjacentHTML('beforeend','<span class="mv-spinner" aria-hidden="true"></span>');
    const media=el.firstElementChild;
    Promise.resolve(item.source).then(url=>{item.url=url;media.src=url;}).catch(()=>{el.classList.add('failed');el.querySelector('.mv-spinner').replaceWith(Object.assign(document.createElement('p'),{className:'mv-error',textContent:'Не удалось загрузить'}));});
    media.addEventListener(item.kind==='video'?'loadedmetadata':'load',()=>el.classList.add('ready'),{once:true});
    slides.set(i,el);return el;
  }
  const media=()=>slide(index).firstElementChild;
  function layout(animate){
    track.replaceChildren(...[index-1,index,index+1].filter(i=>i>=0&&i<items.length).map(i=>{const el=slide(i);el.style.setProperty('--offset',String(i-index));return el;}));
    track.classList.toggle('animate',!!animate&&!calm());track.style.transform='';
  }
  function applyZoom(){const m=media();m.style.transform=zoom>1?`translate(${panX}px,${panY}px) scale(${zoom})`:'';root.classList.toggle('zoomed',zoom>1);}
  function resetZoom(){zoom=1;panX=panY=0;applyZoom();}
  function show(i,animate=true){
    if(i<0||i>=items.length)return;
    slides.forEach(el=>{const v=el.querySelector('video');if(v)v.pause();});
    resetZoom();index=i;layout(animate);
    const item=items[index];
    $('.mv-title strong').textContent=item.author||'';
    $('.mv-title small').textContent=item.created?dateLabel(item.created)+' · '+timeLabel(item.created):'';
    const caption=$('.mv-caption');caption.textContent=item.caption||'';caption.hidden=!item.caption;
    $('.mv-counter').textContent=items.length>1?`${index+1} из ${items.length}`:'';
    $('[data-mv="delete"]').hidden=!options.canDelete?.(item);
    root.classList.toggle('is-video',item.kind==='video');
    if(item.kind==='video'){const v=media();v.play?.().catch(()=>{});}
  }
  function toggleChrome(force){chrome=force??!chrome;root.classList.toggle('bare',!chrome);}

  function close(){
    if(!current)return;current=null;closeMenu();
    removeEventListener('keydown',onKey,true);
    slides.forEach(el=>el.querySelector('video')?.pause());
    root.classList.remove('open');root.classList.add('closing');document.body.classList.remove('media-viewing');
    setTimeout(()=>root.remove(),calm()?0:220);opener?.focus?.({preventScroll:true});
  }
  current={close};

  async function sharedFile(item){
    const url=item.url||await item.source,blob=await (await fetch(url)).blob();
    const ext=(blob.type.split('/')[1]||'bin').replace('jpeg','jpg').replace('quicktime','mov');
    return new File([blob],item.name||`${item.kind==='video'?'video':'photo'}-${item.id}.${ext}`,{type:blob.type});
  }
  async function save(item){
    const file=await sharedFile(item),url=URL.createObjectURL(file),a=document.createElement('a');
    a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  }
  async function share(item){
    if(navigator.canShare){
      try{const file=await sharedFile(item);if(navigator.canShare({files:[file]})){await navigator.share({files:[file],...(item.caption?{text:item.caption}:{})});return;}}
      catch(e){if(e?.name==='AbortError')return;}
    }
    if(options.onForward){close();options.onForward(item);}else await save(item);
  }

  const menu=$('.mv-menu');
  function closeMenu(){menu.hidden=true;$('[data-mv="more"]').setAttribute('aria-expanded','false');}
  function openMenu(){
    const item=items[index],rows=[];
    if(options.onShow)rows.push(['show','chat','Показать в чате']);
    if(!locked&&options.onForward)rows.push(['forward','forward','Переслать']);
    if(!locked)rows.push(['save','download','Сохранить на устройство']);
    if(item.caption&&!locked)rows.push(['copy','copy','Копировать подпись']);
    if(options.canDelete?.(item))rows.push(['delete','trash','Удалить']);
    menu.innerHTML=rows.map(([a,ic,label])=>`<button type="button" role="menuitem" data-mv="${a}"${a==='delete'?' data-danger':''}>${icon(ic)}<span>${esc(label)}</span></button>`).join('');
    menu.hidden=false;$('[data-mv="more"]').setAttribute('aria-expanded','true');menu.querySelector('button')?.focus();
  }

  async function act(action){
    const item=items[index];
    try{
      if(action==='close')return close();
      if(action==='more')return menu.hidden?openMenu():closeMenu();
      closeMenu();
      if(action==='share')await share(item);
      else if(action==='save'){await save(item);toast('Сохранено');}
      else if(action==='copy'){await navigator.clipboard.writeText(item.caption);toast('Подпись скопирована');}
      else if(action==='reply'){close();options.onReply(item);}
      else if(action==='forward'){close();options.onForward(item);}
      else if(action==='show'){close();options.onShow(item);}
      else if(action==='delete'){
        if(!confirm(item.kind==='video'?'Удалить это видео для всех участников?':'Удалить эту фотографию для всех участников?'))return;
        await options.onDelete(item);
        slides.forEach(el=>el.querySelector('video')?.pause());slides.clear();items.splice(index,1);
        if(!items.length)return close();
        show(Math.min(index,items.length-1),false);
      }
    }catch(e){toast(e?.message||'Не получилось');}
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-mv]');if(b){e.stopPropagation();act(b.dataset.mv);return;}
    if(!menu.hidden&&!e.target.closest('.mv-menu')){closeMenu();return;}
  });
  if(locked)root.addEventListener('contextmenu',e=>e.preventDefault());

  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!menu.hidden)closeMenu();else close();}
    else if(e.key==='ArrowLeft'&&!e.target.closest?.('video'))show(index-1);
    else if(e.key==='ArrowRight'&&!e.target.closest?.('video'))show(index+1);
  }
  addEventListener('keydown',onKey,true);

  // Gestures: one finger swipes or pans, two fingers pinch, a quick tap toggles the controls.
  const points=new Map();let start=null,pinch=null,lastTap=0,tapTimer=null;
  stage.addEventListener('pointerdown',e=>{
    if(e.target.closest('video')&&e.offsetY>e.target.clientHeight-64)return; // leave the video controls alone
    points.set(e.pointerId,{x:e.clientX,y:e.clientY});stage.setPointerCapture?.(e.pointerId);
    if(points.size===1)start={x:e.clientX,y:e.clientY,t:Date.now(),panX,panY,axis:null};
    if(points.size===2){const [a,b]=[...points.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),zoom};start=null;}
  });
  stage.addEventListener('pointermove',e=>{
    if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&points.size===2){const [a,b]=[...points.values()];zoom=Math.max(1,Math.min(5,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d));if(zoom===1)panX=panY=0;applyZoom();return;}
    if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if(zoom>1){panX=start.panX+dx;panY=start.panY+dy;applyZoom();return;}
    if(!start.axis&&Math.hypot(dx,dy)>8)start.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    if(start.axis==='x'){const edge=(index===0&&dx>0)||(index===items.length-1&&dx<0);track.classList.remove('animate');track.style.transform=`translateX(${edge?dx/3:dx}px)`;}
    else if(start.axis==='y'&&dy>0){track.classList.remove('animate');track.style.transform=`translateY(${dy}px) scale(${Math.max(.8,1-dy/1200)})`;root.style.setProperty('--fade',String(Math.max(.2,1-dy/400)));}
  });
  const end=e=>{
    if(!points.has(e.pointerId))return;points.delete(e.pointerId);
    if(pinch){if(points.size<2)pinch=null;if(points.size===1){const [p]=[...points.values()];start={x:p.x,y:p.y,t:Date.now(),panX,panY,axis:null};}return;}
    if(!start||points.size)return;const s=start;start=null;
    const dx=e.clientX-s.x,dy=e.clientY-s.y,fast=Date.now()-s.t<300;
    root.style.removeProperty('--fade');
    if(s.axis==='x'&&zoom===1){const w=stage.clientWidth||1;if((dx<-w/4||(fast&&dx<-40))&&index<items.length-1)return show(index+1);if((dx>w/4||(fast&&dx>40))&&index>0)return show(index-1);return layout(true);}
    if(s.axis==='y'&&zoom===1){if(dy>120||(fast&&dy>60))return close();return layout(true);}
    if(s.axis)return;
    // A tap: two quick taps zoom, a single one toggles the controls.
    const now=Date.now();
    if(now-lastTap<280&&items[index].kind==='photo'){clearTimeout(tapTimer);lastTap=0;
      if(zoom>1)resetZoom();else{const r=stage.getBoundingClientRect();zoom=2.5;panX=(r.width/2-(e.clientX-r.left))*1.5;panY=(r.height/2-(e.clientY-r.top))*1.5;applyZoom();}
      return;}
    lastTap=now;if(!e.target.closest('video'))tapTimer=setTimeout(()=>toggleChrome(),items[index].kind==='photo'?280:0);
  };
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',e=>{points.delete(e.pointerId);start=pinch=null;root.style.removeProperty('--fade');layout(true);});
  stage.addEventListener('wheel',e=>{if(items[index].kind!=='photo'||!e.ctrlKey)return;e.preventDefault();zoom=Math.max(1,Math.min(5,zoom*(1-e.deltaY/200)));if(zoom===1)panX=panY=0;applyZoom();},{passive:false});

  show(index,false);
  root.focus({preventScroll:true});
  return current;
}
