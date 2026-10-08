import {$,esc,icon,avatar,vipBadge,api,modal,guard} from './ui.js';
export function createChatDialog(defaultKind='direct',{refresh,openChat}){
 const types=[['direct','Личный чат'],['group','Группа'],['channel','Канал']];
 let kind=types.some(([id])=>id===defaultKind)?defaultKind:'direct',serial=0,timer,pending=false;
 const users=new Map(),titles={group:'',channel:''};
 const dialog=modal('Новый разговор',`<div class="create-chat-tabs" role="radiogroup" aria-label="Тип разговора">${types.map(([id,label])=>`<label><input type="radio" name="chat-kind" value="${id}" ${kind===id?'checked':''}><span>${label}</span></label>`).join('')}</div><form id="create-chat-form" class="stack"><label class="field" id="chat-title-field">Название<input id="group-title" maxlength="80"></label><p class="note" id="chat-kind-help"></p><div class="search">${icon('search')}<input id="user-search" placeholder="Найти по username или имени" autocomplete="off" aria-label="Поиск пользователей"></div><div id="user-results" aria-live="polite"></div><div id="chosen-users" class="muted"></div><button type="submit" class="primary" id="create-chat"></button><p id="create-chat-error" role="alert"></p></form>`);
 const form=$('#create-chat-form'),search=$('#user-search'),results=$('#user-results'),title=$('#group-title'),submit=$('#create-chat');
 const alive=()=>form.isConnected&&dialog.open;
 function update(){
  $('#chat-title-field').hidden=kind==='direct';title.required=kind!=='direct';title.value=titles[kind]||'';
  title.placeholder=kind==='channel'?'Название канала':'Название группы';
  $('#chat-kind-help').textContent={direct:'Выберите человека, чтобы начать переписку.',group:'Участники группы могут общаться между собой.',channel:'Публикуют владелец и администраторы. Подписчики читают.'}[kind];
  submit.textContent={direct:'Начать разговор',group:'Создать группу',channel:'Создать канал'}[kind];
  results.innerHTML='<p class="muted">'+(kind==='direct'?'Найдите собеседника.':'Можно добавить людей сейчас или после создания.')+'</p>';
  $('#chosen-users').textContent='';search.value='';$('#create-chat-error').textContent='';
 }
 dialog.querySelectorAll('[name="chat-kind"]').forEach(r=>r.onchange=()=>{if(pending)return;titles[kind]=title.value;kind=r.value;users.clear();serial++;clearTimeout(timer);update();});
 search.oninput=()=>{const ticket=++serial;clearTimeout(timer);timer=setTimeout(guard(async()=>{
  const q=search.value.trim();if(!q){results.innerHTML='';return;}
  const found=await api('/users?q='+encodeURIComponent(q));if(!alive()||ticket!==serial)return;
  results.innerHTML=found.length?found.map(u=>`<label class="person">${avatar(u.name,u.avatar)}<div><strong>${esc(u.name)} ${vipBadge(u)}</strong><small>${u.username?'@'+esc(u.username):''}</small></div><input type="${kind==='direct'?'radio':'checkbox'}" name="recipient" value="${esc(u.id)}" aria-label="${esc(u.name)}" ${users.has(u.id)?'checked':''}></label>`).join(''):'<p class="muted">Пользователи не найдены</p>';
  results.querySelectorAll('input').forEach(input=>input.onchange=()=>{if(kind==='direct')users.clear();if(input.checked)users.set(input.value,found.find(u=>u.id===input.value));else users.delete(input.value);$('#chosen-users').textContent=[...users.values()].map(u=>u.name).join(', ');});
 }),250);};
 form.onsubmit=guard(async e=>{e.preventDefault();if(pending)return;const error=$('#create-chat-error');if(kind==='direct'&&users.size!==1){error.textContent='Выберите собеседника.';return;}if(kind!=='direct'&&!title.value.trim()){error.textContent='Введите название.';return;}
  pending=true;submit.disabled=true;dialog.querySelectorAll('[name="chat-kind"]').forEach(r=>r.disabled=true);error.textContent='';
  try{const c=await api('/chats','POST',{kind,title:kind==='direct'?'':title.value.trim(),users:[...users.keys()]});if(alive())dialog.close();await refresh();await openChat(c.id);}
  catch(e){if(alive())error.textContent=e.message;}
  finally{pending=false;submit.disabled=false;dialog.querySelectorAll('[name="chat-kind"]').forEach(r=>r.disabled=false);}
 });
 dialog.addEventListener('close',()=>{serial++;clearTimeout(timer);},{once:true});update();
}
