self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
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
