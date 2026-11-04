// Chat folders: tabs above the chat list («Все», «Личные», «Работа», «Каналы»…). A folder takes
// chats by type (people, groups, channels, bots), optionally only unread ones, plus chats added by
// hand, minus excluded ones. Folders live in the account settings, so every device shows the same.
import {$,esc,icon,modal,guard,toast} from './ui.js';
import {activeAccount} from './account-context.js';

const TYPES=[['direct','Личные чаты'],['group','Группы'],['channel','Каналы'],['bot','Боты']];
export const PRESETS=[
  {title:'Личные',emoji:'👤',types:['direct']},
  {title:'Работа',emoji:'💼',types:[]},
  {title:'Группы',emoji:'👥',types:['group']},
  {title:'Каналы',emoji:'📢',types:['channel']},
  {title:'Боты',emoji:'🤖',types:['bot']},
  {title:'Новые',emoji:'🔔',types:['direct','group','channel','bot'],unread:true}
];
const key=()=>'accounts/'+activeAccount()+'/folder';
export const currentFolder=()=>{try{return localStorage.getItem(key())||'all';}catch{return 'all';}};
const setCurrent=id=>{try{localStorage.setItem(key(),id);}catch{}};
const typeOf=(c,me)=>c.kind==='direct'&&c.members?.some(m=>m.user_id!==me&&m.bot)?'bot':c.kind==='saved'?'direct':c.kind;

export function inFolder(c,folder,me){
  if(!folder)return true;
  if((folder.exclude||[]).includes(c.id))return false;
  if((folder.chats||[]).includes(c.id))return true;
  if(!(folder.types||[]).includes(typeOf(c,me)))return false;
  return !folder.unread||c.unread>0||!!c.mentions;
}
export function folderChats(state,chats){
  const folders=state.settings.folders||[],id=currentFolder(),folder=folders.find(f=>f.id===id);
  return folder?chats.filter(c=>inFolder(c,folder,state.user.id)):chats;
}
// Tabs are shown only when the person has made at least one folder.
export function folderTabsHTML(state){
  const folders=state.settings.folders||[];if(!folders.length)return '';
  let id=currentFolder();if(id!=='all'&&!folders.some(f=>f.id===id)){id='all';setCurrent(id);}
  const unread=f=>state.chats.filter(c=>inFolder(c,f,state.user.id)&&c.unread&&!(state.settings.muted||[]).includes(c.id)).length;
  const tab=(fid,label,count)=>`<button type="button" class="folder-tab${id===fid?' active':''}" role="tab" aria-selected="${id===fid}" data-folder="${esc(fid)}">${label}${count?`<span class="folder-count">${count>99?'99+':count}</span>`:''}</button>`;
  return `<div class="folder-tabs" role="tablist" aria-label="Папки чатов">${tab('all','Все',0)}${folders.map(f=>tab(f.id,`${f.emoji?esc(f.emoji)+' ':''}${esc(f.title)}`,unread(f))).join('')}<button type="button" class="folder-tab folder-edit" data-folder-edit aria-label="Настроить папки">${icon('edit')}</button></div>`;
}
export function bindFolderTabs(root,state,save,rerender){
  root.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>{setCurrent(b.dataset.folder);rerender();});
  root.querySelector('[data-folder-edit]')?.addEventListener('click',()=>foldersPage(state,save,rerender));
  // Swipe between folders on phones.
  const list=root.querySelector('.chat-list');if(!list||list.dataset.folderSwipe)return;list.dataset.folderSwipe='1';
  let x=0,y=0;list.addEventListener('touchstart',e=>{x=e.touches[0].clientX;y=e.touches[0].clientY;},{passive:true});
  list.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;const folders=state.settings.folders||[];if(!folders.length||Math.abs(dx)<70||Math.abs(dy)>40)return;const ids=['all',...folders.map(f=>f.id)],at=ids.indexOf(currentFolder());const next=ids[at+(dx<0?1:-1)];if(next){setCurrent(next);rerender();}},{passive:true});
}

const newId=()=>Math.random().toString(36).slice(2,10);
async function persist(state,save,folders,rerender){const previous=state.settings.folders;state.settings.folders=folders;try{await save();}catch(error){state.settings.folders=previous;throw error;}rerender();}

export function foldersPage(state,save,rerender){
  const folders=state.settings.folders||[];
  const unused=PRESETS.filter(p=>!folders.some(f=>f.title===p.title));
  modal('Папки чатов',`<div class="tg-page folders-page"><p class="note">Папки делят список чатов на вкладки. Они одинаковы на всех ваших устройствах.</p>
    <div class="settings-group">${folders.length?folders.map((f,i)=>`<div class="folder-row"><span class="folder-emoji">${esc(f.emoji||'📁')}</span><span class="folder-name"><b>${esc(f.title)}</b><small>${esc(describe(f,state))}</small></span><span class="folder-tools">${i?`<button class="icon-button" data-folder-up="${i}" aria-label="Выше">${icon('up')}</button>`:''}<button class="icon-button" data-folder-open="${esc(f.id)}" aria-label="Изменить">${icon('edit')}</button></span></div>`).join(''):'<p class="muted folder-empty">Папок пока нет</p>'}</div>
    <button class="primary" id="folder-new">${icon('plus')} Создать папку</button>
    ${unused.length?`<p class="group-caption">Рекомендуемые</p><div class="folder-presets">${unused.map((p,i)=>`<button class="chip" data-folder-preset="${i}">${esc(p.emoji+' '+p.title)}</button>`).join('')}</div>`:''}</div>`);
  document.querySelectorAll('[data-folder-preset]').forEach(b=>b.onclick=guard(async()=>{const p=unused[Number(b.dataset.folderPreset)];if(p.title==='Работа'){editFolder(state,save,rerender,{id:newId(),...p,chats:[],exclude:[]},true);return;}await persist(state,save,[...folders,{id:newId(),...p,chats:[],exclude:[]}],rerender);toast('Папка «'+p.title+'» создана');foldersPage(state,save,rerender);}));
  document.querySelectorAll('[data-folder-up]').forEach(b=>b.onclick=guard(async()=>{const i=Number(b.dataset.folderUp),next=[...folders];[next[i-1],next[i]]=[next[i],next[i-1]];await persist(state,save,next,rerender);foldersPage(state,save,rerender);}));
  document.querySelectorAll('[data-folder-open]').forEach(b=>b.onclick=()=>editFolder(state,save,rerender,folders.find(f=>f.id===b.dataset.folderOpen),false));
  $('#folder-new').onclick=()=>editFolder(state,save,rerender,{id:newId(),title:'',emoji:'📁',types:[],chats:[],exclude:[]},true);
}
function describe(f,state){
  const parts=TYPES.filter(([k])=>(f.types||[]).includes(k)).map(([,l])=>l.toLowerCase());
  const n=state.chats.filter(c=>inFolder(c,f,state.user.id)).length;
  return (parts.length?parts.join(', '):'выбранные чаты')+(f.unread?' · только непрочитанные':'')+` · ${n} чат.`;
}
function editFolder(state,save,rerender,folder,fresh){
  const f={types:[],chats:[],exclude:[],...folder};
  const chats=[...state.chats].sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  modal(fresh?'Новая папка':'Папка',`<form id="folder-form" class="stack folder-form">
    <div class="row"><label class="field folder-emoji-field">Значок<input name="emoji" maxlength="4" value="${esc(f.emoji||'')}"></label><label class="field" style="flex:1">Название<input name="title" required maxlength="24" value="${esc(f.title)}" placeholder="Например, Работа"></label></div>
    <p class="group-caption">Включать автоматически</p>
    ${TYPES.map(([k,l])=>`<label class="check-row"><input type="checkbox" name="type" value="${k}" ${f.types.includes(k)?'checked':''}> ${l}</label>`).join('')}
    <label class="check-row"><input type="checkbox" name="unread" ${f.unread?'checked':''}> Только с непрочитанными</label>
    <p class="group-caption">Чаты</p><div class="search"><input id="folder-search" type="search" placeholder="Поиск чата" aria-label="Поиск чата"></div>
    <div class="folder-chats">${chats.map(c=>{const mode=f.chats.includes(c.id)?'in':f.exclude.includes(c.id)?'out':'';return `<label class="folder-chat" data-title="${esc(c.title.toLowerCase())}"><span>${esc(c.title)}</span><select data-folder-chat="${esc(c.id)}" aria-label="${esc(c.title)}"><option value="">Авто</option><option value="in" ${mode==='in'?'selected':''}>В папке</option><option value="out" ${mode==='out'?'selected':''}>Исключить</option></select></label>`;}).join('')}</div>
    <button class="primary">Сохранить</button>${fresh?'':'<button type="button" class="secondary danger" id="folder-delete">Удалить папку</button>'}</form>`);
  $('#folder-search').oninput=e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('.folder-chat').forEach(r=>r.hidden=!!q&&!r.dataset.title.includes(q));};
  $('#folder-form').onsubmit=guard(async e=>{
    e.preventDefault();const form=new FormData(e.currentTarget);
    const next={id:f.id,title:String(form.get('title')).trim().slice(0,24),emoji:String(form.get('emoji')||'').trim().slice(0,4),types:form.getAll('type'),unread:form.get('unread')==='on',chats:[],exclude:[]};
    if(!next.title)throw new Error('Введите название папки');
    document.querySelectorAll('[data-folder-chat]').forEach(s=>{if(s.value==='in')next.chats.push(s.dataset.folderChat);else if(s.value==='out')next.exclude.push(s.dataset.folderChat);});
    if(!next.types.length&&!next.chats.length)throw new Error('Выберите типы чатов или добавьте чаты вручную');
    const list=state.settings.folders||[];await persist(state,save,fresh?[...list,next]:list.map(x=>x.id===f.id?next:x),rerender);
    if(fresh)setCurrent(next.id);rerender();foldersPage(state,save,rerender);
  });
  $('#folder-delete')?.addEventListener('click',guard(async()=>{if(!confirm(`Удалить папку «${f.title}»? Чаты останутся.`))return;await persist(state,save,(state.settings.folders||[]).filter(x=>x.id!==f.id),rerender);foldersPage(state,save,rerender);}));
}
// Context-menu helper: put one chat into a folder or take it out.
export function folderMenuDialog(state,save,rerender,chat){
  const folders=state.settings.folders||[];
  if(!folders.length){foldersPage(state,save,rerender);return;}
  modal('Папки для «'+chat.title+'»',`<div class="stack">${folders.map(f=>`<label class="check-row"><input type="checkbox" data-in-folder="${esc(f.id)}" ${inFolder(chat,f,state.user.id)?'checked':''}> ${esc((f.emoji?f.emoji+' ':'')+f.title)}</label>`).join('')}<button class="primary" id="folder-apply">Готово</button></div>`);
  $('#folder-apply').onclick=guard(async()=>{
    const next=folders.map(f=>{const want=$(`[data-in-folder="${CSS.escape(f.id)}"]`).checked,has=inFolder(chat,f,state.user.id);if(want===has)return f;
      const chats=(f.chats||[]).filter(id=>id!==chat.id),exclude=(f.exclude||[]).filter(id=>id!==chat.id);
      const copy={...f,chats,exclude};if(want&&!inFolder(chat,copy,state.user.id))copy.chats=[...chats,chat.id];if(!want&&inFolder(chat,copy,state.user.id))copy.exclude=[...exclude,chat.id];return copy;});
    await persist(state,save,next,rerender);$('#modal').close();
  });
}
