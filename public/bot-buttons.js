// Inline buttons under bot messages. A callback button asks the server, which passes the press to
// the bot and waits briefly for its answerCallbackQuery; a link button opens the address.
import {esc,api,modal,toast} from './ui.js';

export function botKeyboard(m){
  const rows=m.markup?.inline_keyboard;if(!Array.isArray(rows)||m.deleted||m.pending)return '';
  return `<div class="bot-keyboard" role="group" aria-label="Кнопки бота">${rows.map(row=>`<div class="bot-row">${row.map((b,i)=>b.url
    ?`<a class="bot-button" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" data-bot-link>${esc(b.text)}<span aria-hidden="true">↗</span></a>`
    :`<button type="button" class="bot-button" data-bot-press="${esc(m.id)}" data-bot-data="${esc(b.callback_data)}">${esc(b.text)}</button>`).join('')}</div>`).join('')}</div>`;
}

export function bindBotButtons(box){
  box.querySelectorAll('[data-bot-link]').forEach(a=>a.onclick=e=>{let host='';try{host=new URL(a.href).host;}catch{}if(!confirm(`Открыть ссылку ${host}?`))e.preventDefault();});
  box.querySelectorAll('[data-bot-press]').forEach(button=>button.onclick=async e=>{
    e.stopPropagation();if(button.classList.contains('busy'))return;
    button.classList.add('busy');button.setAttribute('aria-busy','true');
    try{
      const answer=await api(`/messages/${encodeURIComponent(button.dataset.botPress)}/callback`,'POST',{data:button.dataset.botData});
      if(answer.url&&confirm(`Бот предлагает открыть ${new URL(answer.url).host}. Открыть?`))window.open(answer.url,'_blank','noopener');
      if(answer.text){if(answer.show_alert)modal('Ответ бота',`<p>${esc(answer.text)}</p>`);else toast(answer.text);}
    }catch(error){toast(error.message);}
    finally{button.classList.remove('busy');button.removeAttribute('aria-busy');}
  });
}
