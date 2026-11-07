import {api,upload} from './ui.js';
import {compressPhoto} from './media-compress.js';
// Photos start shrinking as soon as they are queued, so the wait overlaps earlier uploads.
const prepared=new WeakMap();
const preparePhoto=file=>{let p=prepared.get(file);if(!p){p=compressPhoto(file);prepared.set(file,p);p.catch(()=>prepared.delete(file));}return p;};
import {encryptFile,SEAL_LIMIT} from './sealed-media.js';
const sealable=new Set(['text','photo','video','file','voice','round','location','poll']);
// Built-in sticker packs are public static files, so their stickers can be sent encrypted.
const builtinSticker=id=>/^v\d+-[a-z0-9-]+$/.test(String(id||''));
// Parts that must not reach the server in the clear once the message is encrypted.
function hiddenParts(payload){
 const extra={};
 if(payload.quote)extra.q=String(payload.quote);
 if(payload.wave)extra.w=String(payload.wave);
 if(payload.sticker&&builtinSticker(payload.sticker))extra.s=String(payload.sticker);
 if(payload.kind==='poll'&&payload.poll){const p=payload.poll;extra.p={o:(p.options||[]).map(String),d:String(p.description||''),x:String(p.explanation||'')};}
 return extra;
}
let connection;
function database(){return connection ||= new Promise((resolve,reject)=>{const r=indexedDB.open('cipherion-outbox',1);r.onupgradeneeded=()=>r.result.createObjectStore('messages',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=null;reject(r.error);};});}
async function transaction(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('messages',mode);const r=action(tx.objectStore('messages'));tx.oncomplete=()=>resolve(r?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
// `encrypt(chat,text,file)` resolves to extra payload fields ({e2e,emoji}) or null for plaintext.
// `protect(chat)` tells whether the chat is end-to-end encrypted, so attachments can be sealed too.
export function createOutbox(user,onChange,encrypt=null,protect=null){
 const request=(path,method,data,signal)=>api(path,method,data,signal,user);
 const memory=new Map(),saving=new Map();let busy=null,disposed=false,lastCreated=0;
 const notify=event=>{if(disposed)return;try{Promise.resolve(onChange(event)).catch(()=>{});}catch{}};
 const ready=transaction('readonly',s=>s.getAll()).then(rows=>{for(const m of rows)if(m.user===user&&!memory.has(m.id)){memory.set(m.id,m);notify({type:'pending',item:m});}}).catch(()=>{});
 const list=async()=>{await ready;return [...memory.values()].sort((a,b)=>a.created-b.created);};
 function save(item){const p=(saving.get(item.id)||Promise.resolve()).catch(()=>{}).then(()=>transaction('readwrite',s=>s.put(item)));saving.set(item.id,p);return p;}
 async function drain(){
  await ready;
  const attempted=new Set();
  while(!disposed&&navigator.onLine){
   const item=(await list()).find(m=>!attempted.has(m.id)&&(!m.error||m.transient));if(!item)break;
   attempted.add(item.id);delete item.error;notify({type:'pending',item});
   try{
    await save(item);
    // Photos are shrunk before upload; files sent as «Файл» keep their original bytes.
    if(item.file){
     const outgoing=item.payload.kind==='photo'?await preparePhoto(item.file):item.file;
     // In an encrypted chat the file is encrypted on this device before it leaves it.
     const seal=encrypt&&protect&&outgoing.size<=SEAL_LIMIT&&await protect(item.chat).catch(()=>false);
     if(seal){const {blob,meta}=await encryptFile(outgoing);const media=await upload(blob,user);item.payload.media=media.id;item.fileKey=meta;}
     else{const media=await upload(outgoing,user);item.payload.media=media.id;}
     delete item.file;await save(item);
    }
    // Encrypt once and keep the envelope: a retry must repeat the identical request.
    const stickerSeal=item.payload.sticker&&builtinSticker(item.payload.sticker)&&!item.payload.forward;
    if(encrypt&&!item.sealed&&(stickerSeal||!item.payload.sticker&&sealable.has(item.payload.kind||'text')&&(String(item.payload.body||'').trim()||item.fileKey||item.payload.sealedFile))){
     const fileKey=item.fileKey||item.payload.sealedFile||null,extra=hiddenParts(item.payload);
     const sealed=await encrypt(item.chat,String(item.payload.body||'').trim(),fileKey,extra);
     if(fileKey&&!sealed)throw Object.assign(new Error('Не удалось зашифровать вложение для всех участников. Отправьте файл заново.'),{status:400});
     item.sealed=true;
     if(sealed){
      Object.assign(item.payload,sealed);delete item.payload.quote;delete item.payload.wave;
      if(stickerSeal){item.stickerId=item.payload.sticker;delete item.payload.sticker;item.payload.sealedSticker=true;}if(extra.q)item.quote=extra.q;
      if(item.payload.poll)item.payload.poll={...item.payload.poll,options:item.payload.poll.options.map((_,i)=>String(i+1)),description:'',explanation:''};
     }
     await save(item);
    }
    const toSticker=item.payload.sticker||item.payload.sealedSticker;
    let message=await request(item.payload.forward?'/messages/'+item.payload.forward+'/forward':toSticker?'/stickers/send':'/chats/'+item.chat+'/messages','POST',{
      ...item.payload,sealedFile:undefined,sealedSticker:undefined,...(item.payload.e2e?{body:undefined}:{}),...((toSticker||item.payload.forward)?{chat:item.chat}:{}),clientMessageId:item.id,clientId:item.id
    },AbortSignal.timeout(30000));
    if(!message.chat_id)message=await request('/messages/'+message.id);
    // Merge the acknowledgement before removing the durable request.
    notify({type:'confirmed',item,message:{...message,clientMessageId:item.id}});
    await transaction('readwrite',s=>s.delete(item.id));memory.delete(item.id);saving.delete(item.id);
   }catch(e){
    item.error=e.message||'Не отправлено';item.transient=!e.status||e.status>=500||e.status===429;
    await save(item).catch(()=>{item.error='Не удалось сохранить сообщение на устройстве. Повторите отправку.';});
    notify({type:'pending',item});
    if(item.transient)break;
   }
  }
 }
 function flush(){if(busy)return busy;if(disposed||!navigator.onLine)return Promise.resolve();busy=drain().finally(()=>{busy=null;});return busy;}
 const online=()=>{void flush().catch(()=>{});};window.addEventListener('online',online);const timer=setInterval(online,15000);
 return {list,flush,dispose:()=>{disposed=true;clearInterval(timer);window.removeEventListener('online',online);return Promise.allSettled([...saving.values(),busy].filter(Boolean));},
  retry:async(id)=>{await ready;const item=memory.get(id);if(item){delete item.error;item.transient=true;notify({type:'pending',item});await save(item);await flush();}},
  enqueue:(chat,payload,file)=>{
   const item={id:crypto.randomUUID(),user,chat,payload:{...payload},...(file?{file}:{}),created:(lastCreated=Math.max(Date.now(),lastCreated+1))};
   if(!navigator.onLine){item.error='Нет подключения. Отправим при восстановлении связи.';item.transient=true;}
   memory.set(item.id,item);notify({type:'pending',item});
   if(file&&item.payload.kind==='photo')void preparePhoto(file).catch(()=>{});
   return save(item).then(()=>{online();return item;}).catch(()=>{item.error='Не удалось сохранить сообщение на устройстве. Повторите отправку.';notify({type:'pending',item});return item;});
  },
  remove:async(id)=>{await ready;await saving.get(id)?.catch(()=>{});await transaction('readwrite',s=>s.delete(id));memory.delete(id);saving.delete(id);}
 };
}
