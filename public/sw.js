self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{event.waitUntil((async()=>{
  let p={};try{p=event.data?.json()||{};}catch{}
  await self.registration.showNotification(p.title||'Cipherion',{body:p.body||'У вас новое сообщение',icon:'/brand/icon-192-99e4c7990351.png',badge:'/brand/icon-192-99e4c7990351.png',tag:p.tag||'cipherion',silent:!!p.silent,...(!p.silent?{vibrate:p.vibrate||[]}:{}),data:{url:p.url||'/',account:p.account}});
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
  const url=new URL(event.notification.data?.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===url.origin){await client.navigate(url.href);await client.focus();return;}}
  await self.clients.openWindow(url.href);
})());});
