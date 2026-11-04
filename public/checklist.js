// Shared checklists: a poll whose options are tasks that members tick off together.
import {$,esc,icon,api,modal,guard} from './ui.js';

export function checklistCard(m,me){
  const p=m.poll,done=new Map((p.done||[]).map(d=>[d.item,d]));
  const total=p.options.length,count=done.size;
  const items=p.options.map((text,i)=>{const d=done.get(i);return `<li><button type="button" class="check-item${d?' done':''}" data-check="${i}" data-message="${esc(m.id)}" aria-pressed="${!!d}"><span class="check-box" aria-hidden="true">${d?icon('check'):''}</span><span class="check-text">${esc(text)}</span>${d?`<small>${esc(d.by===me?'вы':d.name)}</small>`:''}</button></li>`;}).join('');
  return `<div class="checklist-card"><header>${icon('checklist')}<span>Чек-лист · ${count} из ${total}</span></header>${p.description?`<p>${esc(p.description)}</p>`:''}<div class="check-progress"><i style="width:${total?Math.round(count/total*100):0}%"></i></div><ul class="check-items">${items}</ul>${!m.pending&&total<50?`<form class="check-add" data-message="${esc(m.id)}"><input name="text" maxlength="150" placeholder="Добавить пункт" aria-label="Новый пункт"><button class="icon-button" title="Добавить" aria-label="Добавить">${icon('plus')}</button></form>`:''}</div>`;
}
export function bindChecklists(root,state,apply){
  root.querySelectorAll('[data-check]').forEach(b=>b.onclick=guard(async()=>{
    const m=state.messages.find(x=>x.id===b.dataset.message);if(!m?.poll)return;
    const item=Number(b.dataset.check),done=!b.classList.contains('done');
    b.classList.toggle('done',done);
    const poll=await api(`/polls/${m.id}/check`,'POST',{item,done});apply(m,poll);
  }));
  root.querySelectorAll('.check-add').forEach(form=>form.onsubmit=guard(async e=>{
    e.preventDefault();const input=form.querySelector('input'),text=input.value.trim();if(!text)return;
    const m=state.messages.find(x=>x.id===form.dataset.message);input.disabled=true;
    try{const poll=await api(`/polls/${m.id}/items`,'POST',{text});input.value='';apply(m,poll);}finally{input.disabled=false;}
  }));
}
export function checklistEditor(send){
  modal('Новый чек-лист',`<form id="checklist-form" class="stack"><label class="field">Название<input name="title" required maxlength="300" placeholder="Например, «Покупки на выходные»"></label><label class="field">Пункты — по одному в строке<textarea name="items" rows="6" required placeholder="Хлеб&#10;Молоко&#10;Яблоки"></textarea></label><label class="setting-row"><div>Участники могут добавлять пункты</div><input type="checkbox" name="othersAdd" checked></label><label class="setting-row"><div>Участники могут отмечать пункты</div><input type="checkbox" name="othersCheck" checked></label><button class="primary">Отправить</button></form>`);
  $('#checklist-form').onsubmit=guard(async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const options=String(f.get('items')).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,50);
    if(!options.length)throw new Error('Добавьте хотя бы один пункт');
    await send({kind:'poll',body:String(f.get('title')).trim(),poll:{checklist:true,options,othersAdd:f.get('othersAdd')==='on',othersCheck:f.get('othersCheck')==='on'}});
    $('#modal').close();
  });
}
