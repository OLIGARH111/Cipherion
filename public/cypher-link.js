// Cypher for Windows ↔ Cipherion: approving a computer and managing linked computers (server/cypher-link.js).
import {$,esc,api,modal,guard,toast} from './ui.js';

const when=t=>t?new Date(t).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const normal=code=>{const raw=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return raw.length===8?raw.slice(0,4)+'-'+raw.slice(4):'';};
const WHAT=`<ul class="cypher-grants"><li><b>Пульт ПК.</b> У вас появится чат с личным ботом «Cypher · ПК»: команды из него Cypher выполнит на компьютере.</li><li><b>Уведомления.</b> Cypher узнает о новых сообщениях: кто и в каком чате написал. Текст — только у сообщений без сквозного шифрования, зашифрованные он прочитать не может.</li><li><b>Память AI.</b> Записи памяти AI будут общими у Cypher на компьютере и Cypher AI в Cipherion.</li><li><b>Вход в Cypher</b> через этот аккаунт, без кода доступа.</li></ul>`;

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
  $('#cypher-approve').onclick=guard(async()=>{await api('/cypher/link/approve','POST',{code:value});$('#modal').close();toast('Cypher подключён. Вернитесь к компьютеру — через пару секунд всё будет готово.');onDone();});
  $('#cypher-decline').onclick=guard(async()=>{await api('/cypher/link/approve','POST',{code:value,approve:false});$('#modal').close();toast('Подключение отклонено');});
}

// The card in the AI section: linked computers, the remote chat and the code form.
export async function cypherComputers(card,openChat){
  if(!card)return;let data;try{data=await api('/cypher/links');}catch{return;}if(!card.isConnected)return;
  const rows=data.links.map(l=>`<div class="cypher-pc-row"><div><b>${esc(l.device)}</b><small>${l.remote?'Пульт · ':''}подключён ${esc(when(l.created))} · был в сети ${esc(when(l.lastSeen))}</small></div><button class="chip" data-cypher-unlink="${esc(l.id)}">Отключить</button></div>`).join('');
  card.innerHTML=`<div class="cypher-pc-head"><div><span class="eyebrow">CYPHER НА КОМПЬЮТЕРЕ</span><h3>${data.links.length?'Подключённые компьютеры':'Подключите Cypher на ПК'}</h3><p class="note">${data.links.length?'Пишите команды в чат «Cypher · ПК» — Cypher выполнит их на компьютере, который сейчас держит пульт.':'Пульт для компьютера из любого места, уведомления о сообщениях голосом и общая память AI.'}</p></div><div class="row">${data.chat?'<button class="primary" id="cypher-open-remote">Открыть пульт</button>':''}<button class="${data.chat?'secondary':'primary'}" id="cypher-add-pc">Подключить по коду</button></div></div>${rows?`<div class="cypher-pc-list">${rows}</div>`:''}`;
  card.hidden=false;
  const reload=()=>cypherComputers(card,openChat);
  $('#cypher-add-pc',card).onclick=guard(()=>approveCypher('',reload));
  const open=$('#cypher-open-remote',card);if(open)open.onclick=guard(()=>openChat(data.chat));
  card.querySelectorAll('[data-cypher-unlink]').forEach(btn=>btn.onclick=guard(async()=>{
    const name=btn.closest('.cypher-pc-row').querySelector('b').textContent;
    if(!confirm(`Отключить Cypher на компьютере «${name}»? Он потеряет доступ к пульту, уведомлениям и памяти.`))return;
    await api('/cypher/links','DELETE',{id:btn.dataset.cypherUnlink});toast('Компьютер отключён');await reload();
  }));
}
