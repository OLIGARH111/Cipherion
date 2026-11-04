// Message formatting. Text keeps simple markers, so it is encrypted and synced like any
// other text and old app versions still show something readable:
//   **жирный**  __курсив__  `моноширинный`  ```блок кода```  ~~зачёркнутый~~  ||спойлер||
// Links become clickable and @username mentions are highlighted.
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const URL_PATTERN=/\bhttps?:\/\/[^\s<>"'«»]+[^\s<>"'«».,;:!?)\]}]/gi;

const rules=[
  [/\*\*(?=\S)([\s\S]*?\S)\*\*/g,'<strong>$1</strong>'],
  [/__(?=\S)([\s\S]*?\S)__/g,'<em>$1</em>'],
  [/~~(?=\S)([\s\S]*?\S)~~/g,'<s>$1</s>'],
  [/\|\|(?=\S)([\s\S]*?\S)\|\|/g,'<span class="spoiler" role="button" tabindex="0" aria-label="Скрытый текст, нажмите, чтобы показать">$1</span>']
];

// `emoji` post-processes escaped HTML (custom emoji tokens survive escaping unchanged).
export function richText(text,{emoji=html=>html,links=true}={}){
  const slots=[];const keep=html=>`\u0000${slots.push(html)-1}\u0000`;
  let source=String(text??'').replace(/\u0000/g,'');
  source=source.replace(/```(?:[a-z0-9_+-]{1,20}\n)?([\s\S]+?)```/gi,(_,code)=>keep(`<pre class="code-block"><code>${escape(code.replace(/^\n|\n$/g,''))}</code></pre>`));
  source=source.replace(/`([^`\n]+)`/g,(_,code)=>keep(`<code>${escape(code)}</code>`));
  if(links)source=source.replace(URL_PATTERN,url=>keep(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer nofollow">${escape(url.length>80?url.slice(0,77)+'…':url)}</a>`));
  let html=escape(source);
  for(const [pattern,replacement] of rules)html=html.replace(pattern,replacement);
  html=html.replace(/(^|[^\w@&])@([a-zA-Z0-9_]{3,32})\b/g,'$1<span class="mention" data-mention="$2">@$2</span>');
  html=emoji(html);
  return html.replace(/\u0000(\d+)\u0000/g,(_,i)=>slots[Number(i)]??'');
}
// Text for chat list previews and notifications: markers removed, spoilers hidden.
export function plainText(text){
  return String(text??'').replace(/```(?:[a-z0-9_+-]{1,20}\n)?([\s\S]+?)```/gi,'$1').replace(/`([^`\n]+)`/g,'$1')
    .replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g,'▒▒▒').replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g,'$1').replace(/__(?=\S)([\s\S]*?\S)__/g,'$1').replace(/~~(?=\S)([\s\S]*?\S)~~/g,'$1');
}
export function firstURL(text){
  const clean=String(text??'').replace(/```[\s\S]*?```/g,'').replace(/`[^`\n]*`/g,'');
  return (clean.match(URL_PATTERN)||[])[0]||'';
}

// Wraps the selection of a textarea in a marker (or removes it when already wrapped).
export const MARKERS={bold:'**',italic:'__',mono:'`',strike:'~~',spoiler:'||'};
export function toggleFormat(input,kind){
  const marker=MARKERS[kind];if(!marker||!input)return;
  const {selectionStart:start,selectionEnd:end,value}=input;
  const selected=value.slice(start,end);
  const before=value.slice(Math.max(0,start-marker.length),start),after=value.slice(end,end+marker.length);
  if(before===marker&&after===marker){
    input.setRangeText(selected,start-marker.length,end+marker.length,'select');
  }else if(selected.startsWith(marker)&&selected.endsWith(marker)&&selected.length>=marker.length*2){
    input.setRangeText(selected.slice(marker.length,-marker.length),start,end,'select');
  }else{
    const wrap=kind==='mono'&&selected.includes('\n')?'```':marker;
    input.setRangeText(wrap+(wrap==='```'?'\n':'')+selected+(wrap==='```'?'\n':'')+wrap,start,end,'end');
    if(!selected){const caret=start+wrap.length;input.setSelectionRange(caret,caret);}
    else input.setSelectionRange(start+wrap.length+(wrap==='```'?1:0),start+wrap.length+(wrap==='```'?1:0)+selected.length);
  }
  input.dispatchEvent(new Event('input'));input.focus();
}
// Spoilers reveal on tap; one listener for the whole page.
if(typeof document!=='undefined')document.addEventListener('click',e=>{
  const spoiler=e.target.closest?.('.spoiler');if(!spoiler||spoiler.classList.contains('revealed'))return;
  e.preventDefault();e.stopPropagation();spoiler.classList.add('revealed');spoiler.removeAttribute('role');spoiler.setAttribute('aria-label','');
},true);
if(typeof document!=='undefined')document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList?.contains('spoiler')){e.preventDefault();e.target.click();}});
