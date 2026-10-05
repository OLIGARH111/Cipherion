import {api} from './ui.js';
let dbPromise;
function db(){return dbPromise||=new Promise((resolve,reject)=>{const r=indexedDB.open('cipherion-history',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('messages',{keyPath:'key'});s.createIndex('chat','userChat');r.result.createObjectStore('cursors');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export function createSync(user,onMessages=()=>{}){let running,again=false;
 async function cursor(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('cursors').objectStore('cursors').get(user);r.onsuccess=()=>resolve(r.result||0);r.onerror=()=>reject(r.error);});}
 async function write(rows,next){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(['messages','cursors'],'readwrite'),store=tx.objectStore('messages');for(const message of rows)store.put({key:user+':'+message.id,userChat:user+':'+message.chat_id,message});if(next!==undefined)tx.objectStore('cursors').put(next,user);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
 async function pull(){if(running){again=true;return running;}running=(async()=>{do{again=false;let more=true;while(more){const batch=await api('/sync?after='+await cursor());const rows=batch.events.map(e=>e.message);await write(rows,batch.cursor);onMessages(rows);more=batch.hasMore;}}while(again);})().finally(()=>{running=null;});return running;}
 async function cached(chat){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('messages').objectStore('messages').index('chat').getAll(user+':'+chat);r.onsuccess=()=>resolve(r.result.map(r=>r.message).sort((a,b)=>a.created-b.created));r.onerror=()=>reject(r.error);});}
 return {pull,write,cached};
}

