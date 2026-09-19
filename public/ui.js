export const $ = (q, root = document) => root.querySelector(q);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const paths = {
 ai:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM4 12h16M12 3c-6 5-6 13 0 18 6-5 6-13 0-18',edit:'m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4',
 chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 9h9M7 13h6',
 people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
 phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3l2 5-2 2a16 16 0 0 0 6 6l2-2Z',
 video:'m16 8 6-4v16l-6-4M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 2h6l1 3 3 1 3 4-2 3 1 3-4 4-3-1-3 2-4-3v-3l-3-2 1-5 3-1Z',
 channel:'m3 10 17-7v18L3 14v-4ZM7 15v6h4v-5',
 search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
 plus:'M12 5v14M5 12h14', arrow:'m5 12 14 0m-6-6 6 6-6 6', back:'m15 5-7 7 7 7', close:'m6 6 12 12M6 18 18 6',
 send:'m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2', mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
 emoji:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1 3 4 3 4-3 4-3M8 8h.01M16 8h.01',
 image:'M3 3h18v18H3V3Zm0 13 5-5 5 5 3-3 5 5M15 7h.01', file:'M14 2H4v20h16V8l-6-6Zm0 0v6h6', poll:'M5 20V10M12 20V4M19 20v-7',
 more:'M5 12h.01M12 12h.01M19 12h.01', check:'m4 12 5 5L20 6', shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6',
 screen:'M2 3h20v14H2V3ZM12 17v5M7 22h10', lock:'M5 10h14v12H5V10Zm3 0V6a4 4 0 0 1 8 0v4', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
 palette:'M12 2a10 10 0 1 0 0 20h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h6a3 3 0 0 0 3-3 10 10 0 0 0-10-9ZM7 8h.01M12 6h.01M17 8h.01',
 logout:'M9 3H3v18h6M9 12h13m-5-5 5 5-5 5', download:'M12 2v13m-5-5 5 5 5-5M3 17v5h18v-5', stop:'M5 5h14v14H5Z', pin:'m16 3 5 5-5 2-2 6-6-6 6-2 2-5ZM10 14l-7 7', moon:'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z'
};
export const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name] || paths.chat).split('~').map(d=>`<path d="${d}"/>`).join('')}</svg>`;
export const button = (name, title, attrs = '') => `<button class="icon-button" title="${esc(title)}" aria-label="${esc(title)}" ${attrs}>${icon(name)}</button>`;
export const avatar = (name, media, cls = '') => `<span class="avatar ${cls}">${media ? `<img src="/api/media/${encodeURIComponent(media)}" alt="">` : esc((name || '?').slice(0, 2).toUpperCase())}</span>`;
export const time = t => new Date(t).toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'});
export function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),4500); }
export async function api(path, method='GET', data) {
  const response=await fetch('/api'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Ошибка запроса');return result;
}
export async function upload(file) {
  const limit=(await api('/vip')).uploadMB;if(file.size>limit*1024*1024)throw new Error(`Максимальный размер файла — ${limit} МБ`);
  const response=await fetch('/api/media',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
  const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
export function modal(title, content, wide=false) {
  const el=$('#modal');el.classList.toggle('wide',wide);el.innerHTML=`<header><div><span class="eyebrow">CIPHERION</span><h2>${esc(title)}</h2></div>${button('close','Закрыть','id="modal-close"')}</header><div class="modal-body">${content}</div>`;
  $('#modal-close').onclick=()=>el.close();if(!el.open)el.showModal();return el;
}
export function guard(fn) { return async (...args)=>{try{await fn(...args);}catch(error){toast(error.message);}}; }
