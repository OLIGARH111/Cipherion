// Comments under channel posts: a sheet with the discussion and a reply field.
import {$,esc,icon,api,modal,guard,avatar,time,asSheet} from './ui.js';
import {richText} from './rich-text.js';
import {emojiHTML} from './stickers.js';

export function commentButton(m,chat){
  if(chat?.kind!=='channel'||!chat.comments||m.deleted||m.pending)return '';
  const n=m.comments||0;
  return `<button type="button" class="comment-link" data-comments="${esc(m.id)}">${icon('comment')}<span>${n?`${n} ${plural(n)}`:'Прокомментировать'}</span>${icon('chevron')}</button>`;
}
const plural=n=>{const a=n%10,b=n%100;return a===1&&b!==11?'комментарий':a>=2&&a<=4&&(b<12||b>14)?'комментария':'комментариев';};

// Opens as its own full-screen page: header with back + count, collapsible post, scrolling thread, composer pinned to the bottom.
export function openComments(post,chat,preview){
  let reply=null,first=true;
  const dialog=$('#modal');
  const count=n=>{const el=$('#comments-count');if(el)el.textContent=n?`${n} ${plural(n)}`:'Нет комментариев';};
  const setReply=(id,name,text)=>{reply=id;const bar=$('#comment-reply'),box=$('#comments-list'),stick=box&&box.scrollHeight-box.scrollTop-box.clientHeight<80;requestAnimationFrame(()=>{if(stick)box.scrollTop=box.scrollHeight;});if(!id){bar.innerHTML='';return;}bar.innerHTML=`${icon('reply')}<div><b>Ответ ${esc(name)}</b><span>${esc(text)}</span></div><button type="button" class="icon-button" id="comment-reply-cancel" aria-label="Отменить ответ">${icon('close')}</button>`;$('#comment-reply-cancel').onclick=()=>setReply(null);$('#comment-input').focus();};
  const draw=async(toBottom)=>{
    const list=await api(`/messages/${post.id}/comments`);
    const box=$('#comments-list');if(!box)return;
    const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    count(list.length);
    box.innerHTML=list.length?list.map(c=>{const parent=c.reply_id&&list.find(x=>x.id===c.reply_id);return `<article class="comment" data-comment="${esc(c.id)}">${avatar(c.name,c.avatar)}<div class="comment-body"><header><b>${esc(c.name)}</b><time>${time(c.created)}</time></header>${parent?`<div class="comment-quote"><b>${esc(parent.name)}</b>${esc(parent.body.slice(0,80))}</div>`:''}<div class="body">${richText(c.body,{emoji:emojiHTML})}</div><footer><button type="button" class="comment-action" data-reply="${esc(c.id)}" data-name="${esc(c.name)}">${icon('reply')}Ответить</button>${c.canDelete?`<button type="button" class="comment-action danger" data-remove="${esc(c.id)}">${icon('trash')}Удалить</button>`:''}</footer></div></article>`;}).join(''):`<div class="comments-empty">${icon('comment')}<b>Пока нет комментариев</b><span>Будьте первым, кто напишет</span></div>`;
    box.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>{const c=list.find(x=>x.id===b.dataset.reply);setReply(b.dataset.reply,b.dataset.name,(c?.body||'').slice(0,80));});
    box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=guard(async()=>{if(!confirm('Удалить комментарий?'))return;await api('/comments/'+b.dataset.remove,'DELETE');await draw();}));
    if(first||toBottom||nearBottom)box.scrollTop=box.scrollHeight;first=false;
  };
  dialog.classList.add('comments-screen');
  dialog.addEventListener('close',()=>dialog.classList.remove('comments-screen'),{once:true});
  return asSheet(async()=>{
    modal('Комментарии',`<div class="comments-post collapsed" id="comments-post"><div class="comments-post-head"><b>${esc(chat.title)}</b><span id="comments-count">Загрузка…</span></div><div class="body">${preview}</div><button type="button" class="comments-post-toggle" id="comments-post-toggle">Показать пост полностью</button></div><div id="comments-list" class="comments-list"><div class="skeleton-list"></div></div><form id="comment-form" class="comment-form"><div id="comment-reply" class="comment-reply"></div><div class="row"><textarea id="comment-input" rows="1" maxlength="2000" placeholder="Написать комментарий…" aria-label="Комментарий" enterkeyhint="send"></textarea><button class="icon-button send" title="Отправить" aria-label="Отправить" disabled>${icon('send')}</button></div></form>`);
    // Header: back arrow on the left instead of a close cross.
    const close=$('#modal-close');if(close){close.innerHTML=icon('back');close.setAttribute('aria-label','Назад');close.title='Назад';}
    const postBox=$('#comments-post'),toggle=$('#comments-post-toggle');
    const fits=()=>{const b=postBox.querySelector('.body');toggle.hidden=b.scrollHeight<=b.clientHeight+2&&postBox.classList.contains('collapsed');};
    toggle.onclick=()=>{const open=postBox.classList.toggle('collapsed');toggle.textContent=open?'Показать пост полностью':'Свернуть пост';};
    requestAnimationFrame(fits);
    const input=$('#comment-input'),send=$('#comment-form .send');
    const grow=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px';send.disabled=!input.value.trim();};
    input.oninput=grow;
    const touch=matchMedia('(pointer:coarse)').matches;
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!touch){e.preventDefault();$('#comment-form').requestSubmit();}if(e.key==='Escape'&&reply){e.preventDefault();e.stopPropagation();setReply(null);}};
    $('#comment-form').onsubmit=guard(async e=>{e.preventDefault();const body=input.value.trim();if(!body)return;input.disabled=true;send.disabled=true;try{await api(`/messages/${post.id}/comments`,'POST',{body,reply});input.value='';setReply(null);grow();await draw(true);}finally{input.disabled=false;grow();input.focus();}});
    await draw(true);
  });
}
