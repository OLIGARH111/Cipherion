// Composer helpers: a formatting bar for selected text, keyboard shortcuts and
// @mention suggestions with the members of the open group.
import {$,esc,icon,avatar} from './ui.js';
import {toggleFormat} from './rich-text.js';

const tools=[['bold','Жирный','Ctrl+B'],['italic','Курсив','Ctrl+I'],['mono','Моноширинный','Ctrl+Shift+M'],['strike','Зачёркнутый','Ctrl+Shift+X'],['spoiler','Спойлер','Ctrl+Shift+P']];
const iconFor={bold:'bold',italic:'italic',mono:'code',strike:'strike',spoiler:'spoiler'};

// Ids of members mentioned in the text as @username.
export function mentionIds(text,chat,me){
  const names=new Set([...String(text||'').matchAll(/(^|[^\w@])@([a-zA-Z0-9_]{3,32})/g)].map(m=>m[2].toLowerCase()));
  return (chat?.members||[]).filter(m=>m.user_id!==me&&m.username&&names.has(String(m.username).toLowerCase())).map(m=>m.user_id);
}

export function setupComposeTools({getChat,me}){
  const input=$('#draft'),inner=$('.composer-inner');if(!input||!inner)return;
  inner.querySelector('.format-bar')?.remove();inner.querySelector('.mention-list')?.remove();
  const bar=document.createElement('div');bar.className='format-bar';bar.hidden=true;bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Форматирование');
  bar.innerHTML=tools.map(([kind,label,keys])=>`<button type="button" class="icon-button" data-format="${kind}" title="${esc(label)} (${keys})" aria-label="${esc(label)}">${icon(iconFor[kind])}</button>`).join('');
  const list=document.createElement('div');list.className='mention-list';list.hidden=true;list.setAttribute('role','listbox');list.setAttribute('aria-label','Участники');
  inner.prepend(list);inner.prepend(bar);
  // mousedown keeps the textarea selection alive on desktop; click covers touch.
  bar.addEventListener('mousedown',e=>e.preventDefault());
  bar.addEventListener('click',e=>{const b=e.target.closest('[data-format]');if(b){toggleFormat(input,b.dataset.format);syncBar();}});
  const syncBar=()=>{const has=document.activeElement===input&&input.selectionStart!==input.selectionEnd;bar.hidden=!has;};
  document.addEventListener('selectionchange',()=>{if(input.isConnected)syncBar();});
  input.addEventListener('blur',()=>setTimeout(()=>{bar.hidden=true;list.hidden=true;},150));

  let options=[],active=0,range=null;
  function closeList(){list.hidden=true;options=[];range=null;}
  function pick(member){
    if(!range||!member)return;
    input.setRangeText('@'+member.username+' ',range[0],range[1],'end');closeList();input.dispatchEvent(new Event('input'));input.focus();
  }
  function renderList(){
    list.innerHTML=options.map((m,i)=>`<button type="button" role="option" class="mention-option${i===active?' active':''}" aria-selected="${i===active}" data-index="${i}">${avatar(m.name,m.avatar)}<span><b>${esc(m.name)}</b><small>@${esc(m.username)}</small></span></button>`).join('');
    list.hidden=!options.length;
  }
  list.addEventListener('mousedown',e=>e.preventDefault());
  list.addEventListener('click',e=>{const b=e.target.closest('[data-index]');if(b)pick(options[Number(b.dataset.index)]);});
  input.addEventListener('input',()=>{
    const chat=getChat();if(!chat||['direct','saved'].includes(chat.kind)){closeList();return;}
    const before=input.value.slice(0,input.selectionStart),match=/(^|\s)@([a-zA-Z0-9_]{0,32})$/.exec(before);
    if(!match){closeList();return;}
    const query=match[2].toLowerCase();range=[input.selectionStart-match[2].length-1,input.selectionStart];
    options=chat.members.filter(m=>m.user_id!==me()&&m.username&&m.role!=='banned'&&(String(m.username).toLowerCase().startsWith(query)||String(m.name||'').toLowerCase().includes(query))).slice(0,8);
    active=0;renderList();
  });
  input.addEventListener('keydown',e=>{
    if(!list.hidden&&options.length){
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopImmediatePropagation();active=(active+(e.key==='ArrowDown'?1:options.length-1))%options.length;renderList();return;}
      if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();pick(options[active]);return;}
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeList();return;}
    }
    const mod=e.ctrlKey||e.metaKey;if(!mod)return;const key=e.key.toLowerCase();
    const kind=!e.shiftKey&&key==='b'?'bold':!e.shiftKey&&key==='i'?'italic':e.shiftKey&&key==='m'?'mono':e.shiftKey&&key==='x'?'strike':e.shiftKey&&key==='p'?'spoiler':null;
    if(kind){e.preventDefault();toggleFormat(input,kind);}
  },true);
}
