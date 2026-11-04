import {activeAccount,accountFetch,accountURL,accountEpoch} from './account-context.js';
import {vipBadgeValue,vipBadgeText,isCustomBadge} from './vip-badges.js';
// Adaptive emoji: any sticker drawn as a one-colour shape (with its inner details kept) in the current text colour.
export function adaptiveEmoji(id,extra=''){const src=accountURL('/api/stickers/'+encodeURIComponent(id)+'/file?poster=1');return `<span class="adaptive-emoji ${extra}" role="img" aria-label="Адаптивный эмодзи" style="--ae:url('${esc(src)}')"></span>`;}
// Blue check for official and verified accounts, shown before the VIP mark.
export function verifiedBadge(user){if(user?.verified!==true)return '';const label=user.official?'Официальный аккаунт Cipherion':'Подтверждённый аккаунт';return `<span class="verified-badge" title="${label}" aria-label="${label}" role="img"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="vb-seal" d="M12 1.6l2.6 1.9 3.2-.1 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.1L12 22.4l-2.6-1.9-3.2.1-1-3.1-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3.1 3.2.1z"/><path class="vb-tick" d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;}
export function vipBadge(user){return verifiedBadge(user)+vipOnly(user);}
function vipOnly(user){if(user?.vip!==true)return '';const value=vipBadgeValue(user.vipBadge||user.profile?.badge);const custom=isCustomBadge(value),id=custom?value.slice(4,-1):'';const content=!custom?esc(vipBadgeText(value)):value.startsWith(':ae[')?adaptiveEmoji(id,'badge-emoji'):`<img class="custom-emoji badge-emoji" src="${esc(accountURL('/api/stickers/'+id+'/file?poster=1'))}" data-motion="${esc(accountURL('/api/stickers/'+id+'/file'))}" data-poster="${esc(accountURL('/api/stickers/'+id+'/file?poster=1'))}" alt="">`;return `<span class="vip-mark vip-badge${value==='✦'?' vip-text':''}${custom?' vip-custom':''}" title="Cipherion VIP" aria-label="Cipherion VIP">${content}</span>`;}
export const $ = (q, root = document) => root.querySelector(q);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
 folder:'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z', quote:'M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6', eye:'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z~M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', headphones:'M4 15v-3a8 8 0 0 1 16 0v3~M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3ZM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z',
 location:'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z~M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', qr:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M17 20h4v-3M14 20h.01', key:'M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM12 11v10M12 17h3M12 20h2', bot:'M12 3v3M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM9 13h.01M15 13h.01M9.5 16.5h5', timer:'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', checklist:'M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17', comment:'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z', topics:'M4 5h16M4 12h16M4 19h10', export:'M12 3v12M7 8l5-5 5 5M5 21h14', at:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1', bold:'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z', italic:'M19 4h-9M14 20H5M15 4 9 20', strike:'M4 12h16M16 6.5A4 3 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 3 8 2.5 8 6 0 1.9-1.8 3-4 3a4.5 3.2 0 0 1-4.5-2', code:'m8 7-5 5 5 5M16 7l5 5-5 5', spoiler:'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 10 7a14 14 0 0 1-3.2 3.9M6.1 6.1C3.9 7.5 2.6 9.6 2 12c1 2 5 7 10 7a9.7 9.7 0 0 0 4.2-.9',
 speakeroff:'M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6', mobile:'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2', tablet:'M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2',
 ai:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM4 12h16M12 3c-6 5-6 13 0 18 6-5 6-13 0-18',edit:'m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4',
 bookmark:'M6 3.5h12V21l-6-4.2L6 21V3.5Z',link:'M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6~M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',eraser:'M8 20h12~M4.6 15.4 14 6l5 5-8.6 8.6a1.4 1.4 0 0 1-2 0l-3.8-3.8a1 1 0 0 1 0-1.4Z~M9.5 10.5l5 5',
 chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 9h9M7 13h6',
 people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
 phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3l2 5-2 2a16 16 0 0 0 6 6l2-2Z',
 video:'m16 8 6-4v16l-6-4M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
 settings:'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915~M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4',
 channel:'m3 10 17-7v18L3 14v-4ZM7 15v6h4v-5',
 search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
 plus:'M12 5v14M5 12h14', arrow:'m5 12 14 0m-6-6 6 6-6 6', back:'m15 5-7 7 7 7', close:'m6 6 12 12M6 18 18 6',
 send:'m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2', round:'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z', mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8', micoff:'M2 2l20 20~M18.89 13.23A7.12 7.12 0 0 0 19 12v-2~M5 10v2a7 7 0 0 0 12 5~M15 9.34V6a3 3 0 0 0-5.68-1.33~M9 9v3a3 3 0 0 0 5.12 2.12~M12 19v3M8 22h8', videooff:'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.25-3.06A.5.5 0 0 1 22 7.87v8.2~M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2~M2 2l20 20', flip:'M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5~M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5~M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z~m18 22-3-3 3-3~m6 2 3 3-3 3',
 emoji:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01',
 image:'M3 3h18v18H3V3Zm0 13 5-5 5 5 3-3 5 5M15 7h.01', file:'M14 2H4v20h16V8l-6-6Zm0 0v6h6', poll:'M5 20V10M12 20V4M19 20v-7',
 more:'M5 12h.01M12 12h.01M19 12h.01', check:'m4 12 5 5L20 6', shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
 screen:'M2 3h20v14H2V3ZM12 17v5M7 22h10', lock:'M5 10h14v12H5V10Zm3 0V6a4 4 0 0 1 8 0v4', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
 palette:'M12 2a10 10 0 1 0 0 20h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h6a3 3 0 0 0 3-3 10 10 0 0 0-10-9ZM7 8h.01M12 6h.01M17 8h.01',
 logout:'M9 3H3v18h6M9 12h13m-5-5 5 5-5 5', download:'M12 2v13m-5-5 5 5 5-5M3 17v5h18v-5', stop:'M5 5h14v14H5Z', pin:'m16 3 5 5-5 2-2 6-6-6 6-2 2-5ZM10 14l-7 7', moon:'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z',
 menu:'M4 6h16M4 12h16M4 18h16', kebab:'M12 5h.01M12 12h.01M12 19h.01',
 attach:'m16 6-8.41 8.59a2 2 0 0 0 2.83 2.83l8.41-8.59a4 4 0 0 0-5.66-5.66l-8.38 8.55a6 6 0 0 0 8.49 8.49l8.38-8.55',
 reply:'M20 18v-2a4 4 0 0 0-4-4H4M9 17l-5-5 5-5', forward:'m15 17 5-5-5-5M4 18v-2a4 4 0 0 1 4-4h12',
 copy:'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z~M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
 trash:'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
 select:'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3', archive:'M3 3h18v5H3ZM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4',
 mute:'M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20',
 down:'m6 9 6 6 6-6', up:'m18 15-6-6-6 6', chevron:'m9 18 6-6-6-6', arrowdown:'M12 5v14M19 12l-7 7-7-7',
 sun:'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
 user:'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
 language:'m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6',
 database:'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3ZM3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3',
 star:'m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z',
 info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
 heart:'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
 history:'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2', group:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
 missed:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3l2 5-2 2a16 16 0 0 0 6 6l2-2ZM16 2l6 6M22 2l-6 6'
};
export const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name] || paths.chat).split('~').map(d=>`<path d="${d}"/>`).join('')}</svg>`;
export const button = (name, title, attrs = '') => `<button class="icon-button" title="${esc(title)}" aria-label="${esc(title)}" ${attrs}>${icon(name)}</button>`;
// Letters on a coloured gradient when there is no photo; the colour is stable per name.
export const initials = name => { const words = String(name || '?').trim().split(/\s+/).filter(Boolean); const first = w => Array.from(w || '')[0] || ''; return ((first(words[0]) || '?') + (words.length > 1 ? first(words[1]) : '')).toUpperCase(); };
export const tone = name => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % 7; };
export const avatar = (name, media, cls = '') => `<span class="avatar ${cls}" data-tone="${tone(name)}">${media ? `<img src="${accountURL('/api/media/'+encodeURIComponent(media))}" alt="">` : esc(initials(name))}</span>`;
// Creating a date formatter is slow (it loads locale data each time) and a chat shows dozens of
// times, so each format is made once and reused. The output is the same as toLocale*String.
const formats = new Map();
export function formatDate(t, options) {
  const key = JSON.stringify(options);
  let format = formats.get(key);
  if (!format) formats.set(key, format = new Intl.DateTimeFormat('ru', options));
  return format.format(new Date(t));
}
export const time = t => formatDate(t, {hour:'2-digit',minute:'2-digit'});
export function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),4500); }
// A response filter (end-to-end decryption) sees every JSON result before callers do.
let responseFilter=null;
export function setResponseFilter(fn){responseFilter=fn;}
// Render sometimes restarts the server, and for those seconds its proxy answers with an HTML error page
// or drops the connection. Reads are safe to repeat, so they are retried quietly for about 25 seconds
// before an error is shown. Errors written by the app itself (JSON with a message) are never retried.
const RETRY_DELAYS=[700,1500,2500,4000,6000,10000];
const wait=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Отменено','AbortError'));},{once:true});});
async function requestOnce(url,options,account){
  let response;
  try{response=await accountFetch(url,options,account);}catch(error){if(error.name==='AbortError')throw error;throw Object.assign(new Error('Нет соединения с сервером. Проверьте интернет и повторите попытку.'),{transient:true});}
  let result;try{result=await response.json();}catch{throw Object.assign(new Error('Сервер временно недоступен. Попробуйте позже.'),{status:response.status>=400?response.status:502,transient:true});}
  if(!response.ok){const message=typeof result?.error==='string'?result.error:'';throw Object.assign(new Error(message||'Не удалось выполнить действие. Попробуйте позже.'),{status:response.status,need:typeof result?.need==='string'?result.need:undefined,transient:!message&&[502,503,504].includes(response.status)});}
  return result;
}
async function requestJSON(url,options,account=activeAccount()) {
  const ticket=accountEpoch(),read=['GET','HEAD'].includes((options?.method||'GET').toUpperCase());
  let result;
  for(let attempt=0;;attempt++){
    try{result=await requestOnce(url,options,account);break;}
    catch(error){
      if(!read||!error.transient||attempt>=RETRY_DELAYS.length||ticket!==accountEpoch())throw error;
      await wait(RETRY_DELAYS[attempt],options?.signal);
      if(ticket!==accountEpoch())throw new DOMException('Аккаунт переключён','AbortError');
    }
  }
  if(responseFilter)result=await responseFilter(result,account);
  if(ticket!==accountEpoch())throw new DOMException('Аккаунт переключён','AbortError');return result;
}
export async function api(path, method='GET', data, signal, account=activeAccount()) {
  return requestJSON('/api'+path,{method,signal,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)},account);
}
export async function upload(file,account=activeAccount()) {
  const limit=(await api('/vip','GET',undefined,undefined,account)).uploadMB;if(file.size>limit*1024*1024)throw new Error(`Максимальный размер файла — ${limit} МБ`);
  return requestJSON('/api/media',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file},account);
}
export function modal(title, content, wide=false) {
  const el=$('#modal');el.classList.toggle('wide',wide);el.innerHTML=`<header><div><span class="eyebrow">CIPHERION</span><h2>${esc(title)}</h2></div>${button('close','Закрыть','id="modal-close"')}</header><div class="modal-body">${content}</div>`;
  $('#modal-close').onclick=()=>el.close();el.onclick=e=>{if(e.target===el){const r=el.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)el.close();}};if(!el.open)el.showModal();el.scrollTop=0;return el;
}
// Profile, group info and settings sections open as a side sheet (full screen on phones).
export async function asSheet(fn) { const dialog=$('#modal');dialog.classList.add('sheet');dialog.addEventListener('close',()=>dialog.classList.remove('sheet'),{once:true});try{await fn();}finally{if(!dialog.open)dialog.classList.remove('sheet');} }
export function guard(fn) { const ticket=accountEpoch();return async (...args)=>{if(ticket!==accountEpoch())return;try{await fn(...args);}catch(error){if(ticket===accountEpoch()&&error.name!=='AbortError')toast(error.message);}}; }








// Explicit shared save contract: duplicate protection, retained form on error,
// and close only after the operation and local-state update have succeeded.
export function saveAction(fn) {
 let pending=false;const boundEpoch=accountEpoch();
 return async function(event,...args) {
  event?.preventDefault?.();if(pending||boundEpoch!==accountEpoch())return;pending=true;
  const ticket=accountEpoch();const source=event?.currentTarget,dialog=source?.closest?.('dialog')||$('#modal');
  const controls=source?.tagName==='FORM'?[...source.querySelectorAll('button[type="submit"],button:not([type])')]:source?[source]:[];
  const old=controls.map(c=>c.disabled);controls.forEach(c=>{c.disabled=true;c.setAttribute('aria-busy','true');});
  const errorBox=dialog?.querySelector('[data-save-error]');errorBox?.remove();
  try{await fn(event,...args);if(ticket===accountEpoch()&&dialog?.open)dialog.close();}
  catch(error){if(ticket!==accountEpoch()||error.name==='AbortError')return;if(dialog?.open){const box=document.createElement('p');box.dataset.saveError='';box.setAttribute('role','alert');box.textContent=error.message;dialog.querySelector('.modal-body')?.append(box);}toast(error.message);}
  finally{pending=false;controls.forEach((c,i)=>{c.disabled=old[i];c.removeAttribute('aria-busy');});}
 };
}
function plural(n,forms){const a=n%10,b=n%100;return forms[b>=11&&b<=14?2:a===1?0:a>=2&&a<=4?1:2];}
// «в сети» / «был(а) 5 минут назад»; without lastSeen (hidden by privacy) falls back to «был(а) недавно».
export function lastSeenText(user,at=Date.now()){if(user?.online)return 'в сети';const seen=Number(user?.lastSeen);if(!seen)return 'был(а) недавно';const minutes=Math.max(0,Math.floor((at-seen)/60000));if(minutes<1)return 'был(а) только что';if(minutes<60)return `был(а) ${minutes} ${plural(minutes,['минуту','минуты','минут'])} назад`;const hours=Math.floor(minutes/60);if(hours<24)return `был(а) ${hours} ${plural(hours,['час','часа','часов'])} назад`;const days=Math.floor(hours/24);return `был(а) ${days} ${plural(days,['день','дня','дней'])} назад`;}
export function peopleCount(n,channel=false){const forms=channel?['подписчик','подписчика','подписчиков']:['участник','участника','участников'];const a=n%10,b=n%100;return `${n} ${forms[b>=11&&b<=14?2:a===1?0:a>=2&&a<=4?1:2]}`;}
// Lost legacy uploads remain a recoverable UI state, not a broken image.
if(typeof document!=='undefined')document.addEventListener('error',event=>{const el=event.target;if(!el?.matches?.('img,video,audio')||!el.getAttribute('src')?.startsWith('/api/media/'))return;if(el.parentElement?.classList.contains('avatar')){el.replaceWith(document.createTextNode('?'));return;}const placeholder=document.createElement('span');placeholder.className='media-unavailable';placeholder.textContent='Медиа недоступно';el.replaceWith(placeholder);},true);
