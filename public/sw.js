const SHELL='cipherion-shell-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith('cipherion-shell-')&&n!==SHELL).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
// App files: always ask the network first (a 304 via the HTTP cache is cheap), so a deploy is never
// half-applied. The copy kept here opens the app when offline or when the server is unavailable.
// API calls and media never pass through this cache: they carry private, per-account data.
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/android/')||url.pathname==='/sw.js')return;
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL);
    const key=request.mode==='navigate'&&url.pathname==='/'?'/':request;
    const network=fetch(request).then(response=>{
      if(response.ok&&response.type==='basic')cache.put(key,response.clone()).catch(()=>{});
      return response;
    });
    // Offline or server down: open the saved copy. No race against a slow network, which could mix
    // old and new modules right after a deploy.
    const fallback=async()=>await cache.match(key)||Response.error();
    return network.then(r=>r.status>=500?cache.match(key).then(c=>c||r):r,fallback);
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
