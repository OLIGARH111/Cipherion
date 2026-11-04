// «Мои боты»: create bots, get their tokens and connect a webhook.
import {$,esc,icon,api,modal,guard,toast,avatar} from './ui.js';

const docs=origin=>`<details class="bot-docs"><summary>Как работает API</summary><p>Запросы отправляются на <code>${esc(origin)}/api/bot/&lt;токен&gt;/&lt;метод&gt;</code> методом POST с JSON или GET с параметрами. Ответ: <code>{"ok":true,"result":…}</code>.</p><ul><li><code>getMe</code> — данные бота</li><li><code>getUpdates</code> — новые сообщения (<code>offset</code>, <code>limit</code>, <code>timeout</code> до 25 с)</li><li><code>sendMessage</code> — <code>chat_id</code>, <code>text</code>, <code>reply_to_message_id</code>, <code>topic_id</code></li><li><code>editMessageText</code>, <code>deleteMessage</code>, <code>sendChatAction</code>, <code>getChat</code></li><li><code>setWebhook</code> — <code>url</code> (https), <code>secret_token</code>; его значение придёт в заголовке <code>X-Cipherion-Bot-Secret</code>. <code>deleteWebhook</code>, <code>getWebhookInfo</code></li></ul><p>Пример: <code>curl -X POST ${esc(origin)}/api/bot/ТОКЕН/sendMessage -H 'Content-Type: application/json' -d '{"chat_id":"…","text":"Привет"}'</code></p><p class="muted">Чаты с ботом не шифруются сквозным образом: бот читает сообщения через сервер.</p></details>`;

function showToken(token){
  modal('Токен бота',`<p class="note">Сохраните токен: он показывается один раз. Любой, у кого есть токен, может управлять ботом.</p><div class="token-box"><code id="bot-token">${esc(token)}</code><button class="secondary" id="copy-token">${icon('copy')} Скопировать</button></div>${docs(location.origin)}<button class="primary" id="token-done">Готово</button>`);
  $('#copy-token').onclick=guard(async()=>{await navigator.clipboard.writeText(token);toast('Токен скопирован');});
  $('#token-done').onclick=()=>botsPage();
}
export async function botsPage(openChat){
  const list=await api('/bots');
  modal('Мои боты',`<div class="tg-page"><p class="note">Боты отвечают на сообщения автоматически: напишите программу, которая работает с API Cipherion по токену.</p><div class="settings-group">${list.length?list.map(b=>`<button type="button" class="device-row bot-row" data-bot="${esc(b.id)}">${avatar(b.name)}<div><b>${esc(b.name)}</b><small>@${esc(b.username)}${b.webhook?' · вебхук':''}</small></div>${icon('chevron')}</button>`).join(''):'<p class="empty-list">У вас пока нет ботов</p>'}</div><button class="primary" id="bot-new">${icon('bot')} Создать бота</button>${docs(location.origin)}</div>`);
  $('#bot-new').onclick=()=>{
    modal('Новый бот',`<form id="bot-form" class="stack"><label class="field">Имя<input name="name" required maxlength="64" placeholder="Помощник"></label><label class="field">Username (в конце «bot»)<input name="username" required maxlength="32" pattern="[a-zA-Z0-9_]{2,28}[bB][oO][tT]" placeholder="helper_bot"></label><label class="field">Описание<textarea name="description" maxlength="500" rows="3"></textarea></label><button class="primary">Создать</button></form>`);
    $('#bot-form').onsubmit=guard(async e=>{e.preventDefault();const r=await api('/bots','POST',Object.fromEntries(new FormData(e.currentTarget)));showToken(r.token);});
  };
  document.querySelectorAll('[data-bot]').forEach(row=>row.onclick=()=>botDetails(list.find(b=>b.id===row.dataset.bot),openChat));
}
function botDetails(b,openChat){
  modal(b.name,`<form id="bot-edit" class="stack"><label class="field">Имя<input name="name" value="${esc(b.name)}" required maxlength="64"></label><label class="field">Описание<textarea name="description" maxlength="500" rows="3">${esc(b.description)}</textarea></label><label class="field">Вебхук (необязательно)<input name="webhook" type="url" value="${esc(b.webhook)}" placeholder="https://example.com/cipherion"></label><button class="primary">Сохранить</button></form><div class="stack"><button class="secondary" id="bot-chat">${icon('chat')} Написать боту</button><button class="secondary" id="bot-token-new">${icon('key')} Выпустить новый токен</button><button class="secondary danger" id="bot-delete">${icon('trash')} Удалить бота</button><button class="secondary" id="bot-back">Назад</button></div>`);
  $('#bot-edit').onsubmit=guard(async e=>{e.preventDefault();await api('/bots/'+b.id,'PATCH',Object.fromEntries(new FormData(e.currentTarget)));toast('Сохранено');await botsPage(openChat);});
  $('#bot-chat').onclick=guard(async()=>{const chat=await api('/chats','POST',{users:[b.id]});$('#modal').close();await openChat?.(chat.id,true);});
  $('#bot-token-new').onclick=guard(async()=>{if(!confirm('Старый токен перестанет работать. Продолжить?'))return;showToken((await api('/bots/'+b.id+'/token','POST',{})).token);});
  $('#bot-delete').onclick=guard(async()=>{if(!confirm(`Удалить бота @${b.username}? Он покинет все чаты.`))return;await api('/bots/'+b.id,'DELETE');toast('Бот удалён');await botsPage(openChat);});
  $('#bot-back').onclick=()=>botsPage(openChat);
}
