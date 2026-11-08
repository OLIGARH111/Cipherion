// The saved page keeps its cache name across versions, so an app updated to this code still opens
// at once from the page it saved before.
const SHELL='cipherion-shell-v2',ASSETS='cipherion-assets-v1',STATIC='cipherion-static-v1';
// Installing saves the whole app (page and files), so even the next start after the very first
// visit opens instantly and works offline.
self.addEventListener('install',event=>event.waitUntil(Promise.all([self.skipWaiting(),refreshShell({url:new URL('/',self.location.origin).href})])));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith('cipherion-shell-')&&n!==SHELL).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
const textOf=r=>{try{return r.clone().text().catch(()=>'');}catch{return Promise.resolve('');}};
const versionsIn=text=>new Set([...String(text).matchAll(/\/v\/([a-f0-9]{12})\//g)].map(m=>m[1]));
const assetsIn=text=>[...new Set([...String(text).matchAll(/(?:href|src)="(\/v\/[a-f0-9]{12}\/[\w.-]+\.(?:js|css))"/g)].map(m=>m[1]))];
const immutable=response=>response.ok&&response.type==='basic'&&/immutable/.test(response.headers?.get('Cache-Control')||'');
// Scripts and styles under /v/<version>/ never change, so a saved copy opens instantly with no
// network at all. Only files of the current and the previous page version are kept.
async function versionedAsset(request){
  const cache=await caches.open(ASSETS),hit=await cache.match(request);if(hit)return hit;
  const response=await fetch(request);
  if(immutable(response))cache.put(request,response.clone()).catch(()=>{});
  return response;
}
async function prune(previousPage,page){
  try{
    const keep=new Set([...versionsIn(previousPage),...versionsIn(page)]);if(!keep.size)return;
    const cache=await caches.open(ASSETS);
    for(const key of await cache.keys()){const v=new URL(key.url).pathname.match(/^\/v\/([a-f0-9]{12})\//);if(v&&!keep.has(v[1]))await cache.delete(key);}
  }catch{}
}
// Every file a page links is downloaded before that page is saved. So the saved page can always
// open from the cache alone, and an old page never runs with half of the new files.
async function precache(page){
  const cache=await caches.open(ASSETS);
  for(const path of assetsIn(page)){
    if(await cache.match(path))continue;
    const response=await fetch(path,{credentials:'same-origin'});
    if(!immutable(response))return false;
    await cache.put(path,response);
  }
  return true;
}
let checking=null;
// Checks the server for a newer page in the background. Returns true when a new version was saved.
function refreshShell(request){
  return checking||=(async()=>{
    try{
      const response=await fetch(request.url,{credentials:'same-origin',cache:'no-cache'});
      if(!response.ok||response.type!=='basic')return false;
      const cache=await caches.open(SHELL),saved=await cache.match('/');
      const [before,after]=await Promise.all([saved?textOf(saved):'',textOf(response)]);
      if(before===after||!await precache(after))return false;
      await cache.put('/',response);
      prune(before,after);
      return !!before;
    }catch{return false;}
  })().finally(()=>{checking=null;});
}
async function announceUpdate(){
  for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'app-updated'});
}
// The app page opens from the cache at once, the way a native app starts: no waiting for the
// server, which may be far away, slow, or still waking up. The newest version is fetched in the
// background and used from the next start; an open app is told so it can switch quietly.
// Each handler returns the response and the background work separately, so waitUntil is called
// while the event is still being dispatched (Safari requires that).
function appPage(request){
  let background;
  const response=(async()=>{
    const cache=await caches.open(SHELL),saved=await cache.match('/');
    if(saved){background=refreshShell(request).then(updated=>updated&&announceUpdate());return saved;}
    // First start: the network decides, and the page is saved together with its files.
    try{
      const response=await fetch(request);
      if(response.ok&&response.type==='basic'){const copy=response.clone();background=textOf(copy).then(text=>precache(text).then(ok=>ok&&cache.put('/',copy))).catch(()=>{});}
      return response;
    }catch{return await cache.match('/')||Response.error();}
  })();
  return {response,background:response.then(()=>background,()=>{})};
}
// Icons with a hash in the name and bundled sticker art never change in place: show the saved
// copy at once and refresh it quietly.
function staticAsset(request){
  const update=caches.open(STATIC).then(cache=>fetch(request).then(response=>{if(response.ok&&response.type==='basic')cache.put(request,response.clone()).catch(()=>{});return response;}));
  const response=caches.open(STATIC).then(cache=>cache.match(request)).then(hit=>hit||update);
  return {response,background:update.catch(()=>{})};
}
const respond=(event,{response,background})=>{event.respondWith(response);event.waitUntil(background);};
// API calls and media never pass through these caches: they carry private, per-account data.
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/sw.js')return;
  if(/^\/v\/[a-f0-9]{12}\//.test(url.pathname)){event.respondWith(versionedAsset(request));return;}
  if(request.mode==='navigate'&&url.pathname==='/'){respond(event,appPage(request));return;}
  if(/^\/(brand\/icon-\d+-[a-f0-9]+\.(png|webp)|stickers(-v\d+)?\/)/.test(url.pathname)){respond(event,staticAsset(request));return;}
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL);
    try{
      const response=await fetch(request);
      if(response.ok&&response.type==='basic')cache.put(request,response.clone()).catch(()=>{});
      return response.status>=500?await cache.match(request)||response:response;
    }catch{return await cache.match(request)||Response.error();}
  })());
});
self.addEventListener('message',event=>{
  // The page asks for a check when it comes back to the screen after a while.
  if(event.data?.type==='check-update')event.waitUntil(refreshShell({url:new URL('/',self.location.origin).href}).then(updated=>updated&&announceUpdate()));
});
// Incoming calls ring like a phone call even when Cipherion is closed: a long vibration, buttons to
// answer or decline, and the notification is replaced when the call ends («Пропущенный звонок»).
const RING=[600,300,600,300,600,300,600,300,600];
self.addEventListener('push',event=>{event.waitUntil((async()=>{
  let p={};try{p=event.data?.json()||{};}catch{}
  const call=p.type==='calls',expired=call&&p.expiresAt<=Date.now(),ended=p.type==='call-end';
  if(ended)for(const n of await self.registration.getNotifications({tag:p.tag}))n.close();
  // Every push must display a notification (including an already expired call).
  await self.registration.showNotification(p.title||'Cipherion',{
    body:expired?'Пропущенный звонок':p.body||'У вас новое сообщение',
    icon:'/brand/icon-192-1f66c49421df.png',badge:'/brand/icon-192-1f66c49421df.png',
    tag:p.tag||'cipherion',renotify:call&&!expired,silent:!!p.silent,...(!p.silent?{vibrate:call&&!expired?RING:p.vibrate||[]}:{}),
    requireInteraction:call&&!expired,
    ...(call&&!expired?{actions:[{action:'answer',title:'Ответить'},{action:'decline',title:'Отклонить'}]}:{}),
    data:{url:p.url||'/',account:p.account,call:p.call,expiresAt:p.expiresAt,kind:p.type}
  });
  // The call was answered on another device: the notice only replaces the ringing one.
  if(p.quiet)setTimeout(()=>self.registration.getNotifications({tag:p.tag}).then(list=>list.forEach(n=>n.close())),3000);
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
  const data=event.notification.data||{};
  // Declining needs no window: the service worker tells the server directly.
  if(event.action==='decline'&&data.call){
    await fetch('/api/call-action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(data.account?{'X-Cipherion-Account':data.account}:{})},body:JSON.stringify({id:data.call,action:'reject'})}).catch(()=>{});
    return;
  }
  const url=new URL(data.url||'/',self.location.origin);if(url.origin!==self.location.origin)return;
  if(event.action==='answer'&&data.call)url.hash+=(url.hash?'&':'#')+'answer=1';
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(new URL(client.url).origin===url.origin){
    // Navigating a live window destroys its microphone and peer connections.
    await client.focus();client.postMessage({type:'notification-open',...data,url:url.href});return;
  }}
  await self.clients.openWindow(url.href);
})());});
