// "Перенос истории": moving the account's history key to a new device, so it can read messages
// written before it existed. Two ways: a QR code shown on the new device and scanned (or typed)
// on a device that already has the key, or a backup protected by a password.
import {$,esc,icon,api,modal,guard,toast} from './ui.js';
import {qrSVG} from './qr.js';
import {historyStatus,transferReceiver,wrapHistoryFor,fromUrlKey,fingerprint,saveBackup,restoreBackup,removeBackup,prepareHistory,startHistoryHere} from './e2e.js';

const linkFor=(code,key)=>`${location.origin}/#e2e-transfer=${code}&k=${key}`;

export async function historyPage(state){
  const user=state.user.id,s=await historyStatus(user);
  const ready=s.ready;
  modal('Перенос истории',`<div class="tg-page key-transfer">
    <div class="kt-status ${ready?'ok':'warn'}">${icon(ready?'shield':'lock')}<div><b>${ready?'Ключ истории есть на этом устройстве':'На этом устройстве нет ключа истории'}</b><small>${ready?'Это устройство может передать старую переписку на новое.':'Сообщения, отправленные до входа на этом устройстве, не открываются, пока вы не перенесёте ключ.'}</small></div></div>
    ${ready?`<button class="primary" id="kt-send">${icon('qr')} Передать на новое устройство</button>
      <button class="secondary" id="kt-backup">${icon('key')} ${s.backup?'Изменить пароль резервной копии':'Резервная копия с паролем'}</button>
      ${s.backup?`<button class="secondary danger" id="kt-backup-off">Удалить резервную копию</button>`:''}
      <button class="secondary" id="kt-prepare">${icon('history')} Подготовить историю для переноса</button><p class="muted" id="kt-progress"></p>`
    :`<button class="primary" id="kt-receive">${icon('qr')} Получить с другого устройства</button>
      ${s.backup?`<button class="secondary" id="kt-restore">${icon('key')} Восстановить из резервной копии</button>`:''}
      ${s.keyId?'':`<button class="secondary" id="kt-start">Создать ключ на этом устройстве</button>`}
      <button class="secondary danger" id="kt-reset">Я потерял все старые устройства</button>`}
    <p class="note">Ключ истории передаётся только между вашими устройствами в зашифрованном виде. Сервер хранит копию лишь в резервной копии, закрытой вашим паролем; без пароля её не открыть ни нам, ни кому-то ещё.</p>
  </div>`);
  const on=(id,fn)=>{const el=$('#'+id);if(el)el.onclick=guard(fn);};
  on('kt-send',()=>sendDialog(state));
  on('kt-receive',()=>receiveDialog(state));
  on('kt-backup',()=>backupDialog(state));
  on('kt-backup-off',async()=>{if(!confirm('Удалить резервную копию ключей? Восстановить историю по паролю станет нельзя.'))return;await removeBackup(user);toast('Резервная копия удалена');await historyPage(state);});
  on('kt-restore',()=>restoreDialog(state));
  on('kt-prepare',async()=>{const out=$('#kt-progress');await prepareHistory(user,n=>{if(out)out.textContent=`Обработано сообщений: ${n}`;});if(out)out.textContent='Готово: открытые здесь сообщения доступны для переноса.';});
  on('kt-start',async()=>{if(!confirm('Создать ключ истории на этом устройстве? Если вы входили раньше с другого устройства, его старые сообщения нужно будет перенести сюда с него.'))return;await startHistoryHere(user);toast('Ключ истории создан');await historyPage(state);});
  on('kt-reset',async()=>{if(!confirm('Начать новый ключ истории? Старые сообщения останутся нечитаемыми на новых устройствах, а резервная копия будет удалена.'))return;await startHistoryHere(user,{reset:true});toast('Создан новый ключ истории');await historyPage(state);});
}

// New device: show a QR code and wait until another device sends the key.
export async function receiveDialog(state){
  const user=state.user.id,receiver=await transferReceiver();
  const {code}=await api('/e2e/transfer','POST',{pub:receiver.pub});
  let stopped=false,timer;
  const dialog=modal('Получить историю',`<div class="qr-login"><div class="qr-box">${qrSVG(linkFor(code,receiver.urlKey),{label:'QR-код переноса истории'})}</div>
    <ol class="qr-steps"><li>Откройте Cipherion на устройстве, где старая переписка читается.</li><li><b>Настройки → Устройства → Перенос истории → Передать на новое устройство</b> и наведите камеру на код.</li></ol>
    <p class="muted">Код для ручного ввода: <b class="qr-manual">${esc(code.slice(0,4)+'-'+code.slice(4))}</b></p>
    <p class="muted">Проверочные цифры: <b>${esc(receiver.fingerprint)}</b> — при ручном вводе они должны совпасть на обоих экранах.</p></div>`);
  dialog.addEventListener('close',()=>{stopped=true;clearTimeout(timer);api('/e2e/transfer/'+code,'DELETE',{}).catch(()=>{});},{once:true});
  const poll=async()=>{
    if(stopped)return;
    try{const r=await api('/e2e/transfer/'+code);if(r.ready){stopped=true;await receiver.accept(user,r.payload);dialog.close();toast('История перенесена. Старые сообщения открываются.');return;}}
    catch(error){if(error.status===404){stopped=true;dialog.close();toast('Код устарел. Начните перенос заново.');return;}}
    timer=setTimeout(poll,2000);
  };
  timer=setTimeout(poll,2000);
}

// Device with the key: scan the new device's QR code or type its code.
export function sendDialog(state){
  const scan='BarcodeDetector' in window&&navigator.mediaDevices?.getUserMedia;
  modal('Передать историю',`<div class="stack"><p class="note">На новом устройстве откройте <b>Настройки → Устройства → Перенос истории → Получить с другого устройства</b>.</p>${scan?`<button class="primary" id="kt-scan">${icon('qr')} Сканировать QR-код</button><video id="kt-video" class="qr-video" playsinline muted hidden></video>`:''}<form id="kt-form" class="stack"><label class="field">Или введите код с экрана<input name="code" required maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="ABCD-2345"></label><button class="secondary">Продолжить</button></form></div>`);
  let stream;const stop=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;};
  $('#modal').addEventListener('close',stop,{once:true});
  $('#kt-form').onsubmit=guard(async e=>{e.preventDefault();stop();await sendTransfer(state,new FormData(e.currentTarget).get('code'),null);});
  if(scan)$('#kt-scan').onclick=guard(async()=>{
    const video=$('#kt-video');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});video.srcObject=stream;video.hidden=false;await video.play();
    const detector=new BarcodeDetector({formats:['qr_code']});
    const look=async()=>{if(!stream)return;try{const [hit]=await detector.detect(video);const m=hit&&/e2e-transfer=([A-Z0-9]{8})&k=([A-Za-z0-9_-]+)/.exec(hit.rawValue||'');if(m){stop();await sendTransfer(state,m[1],m[2]);return;}}catch{}requestAnimationFrame(look);};
    look();
  });
}
const normalize=code=>String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
// urlKey comes from the QR picture; without it the person compares the check digits by eye.
export async function sendTransfer(state,code,urlKey){
  code=normalize(code);const user=state.user.id;
  const info=await api('/e2e/transfer/'+code);
  const scanned=urlKey?fromUrlKey(urlKey):null;
  if(urlKey&&scanned!==info.pub)throw new Error('Ключ в QR-коде не совпадает с ключом на сервере. Перенос остановлен.');
  const digits=await fingerprint(info.pub);
  modal('Передать историю?',`<div class="stack"><p class="note"><b>Передавайте ключ только своему устройству.</b> С ним можно прочитать всю вашу зашифрованную переписку.</p>${scanned?'':`<p>Проверочные цифры на новом устройстве должны быть: <b>${esc(digits)}</b></p>`}<button class="primary" id="kt-confirm">Передать ключ</button><button class="secondary" id="kt-cancel">Отмена</button></div>`);
  $('#kt-cancel').onclick=()=>$('#modal').close();
  $('#kt-confirm').onclick=guard(async()=>{
    const payload=await wrapHistoryFor(user,info.pub);if(!payload)throw new Error('На этом устройстве нет ключа истории');
    await api('/e2e/transfer/'+code,'PUT',{payload});$('#modal').close();toast('Ключ передан. Готовим историю…');
    prepareHistory(user).catch(()=>{});
  });
}

function backupDialog(state){
  modal('Резервная копия ключей',`<form id="kt-backup-form" class="stack"><p class="note">Ключ истории будет зашифрован этим паролем и сохранён на сервере. На новом устройстве достаточно ввести пароль. <b>Восстановить забытый пароль нельзя.</b></p><label class="field">Пароль (не короче 8 символов)<input name="p1" type="password" minlength="8" required autocomplete="new-password"></label><label class="field">Повторите пароль<input name="p2" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary">Сохранить</button></form>`);
  $('#kt-backup-form').onsubmit=guard(async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('p1')!==f.get('p2'))throw new Error('Пароли не совпадают');e.submitter&&(e.submitter.disabled=true);try{await saveBackup(state.user.id,f.get('p1'));}finally{if(e.submitter)e.submitter.disabled=false;}$('#modal').close();toast('Резервная копия сохранена');prepareHistory(state.user.id).catch(()=>{});});
}
function restoreDialog(state){
  modal('Восстановить историю',`<form id="kt-restore-form" class="stack"><label class="field">Пароль резервной копии<input name="p" type="password" required autocomplete="current-password"></label><button class="primary">Восстановить</button></form>`);
  $('#kt-restore-form').onsubmit=guard(async e=>{e.preventDefault();await restoreBackup(state.user.id,new FormData(e.currentTarget).get('p'));$('#modal').close();toast('История восстановлена');});
}
