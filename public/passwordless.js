// Passwordless sign-in: QR code from a signed-in phone, and passkeys (Face ID, Touch ID,
// Windows Hello, Android screen lock).
import {$,esc,icon,api,modal,guard,toast} from './ui.js';
import {qrSVG} from './qr.js';
import {describeAgent} from './devices.js';
import {transferReceiver,wrapHistoryFor,fromUrlKey,fingerprint} from './e2e.js';

const b64url=buffer=>{const bytes=new Uint8Array(buffer);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const fromB64url=text=>Uint8Array.from(atob(String(text).replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((String(text).length+3)%4)),c=>c.charCodeAt(0));
export const passkeysSupported=()=>!!(window.PublicKeyCredential&&navigator.credentials?.create);
// Plain fetch for the signed-out screen: there is no account to attach yet.
async function post(path,data){const r=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{}),credentials:'same-origin'});const body=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(body.error||'Не удалось выполнить действие'),{status:r.status});return body;}

// ---------- New device: show a QR code and wait ----------
export function qrLoginDialog(complete){
  let stopped=false,timer;
  const dialog=modal('Вход по QR-коду','<div class="qr-login"><div class="qr-box" id="qr-box"><div class="skeleton-list"></div></div><ol class="qr-steps"><li>Откройте Cipherion на телефоне, где вы уже вошли.</li><li>Наведите камеру телефона на код или откройте <b>Настройки → Устройства → Подключить устройство</b>.</li><li>Подтвердите вход на телефоне.</li></ol><p class="muted" id="qr-code-text"></p></div>');
  dialog.addEventListener('close',()=>{stopped=true;clearTimeout(timer);},{once:true});
  // A one-time key for receiving the history key from the approving phone (see key-transfer.js).
  const receiver=transferReceiver().catch(()=>null);
  async function issue(){
    const keys=await receiver;const r=await post('/qr-login',keys?{pub:keys.pub}:{});if(stopped)return;
    $('#qr-box').innerHTML=qrSVG(r.link,{label:'QR-код для входа'});
    $('#qr-code-text').innerHTML=`Код для ручного ввода: <b class="qr-manual">${esc(r.code.slice(0,4)+'-'+r.code.slice(4))}</b>${keys?`<br>Проверочные цифры: <b>${esc(keys.fingerprint)}</b>`:''}`;
    const poll=async()=>{
      if(stopped)return;
      try{
        const s=await post('/qr-login/status',{secret:r.secret});
        if(s.state==='approved'){stopped=true;dialog.close();if(s.history&&keys)await keys.accept(s.user.id,s.history).catch(()=>toast('Не удалось перенести историю. Её можно перенести позже в «Устройствах».'));toast(s.history?'Вход выполнен, история перенесена':'Вход выполнен');await complete(s);return;}
        if(s.state==='expired'){await issue();return;}
      }catch(error){if(error.status===404){await issue();return;}}
      timer=setTimeout(poll,2000);
    };
    timer=setTimeout(poll,2000);
  }
  issue().catch(error=>{$('#qr-box').innerHTML=`<p class="auth-error">${esc(error.message)}</p>`;});
}

// ---------- Signed-in phone: approve a code ----------
// urlKey is the new device's public key read from the QR picture; a typed code has none, so the
// check digits are shown for comparison instead.
export async function approveDevice(code,urlKey=null,user=null){
  const info=await api('/qr-login/info?code='+encodeURIComponent(code));
  const d=describeAgent(info.agent),scanned=urlKey?fromUrlKey(urlKey):null;
  const canTransfer=!!info.pub&&(!urlKey||scanned===info.pub);
  const digits=canTransfer&&!scanned?await fingerprint(info.pub).catch(()=>''):'';
  modal('Подключить устройство?',`<div class="stack"><div class="device-confirm">${icon(d.type==='desktop'?'screen':d.type)}<div><b>${esc(d.model)}</b><small>${esc([d.app,d.os].filter(Boolean).join(' · '))}</small></div></div><p class="note"><b>Подтверждайте, только если вы сами открыли Cipherion на этом устройстве.</b> Если код вам прислал кто-то другой, это попытка получить доступ к вашему аккаунту.</p>${canTransfer?`<label class="check-row"><input type="checkbox" id="qr-history" checked> Перенести историю зашифрованных сообщений</label>${digits?`<p class="muted">Проверочные цифры на новом устройстве: <b>${esc(digits)}</b></p>`:''}`:''}<button class="primary" id="qr-approve">Подключить</button><button class="secondary" id="qr-cancel">Отмена</button></div>`);
  $('#qr-cancel').onclick=()=>$('#modal').close();
  $('#qr-approve').onclick=guard(async()=>{const account=user||(await api('/me')).user.id;const history=canTransfer&&$('#qr-history')?.checked?await wrapHistoryFor(account,info.pub).catch(()=>null):null;await api('/qr-login/approve','POST',{code,...(history?{history}:{})});$('#modal').close();toast(history?'Устройство подключено, история передана':'Устройство подключено');});
}
// Scan with the camera where the browser can read QR codes; otherwise type the code.
export function connectDeviceDialog(){
  const scan='BarcodeDetector' in window&&navigator.mediaDevices?.getUserMedia;
  modal('Подключить устройство',`<div class="stack"><p class="note">На новом устройстве нажмите «Войти по QR-коду».</p>${scan?`<button class="primary" id="qr-scan">${icon('qr')} Сканировать QR-код</button><video id="qr-video" class="qr-video" playsinline muted hidden></video>`:''}<form id="qr-code-form" class="stack"><label class="field">Или введите код с экрана<input name="code" required maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="ABCD-2345"></label><button class="secondary">Продолжить</button></form></div>`);
  let stream;const stop=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;};
  $('#modal').addEventListener('close',stop,{once:true});
  $('#qr-code-form').onsubmit=guard(async e=>{e.preventDefault();stop();await approveDevice(new FormData(e.currentTarget).get('code'));});
  if(scan)$('#qr-scan').onclick=guard(async()=>{
    const video=$('#qr-video');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});video.srcObject=stream;video.hidden=false;await video.play();
    const detector=new BarcodeDetector({formats:['qr_code']});
    const look=async()=>{if(!stream)return;try{const [hit]=await detector.detect(video);const found=hit&&/qr-login=([A-Z0-9]{8})(?:&k=([A-Za-z0-9_-]+))?/.exec(hit.rawValue||'');if(found){stop();await approveDevice(found[1],found[2]||null);return;}}catch{}requestAnimationFrame(look);};
    look();
  });
}

// ---------- Passkeys ----------
export async function passkeyLogin(complete){
  if(!passkeysSupported())throw new Error('Этот браузер не поддерживает ключи доступа');
  const options=await post('/passkeys/login/options');
  const credential=await navigator.credentials.get({publicKey:{challenge:fromB64url(options.challenge),rpId:options.rpId,timeout:options.timeout,userVerification:'required',allowCredentials:[]},mediation:'optional'}).catch(error=>{throw new Error(error.name==='NotAllowedError'?'Вход отменён':'Не удалось использовать ключ доступа');});
  const r=credential.response;
  const result=await post('/passkeys/login',{id:credential.id,clientDataJSON:b64url(r.clientDataJSON),authenticatorData:b64url(r.authenticatorData),signature:b64url(r.signature),userHandle:r.userHandle?b64url(r.userHandle):null});
  await complete(result);
}
const deviceName=()=>{const d=describeAgent(navigator.userAgent);return [d.model,d.app].filter(Boolean).join(' · ').slice(0,60);};
export async function passkeysPage(){
  const list=await api('/passkeys');
  modal('Ключи доступа',`<div class="tg-page"><p class="note">Ключ доступа (passkey) заменяет пароль: вход подтверждается Face ID, отпечатком пальца или PIN-кодом устройства. Секретная часть ключа хранится только на устройстве и не передаётся на сервер.</p><div class="settings-group">${list.length?list.map(k=>`<div class="device-row"><span class="device-icon" style="--c:#2b9a5a">${icon('key')}</span><div><b>${esc(k.name)}</b><small>Добавлен ${new Date(k.created).toLocaleDateString('ru')}${k.last_used?' · вход '+new Date(k.last_used).toLocaleDateString('ru'):''}</small></div><button class="chip danger" data-remove-key="${esc(k.id)}">Удалить</button></div>`).join(''):'<p class="empty-list">Ключей пока нет</p>'}</div>${passkeysSupported()?`<button class="primary" id="passkey-add">${icon('key')} Создать ключ доступа</button>`:'<p class="note">Этот браузер не поддерживает ключи доступа.</p>'}</div>`);
  document.querySelectorAll('[data-remove-key]').forEach(b=>b.onclick=guard(async()=>{if(!confirm('Удалить ключ доступа? Войти с ним больше не получится.'))return;await api('/passkeys','DELETE',{id:b.dataset.removeKey});await passkeysPage();}));
  if($('#passkey-add'))$('#passkey-add').onclick=guard(async()=>{
    const o=await api('/passkeys/register/options','POST',{});
    const credential=await navigator.credentials.create({publicKey:{...o,challenge:fromB64url(o.challenge),user:{...o.user,id:fromB64url(o.user.id)},excludeCredentials:o.excludeCredentials.map(c=>({...c,id:fromB64url(c.id)}))}}).catch(error=>{throw new Error(error.name==='InvalidStateError'?'Ключ для этого устройства уже есть':error.name==='NotAllowedError'?'Создание ключа отменено':'Не удалось создать ключ доступа');});
    const r=credential.response;
    await api('/passkeys/register','POST',{id:credential.id,clientDataJSON:b64url(r.clientDataJSON),attestationObject:b64url(r.attestationObject),transports:r.getTransports?.()||[],name:deviceName()});
    toast('Ключ доступа создан');await passkeysPage();
  });
}
