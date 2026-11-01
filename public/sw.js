const SHELL='cipherion-shell-v2',ASSETS='cipherion-assets-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith('cipherion-shell-')&&n!==SHELL).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
const textOf=r=>{try{return r.clone().text().catch(()=>'');}catch{return Promise.resolve('');}};
const versionsIn=text=>new Set([...String(text).matchAll(/\/v\/([a-f0-9]{12})\//g)].map(m=>m[1]));
// Scripts and styles under /v/<version>/ never change, so a saved copy opens instantly with no
// network at all. Only files of the current and the previous page version are kept.
async function versionedAsset(request){
  const cache=await caches.open(ASSETS),hit=await cache.match(request);if(hit)return hit;
  const response=await fetch(request);
  if(response.ok&&response.type==='basic'&&/immutable/.test(response.headers?.get('Cache-Control')||''))cache.put(request,response.clone()).catch(()=>{});
  return response;
}
async function prune(previousPage,page){
  try{
    const keep=new Set([...versionsIn(previousPage),...versionsIn(page)]);if(!keep.size)return;
    const cache=await caches.open(ASSETS);
    for(const key of await cache.keys()){const v=new URL(key.url).pathname.match(/^\/v\/([a-f0-9]{12})\//);if(v&&!keep.has(v[1]))await cache.delete(key);}
  }catch{}
}
// The page itself: network first, so a deploy arrives at once. When the network is slow or down,
// the saved page opens instead; it links its own versioned files, so old and new code never mix.
// API calls and media never pass through these caches: they carry private, per-account data.
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/sw.js')return;
  if(/^\/v\/[a-f0-9]{12}\//.test(url.pathname)){event.respondWith(versionedAsset(request));return;}
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL);
    const page=request.mode==='navigate'&&url.pathname==='/',key=page?'/':request;
    const saved=page?await cache.match(key):undefined,savedText=saved?textOf(saved):null;
    const network=fetch(request).then(response=>{
      if(response.ok&&response.type==='basic'){
        cache.put(key,response.clone()).catch(()=>{});
        if(savedText)Promise.all([savedText,textOf(response)]).then(([a,b])=>prune(a,b)).catch(()=>{});
      }
      return response;
    });
    const fallback=async()=>saved||await cache.match(key)||Response.error();
    const result=network.then(r=>r.status>=500?cache.match(key).then(c=>c||r):r,fallback);
    if(!saved)return result;
    // A saved page exists: wait for the network briefly, then open the saved copy.
    return Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve(saved),2500))]);
  })());
});
self.addEventListener('push',event=>{event.waitUntil((async()=>{
  let p={};try{p=event.data?.json()||{};}catch{}
  const call=p.type==='calls',expired=call&&p.expiresAt<=Date.now();
  // Every push must display a notification (including an already expired call).
  await self.registration.showNotification(p.title||'Cipherion',{
    body:expired?'Пропущенный звонок':p.body||'У вас новое сообщение',
    icon:'/brand/icon-192-99e4c7990351.png',badge:'/brand/icon-192-99e4c7990351.png',
    tag:p.tag||'cipherion',silent:!!p.silent,...(!p.silent?{vibrate:p.vibrate||[]}:{}),
    requireInteraction:call&&!expired,
    ...(call?{actions:[{action:'open',title:expired?'Открыть':'Открыть звонок'}]}:{}),
    data:{url:p.url||'/',account:p.account,call:p.call,expiresAt:p.expiresAt}
  });
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
  const data=event.notification.data||{};
  const url=new URL(data.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===url.origin){
    // Navigating a live window destroys its microphone and peer connections.
    await client.focus();client.postMessage({type:'notification-open',...data,url:url.href});return;
  }}
  await self.clients.openWindow(url.href);
})());});
