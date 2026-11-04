// Message helpers added in the November update:
//  • one-tap translation through the connected AI assistant;
//  • «Кто прочитал» for your own messages in groups;
//  • replying with a quote of the selected fragment;
//  • a real voice waveform computed from the recording.
import {$,esc,api,modal,avatar,toast} from './ui.js';

// ---------- Translation ----------
const translations=new Map();
export const translationOf=id=>translations.get(id)||null;
const targetLanguage=state=>state.settings.translateTo||'Русский';
// A quick hint for the button under a message: text without Cyrillic letters while the target is Russian.
export function looksForeign(text,state){
  const t=String(text||'').replace(/https?:\/\/\S+/g,'').replace(/:ce\[[^\]]+\]/g,'');
  if(targetLanguage(state)!=='Русский')return t.replace(/[^\p{L}]/gu,'').length>=12;
  const letters=t.replace(/[^\p{L}]/gu,'');return letters.length>=12&&!/[а-яё]/i.test(letters);
}
export async function translateMessage(m,state,rerender){
  if(translations.has(m.id)){translations.delete(m.id);rerender();return;}
  if(!state.settings.ai?.enabled)throw new Error('Включите AI-помощника: Настройки → AI');
  if(!state.settings.translateConsent){
    if(!confirm('Текст сообщения будет отправлен подключённому AI-провайдеру для перевода. Продолжить?'))return;
    state.settings.translateConsent=true;state.saveSettings?.().catch(()=>{});
  }
  const text=String(m.body||'').trim();if(!text)throw new Error('В сообщении нет текста');
  translations.set(m.id,{loading:true});rerender();
  try{const r=await api('/ai/rewrite','POST',{action:'translate',language:targetLanguage(state),text:text.slice(0,4000)});translations.set(m.id,{text:r.text,language:targetLanguage(state)});}
  catch(error){translations.delete(m.id);throw error;}
  finally{rerender();}
}
export function translationHTML(m){
  const t=translations.get(m.id);if(!t)return '';
  if(t.loading)return '<div class="translation loading" aria-live="polite">Переводим…</div>';
  return `<div class="translation"><small>Перевод · ${esc(t.language)}</small><div>${esc(t.text)}</div><button type="button" class="chip" data-translate="${esc(m.id)}">Показать оригинал</button></div>`;
}

// ---------- Who read it ----------
const when=t=>{if(!t)return 'прочитано';const d=new Date(t),today=new Date().toDateString()===d.toDateString();return (today?'сегодня в ':d.toLocaleDateString('ru',{day:'numeric',month:'short'})+' в ')+d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});};
export async function readersDialog(m){
  const r=await api(`/messages/${encodeURIComponent(m.id)}/readers`);
  const unread=r.total-r.read.length-r.hidden;
  modal('Кто прочитал',`<div class="readers">${r.read.length?r.read.map(p=>`<div class="reader-row">${avatar(p.name,p.avatar)}<span><b>${esc(p.name)}</b><small>${esc(when(p.at))}</small></span></div>`).join(''):'<p class="muted">Пока никто не прочитал</p>'}
    <p class="muted">${[unread>0?`Не прочитали: ${unread}`:'',r.hidden?`Скрыли отметки о прочтении: ${r.hidden}`:''].filter(Boolean).join(' · ')||'Прочитали все участники'}</p></div>`);
}

// ---------- Quote of a fragment ----------
// While text inside one message is selected, a small «Цитировать» button floats above it.
export function setupQuoteSelection(box,{canQuote,onQuote}){
  let chip=null;
  const hide=()=>{chip?.remove();chip=null;};
  const update=()=>{
    const sel=getSelection?.();const text=String(sel||'').replace(/\s+/g,' ').trim();
    const node=sel?.anchorNode,article=node&&(node.nodeType===1?node:node.parentElement)?.closest?.('.message[data-id]');
    if(!text||!article||!box.contains(article)||!article.contains(sel.focusNode)||!canQuote(article.dataset.id)||!article.querySelector('.body')?.contains(node)){hide();return;}
    const rect=sel.getRangeAt(0).getBoundingClientRect();if(!rect.width&&!rect.height){hide();return;}
    if(!chip){chip=document.createElement('button');chip.type='button';chip.className='quote-chip';chip.textContent='❝ Цитировать';document.body.append(chip);
      chip.addEventListener('pointerdown',e=>e.preventDefault());}
    chip.style.left=Math.max(8,Math.min(innerWidth-130,rect.left+rect.width/2-60))+'px';chip.style.top=Math.max(8,rect.top-44)+'px';
    chip.onclick=()=>{const id=article.dataset.id;hide();getSelection()?.removeAllRanges();onQuote(id,text.slice(0,1000));};
  };
  const onChange=()=>requestAnimationFrame(update);
  document.addEventListener('selectionchange',onChange);box.addEventListener('scroll',hide,{passive:true});
  return ()=>{document.removeEventListener('selectionchange',onChange);hide();};
}
export function selectedQuote(article){
  const sel=getSelection?.();const text=String(sel||'').replace(/\s+/g,' ').trim();
  return text&&article?.querySelector('.body')?.contains(sel.anchorNode)?text.slice(0,1000):'';
}

// ---------- Voice waveform ----------
// 48 bars, each a letter a–v (22 levels): the loudness of that slice of the recording.
const BARS=48,LEVELS='abcdefghijklmnopqrstuv';
export async function waveformOf(blob){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
    const ctx=new (window.OfflineAudioContext||AC)(1,44100,44100);
    const audio=await ctx.decodeAudioData(await blob.arrayBuffer());
    const data=audio.getChannelData(0),step=Math.max(1,Math.floor(data.length/BARS)),peaks=[];
    for(let i=0;i<BARS;i++){let sum=0,n=0;for(let j=i*step;j<Math.min(data.length,(i+1)*step);j+=4){sum+=data[j]*data[j];n++;}peaks.push(Math.sqrt(sum/Math.max(1,n)));}
    const max=Math.max(...peaks,1e-4);
    return peaks.map(p=>LEVELS[Math.min(21,Math.round(Math.pow(p/max,.7)*21))]).join('');
  }catch{return null;}
}
const waves=new Map();
export function waveHTML(m){
  const wave=m.wave||waves.get(m.id);
  const bars=wave?[...wave].map(c=>3+LEVELS.indexOf(c)*1.1):Array.from({length:BARS},()=>4);
  return `<div class="waveform${wave?' real':' pending'}" data-wave="${esc(m.id)}" aria-hidden="true">${bars.map(h=>`<i style="height:${h.toFixed(1)}px"></i>`).join('')}</div>`;
}
// Older voice messages have no stored waveform: it is computed once from the audio after it loads.
export function bindWaves(box,messages){
  box.querySelectorAll('.waveform[data-wave]').forEach(el=>{
    const m=messages.find(x=>x.id===el.dataset.wave),audio=el.parentElement.querySelector('audio');if(!m||!audio)return;
    const paint=()=>{const p=audio.duration?audio.currentTime/audio.duration:0,bars=el.children,n=Math.round(p*bars.length);for(let i=0;i<bars.length;i++)bars[i].classList.toggle('played',i<n);};
    audio.addEventListener('timeupdate',paint);audio.addEventListener('ended',()=>{for(const b of el.children)b.classList.remove('played');});
    el.onclick=e=>{if(!audio.duration)return;const r=el.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*audio.duration;paint();};
    if(m.wave||waves.has(m.id)||el.dataset.loading)return;
    const load=async()=>{
      el.dataset.loading='1';const src=audio.currentSrc||audio.src;if(!src)return;
      const response=await fetch(src,{credentials:'same-origin'}).catch(()=>null);
      if(!response?.ok)return;const wave=await waveformOf(await response.blob());if(!wave)return;
      waves.set(m.id,wave);el.outerHTML=waveHTML(m);bindWaves(box,messages);
    };
    if(audio.src||audio.currentSrc)load();else audio.addEventListener('loadedmetadata',load,{once:true});
  });
}
export const quoteLabel=text=>`«${String(text).slice(0,160)}${String(text).length>160?'…':''}»`;
export function noteQuote(){toast('Цитата добавлена в ответ');}
