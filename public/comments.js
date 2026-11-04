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

export function openComments(post,chat,preview){
  let reply=null;
  const draw=async()=>{
    const list=await api(`/messages/${post.id}/comments`);
    const box=$('#comments-list');if(!box)return;
    box.innerHTML=list.length?list.map(c=>{const parent=c.reply_id&&list.find(x=>x.id===c.reply_id);return `<article class="comment" data-comment="${esc(c.id)}">${avatar(c.name,c.avatar)}<div class="comment-body"><header><b>${esc(c.name)}</b><time>${time(c.created)}</time></header>${parent?`<div class="comment-quote">${esc(parent.name)}: ${esc(parent.body.slice(0,80))}</div>`:''}<div class="body">${richText(c.body,{emoji:emojiHTML})}</div><footer><button type="button" class="chip" data-reply="${esc(c.id)}" data-name="${esc(c.name)}">Ответить</button>${c.canDelete?`<button type="button" class="chip danger" data-remove="${esc(c.id)}">Удалить</button>`:''}</footer></div></article>`;}).join(''):`<p class="empty-list">${icon('comment')}Пока нет комментариев. Будьте первым!</p>`;
    box.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>{reply=b.dataset.reply;$('#comment-reply').innerHTML=`<span>Ответ ${esc(b.dataset.name)}</span><button type="button" class="chip" id="comment-reply-cancel">Отмена</button>`;$('#comment-reply-cancel').onclick=()=>{reply=null;$('#comment-reply').innerHTML='';};$('#comment-input').focus();});
    box.querySelectorAll('[data-remove]').forEach(b=>b.onclick=guard(async()=>{if(!confirm('Удалить комментарий?'))return;await api('/comments/'+b.dataset.remove,'DELETE');await draw();}));
    box.scrollTop=box.scrollHeight;
  };
  return asSheet(async()=>{
    modal('Комментарии',`<div class="comments-post"><b>${esc(chat.title)}</b><div class="body">${preview}</div></div><div id="comments-list" class="comments-list"><div class="skeleton-list"></div></div><form id="comment-form" class="comment-form"><div id="comment-reply" class="comment-reply"></div><div class="row"><textarea id="comment-input" rows="1" maxlength="2000" placeholder="Комментарий" aria-label="Комментарий"></textarea><button class="icon-button send" title="Отправить" aria-label="Отправить">${icon('send')}</button></div></form>`);
    const input=$('#comment-input');
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#comment-form').requestSubmit();}};
    $('#comment-form').onsubmit=guard(async e=>{e.preventDefault();const body=input.value.trim();if(!body)return;input.disabled=true;try{await api(`/messages/${post.id}/comments`,'POST',{body,reply});input.value='';reply=null;$('#comment-reply').innerHTML='';await draw();}finally{input.disabled=false;input.focus();}});
    await draw();
  });
}
