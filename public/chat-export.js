// Chat export to JSON or a standalone HTML page. It runs on the device: encrypted
// messages are decrypted here, so the server never sees the exported text.
import {$,esc,api,modal,guard,toast} from './ui.js';
import {richText,plainText} from './rich-text.js';

const kinds={photo:'Фото',video:'Видео',file:'Файл',voice:'Голосовое сообщение',round:'Видеосообщение',poll:'Опрос',sticker:'Стикер',location:'Геопозиция',treat:'Игра'};
const stamp=t=>new Date(t).toLocaleString('ru',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});

async function history(chat,progress){
  const rows=[];let cursor=null;
  for(let page=0;page<500;page++){
    const batch=await api(`/chats/${chat}/messages${cursor?`?before=${cursor.created}&beforeId=${encodeURIComponent(cursor.id)}`:''}`);
    if(!batch.length)break;rows.unshift(...batch);cursor=batch[0];progress(rows.length);
    if(batch.length<60)break;
  }
  return rows.filter(m=>!m.deleted);
}
function record(m,names){
  const out={id:m.id,date:new Date(m.created).toISOString(),from:names(m),type:m.kind||'text',text:m.kind==='location'?undefined:plainText(m.body||'')};
  if(m.edited)out.edited=new Date(m.edited).toISOString();
  if(m.reply_id)out.reply_to=m.reply_id;
  if(m.forwarded)out.forwarded_from=m.forwarded;
  if(m.media)out.file={name:m.file?.n||m.media.name,size:m.file?.s||m.media.size,type:m.file?.m||m.media.type};
  if(m.poll)out.poll={question:m.body,options:m.poll.options,...(m.poll.checklist?{checklist:true,done:(m.poll.done||[]).map(d=>d.item)}:{})};
  if(m.kind==='location'){try{out.location=JSON.parse(m.body);}catch{}}
  if(m.reactions?.length)out.reactions=m.reactions.map(r=>({emoji:r.emoji,count:r.count}));
  if(m.topic_id)out.topic=m.topic_id;
  return out;
}
function page(chat,list,names){
  const body=list.map(m=>{
    const extra=m.media?`<div class="att">📎 ${esc(m.file?.n||m.media.name)}</div>`:m.kind==='location'?(()=>{try{const p=JSON.parse(m.body);return `<div class="att">📍 <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}">${p.lat}, ${p.lng}</a></div>`;}catch{return '';}})():m.poll?`<ul class="poll">${m.poll.options.map((o,i)=>`<li>${m.poll.checklist&&(m.poll.done||[]).some(d=>d.item===i)?'☑':'☐'} ${esc(o)}</li>`).join('')}</ul>`:'';
    const text=m.kind==='location'?'':m.kind==='sticker'?'[Стикер]':richText(m.body||'');
    return `<article><header><b>${esc(names(m))}</b><time>${esc(stamp(m.created))}</time></header>${m.forwarded?`<div class="fwd">Переслано от ${esc(m.forwarded)}</div>`:''}${text?`<div class="text">${text}</div>`:''}${extra}</article>`;
  }).join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(chat.title)} — экспорт Cipherion</title><style>
:root{--bg:#f4f6f5;--card:#fff;--text:#14201b;--muted:#6b7a74;--accent:#1f8f6a}@media(prefers-color-scheme:dark){:root{--bg:#0d1512;--card:#16211d;--text:#e7f1ed;--muted:#8fa39b;--accent:#4cc79c}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:760px;margin:auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}p.meta{color:var(--muted);margin:0 0 20px}
article{background:var(--card);border-radius:14px;padding:10px 14px;margin:8px 0}article header{display:flex;justify-content:space-between;gap:12px;font-size:13px}article time{color:var(--muted)}.text{white-space:pre-wrap;overflow-wrap:anywhere}.fwd,.att{color:var(--muted);font-size:13px}a{color:var(--accent)}code,pre{font-family:ui-monospace,monospace;background:#8882;border-radius:6px;padding:1px 4px}pre{padding:8px;overflow:auto}.spoiler{background:var(--muted);color:transparent;border-radius:4px}.spoiler:hover{color:inherit;background:none}.mention{color:var(--accent)}.poll{margin:4px 0;padding-left:18px}
</style></head><body><main><h1>${esc(chat.title)}</h1><p class="meta">Экспортировано из Cipherion ${esc(stamp(Date.now()))} · ${list.length} сообщений</p>${body}</main></body></html>`;
}
function download(name,type,text){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}

export function exportDialog(chat,state){
  modal('Экспорт чата',`<p class="note">Файл собирается на этом устройстве: зашифрованные сообщения расшифровываются здесь и не уходят на сервер. Медиафайлы в экспорт не входят — только их названия.</p><div class="stack"><button class="primary" data-export="html">Страница HTML</button><button class="secondary" data-export="json">Данные JSON</button><p class="muted" id="export-progress" aria-live="polite"></p></div>`);
  document.querySelectorAll('[data-export]').forEach(b=>b.onclick=guard(async()=>{
    document.querySelectorAll('[data-export]').forEach(x=>x.disabled=true);
    try{
      const list=await history(chat.id,n=>{const el=$('#export-progress');if(el)el.textContent=`Загружено сообщений: ${n}`;});
      const names=m=>m.user_id===state.user.id?state.user.name:chat.members.find(p=>p.user_id===m.user_id)?.name||m.author?.name||'Участник';
      const base=(chat.title||'chat').replace(/[\\/:*?"<>|]+/g,'').slice(0,60)||'chat',date=new Date().toISOString().slice(0,10);
      if(b.dataset.export==='json')download(`${base}-${date}.json`,'application/json',JSON.stringify({chat:{id:chat.id,title:chat.title,type:chat.kind},exported:new Date().toISOString(),messages:list.map(m=>record(m,names))},null,2));
      else download(`${base}-${date}.html`,'text/html',page(chat,list,names));
      toast(`Экспортировано сообщений: ${list.length}`);$('#modal').close();
    }finally{document.querySelectorAll('[data-export]').forEach(x=>x.disabled=false);}
  }));
}
export {kinds as exportKinds};
