// Per-chat modes: auto-delete timer, slow mode, forum topics, channel comments,
// and the "next mention" button.
import {$,esc,icon,api,modal,guard,toast,time} from './ui.js';
import {plainText} from './rich-text.js';

export const TTL_LABELS={0:'Выключено',86400:'1 день',604800:'1 неделя',2592000:'1 месяц'};
export const SLOW_LABELS={0:'Выключен',10:'10 секунд',30:'30 секунд',60:'1 минута',300:'5 минут',900:'15 минут',3600:'1 час'};

function choiceDialog(title,note,labels,current,onPick){
  modal(title,`<p class="note">${note}</p><div class="choice-list" role="radiogroup">${Object.entries(labels).map(([value,label])=>`<button type="button" role="radio" aria-checked="${Number(value)===Number(current||0)}" class="choice-row${Number(value)===Number(current||0)?' selected':''}" data-value="${value}"><span>${esc(label)}</span>${Number(value)===Number(current||0)?icon('check'):''}</button>`).join('')}</div>`);
  document.querySelectorAll('.choice-row').forEach(b=>b.onclick=guard(async()=>{await onPick(Number(b.dataset.value));$('#modal').close();}));
}
export function ttlDialog(c,after){
  choiceDialog('Автоудаление сообщений',c.kind==='direct'?'Новые сообщения в этом чате будут удаляться у обоих собеседников через выбранное время. Уже отправленные сообщения не изменятся.':'Новые сообщения будут удаляться у всех участников через выбранное время. Уже отправленные сообщения не изменятся.',TTL_LABELS,c.ttl,async ttl=>{await api(`/chats/${c.id}/features`,'PATCH',{ttl});c.ttl=ttl;toast(ttl?'Автоудаление: '+TTL_LABELS[ttl]:'Автоудаление выключено');await after?.();});
}
export function slowDialog(c,after){
  choiceDialog('Медленный режим','Участники смогут отправлять одно сообщение за выбранный интервал. На владельца и администраторов ограничение не действует.',SLOW_LABELS,c.slow_mode,async slowMode=>{await api(`/chats/${c.id}/features`,'PATCH',{slowMode});c.slow_mode=slowMode;toast(slowMode?'Медленный режим: '+SLOW_LABELS[slowMode]:'Медленный режим выключен');await after?.();});
}
export async function toggleFeature(c,key,after){
  const next=!c[key==='forum'?'forum':'comments'];
  if(key==='forum'&&next&&!confirm('Включить темы? Сообщения группы будут разделены по темам, как на форуме. Старые сообщения окажутся в теме «Общее».'))return;
  await api(`/chats/${c.id}/features`,'PATCH',{[key]:next});c[key]=next?1:0;
  toast(key==='forum'?(next?'Темы включены':'Темы выключены'):(next?'Комментарии включены':'Комментарии выключены'));await after?.();
}

// Header note for an active timer or slow mode.
export function modeNotice(c){
  const parts=[];
  if(c?.ttl)parts.push(`${icon('timer')}<span>Автоудаление: ${esc(TTL_LABELS[c.ttl]||'')}</span>`);
  if(c?.kind==='group'&&c.slow_mode)parts.push(`${icon('clock')}<span>Медленный режим: ${esc(SLOW_LABELS[c.slow_mode]||'')}</span>`);
  return parts.length?`<div class="mode-notice">${parts.map(p=>`<span class="mode-chip">${p}</span>`).join('')}</div>`:'';
}

// Slow mode: the composer shows how long to wait and refuses to queue too early.
let slowTimer;
export function slowGuard(c){
  if(!c||c.staff||!c.slow_mode)return true;
  const left=Math.ceil(((c.slowUntil||0)-Date.now())/1000);
  if(left>0){toast(`Медленный режим: подождите ещё ${left} с`);return false;}
  return true;
}
export function markSent(c){if(c&&!c.staff&&c.slow_mode){c.slowUntil=Date.now()+c.slow_mode*1000;runSlowCountdown(c);}}
export function runSlowCountdown(c){
  clearInterval(slowTimer);const input=$('#draft');if(!input)return;
  if(!c||c.staff||!c.slow_mode){input.placeholder='Сообщение';return;}
  if(c.slowWait&&!c.slowUntil)c.slowUntil=Date.now()+c.slowWait;
  const tick=()=>{const field=$('#draft');if(!field){clearInterval(slowTimer);return;}const left=Math.ceil(((c.slowUntil||0)-Date.now())/1000);field.placeholder=left>0?`Медленный режим: ${left} с`:'Сообщение';if(left<=0)clearInterval(slowTimer);};
  tick();slowTimer=setInterval(tick,1000);
}

// ---------- Topics ----------
export async function topicsView(c,{onPick,onBack,onInfo}){
  const box=$('.workspace');
  box.innerHTML=`<section class="conversation topics-view"><header class="conversation-header pill-head"><button class="icon-button mobile-back" id="topics-back" title="Назад" aria-label="Назад к списку чатов">${icon('back')}</button><div class="conversation-peer"><div class="conversation-title" role="button" tabindex="0"><h3>${esc(c.title)}</h3><small>Темы группы</small></div></div><div class="header-actions"><button class="icon-button" id="topic-new" title="Новая тема" aria-label="Новая тема">${icon('plus')}</button></div></header><div class="topics-list" role="list"><div class="skeleton-list"></div></div></section>`;
  $('#topics-back').onclick=onBack;$('.topics-view .conversation-title').onclick=onInfo;
  $('#topic-new').onclick=guard(()=>newTopic(c,()=>topicsView(c,{onPick,onBack,onInfo})));
  const topics=await api(`/chats/${c.id}/topics`);
  const list=$('.topics-list');if(!list)return topics;
  list.innerHTML=topics.map(t=>`<button type="button" role="listitem" class="topic-row" data-topic="${esc(t.id)}"><span class="topic-icon" aria-hidden="true">${esc(t.icon||'#')}</span><span class="topic-main"><b>${esc(t.title)}${t.closed?` <span class="topic-closed">${icon('lock')}</span>`:''}</b><small>${t.last?esc((t.last.author?t.last.author+': ':'')+(t.last.encrypted?'🔒 Зашифрованное сообщение':plainText(t.last.body)||'Вложение')):'Пока нет сообщений'}</small></span><span class="topic-meta">${t.last?`<time>${time(t.last.created)}</time>`:''}${t.unread?`<span class="badge">${t.unread>99?'99+':t.unread}</span>`:''}</span></button>`).join('');
  list.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>onPick(topics.find(t=>t.id===b.dataset.topic)));
  return topics;
}
const TOPIC_ICONS=['💬','📌','🎉','🏖','💼','🎮','📚','🎵','🍕','⚽','💡','❓'];
export function newTopic(c,after){
  modal('Новая тема',`<form id="topic-form" class="stack"><label class="field">Название<input name="title" required maxlength="80" placeholder="Например, «Поездка в Казань»"></label><div class="topic-icons" role="radiogroup" aria-label="Значок">${TOPIC_ICONS.map((e,i)=>`<label class="topic-icon-choice"><input type="radio" name="icon" value="${e}" ${i?'':'checked'}><span>${e}</span></label>`).join('')}</div><button class="primary">Создать тему</button></form>`);
  $('#topic-form').onsubmit=guard(async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));await api(`/chats/${c.id}/topics`,'POST',data);$('#modal').close();await after?.();});
}
export function topicMenu(c,topic,after){
  if(!topic||topic.id==='general')return;
  modal(topic.title,`<div class="stack"><button class="secondary" id="topic-rename">Переименовать</button>${c.staff?`<button class="secondary" id="topic-close">${topic.closed?'Открыть тему':'Закрыть тему'}</button><button class="secondary danger" id="topic-delete">Удалить тему</button>`:''}</div>`);
  $('#topic-rename').onclick=guard(async()=>{const title=prompt('Новое название темы',topic.title);if(!title)return;await api('/topics/'+topic.id,'PATCH',{title});topic.title=title;$('#modal').close();await after?.();});
  if($('#topic-close'))$('#topic-close').onclick=guard(async()=>{await api('/topics/'+topic.id,'PATCH',{closed:!topic.closed});topic.closed=!topic.closed;$('#modal').close();await after?.();});
  if($('#topic-delete'))$('#topic-delete').onclick=guard(async()=>{if(!confirm(`Удалить тему «${topic.title}» вместе с сообщениями?`))return;await api('/topics/'+topic.id,'DELETE');$('#modal').close();await after?.(true);});
}

// ---------- Mentions ----------
// A floating "@" button above "scroll down" jumps through unread mentions in order.
export function createMentionNavigator({chatId,find,loadOlder,jump,topic}){
  let queue=[],busy=false,observer;
  const button=()=>$('#mention-next');
  function paint(){const b=button();if(!b)return;b.hidden=!queue.length;const badge=b.querySelector('.badge');if(badge)badge.textContent=queue.length>99?'99+':String(queue.length);}
  async function seen(id){queue=queue.filter(m=>m.id!==id);paint();try{await api(`/chats/${chatId}/mentions`,'POST',{message:id});}catch{}}
  async function load(){try{const list=await api(`/chats/${chatId}/mentions`);const t=topic();queue=t?list.filter(m=>(m.topic||'general')===t):list;}catch{queue=[];}paint();}
  async function next(){
    if(busy||!queue.length)return;busy=true;
    try{
      const target=queue[0];
      for(let i=0;i<30&&!find(target.id);i++)if(!await loadOlder())break;
      if(find(target.id))jump(target.id);else toast('Сообщение с упоминанием недоступно');
      await seen(target.id);
    }finally{busy=false;}
  }
  function install(){
    const wrap=$('.messages-wrap');if(!wrap||button())return;
    wrap.insertAdjacentHTML('beforeend',`<button type="button" class="mention-next" id="mention-next" hidden title="К следующему упоминанию" aria-label="К следующему упоминанию">${icon('at')}<span class="badge"></span></button>`);
    button().onclick=guard(next);
    if(typeof IntersectionObserver==='function')observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const id=e.target.dataset.id;if(queue.some(m=>m.id===id))seen(id);}},{threshold:.6});
  }
  // Called after each render: mentioned messages that scroll into view count as seen.
  function watch(){if(typeof observer?.observe!=='function')return;observer.disconnect?.();document.querySelectorAll('.messages .message.mentioned').forEach(el=>observer.observe(el));}
  function add(id,topicId){const t=topic();if(t&&(topicId||'general')!==t)return;if(!queue.some(m=>m.id===id))queue.push({id});paint();}
  return {install,load,watch,add,dispose:()=>observer?.disconnect?.()};
}
