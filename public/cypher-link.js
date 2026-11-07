// Cypher for Windows ↔ Cipherion: approving a computer and managing linked computers (server/cypher-link.js).
import {$,esc,api,modal,guard,toast} from './ui.js';

const when=t=>t?new Date(t).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const normal=code=>{const raw=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return raw.length===8?raw.slice(0,4)+'-'+raw.slice(4):'';};
const WHAT=`<ul class="cypher-grants"><li><b>Управление компьютером из раздела AI.</b> Выберите «💻 Компьютер» в поле «Контекст» — Cypher выполнит команду на ПК и ответит здесь.</li><li><b>Уведомления.</b> Cypher узнает о новых сообщениях: кто и в каком чате написал. Текст — только у сообщений без сквозного шифрования, зашифрованные он прочитать не может.</li><li><b>Память AI.</b> Записи памяти AI будут общими у Cypher на компьютере и Cypher AI в Cipherion.</li><li><b>Вход в Cypher</b> через этот аккаунт, без кода доступа.</li></ul>`;

// Sends a command to a linked PC and waits for its answer (the server keeps both in the AI history).
export async function runOnPC({link,text,signal,status=()=>{}}){
  const sent=await api('/cypher/remote','POST',{link,text});
  status(sent.online?'Отправлено на компьютер…':'Компьютер не в сети. Команда подождёт до 10 минут, пока он включится…');
  const started=Date.now();
  while(Date.now()-started<11*60*1000){
    if(signal?.aborted)throw new DOMException('Ожидание остановлено','AbortError');
    const r=await api('/cypher/remote/result?id='+encodeURIComponent(sent.id)+'&timeout=20');
    if(r.status==='done')return r.reply;
    if(r.status==='expired')throw new Error(r.error);
    status(r.status==='running'?'Cypher выполняет на компьютере…':r.online?'Отправлено на компьютер…':'Компьютер не в сети. Жду, пока он включится…');
  }
  throw new Error('Компьютер долго не отвечает. Проверьте, что Cypher запущен.');
}

// Shown from the AI section, or when a QR code / link from Cypher opens Cipherion (#cypher-link=CODE).
export async function approveCypher(code,onDone=()=>{}){
  const value=normal(code);
  if(!value){
    modal('Подключить Cypher',`<form id="cypher-code-form" class="stack"><p class="note">В Cypher на компьютере нажмите «Войти через Cipherion» или «Подключить» в настройках — появится код.</p><label class="field">Код с экрана компьютера<input name="code" required maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="ABCD-EFGH"></label><button class="primary">Продолжить</button></form>`);
    $('#cypher-code-form').onsubmit=guard(async e=>{e.preventDefault();await approveCypher(new FormData(e.currentTarget).get('code'),onDone);});
    return;
  }
  const info=await api('/cypher/link/info?code='+encodeURIComponent(value));
  modal('Подключить Cypher?',`<div class="stack"><p>Компьютер <b>«${esc(info.device)}»</b> просит подключить Cypher к вашему аккаунту.</p><p class="note">Подтверждайте, только если код <b>${esc(value)}</b> сейчас показан на вашем компьютере в программе Cypher.</p><p><b>Cypher получит:</b></p>${WHAT}<div class="row"><button class="primary" id="cypher-approve">Подключить</button><button class="secondary" id="cypher-decline">Отклонить</button></div></div>`);
  $('#cypher-approve').onclick=guard(async()=>{await api('/cypher/link/approve','POST',{code:value});$('#modal').close();toast('Cypher подключён. Управлять компьютером можно в разделе AI.');onDone();});
  $('#cypher-decline').onclick=guard(async()=>{await api('/cypher/link/approve','POST',{code:value,approve:false});$('#modal').close();toast('Подключение отклонено');});
}

// The card in the AI section: linked computers and the code form. onPick switches the AI chat to a PC.
export async function cypherComputers(card,onPick){
  if(!card)return;let data;try{data=await api('/cypher/links');}catch{return;}if(!card.isConnected)return;
  const rows=data.links.map(l=>`<div class="cypher-pc-row"><div><b>${esc(l.device)}</b><small>${l.online?'в сети':'был в сети '+esc(when(l.lastSeen))} · подключён ${esc(when(l.created))}</small></div><div class="row"><button class="chip" data-cypher-pick="${esc(l.id)}">Командовать</button><button class="chip" data-cypher-unlink="${esc(l.id)}">Отключить</button></div></div>`).join('');
  card.innerHTML=`<div class="cypher-pc-head"><div><span class="eyebrow">CYPHER НА КОМПЬЮТЕРЕ</span><h3>${data.links.length?'Подключённые компьютеры':'Подключите Cypher на ПК'}</h3><p class="note">${data.links.length?'Выберите «💻 Компьютер» в поле «Контекст» — сообщение уйдёт на ПК, Cypher выполнит его и ответит здесь.':'Управление компьютером прямо из этого чата, уведомления о сообщениях голосом и общая память AI.'}</p></div><div class="row"><button class="${data.links.length?'secondary':'primary'}" id="cypher-add-pc">Подключить по коду</button></div></div>${rows?`<div class="cypher-pc-list">${rows}</div>`:''}`;
  card.hidden=false;
  const reload=()=>cypherComputers(card,onPick);
  $('#cypher-add-pc',card).onclick=guard(()=>approveCypher('',()=>location.reload()));
  card.querySelectorAll('[data-cypher-pick]').forEach(btn=>btn.onclick=()=>onPick(btn.dataset.cypherPick));
  card.querySelectorAll('[data-cypher-unlink]').forEach(btn=>btn.onclick=guard(async()=>{
    const name=btn.closest('.cypher-pc-row').querySelector('b').textContent;
    if(!confirm(`Отключить Cypher на компьютере «${name}»? Он потеряет доступ к командам, уведомлениям и памяти.`))return;
    await api('/cypher/links','DELETE',{id:btn.dataset.cypherUnlink});toast('Компьютер отключён');await reload();
  }));
}
