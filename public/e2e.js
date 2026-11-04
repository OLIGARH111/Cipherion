// End-to-end encryption of message text.
//
// Every browser profile signed into an account is a separate device with its own
// P-256 key pairs: ECDH for receiving and ECDSA for signing. Private keys are created
// non-extractable and never leave IndexedDB on this device; the server only stores
// the public halves. A message is encrypted once with a random AES-256-GCM key, and
// that key is wrapped for each device of every chat member through ECDH with a fresh
// ephemeral key, then the whole envelope is signed by the sending device.
import {api,esc,modal,setResponseFilter} from './ui.js';

const enc=new TextEncoder(),dec=new TextDecoder();
const subtle=globalThis.crypto?.subtle;
const b64=buffer=>{const bytes=new Uint8Array(buffer);let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);};
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const ECDH={name:'ECDH',namedCurve:'P-256'},ECDSA={name:'ECDSA',namedCurve:'P-256'},SIGN={name:'ECDSA',hash:'SHA-256'};
export const notices={locked:'🔒 Сообщение зашифровано для другого устройства. Перенесите историю: Настройки → Устройства → Перенос истории',broken:'⚠️ Не удалось расшифровать или проверить сообщение'};

let connection;
function database(){return connection||=new Promise((resolve,reject)=>{const r=indexedDB.open('cipherion-e2e',2);r.onupgradeneeded=()=>{const db=r.result,has=name=>!!db.objectStoreNames?.contains?.(name);if(!has('devices'))db.createObjectStore('devices',{keyPath:'user'});if(!has('history'))db.createObjectStore('history',{keyPath:'user'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=null;reject(r.error);};});}
async function store(mode,action,name='devices'){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode);const r=action(tx.objectStore(name));tx.oncomplete=()=>resolve(r?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}

const devices=new Map();
// Loads or creates this device's keys for an account and binds them to the current session.
export function ensureDevice(user){
  if(!user||!subtle||!globalThis.indexedDB)return Promise.resolve(null);
  if(!devices.has(user))devices.set(user,(async()=>{
    let record=await store('readonly',s=>s.get(user));
    if(!record){
      const [ecdh,ecdsa]=await Promise.all([subtle.generateKey(ECDH,false,['deriveBits']),subtle.generateKey(ECDSA,false,['sign','verify'])]);
      record={user,ecdh,ecdsa,ecdhRaw:b64(await subtle.exportKey('raw',ecdh.publicKey)),ecdsaRaw:b64(await subtle.exportKey('raw',ecdsa.publicKey))};
      await store('readwrite',s=>s.put(record));
    }
    const {id}=await api('/e2e/devices','POST',{ecdh:record.ecdhRaw,ecdsa:record.ecdsaRaw},undefined,user);
    if(record.id!==id){record={...record,id};await store('readwrite',s=>s.put(record));}
    return record;
  })().catch(error=>{devices.delete(user);throw error;}));
  return devices.get(user);
}
const device=user=>ensureDevice(user).catch(()=>null);

const directory=new Map();
const loading=new Map();
function chatKeys(user,chat){
  const key=user+':'+chat,hit=directory.get(key);
  if(hit&&hit.at>Date.now()-15000)return Promise.resolve(hit.value);
  if(!loading.has(key))loading.set(key,api('/e2e/keys?chat='+encodeURIComponent(chat),'GET',undefined,undefined,user)
    .then(value=>{directory.set(key,{at:Date.now(),value});return value;}).finally(()=>loading.delete(key)));
  return loading.get(key);
}
// Called when a chat opens and while typing, so pressing Send never waits for the key list.
export function warmKeys(user,chat){
  if(!user||!chat)return;const hit=directory.get(user+':'+chat);
  if(!hit||hit.at<=Date.now()-10000)chatKeys(user,chat).catch(()=>{});
}
const senders=new Map();
function senderKey(user,id){if(!senders.has(id))senders.set(id,api('/e2e/devices/'+id,'GET',undefined,undefined,user).catch(error=>{senders.delete(id);throw error;}));return senders.get(id);}

const signed=(chat,e)=>enc.encode(JSON.stringify(['cipherion-e2e-v1',chat,e.from,e.eph,e.iv,e.ct,e.keys]));
async function wrappingKey(privateKey,publicRaw,chat,deviceId){
  const peer=await subtle.importKey('raw',unb64(publicRaw),ECDH,false,[]);
  const bits=await subtle.deriveBits({name:'ECDH',public:peer},privateKey,256);
  const base=await subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:enc.encode('cipherion-wrap-v1|'+chat+'|'+deviceId)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

// Encrypts message text for every device in the chat. Returns null when the chat
// cannot be end-to-end encrypted (a channel, a family-filtered chat, or a member
// who has not opened an app version with encryption yet).
export async function seal(user,chat,body,file=null,extra=null){
  const me=await device(user);if(!me?.id)return null;
  const keys=await chatKeys(user,chat);if(!keys.enabled)return null;
  const targets=keys.devices.some(d=>d.id===me.id)?keys.devices:[...keys.devices,{id:me.id,user,ecdh:me.ecdhRaw}];
  if(keys.users.some(u=>!targets.some(d=>d.user===u)))return null;
  const raw=random(32),iv=random(12);
  const content=await subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const ct=await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-e2e-v1|'+chat)},content,enc.encode(JSON.stringify({...(extra||{}),b:String(body),t:Date.now(),...(file?{f:file}:{})})));
  const eph=await subtle.generateKey(ECDH,true,['deriveBits']);
  const wrapped=await Promise.all(targets.map(async d=>{const wiv=random(12);const k=await subtle.encrypt({name:'AES-GCM',iv:wiv},await wrappingKey(eph.privateKey,d.ecdh,chat,d.id),raw);return {d:d.id,iv:b64(wiv),k:b64(k)};}));
  const envelope={v:1,from:me.id,eph:b64(await subtle.exportKey('raw',eph.publicKey)),iv:b64(iv),ct:b64(ct),keys:wrapped};
  envelope.sig=b64(await subtle.sign(SIGN,me.ecdsa.privateKey,signed(chat,envelope)));
  return envelope;
}
// Whether a message to this chat would be end-to-end encrypted right now (same rules as seal).
export async function canSeal(user,chat){
  const me=await device(user);if(!me?.id)return false;
  const keys=await chatKeys(user,chat).catch(()=>null);if(!keys?.enabled)return false;
  const targets=keys.devices.some(d=>d.id===me.id)?keys.devices:[...keys.devices,{user}];
  return !keys.users.some(u=>!targets.some(d=>d.user===u));
}
// Custom emoji travel next to the ciphertext so the server can still authorise their files.
export const emojiKeys=text=>[...new Set([...String(text).matchAll(/:ce\[([a-zA-Z0-9-]+)\]/g)].map(m=>m[1]))];

const opened=new Map();
async function decrypt(user,m){
  const e=JSON.parse(m.e2e),me=await device(user);
  const sender=await senderKey(user,e.from);
  if(sender.user!==m.user_id)throw new Error('foreign device');
  const verifyKey=await subtle.importKey('raw',unb64(sender.ecdsa),ECDSA,false,['verify']);
  if(!await subtle.verify(SIGN,verifyKey,unb64(e.sig),signed(m.chat_id,e)))throw new Error('bad signature');
  const slot=me?.id&&e.keys.find(k=>k.d===me.id);let raw;
  if(slot){
    raw=await subtle.decrypt({name:'AES-GCM',iv:unb64(slot.iv)},await wrappingKey(me.ecdh.privateKey,e.eph,m.chat_id,me.id),unb64(slot.k));
    grantLater(user,m,raw);
  }else{
    // Written before this device existed: open it through a history grant, if the key was transferred.
    const h=m.grant&&await historyKey(user);
    if(!h||h.keyId!==m.grant.key)return {state:'locked',body:notices.locked};
    raw=await subtle.decrypt({name:'AES-GCM',iv:unb64(m.grant.iv),additionalData:enc.encode('cipherion-grant-v1|'+m.id)},h.key,unb64(m.grant.k));
  }
  const content=await subtle.importKey('raw',raw,'AES-GCM',false,['decrypt','encrypt']);
  const plain=JSON.parse(dec.decode(await subtle.decrypt({name:'AES-GCM',iv:unb64(e.iv),additionalData:enc.encode('cipherion-e2e-v1|'+m.chat_id)},content,unb64(e.ct))));
  return {state:'ok',body:String(plain.b??''),file:plain.f&&typeof plain.f==='object'?plain.f:null,extra:plain,content};
}
// Replaces an encrypted message's empty body with its plaintext, in place.
export async function open(user,m){
  if(!m||typeof m.e2e!=='string'||m.deleted)return m;
  const key=user+':'+m.id+':'+m.e2e.length+':'+m.e2e.slice(-24);
  if(!opened.has(key)){
    if(opened.size>3000)opened.delete(opened.keys().next().value);
    opened.set(key,subtle?decrypt(user,m).catch(()=>({state:'broken',body:notices.broken})):Promise.resolve({state:'broken',body:notices.broken}));
  }
  const result=await opened.get(key);
  if(result.state!=='ok')opened.delete(key);
  m.body=result.body;m.e2eState=result.state;if(result.file)m.file=result.file;
  if(result.state==='ok')await applyExtras(m,result);
  return m;
}
// Parts of a message that travel inside the ciphertext besides the text: a quoted fragment, the
// voice waveform, a sticker id and the texts of a poll or checklist.
const contentKeys=new Map();
async function applyExtras(m,result){
  const x=result.extra||{};
  if(typeof x.q==='string')m.quote=x.q.slice(0,1000);
  if(typeof x.w==='string'&&/^[a-v]{8,128}$/.test(x.w))m.wave=x.w;
  if(typeof x.s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x.s)&&m.kind==='sticker'){m.body=x.s;m.sticker=m.sticker||{id:x.s};}
  if(m.poll&&x.p&&typeof x.p==='object'){
    contentKeys.set(m.id,result.content);if(contentKeys.size>500)contentKeys.delete(contentKeys.keys().next().value);
    sealedPolls.set(m.id,x.p);if(sealedPolls.size>500)sealedPolls.delete(sealedPolls.keys().next().value);
    m.poll=await revealPoll(m.id,m.poll);
  }
}
const sealedPolls=new Map();
// Replaces the numbered placeholders of an encrypted poll (as the server returns it) with its texts.
export async function revealPoll(messageId,poll){
  const x=sealedPolls.get(messageId),content=contentKeys.get(messageId);if(!x||!content||!poll)return poll;
  const base=Array.isArray(x.o)?x.o.map(v=>String(v).slice(0,150)):[];
  const out={...poll,sealed:true,options:await Promise.all((poll.options||[]).map((o,i)=>i<base.length?base[i]:openItem(content,messageId,o)))};
  if(typeof x.d==='string')out.description=x.d.slice(0,1000);
  if(typeof x.x==='string'&&poll.explanation!=null)out.explanation=x.x.slice(0,1000);
  return out;
}
// The request body for a new poll: encrypted when the chat allows it, as before otherwise.
export async function pollRequest(user,chat,question,poll){
  const envelope=await seal(user,chat,question,null,{p:{o:(poll.options||[]).map(String),d:String(poll.description||''),x:String(poll.explanation||'')}}).catch(()=>null);
  if(!envelope)return {kind:'poll',body:question,poll};
  return {kind:'poll',e2e:envelope,poll:{...poll,options:poll.options.map((_,i)=>String(i+1)),description:'',explanation:''}};
}
// Checklist items added later are encrypted with the checklist's own message key.
const ITEM=/^e1:([A-Za-z0-9+/=]{16})\.([A-Za-z0-9+/=]{24,800})$/;
async function openItem(content,messageId,text){
  const hit=ITEM.exec(String(text));if(!hit)return String(text);
  try{return dec.decode(await subtle.decrypt({name:'AES-GCM',iv:unb64(hit[1]),additionalData:enc.encode('cipherion-item-v1|'+messageId)},content,unb64(hit[2])));}catch{return '⚠️ Пункт не удалось расшифровать';}
}
export async function sealItem(messageId,text){
  const content=contentKeys.get(messageId);if(!content)return null;
  const iv=random(12);return 'e1:'+b64(iv)+'.'+b64(await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-item-v1|'+messageId)},content,enc.encode(String(text))));
}
// Walks any API response and opens every encrypted message inside it.
export async function reveal(value,user,depth=0){
  if(!value||typeof value!=='object'||depth>6)return value;
  if(Array.isArray(value)){await Promise.all(value.map(v=>reveal(v,user,depth+1)));return value;}
  if(typeof value.e2e==='string'&&value.chat_id)await open(user,value);
  else if(typeof value.body==='string'&&value.body.startsWith('e2d1:')&&'updated' in value&&!('id' in value))value.body=await openDraft(user,value.body);
  await Promise.all(Object.values(value).filter(v=>v&&typeof v==='object').map(v=>reveal(v,user,depth+1)));
  return value;
}
setResponseFilter((result,account)=>account?reveal(result,account):result);

// Safety code: both sides see the same digits when nobody substituted a key.
async function safetyCode(devices){
  const material=devices.map(d=>d.user+':'+d.ecdsa+':'+d.ecdh).sort().join('|');
  const digest=new Uint8Array(await subtle.digest('SHA-256',enc.encode('cipherion-safety-v1|'+material)));
  const groups=[];for(let i=0;i<12;i++)groups.push(String(((digest[i*2]<<8)|digest[i*2+1])%100000).padStart(5,'0'));
  return groups;
}
export async function encryptionInfo(user,chat){
  const me=await device(user);
  if(!me?.id){modal('Шифрование','<p class="note">Этот браузер не даёт хранить ключи шифрования (например, приватный режим без IndexedDB). Сообщения с этого устройства отправляются без сквозного шифрования.</p>');return;}
  const keys=await chatKeys(user,chat.id);
  if(!keys.enabled){modal('Шифрование',`<p class="note">${esc(keys.reason)}</p>`);return;}
  const missing=chat.members.filter(m=>keys.users.includes(m.user_id)&&!keys.devices.some(d=>d.user===m.user_id));
  const code=await safetyCode(keys.devices);
  const count=chat.members.filter(m=>keys.users.includes(m.user_id)).map(m=>`<li>${esc(m.user_id===user?'Вы':m.name)}: ${keys.devices.filter(d=>d.user===m.user_id).length} устр.</li>`).join('');
  modal('Сквозное шифрование',`<p class="note">${missing.length?`Пока ${esc(missing.map(m=>m.name).join(', '))} не откроет обновлённое приложение, новые сообщения в этом чате отправляются <b>без</b> сквозного шифрования.`:'Текст сообщений в этом чате шифруется на вашем устройстве и расшифровывается только на устройствах участников. Сервер хранит лишь шифротекст.'}</p>
    <h3>Код безопасности</h3><p class="safety-code" style="font-family:ui-monospace,monospace;font-size:1.05rem;letter-spacing:.06em;line-height:1.8">${code.map((g,i)=>esc(g)+(i%4===3?'<br>':' ')).join('')}</p>
    <p class="muted">Сверьте код с собеседником лично или по звонку. Совпадение означает, что сервер не подменил ключи. Код меняется, когда кто-то входит с нового устройства.</p>
    <ul class="muted">${count}</ul>
    <p class="muted">Фото, видео, голосовые и файлы до 200 МБ шифруются вместе с текстом. Тексты опросов и чек-листов, стикеры из встроенных наборов и облачные черновики тоже зашифрованы. Не шифруются: отложенные сообщения и опросы, стикеры из пользовательских наборов. Превью ссылок собирает сервер, поэтому адрес ссылки ему виден — превью можно выключить в настройках чатов. Чтобы новое устройство прочитало старые сообщения, перенесите историю: Настройки → Устройства → Перенос истории.</p>`);
}

// ---------- History key: moving old messages to a new device ----------
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function historyId(raw){return hex(await subtle.digest('SHA-256',new Uint8Array([...enc.encode('cipherion-history-id-v1|'),...raw]))).slice(0,32);}
async function importHistory(raw){return subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
const histories=new Map();
// Resolves to {keyId,key} when this device holds the account's current history key, otherwise null.
export function historyKey(user,{refresh=false}={}){
  if(!user||!subtle||!globalThis.indexedDB)return Promise.resolve(null);
  if(refresh)histories.delete(user);
  if(!histories.has(user))histories.set(user,(async()=>{
    const local=await store('readonly',s=>s.get(user),'history').catch(()=>null);
    const me=await device(user);if(!me?.id)return null;
    let server=await api('/e2e/history','GET',undefined,undefined,user);
    if(local&&server.keyId===local.keyId)return {keyId:local.keyId,key:await importHistory(unb64(local.raw)),server};
    if(local&&server.keyId){await store('readwrite',s=>s.delete(user),'history').catch(()=>{});return null;}
    if(!server.keyId){
      // No key yet: the oldest device creates it (or this one, if it already had one).
      const raw=local?unb64(local.raw):random(32),keyId=local?.keyId||await historyId(raw);
      server=await api('/e2e/history','POST',{keyId,device:me.id},undefined,user);
      if(server.keyId!==keyId)return null;
      await store('readwrite',s=>s.put({user,keyId,raw:b64(raw)}),'history');
      return {keyId,key:await importHistory(raw),server,fresh:true};
    }
    return null;
  })().catch(error=>{histories.delete(user);throw error;}));
  return histories.get(user).catch(()=>null);
}
export async function historyStatus(user){
  const h=await historyKey(user,{refresh:true});const server=await api('/e2e/history','GET',undefined,undefined,user);
  return {ready:!!h,keyId:server.keyId,backup:!!server.backup,backupUpdated:server.updated||null};
}
// Starts a key on this device even though older devices exist (they will need a transfer from here).
export async function startHistoryHere(user,{reset=false}={}){
  const me=await device(user);if(!me?.id)throw new Error('Этот браузер не может хранить ключи шифрования');
  const raw=random(32),keyId=await historyId(raw);
  const server=await api('/e2e/history','POST',{keyId,device:me.id,force:true,...(reset?{reset:true}:{})},undefined,user);
  if(server.keyId!==keyId)throw new Error('Ключ истории уже создан на другом устройстве. Перенесите его оттуда.');
  await store('readwrite',s=>s.put({user,keyId,raw:b64(raw)}),'history');histories.delete(user);opened.clear();
  return historyKey(user);
}
async function saveHistory(user,keyId,raw){
  if(await historyId(raw)!==keyId)throw new Error('Ключ не прошёл проверку');
  await store('readwrite',s=>s.put({user,keyId,raw:b64(raw)}),'history');histories.delete(user);opened.clear();
  globalThis.window?.dispatchEvent(new CustomEvent('e2e-history',{detail:{user}}));
}
// Every message this device can open gets a grant, so the account's next device can open it too.
const grantQueue=new Map();let grantTimer=null;
function grantLater(user,m,raw){
  if(!m.id||String(m.id).startsWith('local:'))return;
  historyKey(user).then(async h=>{
    if(!h||m.grant?.key===h.keyId)return;
    const iv=random(12),k=await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-grant-v1|'+m.id)},h.key,raw);
    m.grant={key:h.keyId,iv:b64(iv),k:b64(k)};
    const list=grantQueue.get(user)||new Map();list.set(m.id,{m:m.id,iv:b64(iv),k:b64(k),keyId:h.keyId});grantQueue.set(user,list);
    clearTimeout(grantTimer);grantTimer=setTimeout(flushGrants,1500);
  }).catch(()=>{});
}
async function flushGrants(){
  for(const [user,list] of grantQueue){grantQueue.delete(user);const items=[...list.values()];
    for(let i=0;i<items.length;i+=500){const part=items.slice(i,i+500);await api('/e2e/grants','POST',{keyId:part[0].keyId,items:part.map(({m,iv,k})=>({m,iv,k}))},undefined,user).catch(()=>{});}}
}
// Walks recent history so its grants exist before the person moves to a new phone.
const prepared=new Set();
export async function prepareHistory(user,progress=()=>{}){
  if(prepared.has(user))return;prepared.add(user);
  const h=await historyKey(user);if(!h){prepared.delete(user);return;}
  const chats=await api('/chats','GET',undefined,undefined,user);let done=0;
  for(const chat of chats.filter(c=>['direct','group','saved'].includes(c.kind))){
    let before=null,beforeId=null;
    for(let page=0;page<50;page++){
      const rows=await api(`/chats/${chat.id}/messages${before!==null?`?before=${before}&beforeId=${encodeURIComponent(beforeId)}`:''}`,'GET',undefined,undefined,user).catch(()=>[]);
      if(!rows.length)break;done+=rows.length;progress(done);
      const first=rows.reduce((a,b)=>a.created<b.created||a.created===b.created&&a.id<b.id?a:b);before=first.created;beforeId=first.id;
      if(rows.length<60)break;await new Promise(r=>setTimeout(r,250));
    }
  }
  await new Promise(r=>setTimeout(r,1700));await flushGrants();
}
// ---------- Password-protected backup ----------
const ITERATIONS=600_000;
async function passwordKey(password,salt,iter){
  const base=await subtle.importKey('raw',enc.encode(String(password).normalize('NFKC')),'PBKDF2',false,['deriveKey']);
  return subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function saveBackup(user,password){
  if(String(password).length<8)throw new Error('Пароль резервной копии — не короче 8 символов');
  const h=await historyKey(user);if(!h)throw new Error('На этом устройстве нет ключа истории');
  const local=await store('readonly',s=>s.get(user),'history');
  const salt=random(16),iv=random(12),key=await passwordKey(password,salt,ITERATIONS);
  const ct=await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-backup-v1|'+h.keyId)},key,unb64(local.raw));
  await api('/e2e/history/backup','PUT',{keyId:h.keyId,backup:{v:1,salt:b64(salt),iv:b64(iv),ct:b64(ct),iter:ITERATIONS}},undefined,user);
}
export async function restoreBackup(user,password){
  const server=await api('/e2e/history','GET',undefined,undefined,user);
  if(!server.backup)throw new Error('Резервная копия ключей не создана. Включите её на старом устройстве.');
  const b=server.backup;let raw;
  try{raw=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:unb64(b.iv),additionalData:enc.encode('cipherion-backup-v1|'+server.keyId)},await passwordKey(password,unb64(b.salt),b.iter),unb64(b.ct)));}
  catch{throw new Error('Неверный пароль резервной копии');}
  await saveHistory(user,server.keyId,raw);
}
export const removeBackup=user=>api('/e2e/history/backup','DELETE',{},undefined,user);
// ---------- Device-to-device transfer ----------
// The receiving device makes a one-time ECDH key; its public half reaches the sender inside a QR code.
const transferInfo=keyId=>enc.encode('cipherion-history-transfer-v1|'+keyId);
async function transferKey(privateKey,publicRaw,keyId){
  const peer=await subtle.importKey('raw',unb64(publicRaw),ECDH,false,[]);
  const bits=await subtle.deriveBits({name:'ECDH',public:peer},privateKey,256);
  const base=await subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:transferInfo(keyId)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function transferReceiver(){
  const pair=await subtle.generateKey(ECDH,false,['deriveBits']);
  const pub=b64(await subtle.exportKey('raw',pair.publicKey));
  return {pub,urlKey:pub.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),fingerprint:await fingerprint(pub),
    accept:async(user,payload)=>{if(!payload)return false;const raw=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv)},await transferKey(pair.privateKey,payload.eph,payload.keyId),unb64(payload.ct)));await saveHistory(user,payload.keyId,raw);return true;}};
}
// Wraps this device's history key for the receiving device's public key.
export async function wrapHistoryFor(user,pub){
  const h=await historyKey(user);if(!h)return null;
  const local=await store('readonly',s=>s.get(user),'history');
  const eph=await subtle.generateKey(ECDH,true,['deriveBits']),iv=random(12);
  const ct=await subtle.encrypt({name:'AES-GCM',iv},await transferKey(eph.privateKey,pub,h.keyId),unb64(local.raw));
  return {keyId:h.keyId,eph:b64(await subtle.exportKey('raw',eph.publicKey)),iv:b64(iv),ct:b64(ct)};
}
export const fromUrlKey=text=>{try{const s=String(text||'').replace(/-/g,'+').replace(/_/g,'/');const padded=s+'==='.slice((s.length+3)%4);return unb64(padded).length===65?padded:null;}catch{return null;}};
export async function fingerprint(pub){const d=new Uint8Array(await subtle.digest('SHA-256',unb64(pub)));return [0,2,4,6].map(i=>String(((d[i]<<8)|d[i+1])%10000).padStart(4,'0')).join(' ');}
// ---------- Cloud drafts ----------
export async function sealDraft(user,text){
  if(!text)return text;const h=await historyKey(user);if(!h)return text;
  const iv=random(12),ct=await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-draft-v1')},h.key,enc.encode(text));
  return 'e2d1:'+h.keyId+':'+b64(iv)+':'+b64(ct);
}
export async function openDraft(user,value){
  const [,keyId,iv,ct]=String(value).split(':');
  try{const h=await historyKey(user);if(!h||h.keyId!==keyId)return '';return dec.decode(await subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode('cipherion-draft-v1')},h.key,unb64(ct)));}catch{return '';}
}
