import {esc,icon} from './ui.js';

// Sections the bottom menu (the side rail on a computer) can hold.
// «Чаты» and «Настройки» always stay: without them the phone has no way back.
export const NAV_SECTIONS=[
  ['chat','Чаты',true],
  ['ai','AI',false],
  ['phone','Звонки',false],
  ['people','Контакты',false],
  ['channel','Каналы',false],
  ['settings','Настройки',true]
];
export const NAV_DEFAULT=['chat','ai','phone','settings'];
export const NAV_MAX=5;
const known=new Map(NAV_SECTIONS.map(([key,title,required])=>[key,{key,title,required}]));

// The visible sections in their saved order, repaired if the saved list is broken.
export function navTabs(settings={}){
  const saved=Array.isArray(settings.navTabs)?settings.navTabs:NAV_DEFAULT;
  const list=[...new Set(saved.filter(key=>known.has(key)))];
  for(const [key,,required] of NAV_SECTIONS)if(required&&!list.includes(key))key==='chat'?list.unshift(key):list.push(key);
  while(list.length>NAV_MAX){const i=list.findLastIndex(key=>!known.get(key).required);list.splice(i,1);}
  return list.map(key=>[key,known.get(key).title]);
}

// Settings row: every section in order, visible ones first, with a switch and arrows.
export function navEditor(root,draft,onChange){
  const render=()=>{
    const visible=navTabs(draft).map(([key])=>key),hidden=NAV_SECTIONS.map(([key])=>key).filter(key=>!visible.includes(key)),full=visible.length>=NAV_MAX;
    root.innerHTML=`<p class="nav-editor-hint">Видно ${visible.length} из ${NAV_MAX}. «Чаты» и «Настройки» скрыть нельзя.</p><div class="nav-editor-list" role="list">${[...visible,...hidden].map(key=>{const s=known.get(key),on=visible.includes(key),i=visible.indexOf(key);return `<div class="nav-editor-row ${on?'':'off'}" role="listitem" data-nav-key="${key}"><span class="nav-editor-icon">${icon(key)}</span><span class="nav-editor-title">${esc(s.title)}</span><button type="button" class="nav-editor-move" data-nav-move="-1" aria-label="Выше: ${esc(s.title)}" ${on&&i>0?'':'disabled'}>${icon('up')}</button><button type="button" class="nav-editor-move" data-nav-move="1" aria-label="Ниже: ${esc(s.title)}" ${on&&i<visible.length-1?'':'disabled'}>${icon('down')}</button><input type="checkbox" data-nav-toggle aria-label="Показывать «${esc(s.title)}»" ${on?'checked':''} ${s.required||(!on&&full)?'disabled':''}></div>`;}).join('')}</div><button type="button" class="secondary" data-nav-reset>Вернуть стандартные разделы</button>`;
    const commit=list=>{draft.navTabs=list;render();onChange(list);};
    root.querySelectorAll('[data-nav-move]').forEach(b=>b.onclick=()=>{const key=b.closest('[data-nav-key]').dataset.navKey,i=visible.indexOf(key),j=i+Number(b.dataset.navMove);if(i<0||j<0||j>=visible.length)return;const list=[...visible];[list[i],list[j]]=[list[j],list[i]];commit(list);});
    root.querySelectorAll('[data-nav-toggle]').forEach(c=>c.onchange=()=>{const key=c.closest('[data-nav-key]').dataset.navKey;const list=c.checked?[...visible.filter(k=>k!=='settings'),key,...(visible.includes('settings')?['settings']:[])]:visible.filter(k=>k!==key);commit(list);});
    root.querySelector('[data-nav-reset]').onclick=()=>commit([...NAV_DEFAULT]);
  };
  render();
}
