// Link preview cards. The preview is assembled by the Cipherion server, and its image is
// served through the server as well: the browser never contacts the linked site.
import {api,esc} from './ui.js';
import {accountURL} from './account-context.js';

const cache=new Map(),loading=new Map();
let redraw=()=>{},timer;
export function onPreviewsReady(fn){redraw=fn;}
const scheduleRedraw=()=>{clearTimeout(timer);timer=setTimeout(()=>redraw(),60);};

function load(url){
  if(cache.has(url)||loading.has(url))return;
  loading.set(url,api('/link-preview?url='+encodeURIComponent(url)).then(r=>{cache.set(url,r.preview||null);if(cache.size>300)cache.delete(cache.keys().next().value);scheduleRedraw();}).catch(()=>cache.set(url,null)).finally(()=>loading.delete(url)));
}
// HTML for a message's first link: a full card when known, nothing while it loads.
export function linkCard(url){
  if(!url)return '';
  if(!cache.has(url)){load(url);return '';}
  const p=cache.get(url);if(!p)return '';
  const image=p.image?`<img class="link-card-image" src="${esc(accountURL(p.image))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'';
  return `<a class="link-card${p.large&&p.image?' large':''}" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow"><span class="link-card-text"><b class="link-card-site">${esc(p.site||'')}</b>${p.title?`<strong>${esc(p.title)}</strong>`:''}${p.description?`<span>${esc(p.description)}</span>`:''}</span>${image}</a>`;
}
