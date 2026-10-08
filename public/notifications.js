import {$,api,modal,guard,toast,esc} from './ui.js';
import {accountEpoch,activeAccount} from './account-context.js';
export async function registerDevicePush(subscription){
 const ticket=accountEpoch(),accounts=await api('/accounts');
 for(const account of accounts){if(ticket!==accountEpoch())throw new DOMException('Аккаунт переключён','AbortError');await api('/push/subscriptions','POST',{subscription},undefined,account.user.id);}
}
let registration,config;
let preparing;
export async function preparePush(){
 if(preparing)return preparing;
 preparing=(async()=>{
  if(!('serviceWorker' in navigator))return;
  await navigator.serviceWorker.register('/sw.js');
  registration=await navigator.serviceWorker.ready;config=await api('/push/config');
  if(config.configured&&'PushManager' in window&&'Notification' in window&&Notification.permission==='granted'){
   let sub=await registration.pushManager.getSubscription();
   if(sub?.options?.applicationServerKey&&!sameKey(sub.options.applicationServerKey,config.publicKey)){await sub.unsubscribe();sub=null;}
   // Restore expired subscriptions on the next authenticated app launch.
   sub ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
   await registerDevicePush(sub.toJSON());
  }
 })();try{return await preparing;}finally{preparing=null;}
}
function sameKey(buffer,key){return Array.from(new Uint8Array(buffer)).join(',')===Array.from(keyBytes(key)).join(',');}
export async function closeCallNotification(id){
 if(!id||!('serviceWorker' in navigator))return;
 const reg=await navigator.serviceWorker.getRegistration();
 for(const n of await reg?.getNotifications({tag:'call:'+id})||[])n.close();
}
export async function promptNotifications(){
 if(!('Notification' in window)||Notification.permission!=='default'||sessionStorage.getItem('accounts/'+activeAccount()+'/push-prompt-dismissed'))return;
 if($('#modal')?.open||$('#call-root')?.textContent.trim())return;
 modal('Не пропускайте сообщения и звонки',`<p>Включите уведомления, чтобы видеть входящие звонки и новые сообщения, даже когда Cipherion закрыт.</p><button class="primary" id="push-setup">Настроить уведомления</button><button class="secondary" id="push-later">Позже</button>`);
 sessionStorage.setItem('accounts/'+activeAccount()+'/push-prompt-dismissed','1');
 $('#push-setup').onclick=guard(notificationSettings);$('#push-later').onclick=()=>$('#modal').close();
}
function keyBytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export async function notificationSettings(){const p=await api('/notification-settings');await preparePush();const supported='PushManager' in window&&'Notification' in window;modal('Уведомления и звуки',`<p>Получайте сообщения, даже когда приложение закрыто.</p><button class="primary" id="enable-push" ${!supported||!config?.configured?'disabled':''}>Включить уведомления Cipherion</button><p class="note">${!supported?'На iPhone добавьте Cipherion на экран «Домой» и откройте его оттуда.':!config?.configured?'На сервере ещё не настроены ключи Web Push.': 'Разрешение устройства запрашивается только после нажатия кнопки.'}</p><p class="note" id="push-status">${supported&&Notification.permission==='granted'?'Разрешение выдано':supported&&Notification.permission==='denied'?'Уведомления запрещены в настройках устройства':'Разрешение ещё не выдано'}</p><button class="secondary" id="test-push" ${!supported||!config?.configured?'disabled':''}>Проверить уведомление</button>${Object.entries({direct:'Личные сообщения',group:'Группы',channel:'Каналы',calls:'Звонки',reactions:'Реакции',mentions:'Упоминания',showText:'Показывать текст',showName:'Показывать имя',sound:'Звук',vibration:'Вибрация'}).map(([k,t])=>`<label class="toggle-row">${t}<input type="checkbox" data-notification="${k}" ${p[k]?'checked':''}></label>`).join('')}<p class="note">Звук и вибрацию системных уведомлений также регулируют настройки устройства.</p>`);
 document.querySelectorAll('[data-notification]').forEach(el=>el.onchange=guard(async()=>{try{await api('/notification-settings','PATCH',{[el.dataset.notification]:el.checked});}catch(e){el.checked=!el.checked;throw e;}}));
 $('#enable-push').onclick=guard(async()=>{const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Разрешите уведомления в настройках устройства');await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});await registerDevicePush(sub.toJSON());$('#push-status').textContent='Уведомления подключены на этом устройстве';toast('Системные уведомления подключены');});
 $('#test-push').onclick=guard(async()=>{const sub=await registration?.pushManager.getSubscription();if(!sub)throw new Error('Сначала включите уведомления');await api('/push/test','POST',{endpoint:sub.endpoint});toast('Проверочное уведомление отправлено');});
}
export function muteChat(chat,title){modal('Уведомления: '+title,Object.entries({off:'Включить',hour:'На 1 час',hours8:'На 8 часов',day:'На 1 день',week:'На 1 неделю',forever:'Навсегда'}).map(([k,v])=>`<button class="secondary" data-mute="${k}">${v}</button>`).join(''));document.querySelectorAll('[data-mute]').forEach(el=>el.onclick=guard(async()=>{await api('/chat-mute','POST',{chat,duration:el.dataset.mute});$('#modal').close();toast('Настройка сохранена');}));}


