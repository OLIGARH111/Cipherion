// Защита контента (защита авторских прав) for protected chats.
// A web page cannot fully block system screenshots, so this does everything a browser allows:
// no copying, saving, dragging or printing; the conversation is hidden when the app loses focus
// or a screenshot shortcut is pressed; and a personal watermark marks any screenshot that still leaks.
import {esc,toast} from './ui.js';

export const isProtected=chat=>!!chat?.protect_content&&chat.kind!=='saved';
// Owners and admins of a channel or group keep full access to their own content.
export const restricted=chat=>isProtected(chat)&&chat.canShare===false;

function watermark(user){
  const text=esc(`@${user?.username||user?.name||''} · Cipherion`);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150"><text x="10" y="90" transform="rotate(-24 130 75)" font-family="system-ui,sans-serif" font-size="15" fill="#888" fill-opacity=".16">${text}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const active=()=>document.querySelector('.conversation.content-restricted');
let shieldTimer=0;
function shield(ms=0){
  const box=active();if(!box)return;
  box.classList.add('content-shielded');clearTimeout(shieldTimer);
  if(ms)shieldTimer=setTimeout(()=>{if(document.visibilityState==='visible'&&document.hasFocus())box.classList.remove('content-shielded');},ms);
}
function unshield(){clearTimeout(shieldTimer);active()?.classList.remove('content-shielded');}
const screenshotKey=e=>e.key==='PrintScreen'||e.code==='PrintScreen'
  ||(e.metaKey&&e.shiftKey&&['3','4','5','6','s','S'].includes(e.key))
  ||(e.metaKey&&e.shiftKey&&['Digit3','Digit4','Digit5','Digit6','KeyS'].includes(e.code));
function warn(){toast('В этом чате включена защита контента: скриншоты и копирование запрещены');}

let installed=false;
function install(){
  if(installed)return;installed=true;
  const inside=e=>active()&&e.target instanceof Node&&active().querySelector('.messages')?.contains(e.target);
  for(const type of ['copy','cut'])document.addEventListener(type,e=>{if(!inside(e)&&!(active()&&active().querySelector('.messages')?.contains(getSelection?.()?.anchorNode)))return;e.preventDefault();e.clipboardData?.setData('text/plain','');warn();},true);
  document.addEventListener('dragstart',e=>{if(inside(e))e.preventDefault();},true);
  document.addEventListener('contextmenu',e=>{if(inside(e)&&e.target.closest('img,video,audio,a'))e.preventDefault();},true);
  document.addEventListener('keydown',e=>{
    if(!active())return;
    if(screenshotKey(e)){shield(2500);navigator.clipboard?.writeText?.('').catch(()=>{});warn();}
    else if((e.ctrlKey||e.metaKey)&&['p','s'].includes(e.key.toLowerCase())){e.preventDefault();warn();}
  },true);
  // PrintScreen on Windows only fires keyup.
  document.addEventListener('keyup',e=>{if(active()&&(e.key==='PrintScreen'||e.code==='PrintScreen')){shield(2500);navigator.clipboard?.writeText?.('').catch(()=>{});warn();}},true);
  // Hidden while in the app switcher, screen-capture overlays or another window.
  document.addEventListener('visibilitychange',()=>document.visibilityState==='hidden'?shield():unshield());
  window.addEventListener('blur',()=>shield());
  window.addEventListener('focus',()=>unshield());
  window.addEventListener('pagehide',()=>shield());
  window.addEventListener('beforeprint',()=>shield());
  window.addEventListener('afterprint',()=>unshield());
}

// In the Android app the system can truly block screenshots and screen recording (FLAG_SECURE).
export function nativeSecure(on){try{window.CipherionAndroid?.setSecure?.(!!on);}catch{}}

// Called whenever the open chat is rendered, so a change made by the other side applies at once.
export function syncProtection(chat,user){
  const box=document.querySelector('.conversation');if(!box)return;
  const on=restricted(chat);
  box.classList.toggle('content-protected',isProtected(chat));
  box.classList.toggle('content-restricted',on);
  nativeSecure(on);
  if(on){install();box.style.setProperty('--protect-watermark',watermark(user));}
  else{box.classList.remove('content-shielded');box.style.removeProperty('--protect-watermark');}
  const title=box.querySelector('.conversation-title h3');
  if(title&&!!title.querySelector('.protect-badge')!==isProtected(chat)){
    if(isProtected(chat))title.insertAdjacentHTML('beforeend','<span class="protect-badge" title="Защита контента включена" aria-label="Защита контента включена"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6"/></svg></span>');
    else title.querySelector('.protect-badge')?.remove();
  }
}

export function protectionText(chat){
  return chat.kind==='direct'
    ?'Собеседники не смогут пересылать, копировать и сохранять сообщения и медиа из этого чата. Скриншоты блокируются, насколько позволяет устройство, а на экране появляется водяной знак с именем зрителя. Настройка действует для вас обоих.'
    :`Подписчики не смогут пересылать, копировать и сохранять публикации и медиа ${chat.kind==='channel'?'канала':'группы'}. Скриншоты блокируются, насколько позволяет устройство, а на экране появляется водяной знак с именем зрителя. Владелец и администраторы сохраняют полный доступ.`;
}
