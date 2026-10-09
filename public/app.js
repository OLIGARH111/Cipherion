import {createChatDialog} from './create-chat.js';
import {vipBadge} from './ui.js';
import {saveAction} from './ui.js';
import {createAccountSessionManager} from './accounts.js';
import {emailAuthView} from './email-auth.js';
import {activeAccount,accountEpoch} from './account-context.js';
import {accountURL,accountFetch,draftKey} from './account-context.js';
import {peopleCount} from './ui.js';
import './viewport.js';
import {bindStickerEffects} from './sticker-effects.js';
import {createSync} from './sync.js';
import './motion.js';
import {createOutbox} from './outbox.js';
import {mergeMessages,messageKey,reconcileMessages,optimisticMessage} from './message-state.js';
import {preparePush,muteChat,promptNotifications} from './notifications.js';
import {setupComposerAI} from './composer-ai.js';
import {initStories,refreshStories,showStories} from './stories.js';
import {configureProfiles,extendedProfile} from './profiles.js';
import {pollCard,bindPolls,pollEditor} from './polls.js';
import {renderCustom,stickerPanel} from './stickers.js';
import {toggleEmojiPanel,closeEmojiPanel,emojiPanelOpen,setupStickerSuggestions,showStickerPreview} from './sticker-panel.js';
import {jumboSize} from './emoji-data.js';
import { $,esc,icon,button,avatar,tone,time,toast,api,upload,modal,guard,asSheet } from './ui.js';
import { applyTheme, settingsPage, themes } from './settings.js';
import {popover,closePopover,popoverOpen,menuItem,longPress,swipeBack,setupResizer,sideWidth,dayKey,dayLabel,listTime,ticks,tickSVG,mobile} from './chat-ui.js';
import { createCalls } from './calls.js';
import { groupPanel } from './groups.js';
import {schedulePage} from './social.js';
import {aiPage,familyPage,foldersPage} from './extensions.js';
import {chatDraft,saveDraft,flushDrafts,forgetDraft,bindMessageGestures,heartBurst,bindFileInput,confirmFiles} from './chat-extras.js';

export const state={user:null,settings:{},chats:[],chat:null,messages:[],tab:'chat',filter:'all',reply:null,editing:null,events:null,recording:null,mode:'voice'};
let outbox,synchronizer;
const messagesByChat=new Map();
const clearedAt=chat=>state.chats.find(c=>c.id===chat)?.cleared_at||0;
function acceptMessages(chat,rows,scroll=false){const cut=clearedAt(chat);const messages=mergeMessages(messagesByChat.get(chat)||[],rows).filter(m=>m.pending||m.created>cut);messagesByChat.set(chat,messages);if(state.chat===chat){state.messages=messages;renderMessages(scroll);}return messages;}
function outboxChanged(event){if(!event)return;const {item}=event;if(event.type==='confirmed'){acceptMessages(item.chat,[event.message]);synchronizer?.write([event.message]).catch(()=>{});scheduleChatRefresh();}else acceptMessages(item.chat,[optimisticMessage(item)],true);}
function scheduleChatRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(()=>{}),100);}
let calls, typingAt=0,refreshTimer, register=false, searchTimer, chatGeneration=0;
const app=$('#app');
const mediaLabel={photo:'Фотография',video:'Видео',file:'Файл',voice:'Голосовое сообщение',round:'Видеосообщение',poll:'Опрос'};
const tabs=[['chat','Чаты'],['ai','AI'],['phone','Звонки'],['settings','Настройки']];
const pageCache=new Map();let childRegistration=false;
const preview=m=>m?.deleted?'Сообщение удалено':m?.kind==='sticker'?'Стикер'+(m.sticker?.label?' · '+m.sticker.label:''):String(m?.body||'').replace(/:ce\[[a-zA-Z0-9-]+\]/g,'✨') || mediaLabel[m?.kind] || 'Начните разговор';
const selected=()=>state.chats.find(c=>c.id===state.chat);
const savedAvatar=()=>`<span class="avatar saved-avatar" aria-hidden="true">${icon('bookmark')}</span>`;
const chatAvatar=c=>c?.kind==='saved'?savedAvatar():avatar(c?.title,c?.avatar||chatPeer(c)?.avatar);
export async function saveSettings(){await api('/me','PATCH',{settings:state.settings});applyTheme(state.settings);}
function auth(){applyTheme({theme:'Emerald'});app.innerHTML='<main class="auth"><div class="auth-art"><div class="brand"><img class="auth-logo" src="/brand/icon-192-99e4c7990351.png" alt="" width="40" height="40">Cipherion</div><h1>Общение, которое <em>ощущается живым</em></h1><p>Чаты, группы, звонки и AI-помощник — всё в одном спокойном и понятном пространстве.</p><ul class="auth-features"><li><span>💬</span>Личные чаты, группы и каналы</li><li><span>📞</span>Аудио- и видеозвонки</li><li><span>✨</span>AI-помощник прямо в переписке</li></ul></div><div class="auth-side"><div id="auth-mount"></div><button class="secondary auth-alt" id="auth-switch">Другие аккаунты устройства</button></div></main>';$('#auth-switch').onclick=guard(()=>accountManager.show());emailAuthView($('#auth-mount'),{complete:async r=>{await accountManager.refresh();await accountManager.switchTo(r.user.id);}});}
const backgroundEvents=new Map();
function resetAccount(){
 state.events?.close();for(const ev of backgroundEvents.values())ev.close();backgroundEvents.clear();
 const pending=[outbox?.dispose(),synchronizer?.dispose()];calls?.dispose();calls=null;outbox=null;synchronizer=null;
 clearTimeout(refreshTimer);clearTimeout(searchTimer);chatGeneration++;messagesByChat.clear();pageCache.clear();
closePopover();$('#modal')?.close();$('#modal')?.classList.remove('sheet');document.querySelectorAll('.story-viewer,.story-overlay,.profile-effect').forEach(e=>e.remove());
 Object.assign(state,{user:null,settings:{},chats:[],chat:null,messages:[],tab:'chat',filter:'all',reply:null,editing:null,events:null,recording:null,sendSticker:null,selection:null,find:null,unseen:0,loading:false});typingNow.clear();
 window.speechSynthesis?.cancel();window.dispatchEvent(new Event('account-change'));app.replaceChildren();return Promise.allSettled(pending);
}
const accountManager=createAccountSessionManager({deactivate:resetAccount,canSwitch:()=>!calls?.busy()&&!state.recording,activate:async id=>{await resetAccount();if(!id){auth();return;}try{await boot();}catch(e){if(e.status===401){auth();toast('Сессия этого аккаунта истекла. Другие аккаунты остаются доступны.');}else throw e;}}});
state.accounts=accountManager;
async function connectBackgroundAccounts(){const ticket=accountEpoch(),list=await accountManager.refresh();if(ticket!==accountEpoch())return;for(const a of list){if(a.user.id===state.user.id)continue;const ev=new EventSource(accountURL('/api/events',a.user.id));backgroundEvents.set(a.user.id,ev);ev.addEventListener('message',()=>{if(ticket===accountEpoch())toast('Новое сообщение — '+a.user.name);});ev.addEventListener('call',e=>{if(ticket!==accountEpoch())return;const call=JSON.parse(e.data);if(call.state!=='ringing')return;if(calls?.busy()){toast('Входящий звонок — '+a.user.name);return;}modal('Звонок — '+a.user.name,`<p>${esc(call.name)} звонит вашему аккаунту ${esc(a.user.name)}.</p><button class="primary" id="switch-call-account">Открыть звонок</button>`);$('#switch-call-account').onclick=guard(async()=>{$('#modal').close();await accountManager.switchTo(a.user.id);await calls.event(call);});});}}
const folderTabs=[['all','Все'],['direct','Личные'],['group','Группы'],['channel','Каналы'],['unread','Непрочитанные'],['archived','Архив']];
const calm=()=>!!globalThis.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches||document.body.classList.contains('no-motion');
function shell(){app.innerHTML=`<main class="shell" style="--side-width:${sideWidth()}px"><aside class="side" aria-label="Чаты"><div class="side-header"><div class="side-top">${button('menu','Меню','id="main-menu" aria-haspopup="menu" aria-expanded="false"')}<div class="brand-mark"><img src="/brand/icon-192-99e4c7990351.png" alt="" width="28" height="28"><span>Cipherion</span></div><span class="side-status" role="status"><span class="dot"></span><span id="connection">Подключение…</span></span></div><div class="side-search"><div class="search">${icon('search')}<input id="chat-search" type="search" placeholder="Поиск" aria-label="Поиск по чатам, людям и сообщениям" autocomplete="off" enterkeyhint="search"></div></div><div class="filters folder-tabs" role="tablist" aria-label="Папки чатов">${folderTabs.map(([key,title])=>`<button class="chip ${state.filter===key?'active':''}" role="tab" aria-selected="${state.filter===key}" data-filter="${key}">${title}</button>`).join('')}<span id="custom-folders"></span><button class="chip folder-add" id="manage-folders" title="Настроить папки" aria-label="Настроить папки">${icon('plus')}</button></div></div><div id="stories-strip" class="stories-strip" aria-label="Истории"></div><div class="chat-list"></div><button class="fab" id="new-chat" title="Новый чат" aria-label="Новый чат">${icon('edit')}</button><div class="side-resizer" role="separator" aria-orientation="vertical" aria-label="Ширина списка чатов" tabindex="0"></div></aside><section class="workspace"></section><nav class="nav tabbar" aria-label="Основная навигация">${tabs.map(([key,title])=>`<button class="${state.tab===key?'active':''}" data-tab="${key}" aria-label="${title}" ${state.tab===key?'aria-current="page"':''}>${icon(key)}<span class="nav-label">${title}</span></button>`).join('')}</nav></main>`;
  document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=guard(()=>navigate(el.dataset.tab)));
  $('#main-menu').onclick=()=>mainMenu();$('#new-chat').onclick=()=>newChat();$('#manage-folders').onclick=()=>foldersPage(state,saveSettings,renderChats);$('#chat-search').oninput=searchInput;
  $('#chat-search').onkeydown=e=>{if(e.key==='Escape'&&e.target.value){e.preventDefault();e.stopPropagation();e.target.value='';searchInput();}else if(e.key==='Enter'){e.preventDefault();$('.chat-list [data-chat]')?.click();}};
  document.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>setFilter(el.dataset.filter));
  setupResizer($('.side-resizer'),$('.shell'));swipeBack($('.workspace'),()=>!!$('.shell')?.classList.contains('show-chat'),()=>closeChat());
  const list=$('.chat-list');list.oncontextmenu=e=>{const item=e.target.closest('[data-chat]');if(!item)return;e.preventDefault();chatContextMenu(item.dataset.chat,e.clientX,e.clientY);};longPress(list,'[data-chat]',(e,item)=>chatContextMenu(item.dataset.chat,e.clientX,e.clientY));
  renderChats();empty();
}
function setFilter(key){state.filter=key;document.querySelectorAll('[data-filter]').forEach(e=>{e.classList.toggle('active',e.dataset.filter===key);e.setAttribute('aria-selected',String(e.dataset.filter===key));});renderChats();}
function setConnection(online){const el=$('#connection');if(el)el.textContent=online?'На связи':'Восстанавливаем соединение…';$('.shell')?.setAttribute('data-connection',online?'online':'offline');}
function mainMenu(){
  const anchor=$('#main-menu'),u=state.user,dark=!document.body.classList.contains('light');anchor.setAttribute('aria-expanded','true');
  const el=popover({anchor,className:'main-menu',label:'Главное меню',onClose:()=>anchor.setAttribute('aria-expanded','false'),html:`<button type="button" role="menuitem" class="menu-profile" data-menu="profile">${avatar(u.name,u.avatar)}<span><b>${esc(u.name)} ${vipBadge(u)}</b><small>${u.username?'@'+esc(u.username):'Мой профиль'}</small></span></button><div class="ctx-sep"></div>${menuItem('data-menu="saved"',icon('bookmark'),'Избранное')}${menuItem('data-menu="tab" data-goto="chat"',icon('chat'),'Чаты')}${menuItem('data-menu="tab" data-goto="ai"',icon('ai'),'AI-помощник')}${menuItem('data-menu="tab" data-goto="phone"',icon('phone'),'Звонки')}${menuItem('data-menu="tab" data-goto="settings"',icon('settings'),'Настройки')}<div class="ctx-sep"></div>${menuItem('data-menu="group"',icon('group'),'Создать группу')}${menuItem('data-menu="channel"',icon('channel'),'Создать канал')}${menuItem('data-menu="accounts"',icon('people'),'Аккаунты')}<div class="ctx-sep"></div><button type="button" role="menuitemcheckbox" aria-checked="${dark}" class="ctx-item" data-menu="night">${icon('moon')}<span>Ночной режим</span><i class="switch" aria-hidden="true"></i></button>`});
  el.querySelectorAll('[data-menu]').forEach(b=>b.onclick=guard(async()=>{const what=b.dataset.menu;if(what==='night'){await toggleNight();b.setAttribute('aria-checked',String(!document.body.classList.contains('light')));return;}closePopover();
    if(what==='profile')await asSheet(()=>extendedProfile(u.id));else if(what==='saved')await openSaved();else if(what==='tab')await navigate(b.dataset.goto);else if(what==='accounts')await accountManager.show();else await newChat(what);}));
}
async function toggleNight(){const s=state.settings,light=document.body.classList.contains('light'),previous={...s};if(light)s.theme=s.darkTheme&&themes[s.darkTheme]&&themes[s.darkTheme]!==themes.White?s.darkTheme:'Emerald';else{s.darkTheme=s.theme||'Emerald';s.theme='White';}s.systemTheme=false;try{await saveSettings();}catch(error){state.settings=previous;applyTheme(previous);throw error;}}
function empty(){const w=$('.workspace');if(!w)return;w.innerHTML=`<div class="empty chat-placeholder"><div class="placeholder-card"><img class="placeholder-logo" src="/brand/icon-192-99e4c7990351.png" alt="" width="72" height="72"><h2>Cipherion</h2><p>Выберите разговор слева или начните новый — найдите человека по username.</p><button class="primary" id="start-chat">${icon('edit')} Новое сообщение</button><small>${icon('shield')} Ваши разговоры — только ваши</small></div></div>`;$('#start-chat').onclick=()=>newChat();}
function closeChat(){
  if(state.recording){toast('Завершите или отмените запись');return;}
  const shellEl=$('.shell');if(!shellEl||!state.chat)return;closePopover();
  flushDrafts();state.chat=null;state.reply=null;state.editing=null;state.stashedDraft=null;state.selection=null;state.find=null;pageCache.delete('chat');
  shellEl.classList.remove('show-chat');renderChats();
  setTimeout(()=>{if(!state.chat&&state.tab==='chat')empty();},mobile()&&!calm()?260:0);
}
function chatVipBadge(c){return c?.kind==='direct'?vipBadge(c.members.find(m=>m.user_id!==state.user.id)):'';}
function chatPeer(c){return c?.kind==='direct'?c.members.find(m=>m.user_id!==state.user.id):null;}
const typingNow=new Map(),typingTimers=new Map();
function lastTicks(c){const m=c.last;if(!m||m.user_id!==state.user.id||m.deleted)return '';const others=c.members.filter(p=>p.user_id!==state.user.id);if(!others.length)return '';return ticks(others.every(p=>(p.read_at||0)>=m.created)?'read':others.every(p=>(p.delivered_at||0)>=m.created)?'delivered':'sent');}
function previewAuthor(c){const m=c.last;if(!m||m.deleted)return '';if(m.user_id===state.user.id)return 'Вы';if(c.kind!=='group')return '';return String(c.members.find(p=>p.user_id===m.user_id)?.name||m.author?.name||'').split(' ')[0];}
function chatMuted(c){return !!c.muted||(state.settings.muted||[]).includes(c.id);}
function chatItem(c,pins=state.settings.pins||[]){
  const peer=chatPeer(c),pinned=pins.includes(c.id),muted=chatMuted(c),sel=c.id===state.chat,author=previewAuthor(c),typing=typingNow.get(c.id),draft=!sel&&!typing&&chatDraft(c);
  const line=typing?`<em class="typing-text">${esc(typing)}</em>`:draft?`<span class="draft-label">Черновик:</span> ${esc(draft.body.replace(/\s+/g,' '))}`:`${author?`<span class="preview-author">${esc(author)}:</span> `:''}${esc(c.kind==='saved'&&!c.last?'Заметки, файлы и пересланные сообщения':preview(c.last))}`;
  return `<button class="chat-item ${sel?'selected':''} ${muted?'muted':''} ${c.unread?'unread':''}" data-chat="${c.id}" ${sel?'aria-current="true"':''}><span class="chat-avatar">${chatAvatar(c)}${peer?.online?'<i class="online-dot" aria-label="в сети"></i>':''}</span><span class="chat-info"><span class="chat-line"><strong class="chat-title">${c.kind==='group'?icon('group'):c.kind==='channel'?icon('channel'):''}<span class="chat-name">${esc(c.title)}</span>${chatVipBadge(c)}${muted?`<span class="muted-icon" aria-label="Без звука">${icon('mute')}</span>`:''}</strong><span class="chat-meta">${draft?'':lastTicks(c)}<time>${draft?listTime(draft.updated||c.last?.created):c.last?listTime(c.last.created):''}</time></span></span><span class="chat-line"><span class="chat-preview">${line}</span><span class="chat-badges">${c.unread?`<span class="badge" aria-label="${c.unread} непрочитанных">${c.unread>999?'999+':c.unread}</span>`:pinned?`<span class="pin-icon" aria-label="Закреплён">${icon('pin')}</span>`:''}</span></span></span></button>`;
}
function renderChats(){
  const target=$('.chat-list');if(!target)return;const q=($('#chat-search')?.value||'').trim().toLowerCase();
  if($('#custom-folders')){$('#custom-folders').innerHTML=(state.settings.folders||[]).map(f=>`<button class="chip ${state.filter===f.id?'active':''}" role="tab" aria-selected="${state.filter===f.id}" data-custom-folder="${f.id}">${esc(f.name)}</button>`).join('');document.querySelectorAll('[data-custom-folder]').forEach(el=>el.onclick=()=>setFilter(el.dataset.customFolder));}
  $('.side')?.classList.toggle('searching',!!q);
  if(q){renderSearch(target,q);return;}
  const archived=state.settings.archived||[];const pins=state.settings.pins||[];
  let chats=state.chats.filter(c=>(state.filter==='archived'?archived.includes(c.id):!archived.includes(c.id))&&(state.filter!=='unread'||c.unread)&&(!['direct','group','channel'].includes(state.filter)||c.kind===state.filter));
  const folder=(state.settings.folders||[]).find(f=>f.id===state.filter);if(folder)chats=chats.filter(c=>folder.rule==='manual'?folder.chats.includes(c.id):folder.rule==='unread'?c.unread:folder.rule==='recent'?(c.last?.created||c.created)>Date.now()-86400000:c.kind===folder.rule);
  chats.sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id)));
  target.innerHTML=chats.length?chats.map(c=>chatItem(c,pins)).join(''):`<div class="empty-list">${icon('chat')}Здесь появятся ваши разговоры.<br>Нажмите на карандаш, чтобы начать.</div>`;
  target.querySelectorAll('[data-chat]').forEach(el=>el.onclick=guard(()=>openChat(el.dataset.chat)));
}
// ---------- Global search: chats & people, messages, media, links ----------
const searchTabs=[['chats','Чаты'],['messages','Сообщения'],['media','Медиа'],['links','Ссылки']];
function searchInput(){
  const q=($('#chat-search')?.value||'').trim();state.search={...(state.search||{tab:'chats'}),q,people:null,results:{},loading:!!q};
  clearTimeout(searchTimer);renderChats();if(!q)return;
  searchTimer=setTimeout(()=>loadSearch().catch(()=>{}),250);
}
async function loadSearch(){
  const s=state.search,q=s?.q;if(!q)return;const ticket=accountEpoch(),tab=s.tab;
  const request=tab==='chats'?api('/users?q='+encodeURIComponent(q)).then(people=>{s.people=people;}):api(`/search?type=${tab}&q=${encodeURIComponent(q)}`).then(rows=>{s.results[tab]=rows;});
  try{await request;}finally{if(ticket===accountEpoch()&&state.search===s){s.loading=false;renderChats();}}
}
function highlight(text,q){const source=String(text||''),at=source.toLowerCase().indexOf(q.toLowerCase());if(at<0)return esc(source.slice(0,140));const from=Math.max(0,at-40);return (from?'…':'')+esc(source.slice(from,at))+'<mark>'+esc(source.slice(at,at+q.length))+'</mark>'+esc(source.slice(at+q.length,at+q.length+100));}
const firstLink=text=>(String(text||'').match(/(?:https?:\/\/|www\.)[^\s<>"']+/i)||[''])[0];
function renderSearch(target,q){
  const s=state.search||(state.search={tab:'chats',q,people:null,results:{},loading:false});const tab=s.tab;
  let body='';
  if(tab==='chats'){
    const chats=state.chats.filter(c=>c.title.toLowerCase().includes(q));
    const known=new Set(state.chats.filter(c=>c.kind==='direct').map(c=>chatPeer(c)?.user_id));
    const people=(s.people||[]).filter(u=>!known.has(u.id));
    body=(chats.length?`<div class="search-section">Чаты</div>${chats.map(c=>chatItem(c)).join('')}`:'')
      +(people.length?`<div class="search-section">Глобальный поиск</div>${people.map(u=>`<button class="chat-item" data-person="${esc(u.id)}">${avatar(u.name,u.avatar)}<span class="chat-info"><span class="chat-line"><strong class="chat-title"><span class="chat-name">${esc(u.name)}</span>${vipBadge(u)}</strong></span><span class="chat-line"><span class="chat-preview">${u.username?'@'+esc(u.username):''}</span></span></span></button>`).join('')}`:'')
      +(!chats.length&&!people.length&&s.people?`<div class="empty-list">${icon('search')}Ничего не найдено</div>`:'');
  }else{
    const rows=s.results[tab];const title=m=>state.chats.find(c=>c.id===m.chat_id);
    if(rows?.length&&tab==='media')body=`<div class="search-media">${rows.map(m=>`<button class="search-thumb" data-hit="${esc(m.id)}" data-hit-chat="${esc(m.chat_id)}" aria-label="${esc(mediaLabel[m.kind]||'Медиа')} · ${esc(title(m)?.title||'')}">${m.kind==='photo'?`<img src="${accountURL('/api/media/'+m.media.id)}" alt="" loading="lazy">`:`<video src="${accountURL('/api/media/'+m.media.id)}#t=0.1" preload="metadata" muted playsinline></video><span class="thumb-badge">${icon('video')}</span>`}</button>`).join('')}</div>`;
    else if(rows?.length)body=rows.map(m=>{const c=title(m),link=tab==='links'?firstLink(m.body):'';return `<button class="chat-item search-hit" data-hit="${esc(m.id)}" data-hit-chat="${esc(m.chat_id)}">${tab==='links'?`<span class="avatar link-avatar">${icon('link')}</span>`:chatAvatar(c)}<span class="chat-info"><span class="chat-line"><strong class="chat-title"><span class="chat-name">${esc(tab==='links'?link.replace(/^https?:\/\//,''):c?.title||'Чат')}</span></strong><span class="chat-meta"><time>${listTime(m.created)}</time></span></span><span class="chat-line"><span class="chat-preview">${tab==='links'?esc(c?.title||'')+' · ':m.user_id===state.user.id?'<span class="preview-author">Вы:</span> ':c?.kind==='group'?`<span class="preview-author">${esc(m.author?.name?.split(' ')[0]||'')}:</span> `:''}${highlight(m.body||preview(m),q)}</span></span></span></button>`;}).join('');
    else if(rows)body=`<div class="empty-list">${icon('search')}Ничего не найдено</div>`;
  }
  if(s.loading&&!body)body='<div class="search-loading" aria-live="polite">Ищем…</div>';
  target.innerHTML=`<div class="search-tabs" role="tablist" aria-label="Разделы поиска">${searchTabs.map(([key,label])=>`<button class="chip ${tab===key?'active':''}" role="tab" aria-selected="${tab===key}" data-search-tab="${key}">${label}</button>`).join('')}</div>${body}`;
  target.querySelectorAll('[data-search-tab]').forEach(el=>el.onclick=()=>{s.tab=el.dataset.searchTab;const cached=s.tab==='chats'?s.people:s.results[s.tab];s.loading=!cached;renderChats();if(!cached)loadSearch().catch(()=>{});});
  target.querySelectorAll('[data-chat]').forEach(el=>el.onclick=guard(()=>openChat(el.dataset.chat)));
  target.querySelectorAll('[data-person]').forEach(el=>el.onclick=guard(async()=>{const chat=await api('/chats','POST',{users:[el.dataset.person]});await refresh();await openChat(chat.id);}));
  target.querySelectorAll('[data-hit]').forEach(el=>el.onclick=guard(()=>openChatAt(el.dataset.hitChat,el.dataset.hit)));
}
async function openChatAt(chatId,messageId){
  if(!state.chats.some(c=>c.id===chatId))await refresh();
  if(state.tab!=='chat')await navigate('chat');
  if(state.chat!==chatId)await openChat(chatId);
  // Older messages arrive in pages of 60; keep paging until the hit is loaded.
  for(let page=0;page<40&&state.chat===chatId&&!state.messages.some(m=>m.id===messageId);page++)if(!await loadOlder())break;
  if(state.chat===chatId)jumpTo(messageId);
}
async function openSaved(){const chat=await api('/chats/saved','POST',{});if(!state.chats.some(c=>c.id===chat.id))await refresh();if(state.tab!=='chat')await navigate('chat');await openChat(chat.id);}
function chatContextMenu(chatId,x,y){
  const c=state.chats.find(c=>c.id===chatId);if(!c)return;const pins=state.settings.pins||[],archived=state.settings.archived||[],mine=c.members.find(m=>m.user_id===state.user.id),muted=chatMuted(c);
  const items=[['open','chat','Открыть'],['pin','pin',pins.includes(c.id)?'Открепить':'Закрепить'],['archive','archive',archived.includes(c.id)?'Вернуть из архива':'В архив'],['mute',muted?'bell':'mute',muted?'Включить звук':'Без звука']];
  if(c.unread&&c.last)items.push(['read','check','Отметить прочитанным']);
  items.push(['clear','eraser','Очистить историю']);
  if(['direct','saved'].includes(c.kind))items.push(['delete','trash','Удалить чат']);
  else items.push(mine?.role==='owner'?['manage','trash',c.kind==='channel'?'Удалить канал…':'Удалить группу…']:['leave','logout',c.kind==='channel'?'Покинуть канал':'Покинуть группу']);
  const el=popover({x,y,className:'chat-ctx',label:'Действия с чатом',html:items.map(([action,ic,label])=>menuItem(`data-chat-action="${action}"`,icon(ic),label,['manage','leave','delete'].includes(action)?'data-danger':'')).join('')});
  el.querySelectorAll('[data-chat-action]').forEach(b=>b.onclick=guard(async()=>{const action=b.dataset.chatAction;closePopover();
    if(action==='open')await openChat(c.id);
    else if(action==='pin'||action==='archive'){const key=action==='pin'?'pins':'archived',values=state.settings[key]||[];state.settings[key]=values.includes(c.id)?values.filter(v=>v!==c.id):[...values,c.id];await saveSettings();renderChats();toast(action==='pin'?(values.includes(c.id)?'Чат откреплён':'Чат закреплён'):(values.includes(c.id)?'Чат возвращён из архива':'Чат перемещён в архив'));}
    else if(action==='mute'){await api('/chat-mute','POST',{chat:c.id,duration:muted?'off':'forever'});await refresh();toast(muted?'Уведомления включены':'Уведомления выключены');}
    else if(action==='read'){await api(`/chats/${c.id}/read`,'POST',{message:c.last.id});await refresh();}
    else if(action==='leave'){if(confirm(`Покинуть «${c.title}»?`)){await api('/communities/'+c.id+'/leave','POST',{});await refresh();}}
    else if(action==='manage')await asSheet(()=>groupPanel(c,state,refresh));
    else if(action==='clear')clearHistory(c);
    else if(action==='delete')deleteChat(c);}));
}
export async function refresh(){const ticket=accountEpoch();const chats=await api('/chats');if(ticket!==accountEpoch())return;for(const chat of chats)for(const member of chat.members){const previous=state.chats.find(c=>c.id===chat.id)?.members.find(m=>m.user_id===member.user_id);member.read_at=Math.max(member.read_at||0,previous?.read_at||0);member.delivered_at=Math.max(member.delivered_at||0,previous?.delivered_at||0);}state.chats=chats;renderChats();if(state.chat&&!selected()){state.chat=null;empty();$('.shell')?.classList.remove('show-chat');}else setStatus();}
function chatStatus(c){if(c.kind==='saved')return 'заметки и пересылки';if(c.kind==='direct'){const p=chatPeer(c);return p?.online?'<span class="online">в сети</span>':'был(а) недавно';}const online=c.members.filter(m=>m.online&&m.user_id!==state.user.id).length;return esc(peopleCount(c.members.length,c.kind==='channel'))+(c.kind==='group'&&online?`, ${online} в сети`:'');}
function setStatus(){const t=$('#chat-status'),c=selected();if(t&&c&&!typingNow.has(c.id))t.innerHTML=chatStatus(c);}
export async function openChat(chatId){
  if(state.recording){toast('Завершите или отмените запись');return;}
  closePopover();flushDrafts();state.stashedDraft=null;pageCache.delete('chat');state.messages=messagesByChat.get(chatId)||[];state.chat=chatId;state.tab='chat';markTab('chat');state.reply=null;state.editing=null;state.selection=null;state.find=null;state.unseen=0;state.loading=!state.messages.length;renderedKeys=null;const c=selected();if(!c)return;
  $('.shell').classList.add('show-chat');$('.shell').classList.remove('show-page');renderChats();
  const people=c.members.filter(m=>m.user_id!==state.user.id);
  $('.workspace').innerHTML=`<section class="conversation"><header class="conversation-header">${button('back','Назад к списку чатов','class="icon-button mobile-back" id="chat-back"')}<div class="conversation-peer">${chatAvatar(c)}<div class="conversation-title" role="button" tabindex="0" aria-label="Информация: ${esc(c.title)}"><h3>${esc(c.title)} ${chatVipBadge(c)}</h3><small id="chat-status">${chatStatus(c)}</small></div></div><div class="header-actions">${button('search','Поиск по чату (Ctrl+F)','id="chat-find"')}${!['channel','saved'].includes(c.kind)?button('phone','Аудиозвонок','id="audio-call"')+button('video','Видеозвонок','id="video-call"'):''}${button('kebab','Действия чата','id="chat-menu" aria-haspopup="menu"')}</div><div class="selection-bar" hidden></div></header><div id="chat-find-bar"></div><div id="pinned-bar"></div><div class="messages-wrap"><div class="messages" aria-label="Переписка" role="log"></div><button type="button" class="scroll-down" id="scroll-down" tabindex="-1" aria-hidden="true" aria-label="К последним сообщениям">${icon('down')}<span class="badge" hidden></span></button></div><div class="composer-wrap"><div class="composer-inner"><div id="reply-area"></div><div id="record-area"></div><form class="composer" id="composer">${button('attach','Прикрепить','type="button" id="attach"')}<textarea id="draft" rows="1" maxlength="4000" placeholder="Сообщение" aria-label="Сообщение" enterkeyhint="send"></textarea>${button('emoji','Эмодзи, стикеры и GIF','type="button" id="emoji" aria-expanded="false"')}<span class="composer-ai-slot"><button type="button" id="composer-ai" class="icon-button" title="AI-помощник" aria-label="Улучшить текст с AI">${icon('sparkles')}</button></span>${button(state.mode==='voice'?'mic':'video',state.mode==='voice'?'Голосовое: удерживайте для записи, нажмите — видеосообщение':'Видеосообщение: удерживайте для записи, нажмите — голосовое','type="button" id="record"')}<button class="icon-button send" type="submit" title="Отправить" aria-label="Отправить">${icon('send')}</button></form></div></div></section>`;
  $('#chat-back').classList.add('mobile-back');$('#emoji').classList.add('emoji-btn');
  $('#chat-back').onclick=()=>closeChat();
  const info=guard(()=>c.kind==='saved'?undefined:asSheet(()=>c.kind==='direct'?extendedProfile(people[0]?.user_id||state.user.id):groupPanel(c,state,refresh)));
  $('.conversation-title').onclick=info;$('.conversation-title').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();info();}};$('.conversation-header .avatar').onclick=info;
  $('#chat-menu').onclick=()=>chatMenu();$('#chat-find').onclick=()=>openFind();
  if($('#audio-call'))$('#audio-call').onclick=guard(()=>calls.start(c,false));
  if($('#video-call'))$('#video-call').onclick=guard(()=>calls.start(c,true));
  bindMessageList();
  if(c.kind==='channel'&&!c.canPost){$('.composer-wrap').remove();$('.conversation').insertAdjacentHTML('beforeend',`<div class="channel-actions"><button class="secondary" id="channel-mute">${c.muted?'Включить звук':'Выключить звук'}</button><button class="secondary" id="channel-leave">Покинуть канал</button></div>`);$('#channel-mute').onclick=guard(async()=>{await api('/chat-mute','POST',{chat:c.id,duration:c.muted?'off':'forever'});await refresh();await openChat(c.id);});$('#channel-leave').onclick=guard(async()=>{await api('/communities/'+c.id+'/leave','POST',{});await refresh();});renderMessages(true);await loadMessages();return;}
  $('#composer').onsubmit=guard(async e=>{e.preventDefault();await sendText();});
  $('#draft').value=chatDraft(c)?.body||'';
  bindFileInput($('.conversation'),$('#draft'),sendFiles);
  $('#draft').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!e.repeat&&state.settings.enter!==false){e.preventDefault();guard(sendText)();}else if(e.key==='ArrowUp'&&!e.target.value&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!state.editing){if(editLast())e.preventDefault();}};
  $('#draft').oninput=e=>{const el=$('#draft');if(!state.editing&&state.chat===chatId)saveDraft(chatId,el.value);el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';if(el.value&&c.kind!=='saved'&&Date.now()-typingAt>2500){typingAt=Date.now();api(`/chats/${chatId}/typing`,'POST',{}).catch(()=>{});}};
  $('#attach').onclick=attachments;$('#emoji').onclick=()=>toggleEmojiPanel(state,saveSettings);
  setupComposerAI();setupStickerSuggestions(state,saveSettings);setupRecorder();renderMessages(true);
  if($('#draft').value){const el=$('#draft');el.style.height=Math.min(el.scrollHeight,200)+'px';}
  if(!mobile())$('#draft').focus({preventScroll:true});
  await loadMessages();
}
function bindMessageList(){
  const box=$('.messages');
  box.addEventListener('scroll',updateScrollDown,{passive:true});
  $('#scroll-down').onclick=()=>{box.scrollTo({top:box.scrollHeight,behavior:calm()?'auto':'smooth'});state.unseen=0;updateScrollDown();};
  box.oncontextmenu=e=>{const article=e.target.closest('.message[data-id]');if(!article||state.selection||e.target.closest('a[href],video,audio,input,textarea'))return;const sel=getSelection?.();if(sel&&String(sel)&&article.contains(sel.anchorNode))return;e.preventDefault();messageMenu(article.dataset.id,{x:e.clientX,y:e.clientY});};
  longPress(box,'.message[data-id] .bubble',(e,bubble)=>{if(!state.selection)messageMenu(bubble.closest('.message').dataset.id,{x:e.clientX,y:e.clientY});});
  bindMessageGestures(box,{
    canReply:id=>{const c=selected(),m=state.messages.find(x=>x.id===id);return !!m&&!m.deleted&&!m.pending&&!!$('#draft')&&(c?.kind!=='channel'||c.canPost);},
    onReply:id=>{const m=state.messages.find(x=>x.id===id);if(m)messageAction('reply',m);},
    onDoubleTap:(id,x,y)=>{const c=selected(),m=state.messages.find(x=>x.id===id);if(!m||m.deleted||m.pending||(c?.kind==='channel'&&!c.reactions_enabled))return;const next=m.myReaction==='❤️'?'':'❤️';if(next)heartBurst(x,y);guard(()=>setReaction(id,next))();}
  });
  box.addEventListener('click',e=>{
    const jump=e.target.closest('[data-jump]');if(jump){e.preventDefault();jumpTo(jump.dataset.jump);return;}
    const react=e.target.closest('[data-react]');if(react){e.preventDefault();const m=state.messages.find(x=>x.id===react.dataset.message);guard(()=>setReaction(react.dataset.message,m?.myReaction===react.dataset.react?'':react.dataset.react))();return;}
    const sticker=e.target.closest('.sent-sticker');if(sticker&&!state.selection){const m=state.messages.find(x=>x.id===sticker.closest('.message')?.dataset.id);if(m?.sticker)guard(()=>showStickerPreview(state,{...m.sticker,id:m.sticker.id||m.body},{fromChat:true}))();return;}
    if(state.selection){const article=e.target.closest('.message[data-id]');if(article&&!article.dataset.id.startsWith('local:')){e.preventDefault();toggleSelect(article.dataset.id);}}
  });
}
function updateScrollDown(){const box=$('.messages'),btn=$('#scroll-down');if(!box||!btn)return;const distance=box.scrollHeight-box.scrollTop-box.clientHeight;if(distance<80)state.unseen=0;const visible=distance>300;btn.classList.toggle('visible',visible);btn.tabIndex=visible?0:-1;btn.setAttribute('aria-hidden',String(!visible));const badge=btn.querySelector('.badge');badge.hidden=!state.unseen;badge.textContent=state.unseen>99?'99+':String(state.unseen||'');}
function jumpTo(id,flash=true){const el=[...document.querySelectorAll('.messages .message')].find(a=>a.dataset.id===id);if(!el){toast('Сообщение ещё не загружено');return;}el.scrollIntoView({block:'center',behavior:calm()?'auto':'smooth'});if(!flash)return;el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1500);}
async function loadMessages(scroll=true){
  const chatId=state.chat;if(!chatId)return;const generation=++chatGeneration;let rows;
  try{rows=await api(`/chats/${chatId}/messages`);await synchronizer?.write(rows);}
  catch(e){if(e.status){if(generation===chatGeneration&&chatId===state.chat&&state.loading){state.loading=false;renderMessages(false);}throw e;}rows=(await synchronizer?.cached(chatId)||[]).slice(-60);}
  if(generation!==chatGeneration||chatId!==state.chat)return;state.loading=false;acceptMessages(chatId,rows,scroll);
  if(rows.length&&navigator.onLine){await api('/receipts','POST',{chat:chatId,message:rows.at(-1).id});if(document.visibilityState==='visible')await api(`/chats/${chatId}/read`,'POST',{message:rows.at(-1).id});}
}
let renderedKeys=null;
const authorName=m=>m.user_id===state.user.id?state.user.name:selected()?.members.find(p=>p.user_id===m.user_id)?.name||m.author?.name||'';
const sameRun=(a,b)=>a&&b&&a.user_id===b.user_id&&dayKey(a.created)===dayKey(b.created)&&Math.abs(b.created-a.created)<300000;
const skeleton=()=>`<div class="skeleton-list" data-key="skeleton" aria-hidden="true">${[52,34,68,44,28,60,40].map((w,i)=>`<div class="skeleton-msg ${[1,4,5].includes(i)?'own':''}" style="--w:${w}%"></div>`).join('')}</div>`;
function messageHTML(m,{first,last,kind,others}){
  const own=m.user_id===state.user.id,c=selected(),member=c?.members.find(p=>p.user_id===m.user_id),name=authorName(m);let content='';
  const jumbo=m.kind==='text'&&!m.deleted&&!m.media&&!m.poll&&!m.reply_id&&!m.forwarded&&!m.story?jumboSize(m.body):0;
  const hasText=!jumbo&&!m.deleted&&m.kind!=='sticker'&&!!String(m.body||'').trim();const tail=[];let visual=!!jumbo;
  if(!m.deleted){
    if(m.media){const source=accountURL('/api/media/'+m.media.id);
      if(m.kind==='photo'){visual=true;content+=`<a class="media" href="${source}" target="_blank" rel="noopener"><img src="${source}" alt="${esc(m.media.name)}" loading="lazy"></a>`;}
      else if(['video','round'].includes(m.kind)){visual=true;content+=`<video class="${m.kind==='round'?'round':''}" src="${source}" controls playsinline preload="metadata"></video>`;}
      else if(m.kind==='voice')content+=`<div class="waveform" aria-hidden="true">${Array.from({length:35},(_,i)=>`<i style="height:${7+Math.sin(i*4.3)**2*17}px;animation-delay:${i*.04}s"></i>`).join('')}</div><audio src="${source}" controls preload="metadata"></audio><button class="chip audio-speed">1×</button>`;
      else content+=`<a class="file" href="${source}" download="${esc(m.media.name)}"><span class="file-icon">${icon('file')}</span><span>${esc(m.media.name)}<br><small>${(m.media.size/1024/1024).toFixed(2)} МБ</small></span>${icon('download')}</a>`;
    }
    if(m.reply_id){const original=state.messages.find(r=>r.id===m.reply_id);const who=original?authorName(original):'';content=`<button type="button" class="reply-preview" data-jump="${esc(m.reply_id)}" data-tone="${tone(who)}"><b>${esc(who||'Ответ')}</b><span>${esc(original?preview(original):'Сообщение недоступно')}</span></button>`+content;}
    if(m.forwarded)content=`<div class="forward-label">Переслано от <b>${esc(m.forwarded)}</b></div>`+content;
    if(m.pending&&m.kind!=='text'&&m.kind!=='sticker')content+=`<div class="attachment-pending">${esc(m.attachmentName||mediaLabel[m.kind]||'Вложение')}</div>`;
    if(m.kind==='sticker'){visual=true;content+=`<img class="sent-sticker" src="${esc(accountURL(m.sticker?.poster||'/api/stickers/'+encodeURIComponent(m.body)+'/file'))}" ${m.sticker?.animated?`data-motion="${esc(accountURL(m.sticker.url))}" data-poster="${esc(accountURL(m.sticker.poster))}"`:""} alt="${esc(m.sticker?.label||'Стикер')}" loading="lazy">`;}
    if(m.poll)tail.push(pollCard(m));
    if(m.story)content='<div class="reply-preview story-reply">'+(m.story.unavailable?'История недоступна':'Ответ на историю: '+esc(m.story.caption||m.story.kind))+'</div>'+content;
    if(!m.pending&&['voice','round'].includes(m.kind))tail.push(`<button class="chip transcribe" data-message="${m.id}">${m.transcript?'Показать / скрыть текст':'Расшифровать'}</button>${m.transcript?`<div class="transcript hidden">${esc(m.transcript)}</div>`:''}`);
  }
  const read=others.length&&others.every(p=>p.read_at>=m.created);const delivered=others.length&&others.every(p=>p.delivered_at>=m.created);
  m.status=m.pending?(m.error?'failed':'sending'):read?'read':delivered?'delivered':'sent';
  const status=m.pending?`<span class="send-status ${m.error?'failed':''}" title="${esc(m.error||'Отправляется')}">${m.error?'<b aria-hidden="true">!</b> Не отправлено':`${icon('clock')}<span class="sr-only">Отправляется…</span>`}</span>${m.error?`<button class="chip retry-send" data-client-id="${esc(m.clientMessageId)}">Повторить</button>`:''}`:own&&others.length?ticks(m.status):'';
  const mediaOnly=visual&&!hasText&&!m.reply_id&&!m.forwarded&&!m.story&&!tail.length&&(!m.pending||!!jumbo);
  const footer=`<span class="message-footer${mediaOnly?' overlay':''}">${m.pinned?`<span class="footer-pin" aria-label="Закреплено">${icon('pin')}</span>`:''}${m.edited?'<span class="edited">изменено</span>':''}<time datetime="${new Date(m.created).toISOString()}">${time(m.created)}</time>${status}</span>`;
  const reactions=!m.deleted&&m.reactions?.length?`<div class="message-reactions">${m.reactions.map(r=>`<button type="button" class="reaction${r.emoji===m.myReaction?' mine':''}" data-react="${esc(r.emoji)}" data-message="${m.id}" aria-label="Реакция ${esc(r.emoji)}: ${r.count}">${renderCustom(r.emoji)}<span>${r.count}</span></button>`).join('')}${footer}</div>`:'';
  if(m.deleted)content=`<div class="body deleted">${icon('trash')}<span>Сообщение удалено</span>${footer}</div>`;
  else if(jumbo)content+=`<div class="jumbo-emoji jumbo-${jumbo}">${renderCustom(m.body.trim())}</div>`;
  else if(m.kind!=='sticker')content+=hasText||!visual?`<div class="body">${renderCustom(m.body)}${!reactions&&!tail.length&&hasText?footer:''}</div>`:'';
  content+=tail.join('');
  if(!m.deleted){if(reactions)content+=reactions;else if(!hasText||tail.length)content+=footer;}
  const showAuthor=!['direct','saved'].includes(c?.kind)&&first&&!(mediaOnly&&m.kind==='sticker')&&(!own||state.user.vip);
  const author=showAuthor?`<button class="author profile-name" data-open-profile="${m.user_id}" data-tone="${tone(name)}">${esc(name)} ${vipBadge(own?state.user:member||m.author)}${member?.tag?`<span class="member-tag">${esc(member.tag)}</span>`:''}</button>`:'';
  const side=kind==='group'&&!own?(last?`<button type="button" class="msg-avatar" data-open-profile="${m.user_id}" aria-label="Профиль: ${esc(name)}">${avatar(name,member?.avatar||m.author?.avatar)}</button>`:'<span class="msg-avatar"></span>'):'';
  const picked=state.selection?.has(m.id),found=state.find?.ids.includes(m.id),current=found&&state.find.ids[state.find.index]===m.id;
  return `<article class="message ${own?'own':''} ${first?'first':''} ${last?'last':''} ${picked?'picked':''} ${found?'found':''} ${current?'found-current':''}" data-key="${esc(messageKey(m))}" data-id="${m.id}">${state.selection?`<span class="select-mark" aria-hidden="true">${icon('check')}</span>`:''}${side}<div class="bubble ${mediaOnly?'media-only':''} ${mediaOnly&&(jumbo||['sticker','round'].includes(m.kind))?'bare':''} ${m.kind==='sticker'?'sticker-bubble':''}">${author}${content}</div>${!m.deleted&&!m.pending&&!state.selection?`<button class="message-menu" data-message="${m.id}" aria-label="Действия сообщения">${icon('kebab')}</button>`:''}</article>`;
}
function renderMessages(scroll){
  const box=$('.messages');if(!box)return;const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;const previous=box.scrollTop;
  const c=selected(),kind=c?.kind||'direct',others=(c?.members||[]).filter(p=>p.user_id!==state.user.id);
  if(renderedKeys&&!scroll&&!nearBottom)for(const m of state.messages)if(!renderedKeys.has(messageKey(m))&&m.user_id!==state.user.id)state.unseen=(state.unseen||0)+1;
  renderedKeys=new Set(state.messages.map(messageKey));
  let html=state.messages.length>=60?'<button class="chip older" id="older">Загрузить предыдущие</button>':'';
  if(!state.messages.length)html+=state.loading?skeleton():`<div class="chat-empty" data-key="chat-empty"><span>${kind==='channel'?'Здесь пока нет публикаций':kind==='saved'?'Сохраняйте здесь заметки, файлы и пересланные сообщения — они доступны на всех ваших устройствах':'Сообщений пока нет — напишите первым 👋'}</span></div>`;
  let lastDay='';
  state.messages.forEach((m,i)=>{const day=dayKey(m.created);if(day!==lastDay){html+=`<div class="date-divider" data-key="day:${day}"><span>${dayLabel(m.created)}</span></div>`;lastDay=day;}html+=messageHTML(m,{first:!sameRun(state.messages[i-1],m),last:!sameRun(m,state.messages[i+1]),kind,others});});
  reconcileMessages(box,html);
  box.querySelectorAll('.retry-send').forEach(el=>el.onclick=guard(()=>outbox.retry(el.dataset.clientId)));
  if(scroll||nearBottom)box.scrollTop=box.scrollHeight;else box.scrollTop=previous;
  bindPolls(box,state,loadMessages);bindStickerEffects(box,state.messages,state.settings);
  box.querySelectorAll('.message-menu').forEach(el=>el.onclick=()=>messageMenu(el.dataset.message,{anchor:el}));
  box.querySelectorAll('[data-vote]').forEach(el=>el.onclick=guard(async()=>{const m=state.messages.find(m=>m.id===el.dataset.message);const choice=Number(el.dataset.vote);const choices=m.poll.multiple?(m.poll.mine.includes(choice)?m.poll.mine.filter(c=>c!==choice):[...m.poll.mine,choice]):[choice];await api(`/messages/${m.id}/vote`,'POST',{choices});await loadMessages(false);}));
  box.querySelectorAll('.transcribe').forEach(el=>el.onclick=guard(async()=>{const m=state.messages.find(m=>m.id===el.dataset.message);if(m.transcript){el.nextElementSibling.classList.toggle('hidden');return;}if(!confirm('Отправить запись в подключённый сервис распознавания речи?'))return;el.disabled=true;el.textContent='Распознаём…';try{await api(`/messages/${m.id}/transcribe`,'POST',{consent:true});await loadMessages(false);}finally{el.disabled=false;el.textContent='Расшифровать';}}));
  box.querySelectorAll('audio').forEach(audio=>{audio.onplay=()=>audio.closest('.bubble').classList.add('playing');audio.onpause=()=>audio.closest('.bubble').classList.remove('playing');const speed=audio.nextElementSibling;speed.onclick=()=>{audio.playbackRate=audio.playbackRate===1?1.5:audio.playbackRate===1.5?2:1;speed.textContent=audio.playbackRate+'×';};});
  if($('#older'))$('#older').onclick=guard(loadOlder);
  renderPinned();updateScrollDown();
}
async function loadOlder(){
  const box=$('.messages'),chat=state.chat,first=state.messages.find(m=>!m.pending),generation=chatGeneration;if(!box||!first)return 0;
  const rows=await api(`/chats/${chat}/messages?before=${first.created}&beforeId=${encodeURIComponent(first.id)}`);if(chat!==state.chat||generation!==chatGeneration)return 0;
  if(!rows.length){$('#older')?.remove();return 0;}
  const height=box.scrollHeight;acceptMessages(chat,rows);box.scrollTop=box.scrollHeight-height;return rows.length;
}
function renderPinned(){const bar=$('#pinned-bar');if(!bar)return;const m=[...state.messages].reverse().find(x=>x.pinned&&!x.deleted);const key=m?m.id+':'+preview(m):'';if(bar.dataset.key===key)return;bar.dataset.key=key;if(!m){bar.innerHTML='';return;}bar.innerHTML=`<button type="button" class="pinned-bar"><span class="pinned-text"><b>Закреплённое сообщение</b><span>${esc(preview(m))}</span></span>${icon('pin')}</button>`;bar.firstElementChild.onclick=()=>jumpTo(m.id);}
async function sendText(){
 const input=$('#draft'),text=input.value.trim(),chat=state.chat;if(!text||!chat)return;
 const editing=state.editing,payload={body:text,reply:state.reply};
 // Capture and clear before the first await: Enter + submit cannot send twice.
 input.value='';input.dispatchEvent(new Event('input'));if(!editing){forgetDraft(chat);saveDraft(chat,'',{immediate:true});}
 state.reply=null;state.editing=null;$('#reply-area').innerHTML='';
 if(!editing){await outbox.enqueue(chat,payload);return;}
 restoreStashedDraft();
 try{await api('/messages/'+editing,'PATCH',{body:text});const updated=await api('/messages/'+editing);acceptMessages(chat,[updated]);}
 catch(error){if(state.chat===chat){state.stashedDraft=input.value;input.value=text;state.editing=editing;replyBar('Редактирование',text,'edit');input.dispatchEvent(new Event('input'));}throw error;}
}

function replyBar(title,text='',kind='reply'){$('#reply-area').innerHTML=`<div class="reply-bar ${kind}">${icon(kind==='edit'?'edit':'reply')}<div class="reply-bar-text"><b>${esc(title)}</b><span>${esc(text)}</span></div>${button('close','Отменить','id="cancel-reply"')}</div>`;$('#cancel-reply').onclick=cancelReply;$('#draft').focus();}
function restoreStashedDraft(){const input=$('#draft'),text=state.stashedDraft||'';state.stashedDraft=null;if(!input)return;input.value=text;input.dispatchEvent(new Event('input'));}
function cancelReply(){const editing=state.editing;state.reply=null;state.editing=null;if($('#reply-area'))$('#reply-area').innerHTML='';if(editing&&$('#draft'))restoreStashedDraft();}
function startEdit(m){const input=$('#draft');if(!input)return;if(!state.editing)state.stashedDraft=input.value;state.editing=m.id;state.reply=null;input.value=m.body;input.dispatchEvent(new Event('input'));replyBar('Редактирование',preview(m),'edit');input.setSelectionRange(input.value.length,input.value.length);}
function editLast(){const c=selected();if(c?.kind==='channel'&&!c.canEdit)return false;const m=[...state.messages].reverse().find(x=>x.user_id===state.user.id&&!x.deleted&&!x.pending&&x.kind==='text'&&x.body);if(!m)return false;startEdit(m);return true;}
async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0';document.body.append(area);area.select();document.execCommand?.('copy');area.remove();}}
async function setReaction(id,emoji){
  const chat=state.chat,m=state.messages.find(x=>x.id===id);
  if(m){const previous={reactions:m.reactions,myReaction:m.myReaction};const counts=new Map((m.reactions||[]).map(r=>[r.emoji,r.count]));if(m.myReaction)counts.set(m.myReaction,(counts.get(m.myReaction)||1)-1);if(emoji)counts.set(emoji,(counts.get(emoji)||0)+1);
    m.reactions=[...counts].filter(([,n])=>n>0).map(([emoji,count])=>({emoji,count}));m.myReaction=emoji||null;renderMessages(false);
    try{await api('/reactions','POST',{message:id,emoji});}catch(error){Object.assign(m,previous);if(state.chat===chat)renderMessages(false);throw error;}}
  else await api('/reactions','POST',{message:id,emoji});
  if(state.chat===chat)await loadMessages(false);
}
const quickReactions=['👍','❤️','🔥','😂','🙏','🎉','✨','💎','🚀','🌟'];
function messageMenu(messageId,at={}){
  const m=state.messages.find(m=>m.id===messageId);if(!m||m.pending||m.deleted)return;
  const c=selected(),channel=c?.kind==='channel',post=!channel||c.canPost,own=m.user_id===state.user.id,reactions=!channel||c.reactions_enabled;
  const items=[];
  if(post)items.push(['reply','reply','Ответить']);
  if(m.body&&m.kind!=='sticker')items.push(['copy','copy','Копировать текст']);
  if(m.kind==='sticker'&&m.sticker)items.push(['sticker-favorite','star','Стикер в избранное'],['sticker-pack','image','Открыть набор стикеров']);
  items.push(['forward','forward','Переслать']);
  if(!channel||c.canPin)items.push(['pin','pin',m.pinned?'Открепить':'Закрепить']);
  if(channel?c.canEdit:own)items.push(['edit','edit','Изменить']);
  if(!channel||c.canDelete)items.push(['delete','trash','Удалить']);
  items.push(['select','select','Выбрать'],['sep'],['ai','sparkles','Ответить с AI'],['translate','language','Перевести с AI'],['summarize','file','Резюме с AI']);
  const article=[...document.querySelectorAll('.messages .message')].find(a=>a.dataset.id===m.id);article?.classList.add('menu-open');
  const el=popover({...at,align:'end',className:'message-ctx',label:'Действия с сообщением',onClose:()=>article?.classList.remove('menu-open'),html:`${reactions?`<div class="ctx-reactions" role="group" aria-label="Реакции">${quickReactions.map((e,i)=>`<button type="button" data-quick-reaction="${e}" aria-label="Реакция ${e}" ${i>5?'class="extra"':''}>${e}</button>`).join('')}<button type="button" class="extra" data-quick-reaction="" aria-label="Убрать реакцию" title="Убрать реакцию">${icon('close')}</button><button type="button" class="more-reactions" aria-label="Все реакции" aria-expanded="false">${icon('down')}</button></div>`:''}${items.map(([action,ic,label])=>action==='sep'?'<div class="ctx-sep" role="separator"></div>':menuItem(`data-action="${action}"`,icon(ic),label,action==='delete'?'data-danger':'')).join('')}`});
  el.querySelector('.more-reactions')?.addEventListener('click',e=>{const row=el.querySelector('.ctx-reactions');row.classList.toggle('expanded');e.currentTarget.setAttribute('aria-expanded',String(row.classList.contains('expanded')));});
  el.querySelectorAll('[data-quick-reaction]').forEach(b=>b.onclick=guard(async()=>{closePopover();await api('/reactions','POST',{message:m.id,emoji:b.dataset.quickReaction});await loadMessages(false);}));
  el.querySelectorAll('[data-action]').forEach(b=>b.onclick=guard(async()=>{closePopover();await messageAction(b.dataset.action,m);}));
}
async function messageAction(action,m){
  const channel=selected()?.kind==='channel';
  if(['ai','translate','summarize'].includes(action)){await aiPage(state,saveSettings,openChat,{compact:true,chat:state.chat});$('#ai-text').value=(action==='translate'?'Переведи на русский сообщение ':action==='summarize'?'Сделай резюме сообщения и доступной расшифровки ':'Помоги ответить на сообщение ')+m.id+'. Используй только разрешённые данные. Для записи без расшифровки объясни, что сначала нужна расшифровка. Ничего не отправляй.';}
  else if(action==='reply'){state.reply=m.id;state.editing=null;replyBar(authorName(m)||'Ответ',preview(m));}
  else if(action==='copy'){await copyText(m.body);toast('Текст скопирован');}
  else if(action==='select')enterSelection(m.id);
  else if(action==='edit'&&channel){modal('Редактировать публикацию',`<textarea id="edit-post">${esc(m.body)}</textarea><button class="primary" id="save-post">Сохранить</button>`);$('#save-post').onclick=saveAction(async()=>{await api('/messages/'+m.id,'PATCH',{body:$('#edit-post').value});await loadMessages(false);});}
  else if(action==='edit')startEdit(m);
  else if(action==='delete'){if(confirm('Удалить сообщение для всех участников?')){await api('/messages/'+m.id,'DELETE',{});await loadMessages(false);}}
  else if(action==='pin'){await api('/messages/'+m.id,'PATCH',{pinned:!m.pinned});await loadMessages(false);}
  else if(action==='forward')forwardMessages([m]);
  else if(action==='sticker-favorite'){await api('/stickers/favorites','POST',{id:m.sticker?.id||m.body});toast('Добавлено в избранные стикеры');}
  else if(action==='sticker-pack'){if(m.sticker?.pack_id)await stickerPanel(state,saveSettings,async()=>{},{pack:m.sticker.pack_id});else await showStickerPreview(state,{...m.sticker,id:m.sticker?.id||m.body},{fromChat:true});}
}
function forwardMessages(list){
  if(!list.length)return;
  modal(list.length>1?`Переслать ${list.length} сообщ.`:'Переслать',`<div class="search">${icon('search')}<input id="forward-search" type="search" placeholder="Поиск чата" aria-label="Поиск чата"></div><div class="forward-list">${state.chats.some(c=>c.kind==='saved')?'':`<button class="forward-item" data-forward="saved">${savedAvatar()}<span>Избранное</span></button>`}${[...state.chats].sort((a,b)=>Number(b.kind==='saved')-Number(a.kind==='saved')).filter(c=>c.kind!=='channel'||c.canPost).map(c=>`<button class="forward-item" data-forward="${c.id}">${chatAvatar(c)}<span>${esc(c.title)}</span></button>`).join('')}</div>`);
  $('#forward-search').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('[data-forward]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(q));};
  document.querySelectorAll('[data-forward]').forEach(btn=>btn.onclick=guard(async()=>{if(btn.disabled)return;btn.disabled=true;const target=btn.dataset.forward==='saved'?(await api('/chats/saved','POST',{})).id:btn.dataset.forward;if(btn.dataset.forward==='saved')scheduleChatRefresh();for(const m of list)await outbox.enqueue(target,{forward:m.id,body:m.body,kind:m.kind,forwarded:m.forwarded||m.author?.name});$('#modal').close();exitSelection();toast(list.length>1?'Сообщения пересланы':'Сообщение переслано');}));
}
function enterSelection(id){state.selection=new Set(id?[id]:[]);$('.conversation')?.classList.add('selecting');renderMessages(false);renderSelectionBar();}
function exitSelection(){if(!state.selection)return;state.selection=null;$('.conversation')?.classList.remove('selecting');renderMessages(false);renderSelectionBar();}
function toggleSelect(id){const s=state.selection;if(s.has(id))s.delete(id);else s.add(id);renderMessages(false);renderSelectionBar();}
function renderSelectionBar(){
  const bar=$('.selection-bar');if(!bar)return;const s=state.selection;bar.hidden=!s;if(!s){bar.innerHTML='';return;}
  const c=selected(),none=!s.size,chosen=()=>state.messages.filter(m=>s.has(m.id));
  bar.innerHTML=`${button('close','Отменить выбор (Esc)','id="selection-cancel"')}<strong aria-live="polite">${none?'Выберите сообщения':'Выбрано: '+s.size}</strong><span class="spacer"></span>${button('copy','Копировать','id="selection-copy"')}${button('forward','Переслать','id="selection-forward"')}${c?.kind!=='channel'||c.canDelete?button('trash','Удалить','id="selection-delete"'):''}`;
  bar.querySelectorAll('#selection-copy,#selection-forward,#selection-delete').forEach(b=>b.disabled=none);
  $('#selection-cancel').onclick=exitSelection;
  $('#selection-copy').onclick=guard(async()=>{await copyText(chosen().map(m=>m.body||preview(m)).join('\n\n'));toast('Скопировано');exitSelection();});
  $('#selection-forward').onclick=()=>forwardMessages(chosen());
  if($('#selection-delete'))$('#selection-delete').onclick=guard(async()=>{const list=chosen();if(!confirm(`Удалить выбранные сообщения (${list.length}) для всех участников?`))return;let failed=0;for(const m of list){try{await api('/messages/'+m.id,'DELETE',{});}catch{failed++;}}exitSelection();await loadMessages(false);if(failed)toast(`Не удалось удалить: ${failed}`);});
}
function openFind(){
  const bar=$('#chat-find-bar');if(!bar)return;
  if(!state.find){state.find={q:'',ids:[],index:0};bar.innerHTML=`<div class="find-bar"><div class="search">${icon('search')}<input id="find-input" type="search" placeholder="Поиск в чате" aria-label="Поиск в чате" autocomplete="off"></div><span class="find-count" aria-live="polite"></span>${button('up','Предыдущее (Enter)','id="find-prev"')}${button('down','Следующее (Shift+Enter)','id="find-next"')}${button('close','Закрыть поиск','id="find-close"')}</div>`;
    const input=$('#find-input');input.oninput=()=>runFind(input.value);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();stepFind(e.shiftKey?1:-1);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFind();}};
    $('#find-prev').onclick=()=>stepFind(-1);$('#find-next').onclick=()=>stepFind(1);$('#find-close').onclick=closeFind;}
  $('#find-input').focus();$('#find-input').select();
}
function runFind(q){q=q.trim().toLowerCase();Object.assign(state.find,{q,ids:q?state.messages.filter(m=>!m.deleted&&String(m.body||'').toLowerCase().includes(q)).map(m=>m.id):[]});state.find.index=state.find.ids.length-1;renderMessages(false);showFound();}
function stepFind(d){const f=state.find;if(!f?.ids.length)return;f.index=(f.index+d+f.ids.length)%f.ids.length;renderMessages(false);showFound();}
function showFound(){const f=state.find,count=$('.find-count');if(count)count.textContent=f.q?(f.ids.length?`${f.index+1} из ${f.ids.length}`:'Нет совпадений'):'';const id=f.ids[f.index];if(id)jumpTo(id,false);}
function closeFind(){if(!state.find)return;state.find=null;if($('#chat-find-bar'))$('#chat-find-bar').innerHTML='';renderMessages(false);$('#draft')?.focus({preventScroll:true});}
function markTab(tab){document.querySelectorAll('[data-tab]').forEach(el=>{const on=el.dataset.tab===tab;el.classList.toggle('active',on);if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});}
// Keyboard: Esc closes menus/search/selection/reply and then the chat; Ctrl+F searches.
document.addEventListener('keydown',e=>{
  if(!state.user||!$('.shell'))return;const dialogOpen=document.querySelector('dialog[open]');
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.code==='KeyF'){if(dialogOpen)return;e.preventDefault();if(state.chat&&state.tab==='chat')openFind();else $('#chat-search')?.focus();return;}
  if(e.key!=='Escape'||e.defaultPrevented||dialogOpen||popoverOpen()||state.recording||$('.composer-ai-panel'))return;
  if(emojiPanelOpen()){closeEmojiPanel();$('#emoji')?.focus();return;}
  if(state.find){closeFind();return;}
  if(state.selection){exitSelection();return;}
  if(state.reply||state.editing){cancelReply();return;}
  if(e.target.matches?.('input,textarea')&&e.target.value)return;
  if(state.chat&&state.tab==='chat')closeChat();
});
function attachments(){modal('Поделиться',`<div class="menu-grid"><button id="media-pick">${icon('image')}Фото и видео</button><button id="file-pick">${icon('file')}Файл</button><button id="poll-create">${icon('poll')}Опрос</button></div>`);$('#media-pick').onclick=()=>{modal('Фото и видео','<button class="secondary" id="gallery">Выбрать из галереи</button><button class="secondary" id="capture-photo">Снять фото</button><button class="secondary" id="capture-video">Снять видео</button>');$('#gallery').onclick=()=>pickFile('image/*,video/*');$('#capture-photo').onclick=()=>pickFile('image/*','environment');$('#capture-video').onclick=()=>pickFile('video/*','environment');};$('#file-pick').onclick=()=>pickFile('*/*');$('#poll-create').onclick=createPoll;}
function pickFile(accept,capture){const input=document.createElement('input');input.type='file';input.accept=accept;if(capture)input.capture=capture;input.onchange=guard(async()=>{const file=input.files[0];if(!file)return;$('#modal').close();const kind=accept==='*/*'?'file':file.type.startsWith('image/')?'photo':'video';await outbox.enqueue(state.chat,{kind,reply:state.reply},file);});input.click();}
async function sendFiles(list){const chat=state.chat;if(!chat)return;const reply=state.reply;if(reply)cancelReply();for(const {file,kind,caption}of list)await outbox.enqueue(chat,{kind,reply,...(caption?{body:caption}:{})},file);}
function createPoll(){pollEditor(state.chat,loadMessages).catch(e=>toast(e.message));}
export function newChat(defaultKind='direct'){return createChatDialog(defaultKind,{refresh,openChat});}

function chatMenu(){
  const c=selected();if(!c)return;const mine=c.members.find(m=>m.user_id===state.user.id),archived=(state.settings.archived||[]).includes(c.id),pinned=(state.settings.pins||[]).includes(c.id),anchor=$('#chat-menu'),saved=c.kind==='saved';
  const items=[];
  if(!saved)items.push(['extended-view','info',c.kind==='direct'?'Профиль':'Статистика сообщества'],['mute-chat',chatMuted(c)?'bell':'mute','Уведомления…']);
  items.push(['pin-chat','pin',pinned?'Открепить чат':'Закрепить чат'],['archive-chat','archive',archived?'Вернуть из архива':'Архивировать']);
  if(!(c.kind==='channel'&&!c.canPost))items.push(['schedule-chat','clock','Запланировать сообщение']);
  items.push(['find-in-chat','search','Поиск по чату'],['select-messages','select','Выбрать сообщения']);
  if(c.kind==='direct')items.push(['block-user','lock','Заблокировать собеседника']);
  else if(!saved)items.push(['group-manage','settings',['owner','admin'].includes(mine?.role)?(c.kind==='channel'?'Настройки канала':'Настройки группы'):'Участники']);
  items.push(['sep'],['clear-history','eraser','Очистить историю']);
  if(['direct','saved'].includes(c.kind))items.push(['delete-chat','trash','Удалить чат']);
  else if(mine?.role==='owner')items.push(['delete-community','trash',c.kind==='channel'?'Удалить канал…':'Удалить группу…']);
  else items.push(['leave-community','logout',c.kind==='channel'?'Покинуть канал':'Покинуть группу']);
  const danger=['block-user','delete-chat','delete-community','leave-community'];
  const menu=popover({anchor,align:'end',className:'chat-menu',label:'Действия чата',html:items.map(([id,ic,label])=>id==='sep'?'<div class="ctx-sep" role="separator"></div>':menuItem(`id="${id}"`,icon(ic),label,danger.includes(id)?'data-danger':'')).join('')});
  const on=(id,fn)=>{const b=menu.querySelector('#'+id);if(b)b.onclick=guard(async()=>{closePopover();await fn();});};
  on('extended-view',async()=>{if(c.kind==='direct')await asSheet(()=>extendedProfile(c.members.find(m=>m.user_id!==state.user.id).user_id));else{const data=await api('/statistics?chat='+c.id);modal('Статистика сообщества',`<h3>${data.members} участников · ${data.messages} сообщений</h3>${data.days.map(d=>`<p>${esc(d.day)}: ${d.count}</p>`).join('')}`);}});
  on('schedule-chat',()=>schedulePage(c.id,$('#draft')?.value||''));
  for(const [el,key]of [['archive-chat','archived'],['pin-chat','pins']])on(el,async()=>{const values=state.settings[key]||[];state.settings[key]=values.includes(c.id)?values.filter(v=>v!==c.id):[...values,c.id];await saveSettings();renderChats();});
  on('mute-chat',()=>muteChat(c.id,c.title));
  on('find-in-chat',()=>openFind());
  on('select-messages',()=>enterSelection(null));
  on('group-manage',()=>asSheet(()=>groupPanel(c,state,refresh)));
  on('delete-community',()=>asSheet(()=>groupPanel(c,state,refresh)));
  on('leave-community',async()=>{if(confirm(`Покинуть «${c.title}»?`)){await api('/communities/'+c.id+'/leave','POST',{});await refresh();}});
  on('clear-history',()=>clearHistory(c));
  on('delete-chat',()=>deleteChat(c));
  on('block-user',async()=>{if(confirm('Заблокировать пользователя? Он не сможет отправлять вам сообщения и звонить.')){await api('/blocks','POST',{target:c.members.find(m=>m.user_id!==state.user.id).user_id});toast('Пользователь заблокирован');}});
}
// Clearing hides the history only for you unless "also for <name>" is ticked in a private chat.
function historyDialog(c,remove){
  const peer=chatPeer(c),both=c.kind==='direct'&&peer;
  const text=remove?(c.kind==='saved'?'Удалить «Избранное»? Все сохранённые сообщения исчезнут из этого списка.':`Удалить чат с ${esc(c.title)}?`):`Очистить историю${c.kind==='saved'?' «Избранного»':` чата «${esc(c.title)}»`}? Это действие нельзя отменить.`;
  const note=c.kind==='group'||c.kind==='channel'?'<p class="note">Сообщения исчезнут только у вас, у остальных участников история сохранится.</p>':'';
  modal(remove?'Удалить чат':'Очистить историю',`<p>${text}</p>${note}${both?`<label class="check-row"><input type="checkbox" id="history-both"> Также удалить у собеседника</label>`:''}<div class="row-actions"><button class="secondary" type="button" id="history-cancel">Отмена</button><button class="primary danger" type="button" id="history-ok">${remove?'Удалить':'Очистить'}</button></div>`);
  $('#history-cancel').onclick=()=>$('#modal').close();
  $('#history-ok').onclick=guard(async()=>{const forEveryone=!!$('#history-both')?.checked;$('#history-ok').disabled=true;const r=await api(`/chats/${c.id}/${remove?'hide':'clear'}`,'POST',{forEveryone});$('#modal').close();applyCleared(c.id,r.clearedAt,remove);toast(remove?'Чат удалён':'История очищена');});
}
const clearHistory=c=>historyDialog(c,false),deleteChat=c=>historyDialog(c,true);
function applyCleared(chatId,at,hidden){
  const c=state.chats.find(x=>x.id===chatId);if(c){c.cleared_at=Math.max(c.cleared_at||0,at||0);c.unread=0;if(c.last&&c.last.created<=c.cleared_at)c.last=null;}
  const kept=(messagesByChat.get(chatId)||[]).filter(m=>m.pending||m.created>(at||0));messagesByChat.set(chatId,kept);
  if(hidden){forgetDraft(chatId);state.chats=state.chats.filter(x=>x.id!==chatId);pageCache.delete('chat');if(state.chat===chatId){state.chat=null;state.messages=[];$('.shell')?.classList.remove('show-chat');empty();}}
  else if(state.chat===chatId){state.messages=kept;renderMessages(true);}
  renderChats();scheduleChatRefresh();
}
const callStatus={missed:'Пропущен',declined:'Отклонён',active:'Активен',ringing:'Вызов',ended:'Завершён'};
async function navigate(tab){if(state.recording){toast('Завершите или отмените запись');return;}const previous=state.tab,workspace=$('.workspace');if(previous===tab)return;closePopover();pageCache.set(previous,{nodes:[...workspace.childNodes],chat:state.chat,scroll:workspace.scrollTop});workspace.replaceChildren();state.tab=tab;state.chat=null;state.selection=null;state.find=null;markTab(tab);$('.shell').classList.remove('show-chat');$('.shell').classList.toggle('show-page',tab!=='chat');renderChats();const cached=pageCache.get(tab);if(cached&&tab!=='settings'){workspace.replaceChildren(...cached.nodes);workspace.scrollTop=cached.scroll;state.chat=cached.chat;if(tab==='chat'&&state.chat){$('.shell').classList.add('show-chat');renderChats();await loadMessages(false);}return;}if(tab==='chat'){renderChats();empty();return;}if(tab==='ai'){await aiPage(state,saveSettings,openChat);return;}if(tab==='settings'){settingsPage(state,saveSettings,()=>guard(()=>accountManager.logout())());return;}if(tab==='phone'){await callsPage();return;}
  $('.workspace').innerHTML=`<section class="panel-page"><header class="page-head"><h1>${tab==='people'?'Контакты':'Каналы'}</h1></header><button class="primary" id="new-contact">${icon('plus')}${tab==='people'?'Найти человека':'Создать канал'}</button><div id="contacts">${state.chats.filter(c=>tab==='people'?c.kind==='direct':c.kind==='channel').map(c=>`<button class="chat-item" data-open="${c.id}">${avatar(c.title,c.avatar)}<strong>${esc(c.title)} ${chatVipBadge(c)}</strong></button>`).join('')}</div></section>`;$('#new-contact').onclick=()=>newChat(tab==='people'?'direct':'channel');document.querySelectorAll('[data-open]').forEach(el=>el.onclick=guard(()=>openChat(el.dataset.open)));
}
async function callsPage(){
  const history=await api('/calls');if(state.tab!=='phone')return;
  const rows=history.map(c=>{const chat=state.chats.find(ch=>ch.id===c.chat_id),title=chat?.title||c.name,outgoing=c.user_id===state.user.id,missed=!outgoing&&['missed','declined'].includes(c.status);return `<div class="history-row ${missed?'missed':''}">${chat?chatAvatar(chat):avatar(title)}<div><h3>${esc(title)}</h3><small>${icon(missed?'missed':c.video?'video':'phone')}${outgoing?'Исходящий':'Входящий'} · ${callStatus[c.status]||''} · ${new Date(c.created).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div>${chat?button(c.video?'video':'phone','Перезвонить',`data-recall="${c.chat_id}" data-video="${c.video?1:0}"`):''}</div>`;}).join('');
  $('.workspace').innerHTML=`<section class="panel-page calls-page"><header class="page-head"><h1>Звонки</h1><button class="primary" id="new-call">${icon('phone')} Новый звонок</button></header>${history.length?`<div class="settings-group">${rows}</div>`:`<div class="empty-list">${icon('phone')}Здесь будет история ваших звонков.<br>Нажмите «Новый звонок» и выберите контакт.</div>`}</section>`;
  $('#new-call').onclick=()=>newCallDialog();
  document.querySelectorAll('[data-recall]').forEach(el=>el.onclick=guard(()=>calls.start(state.chats.find(c=>c.id===el.dataset.recall),el.dataset.video==='1')));
}
// Pick a contact (or find anyone by username) and start an audio or video call.
function newCallDialog(){
  const callable=()=>state.chats.filter(c=>['direct','group'].includes(c.kind)).sort((a,b)=>Number(b.kind==='direct')-Number(a.kind==='direct')||a.title.localeCompare(b.title,'ru'));
  const row=(key,value,title,avatarHTML,sub)=>`<div class="call-pick"><span class="call-pick-who">${avatarHTML}<span><b>${esc(title)}</b><small>${esc(sub)}</small></span></span>${button('phone','Аудиозвонок',`data-${key}="${esc(value)}" data-video="0"`)}${button('video','Видеозвонок',`data-${key}="${esc(value)}" data-video="1"`)}</div>`;
  modal('Новый звонок',`<div class="search">${icon('search')}<input id="call-search" type="search" placeholder="Поиск контактов и людей" aria-label="Поиск контактов" autocomplete="off"></div><div class="call-picks" id="call-picks"></div>`);
  let timer,ticket=0;
  const draw=(people=[])=>{
    const q=$('#call-search').value.trim().toLowerCase(),chats=callable().filter(c=>c.title.toLowerCase().includes(q));
    const known=new Set(state.chats.filter(c=>c.kind==='direct').map(c=>chatPeer(c)?.user_id));
    const extra=people.filter(u=>!known.has(u.id));
    $('#call-picks').innerHTML=(chats.length?`<div class="search-section">${q?'Контакты':'Недавние контакты'}</div>${chats.map(c=>row('call-chat',c.id,c.title,chatAvatar(c),c.kind==='group'?peopleCount(c.members.length):chatPeer(c)?.online?'в сети':(chatPeer(c)?.username?'@'+chatPeer(c).username:''))).join('')}`:'')
      +(extra.length?`<div class="search-section">Глобальный поиск</div>${extra.map(u=>row('call-user',u.id,u.name,avatar(u.name,u.avatar),u.username?'@'+u.username:'')).join('')}`:'')
      +(!chats.length&&!extra.length?`<div class="empty-list">${icon('search')}${q?'Никого не найдено':'Найдите человека по имени или username'}</div>`:'');
    document.querySelectorAll('[data-call-chat]').forEach(b=>b.onclick=guard(async()=>{$('#modal').close();await calls.start(state.chats.find(c=>c.id===b.dataset.callChat),b.dataset.video==='1');}));
    document.querySelectorAll('[data-call-user]').forEach(b=>b.onclick=guard(async()=>{const chat=await api('/chats','POST',{users:[b.dataset.callUser]});await refresh();$('#modal').close();await calls.start(state.chats.find(c=>c.id===chat.id)||chat,b.dataset.video==='1');}));
  };
  $('#call-search').oninput=()=>{draw();clearTimeout(timer);const q=$('#call-search').value.trim(),mine=++ticket;if(!q)return;timer=setTimeout(guard(async()=>{const people=await api('/users?q='+encodeURIComponent(q));if(mine===ticket&&$('#call-search'))draw(people);}),250);};
  draw();setTimeout(()=>$('#call-search')?.focus(),0);
}
function setupRecorder(){
  const control=$('#record');let timer,startX=0,startY=0,started=false,pending=false,released=false;
  control.onpointerdown=e=>{if(state.recording)return;e.preventDefault();released=false;started=false;startX=e.clientX;startY=e.clientY;control.setPointerCapture(e.pointerId);timer=setTimeout(guard(async()=>{started=true;pending=true;await beginRecording();pending=false;if(released && state.recording)state.recording.locked=true;}),350);};
  control.onpointermove=e=>{if(!state.recording)return;if(startX-e.clientX>95){finishRecording(false);started=true;}else if(startY-e.clientY>65){state.recording.locked=true;$('#record-label').textContent='Запись закреплена';}};
  control.onpointerup=()=>{clearTimeout(timer);released=true;if(!started){state.mode=state.mode==='voice'?'round':'voice';control.innerHTML=icon(state.mode==='voice'?'mic':'video');toast(state.mode==='voice'?'Режим голосового сообщения':'Режим видео-кружочка');}else if(!pending && state.recording&&!state.recording.locked)finishRecording(true);};
  control.onpointercancel=()=>{clearTimeout(timer);released=true;if(state.recording)finishRecording(false);};
}
async function beginRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Запись требует HTTPS и браузер с поддержкой MediaRecorder');
  const round=state.mode==='round';const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:round?{width:480,height:480,facingMode:'user'}:false});
  const types=round?['video/webm;codecs=vp8,opus','video/mp4']:['audio/webm;codecs=opus','audio/mp4'];const type=types.find(t=>MediaRecorder.isTypeSupported(t));
  let recorder;try{recorder=new MediaRecorder(stream,type?{mimeType:type}:{});}catch(e){stream.getTracks().forEach(t=>t.stop());throw e;}
  const rec={recorder,stream,kind:state.mode,chunks:[],started:Date.now(),locked:false,chat:state.chat,send:false};state.recording=rec;
  $('#record-area').innerHTML=`<div class="record-bar">${round?'<video class="record-preview" autoplay playsinline muted></video>':''}<span class="dot"></span><span class="record-time">0:00</span><small id="record-label">Влево — отмена · Вверх — закрепить</small><span class="spacer"></span>${button('lock','Закрепить запись','id="lock-record"')}${button('close','Отменить запись','id="cancel-record"')}${button('send','Отправить запись','id="send-record"')}</div>`;
  if(round)$('.record-preview').srcObject=stream;$('#cancel-record').onclick=()=>finishRecording(false);$('#send-record').onclick=()=>finishRecording(true);$('#lock-record').onclick=()=>{rec.locked=true;$('#record-label').textContent='Запись закреплена';};
  recorder.ondataavailable=e=>{if(e.data.size)rec.chunks.push(e.data);};
  recorder.onstop=guard(async()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(rec.timer);state.recording=null;$('#record-area').innerHTML='';if(!rec.send)return;const blob=new Blob(rec.chunks,{type:recorder.mimeType});if(blob.size<100 || Date.now()-rec.started<350){toast('Слишком короткая запись');return;}toast('Отправляем запись…');const extension=recorder.mimeType.includes('mp4')?'mp4':'webm';const file=new File([blob],`${rec.kind}-${Date.now()}.${extension}`,{type:recorder.mimeType});await outbox.enqueue(rec.chat,{kind:rec.kind},file);});
  recorder.start(1000);navigator.vibrate?.(20);rec.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-rec.started)/1000);if($('.record-time'))$('.record-time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;if(seconds>=(state.user.vip?600:180))finishRecording(true);},500);
}
function finishRecording(send){const rec=state.recording;if(!rec||rec.recorder.state==='inactive')return;rec.send=send;rec.recorder.stop();}
function connectEvents(){state.events?.close();const events=new EventSource(accountURL('/api/events'));state.events=events;const ticket=accountEpoch();const listen=(name,fn)=>events.addEventListener(name,e=>{if(accountEpoch()===ticket)fn(e);});listen('profile-updated',()=>{refresh().then(()=>{renderMessages(false);const c=selected();if(c&&$('.conversation-title h3'))$('.conversation-title h3').innerHTML=esc(c.title)+' '+chatVipBadge(c);}).catch(()=>{});});listen('stories',()=>refreshStories().catch(()=>{}));listen('story-notification',()=>{toast('Новое событие в историях');refreshStories().catch(()=>{});});listen('poll',()=>toast('Новый ответ на ваш опрос'));listen('settings',()=>{api('/me').then(r=>{state.settings=r.settings;state.user=r.user;applyTheme(state.settings);if(state.tab==='settings')settingsPage(state,saveSettings,()=>guard(()=>accountManager.logout())());}).catch(()=>{});});listen('family',()=>location.reload());listen('ready',()=>{synchronizer?.pull().catch(()=>{});outbox?.flush();calls?.reconnect().catch(()=>{});setConnection(true);refresh().catch(()=>{});if(state.chat)loadMessages(false).catch(()=>{});});events.onerror=()=>setConnection(false);
  listen('message',e=>{const data=JSON.parse(e.data);void (async()=>{
    const message=data.message||await api('/messages/'+encodeURIComponent(data.id));
    acceptMessages(message.chat_id,[message]);synchronizer?.write([message]).catch(()=>{});scheduleChatRefresh();
    if(message.user_id!==state.user.id){
      await api('/receipts','POST',{chat:message.chat_id,message:message.id});
      if(state.chat===message.chat_id&&document.visibilityState==='visible')await api(`/chats/${message.chat_id}/read`,'POST',{message:message.id});
      if(state.settings.notifications!==false&&!(state.settings.muted||[]).includes(message.chat_id)&&state.chat!==message.chat_id&&!document.hidden)toast('Новое сообщение: '+(state.chats.find(c=>c.id===message.chat_id)?.title||''));
    }
  })().catch(()=>{});});
  listen('chat-deleted',e=>{const d=JSON.parse(e.data);messagesByChat.delete(d.chat);pageCache.delete('chat');state.chats=state.chats.filter(c=>c.id!==d.chat);if(state.chat===d.chat){state.chat=null;state.messages=[];empty();$('.shell')?.classList.remove('show-chat');}renderChats();});listen('chat-cleared',e=>{const d=JSON.parse(e.data);applyCleared(d.chat,d.clearedAt,d.hidden);});listen('draft',e=>{const d=JSON.parse(e.data),c=state.chats.find(x=>x.id===d.chat);if(!c)return;c.draft=d.body?{body:d.body,updated:d.updated}:null;if(state.chat!==d.chat)renderChats();});listen('refresh',()=>{const previous=selected()?.canPost;refresh().then(()=>{if(state.chat&&previous!==selected()?.canPost)openChat(state.chat);}).catch(()=>{});});
  listen('receipt',e=>{const data=JSON.parse(e.data);const member=state.chats.find(c=>c.id===data.chat)?.members.find(m=>m.user_id===data.user);if(member){if(data.read)member.read_at=Math.max(member.read_at||0,data.read);if(data.delivered)member.delivered_at=Math.max(member.delivered_at||0,data.delivered);}document.querySelectorAll('.message.own').forEach(el=>{const m=state.messages.find(m=>m.id===el.dataset.id);const people=(selected()?.members||[]).filter(p=>p.user_id!==state.user.id);const marker=el.querySelector('.message-footer .tick');if(marker&&m&&!m.pending){const read=people.length&&people.every(p=>p.read_at>=m.created);const delivered=people.length&&people.every(p=>p.delivered_at>=m.created);const status=read?'read':delivered?'delivered':'sent';marker.innerHTML=tickSVG(status);marker.classList.toggle('read',!!read);marker.classList.toggle('ticks',!!read);marker.title=read?'Прочитано':delivered?'Доставлено':'Отправлено';m.status=status;}});renderChats();});
  listen('typing',e=>{const d=JSON.parse(e.data);if(d.user===state.user.id)return;const chat=state.chats.find(c=>c.id===d.chat);if(!chat)return;const label=chat.kind==='direct'?'печатает':`${String(d.name||'Кто-то').split(' ')[0]} печатает`;typingNow.set(d.chat,label+'…');clearTimeout(typingTimers.get(d.chat));typingTimers.set(d.chat,setTimeout(()=>{typingNow.delete(d.chat);renderChats();if(state.chat===d.chat)setStatus();},3000));renderChats();const target=$('#chat-status');if(state.chat===d.chat&&target)target.innerHTML=`<span class="typing-status">${esc(label)}<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>`;});
  listen('call',e=>calls.event(JSON.parse(e.data)));listen('signal',e=>calls.signal(JSON.parse(e.data)));
}
async function openNotificationLink(href){
 const url=new URL(href,location.origin);if(url.origin!==location.origin)return;
 const link=new URLSearchParams(url.hash.slice(1));
 if(link.get('account')&&link.get('account')!==state.user.id){await accountManager.switchTo(link.get('account'));}
 if(link.get('community')){const cid=link.get('community'),invite=link.get('invite'),c=await api('/communities/'+encodeURIComponent(cid)+'?invite='+encodeURIComponent(invite||''));if(c.subscribed){await refresh();await openChat(cid);return;}modal(c.title,`<p>${peopleCount(c.count,c.kind==='channel')}</p><button class="primary" id="join-community">Присоединиться</button>`);$('#join-community').onclick=guard(async()=>{await api('/communities/'+cid+'/join','POST',{invite});$('#modal').close();await refresh();await openChat(cid);});return;}
 const chat=link.get('chat');if(!chat)return;
 await refresh();if(state.tab!=='chat')await navigate('chat');await openChat(chat);
 if(link.get('call')){
  const active=await api('/calls/active');const call=active.find(c=>c.id===link.get('call'));
  if(call)await calls.event(call);else toast('Этот звонок уже завершён');
  return;
 }
 const key=link.get('message');if(!key)return;
 if(!state.messages.some(m=>m.id===key)){const m=await api('/messages/'+encodeURIComponent(key));if(m.chat_id===state.chat){acceptMessages(m.chat_id,[m]);}}
 const target=document.querySelector('[data-id="'+CSS.escape(key)+'"]');target?.scrollIntoView({block:'center'});
}
let notificationLinksReady=false;
function setupNotificationLinks(){if(notificationLinksReady)return;notificationLinksReady=true;
 if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{
  if(e.data?.type==='notification-open')openNotificationLink(e.data.url).catch(err=>toast(err.message));
 });
 window.addEventListener('hashchange',()=>openNotificationLink(location.href).catch(err=>toast(err.message)));
}
window.addEventListener('profile-saved',()=>guard(async()=>{const r=await api('/me');state.user=r.user;await refresh();pageCache.delete('settings');if(state.tab==='settings')settingsPage(state,saveSettings,()=>guard(()=>accountManager.logout())());})());
async function boot(){const result=await api('/me');state.user=result.user;state.settings=result.settings;state.family=result.family;state.rtcDebug=result.rtcDebug===true;applyTheme(state.settings);if(result.family&&!result.family.linked){app.innerHTML='<main class="auth"><section class="auth-card glass"><h1>Привяжите родителя</h1><p>Детский аккаунт создан. До привязки обычные функции закрыты.</p><button class="primary" id="pending-family">Получить код для родителя</button><button class="secondary" id="pending-refresh">Проверить привязку</button><button class="secondary" id="pending-logout">Выйти</button></section></main>';$('#pending-family').onclick=guard(()=>familyPage(state));$('#pending-refresh').onclick=()=>location.reload();$('#pending-logout').onclick=guard(async()=>{await api('/logout','POST',{});location.reload();});return;}try{await refresh();}catch(e){if(!result.family)throw e;toast(e.message);}shell();synchronizer=createSync(state.user.id,rows=>{for(const chat of new Set(rows.map(m=>m.chat_id)))if(messagesByChat.has(chat)||state.chat===chat)acceptMessages(chat,rows.filter(m=>m.chat_id===chat));});outbox=createOutbox(state.user.id,outboxChanged);await outbox.list();state.sendSticker=async(sticker)=>outbox.enqueue(state.chat,{sticker});preparePush().catch(()=>{});calls=createCalls(state,result.iceServers);connectEvents();configureProfiles({state,save:saveSettings,refresh,openChat,call:(chat,video)=>calls.start(chat,video)});initStories(state,openChat,refresh);setupNotificationLinks();connectBackgroundAccounts().catch(()=>{});const link=new URLSearchParams(location.hash.slice(1));openNotificationLink(location.href).catch(e=>toast(e.message));setTimeout(()=>{if(!location.hash)promptNotifications().catch(()=>{});},1800);if(link.get('profile'))extendedProfile(link.get('profile')).catch(e=>toast(e.message));if(link.get('story'))api('/stories/'+encodeURIComponent(link.get('story'))).then(s=>showStories([s])).catch(e=>toast(e.message));}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.chat)loadMessages(false).catch(()=>{});});
window.addEventListener('beforeunload',()=>{state.recording?.stream.getTracks().forEach(t=>t.stop());});
accountManager.initialize().then(id=>id?boot():auth()).catch(error=>{if(error.status===401)auth();else{app.innerHTML='<main class="auth"><section class="auth-card glass"><img src="/brand/icon-192-99e4c7990351.png" width="100" alt="Cipherion"><h2>Не удалось подключиться</h2><p>Проверьте соединение и повторите попытку.</p><button class="primary" id="retry-boot">Повторить</button></section></main>';$('#retry-boot').onclick=()=>location.reload();}}).finally(()=>document.getElementById('launch')?.remove());





document.addEventListener('click',guard(async e=>{const el=e.target.closest('[data-open-profile]');if(el){e.preventDefault();e.stopPropagation();await extendedProfile(el.dataset.openProfile);}}));
setInterval(()=>{if(!document.hidden&&state.user)refreshStories().catch(()=>{});},30000);
async function newContact(){modal('Новый контакт','<form id="find-contact" class="row"><input name="q" required placeholder="Username"><button class="primary">Найти</button></form><div id="new-contact-results"></div>');$('#find-contact').onsubmit=guard(async e=>{e.preventDefault();const users=await api('/users?q='+encodeURIComponent(new FormData(e.currentTarget).get('q')));$('#new-contact-results').innerHTML=users.map(u=>`<div class="person"><button class="profile-name" data-open-profile="${u.id}">${esc(u.name)} @${esc(u.username)}</button><button class="chip" data-save-contact="${u.id}">Добавить</button></div>`).join('')||'<p>Пользователь не найден</p>';document.querySelectorAll('[data-save-contact]').forEach(b=>b.onclick=guard(async()=>{await api('/contacts','POST',{target:b.dataset.saveContact});toast('Контакт добавлен');b.disabled=true;}));});}



