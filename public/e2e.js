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
export const notices={locked:'🔒 Сообщение зашифровано для другого устройства',broken:'⚠️ Не удалось расшифровать или проверить сообщение'};

let connection;
function database(){return connection||=new Promise((resolve,reject)=>{const r=indexedDB.open('cipherion-e2e',1);r.onupgradeneeded=()=>r.result.createObjectStore('devices',{keyPath:'user'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=null;reject(r.error);};});}
async function store(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('devices',mode);const r=action(tx.objectStore('devices'));tx.oncomplete=()=>resolve(r?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}

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
export async function seal(user,chat,body,file=null){
  const me=await device(user);if(!me?.id)return null;
  const keys=await chatKeys(user,chat);if(!keys.enabled)return null;
  const targets=keys.devices.some(d=>d.id===me.id)?keys.devices:[...keys.devices,{id:me.id,user,ecdh:me.ecdhRaw}];
  if(keys.users.some(u=>!targets.some(d=>d.user===u)))return null;
  const raw=random(32),iv=random(12);
  const content=await subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const ct=await subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cipherion-e2e-v1|'+chat)},content,enc.encode(JSON.stringify({b:String(body),t:Date.now(),...(file?{f:file}:{})})));
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
  const slot=me?.id&&e.keys.find(k=>k.d===me.id);if(!slot)return {state:'locked',body:notices.locked};
  const raw=await subtle.decrypt({name:'AES-GCM',iv:unb64(slot.iv)},await wrappingKey(me.ecdh.privateKey,e.eph,m.chat_id,me.id),unb64(slot.k));
  const content=await subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const plain=JSON.parse(dec.decode(await subtle.decrypt({name:'AES-GCM',iv:unb64(e.iv),additionalData:enc.encode('cipherion-e2e-v1|'+m.chat_id)},content,unb64(e.ct))));
  return {state:'ok',body:String(plain.b??''),file:plain.f&&typeof plain.f==='object'?plain.f:null};
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
  m.body=result.body;m.e2eState=result.state;if(result.file)m.file=result.file;return m;
}
// Walks any API response and opens every encrypted message inside it.
export async function reveal(value,user,depth=0){
  if(!value||typeof value!=='object'||depth>6)return value;
  if(Array.isArray(value)){await Promise.all(value.map(v=>reveal(v,user,depth+1)));return value;}
  if(typeof value.e2e==='string'&&value.chat_id)await open(user,value);
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
    <p class="muted">Фото, видео, голосовые и файлы до 200 МБ шифруются вместе с текстом. Не шифруются сквозным образом: опросы и чек-листы, стикеры, отложенные сообщения и черновики. Превью ссылок собирает сервер, поэтому адрес ссылки ему виден — превью можно выключить в настройках чатов. Новое устройство не может прочитать сообщения, отправленные до его появления.</p>`);
}
