import {api,upload} from './ui.js';
let connection;
function database(){return connection ||= new Promise((resolve,reject)=>{const r=indexedDB.open('cipherion-outbox',1);r.onupgradeneeded=()=>r.result.createObjectStore('messages',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{connection=null;reject(r.error);};});}
async function transaction(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('messages',mode);const r=action(tx.objectStore('messages'));tx.oncomplete=()=>resolve(r?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export function createOutbox(user,onChange){
 const memory=new Map(),saving=new Map();let busy=null,disposed=false,lastCreated=0;
 const notify=event=>{try{Promise.resolve(onChange(event)).catch(()=>{});}catch{}};
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
    if(item.file){const media=await upload(item.file);item.payload.media=media.id;delete item.file;await save(item);}
    let message=await api(item.payload.forward?'/messages/'+item.payload.forward+'/forward':item.payload.sticker?'/stickers/send':'/chats/'+item.chat+'/messages','POST',{
      ...item.payload,...((item.payload.sticker||item.payload.forward)?{chat:item.chat}:{}),clientMessageId:item.id,clientId:item.id
    },AbortSignal.timeout(30000));
    if(!message.chat_id)message=await api('/messages/'+message.id);
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
 return {list,flush,dispose:()=>{disposed=true;clearInterval(timer);window.removeEventListener('online',online);},
  retry:async(id)=>{await ready;const item=memory.get(id);if(item){delete item.error;item.transient=true;notify({type:'pending',item});await save(item);await flush();}},
  enqueue:(chat,payload,file)=>{
   const item={id:crypto.randomUUID(),user,chat,payload:{...payload},...(file?{file}:{}),created:(lastCreated=Math.max(Date.now(),lastCreated+1))};
   if(!navigator.onLine){item.error='Нет подключения. Отправим при восстановлении связи.';item.transient=true;}
   memory.set(item.id,item);notify({type:'pending',item});
   return save(item).then(()=>{online();return item;}).catch(()=>{item.error='Не удалось сохранить сообщение на устройстве. Повторите отправку.';notify({type:'pending',item});return item;});
  },
  remove:async(id)=>{await ready;await saving.get(id)?.catch(()=>{});await transaction('readwrite',s=>s.delete(id));memory.delete(id);saving.delete(id);}
 };
}
