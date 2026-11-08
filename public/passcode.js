// Код-пароль: this device asks for a code when Cipherion opens and after N minutes without
// activity (or in the background). The code never leaves the device: only a PBKDF2 hash of it is
// kept in localStorage. It hides the app from someone who picks up an unlocked phone; it does not
// replace the screen lock of the device itself.
import {$,esc,modal,guard,toast} from './ui.js';

const KEY='cipherion-passcode';
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export const TIMEOUTS=[[1,'1 минута'],[5,'5 минут'],[15,'15 минут'],[60,'1 час'],[300,'5 часов']];
function config(){try{const c=JSON.parse(localStorage.getItem(KEY)||'null');return c&&c.hash&&c.salt?c:null;}catch{return null;}}
function store(c){try{if(c)localStorage.setItem(KEY,JSON.stringify(c));else localStorage.removeItem(KEY);}catch{}}
async function hash(code,salt,iter=210_000){
  const base=await crypto.subtle.importKey('raw',enc.encode(String(code)),'PBKDF2',false,['deriveBits']);
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter},base,256));
}
export const passcodeEnabled=()=>!!config();
export const passcodeMinutes=()=>config()?.minutes||5;

let locked=false,lastActive=Date.now(),hiddenAt=0,attempts=0,blockedUntil=0,onForgot=null;
const touch=()=>{if(!locked)lastActive=Date.now();};
for(const name of ['pointerdown','keydown','wheel','touchstart'])window.addEventListener(name,touch,{passive:true,capture:true});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){hiddenAt=Date.now();return;}
  const c=config();if(c&&hiddenAt&&Date.now()-hiddenAt>=c.minutes*60000)lock();hiddenAt=0;
});
setInterval(()=>{const c=config();if(c&&!locked&&Date.now()-lastActive>=c.minutes*60000)lock();},15000).unref?.();

// `forgot` signs out of this device's accounts when the person cannot remember the code.
export function initPasscode(forgot){onForgot=forgot;if(config())lock();}
export function lock(){
  if(locked||!config())return;locked=true;
  // Dialogs sit in the top layer above any overlay, so they close first.
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  const screen=document.createElement('div');screen.className='passcode-lock';screen.setAttribute('role','dialog');screen.setAttribute('aria-modal','true');screen.setAttribute('aria-label','Введите код-пароль');
  screen.innerHTML=`<div class="passcode-card"><img src="/brand/icon-192-1f66c49421df.png" alt="" width="64" height="64"><h2>Cipherion</h2><p>Введите код-пароль</p><form id="passcode-form"><input id="passcode-input" type="password" inputmode="numeric" autocomplete="off" maxlength="32" aria-label="Код-пароль" required><button class="primary">Открыть</button></form><p class="passcode-error" id="passcode-error" aria-live="assertive"></p><button type="button" class="link-button" id="passcode-forgot">Забыли код?</button></div>`;
  document.body.append(screen);document.body.classList.add('passcode-locked');
  // Dialogs opened underneath stay hidden until the code is entered.
  const input=screen.querySelector('#passcode-input');setTimeout(()=>input.focus(),50);
  screen.querySelector('#passcode-form').onsubmit=async e=>{
    e.preventDefault();const error=screen.querySelector('#passcode-error');
    if(Date.now()<blockedUntil){error.textContent=`Слишком много попыток. Подождите ${Math.ceil((blockedUntil-Date.now())/1000)} с`;return;}
    const c=config();if(!c){unlock(screen);return;}
    if(await hash(input.value,unb64(c.salt),c.iter)===c.hash){attempts=0;unlock(screen);return;}
    attempts++;input.value='';input.focus();screen.querySelector('.passcode-card').classList.remove('shake');void screen.offsetWidth;screen.querySelector('.passcode-card').classList.add('shake');
    if(attempts>=5){blockedUntil=Date.now()+30000*2**Math.min(attempts-5,5);error.textContent='Слишком много попыток. Попробуйте позже.';}else error.textContent='Неверный код';
  };
  screen.querySelector('#passcode-forgot').onclick=()=>{
    if(!confirm('Сбросить код-пароль? Для этого придётся выйти из всех аккаунтов на этом устройстве. Сообщения останутся на сервере, а ключи шифрования этого устройства будут удалены.'))return;
    store(null);unlock(screen);onForgot?.();
  };
}
function unlock(screen){locked=false;lastActive=Date.now();screen.remove();document.body.classList.remove('passcode-locked');}
export const isLocked=()=>locked;

export function passcodeSettings(){
  const c=config();
  modal('Код-пароль',`<div class="stack"><p class="note">Код-пароль закрывает Cipherion на этом устройстве: его нужно ввести при запуске и после выбранного времени без действий. Код хранится только здесь, в виде хеша.</p>
    ${c?`<label class="field">Блокировать через<select id="passcode-minutes">${TIMEOUTS.map(([m,l])=>`<option value="${m}" ${m===c.minutes?'selected':''}>${l}</option>`).join('')}</select></label>
      <button class="secondary" id="passcode-lock-now">Заблокировать сейчас</button><button class="secondary" id="passcode-change">Сменить код</button><button class="secondary danger" id="passcode-off">Выключить код-пароль</button>`
    :`<button class="primary" id="passcode-on">Включить код-пароль</button>`}</div>`);
  $('#passcode-on')?.addEventListener('click',()=>setCode());
  $('#passcode-change')?.addEventListener('click',()=>setCode(c.minutes));
  $('#passcode-lock-now')?.addEventListener('click',()=>{$('#modal').close();lock();});
  $('#passcode-off')?.addEventListener('click',guard(async()=>{const code=prompt('Введите текущий код-пароль');if(code===null)return;if(await hash(code,unb64(c.salt),c.iter)!==c.hash)throw new Error('Неверный код');store(null);toast('Код-пароль выключен');passcodeSettings();}));
  $('#passcode-minutes')?.addEventListener('change',e=>{store({...config(),minutes:Number(e.target.value)});toast('Сохранено');});
}
function setCode(minutes=5){
  modal('Новый код-пароль',`<form id="passcode-new" class="stack"><label class="field">Код (4–32 символа)<input name="a" type="password" inputmode="numeric" minlength="4" maxlength="32" required autocomplete="new-password"></label><label class="field">Повторите код<input name="b" type="password" inputmode="numeric" minlength="4" maxlength="32" required autocomplete="new-password"></label><label class="field">Блокировать через<select name="minutes">${TIMEOUTS.map(([m,l])=>`<option value="${m}" ${m===minutes?'selected':''}>${esc(l)}</option>`).join('')}</select></label><button class="primary">Сохранить</button></form>`);
  $('#passcode-new').onsubmit=guard(async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('a')!==f.get('b'))throw new Error('Коды не совпадают');
    const salt=crypto.getRandomValues(new Uint8Array(16));store({hash:await hash(f.get('a'),salt),salt:b64(salt),iter:210_000,minutes:Number(f.get('minutes'))});lastActive=Date.now();toast('Код-пароль включён');passcodeSettings();});
}
