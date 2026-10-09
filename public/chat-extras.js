// Telegram-like conveniences around a conversation: cloud drafts, swipe to
// reply, double tap to react, and sending files by drag & drop or Ctrl+V.
import {$,esc,api,icon,modal,guard} from './ui.js';
import {draftKey} from './account-context.js';

// ---------- Drafts ----------
// The device copy is written on every keystroke; the server copy follows with a
// short delay so another device sees it. The newer of the two wins.
function readLocal(chat){
  let raw=null;
  try{raw=localStorage.getItem(draftKey(chat))??sessionStorage.getItem(draftKey(chat));}catch{}
  if(raw==null)return null;
  try{const value=JSON.parse(raw);if(value&&typeof value.body==='string')return value;}catch{}
  return {body:raw,updated:0};
}
export function chatDraft(chat){
  const local=readLocal(chat.id),remote=chat.draft;
  const pick=!local?remote:!remote?local:(local.updated||0)>=(remote.updated||0)?local:remote;
  return pick?.body?.trim()?pick:null;
}
const timers=new Map();
export function saveDraft(chat,body,{immediate=false}={}){
  const value={body,updated:Date.now()};
  // An empty value is kept as a dated tombstone so an older server copy cannot resurface.
  try{localStorage.setItem(draftKey(chat),JSON.stringify(value));sessionStorage.removeItem(draftKey(chat));}catch{}
  clearTimeout(timers.get(chat));
  const push=()=>{timers.delete(chat);api(`/chats/${encodeURIComponent(chat)}/draft`,'PUT',{body}).catch(()=>{});};
  if(immediate)push();else timers.set(chat,setTimeout(push,900));
}
export function flushDrafts(){for(const [chat,timer] of [...timers]){clearTimeout(timer);timers.delete(chat);const value=readLocal(chat);api(`/chats/${encodeURIComponent(chat)}/draft`,'PUT',{body:value?.body||''}).catch(()=>{});}}
export function forgetDraft(chat){try{localStorage.setItem(draftKey(chat),JSON.stringify({body:'',updated:Date.now()}));sessionStorage.removeItem(draftKey(chat));}catch{}clearTimeout(timers.get(chat));timers.delete(chat);}

// ---------- Swipe to reply / double tap to react (touch) ----------
const interactive='a[href],button,video,audio,input,textarea,select,.sent-sticker,.reaction,.poll-card';
export function bindMessageGestures(box,{canReply,onReply,onDoubleTap}){
  let start=null,lastTap=null;
  const reset=()=>{if(!start)return;const {article,icon:hint}=start;article.style.transform='';article.classList.remove('swiping');hint?.remove();start=null;};
  box.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'||!e.isPrimary)return;
    const article=e.target.closest('.message[data-id]');
    // The left screen edge belongs to the "back" gesture.
    if(!article||article.dataset.id.startsWith('local:')||e.clientX<=28||box.closest('.selecting'))return;
    start={article,x:e.clientX,y:e.clientY,time:Date.now(),dx:0,horizontal:null,target:e.target,icon:null};
  });
  box.addEventListener('pointermove',e=>{
    if(!start||e.pointerType==='mouse')return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;
    if(start.horizontal===null&&(Math.abs(dx)>10||Math.abs(dy)>10))start.horizontal=Math.abs(dx)>Math.abs(dy)*1.4&&canReply(start.article.dataset.id);
    if(!start.horizontal)return;
    start.dx=Math.max(-90,Math.min(90,dx));
    if(!start.icon){start.icon=document.createElement('span');start.icon.className='swipe-reply';start.icon.innerHTML=icon('reply');start.article.append(start.icon);start.article.classList.add('swiping');}
    start.icon.classList.toggle('left',start.dx>0);
    start.icon.classList.toggle('ready',Math.abs(start.dx)>=60);
    start.article.style.transform=`translateX(${start.dx}px)`;
  });
  box.addEventListener('pointerup',e=>{
    if(!start||e.pointerType==='mouse')return;
    const {article,dx,horizontal,x,y,time,target}=start;reset();
    if(horizontal){if(Math.abs(dx)>=60){navigator.vibrate?.(10);onReply(article.dataset.id);}return;}
    const still=Math.hypot(e.clientX-x,e.clientY-y)<12&&Date.now()-time<350;
    if(!still||target.closest(interactive)){lastTap=null;return;}
    if(lastTap&&lastTap.id===article.dataset.id&&Date.now()-lastTap.at<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){lastTap=null;e.preventDefault();onDoubleTap(article.dataset.id,e.clientX,e.clientY);return;}
    lastTap={id:article.dataset.id,at:Date.now(),x:e.clientX,y:e.clientY};
  });
  box.addEventListener('pointercancel',reset);
}
export function heartBurst(x,y){
  const el=document.createElement('span');el.className='heart-burst';el.textContent='❤️';el.style.left=x+'px';el.style.top=y+'px';
  document.body.append(el);setTimeout(()=>el.remove(),700);
}

// ---------- Files from drag & drop and the clipboard ----------
const kindOf=(file,asFile)=>asFile?'file':file.type.startsWith('image/')?'photo':file.type.startsWith('video/')?'video':'file';
const size=bytes=>bytes<1024*1024?Math.max(1,Math.round(bytes/1024))+' КБ':(bytes/1024/1024).toFixed(1)+' МБ';
export function confirmFiles(input,send){
  const files=[...input].filter(f=>f&&f.size>0).slice(0,10);if(!files.length)return;
  const media=files.some(f=>/^(image|video)\//.test(f.type));const urls=[];
  const dialog=modal(files.length>1?`Отправить ${files.length} файла(ов)`:files[0].type.startsWith('image/')?'Отправить изображение':'Отправить файл',
    `<div class="send-files">${files.map((f,i)=>{let preview=`<span class="file-icon">${icon('file')}</span>`;if(/^image\/(png|jpeg|webp|gif)$/.test(f.type)){const url=URL.createObjectURL(f);urls.push(url);preview=`<img src="${url}" alt="">`;}return `<div class="send-file" data-index="${i}">${preview}<span><b>${esc(f.name||'Файл')}</b><small>${size(f.size)}</small></span></div>`;}).join('')}</div>
    ${media?'<label class="check-row"><input type="checkbox" id="send-as-file"> Отправить без сжатия, как файл</label>':''}
    <textarea id="send-caption" rows="2" maxlength="4000" placeholder="Подпись"></textarea>
    <div class="row-actions"><button class="secondary" type="button" id="send-files-cancel">Отмена</button><button class="primary" type="button" id="send-files-ok">Отправить</button></div>`);
  const cleanup=()=>urls.forEach(u=>URL.revokeObjectURL(u));dialog?.addEventListener?.('close',cleanup,{once:true});
  $('#send-files-cancel').onclick=()=>$('#modal').close();
  const submit=guard(async()=>{const asFile=!!$('#send-as-file')?.checked,caption=$('#send-caption').value.trim();$('#modal').close();await send(files.map((file,i)=>({file,kind:kindOf(file,asFile),caption:i===0?caption:''})));});
  $('#send-files-ok').onclick=submit;
  $('#send-caption').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit();}};
  setTimeout(()=>$('#send-caption')?.focus(),0);
}
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
export function bindFileInput(conversation,draft,send){
  let depth=0;
  conversation.addEventListener('dragenter',e=>{if(!hasFiles(e))return;e.preventDefault();depth++;conversation.classList.add('drop-active');});
  conversation.addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  conversation.addEventListener('dragleave',e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth)conversation.classList.remove('drop-active');});
  conversation.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();depth=0;conversation.classList.remove('drop-active');confirmFiles(e.dataTransfer.files,send);});
  draft?.addEventListener('paste',e=>{
    const files=[...(e.clipboardData?.items||[])].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);
    if(!files.length)return;
    e.preventDefault();
    // Screenshots arrive as "image.png"; give them a readable unique name.
    confirmFiles(files.map(f=>f.name&&f.name!=='image.png'?f:new File([f],`Снимок ${new Date().toLocaleString('ru').replace(/[/:]/g,'-')}.${(f.type.split('/')[1]||'png').replace('jpeg','jpg')}`,{type:f.type})),send);
  });
}
