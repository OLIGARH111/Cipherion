// End-to-end encrypted attachments. The file is encrypted on the sender's device with a
// fresh AES-256-GCM key; the server stores an opaque blob of type
// application/x-cipherion-sealed. The key, the real name and the type travel inside the
// encrypted message text, so only chat members' devices can open the file.
import {accountURL,accountFetch} from './account-context.js';

export const SEALED_TYPE='application/x-cipherion-sealed';
export const SEAL_LIMIT=200*1024*1024;
const AAD=new TextEncoder().encode('cipherion-file-v1');
const b64=buffer=>{const bytes=new Uint8Array(buffer);let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);};
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));

export async function encryptFile(file){
  const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},key,await file.arrayBuffer());
  const blob=new File([data],'encrypted.bin',{type:SEALED_TYPE});
  return {blob,meta:{k:b64(raw),iv:b64(iv),n:String(file.name||'file').slice(0,200),m:String(file.type||'application/octet-stream').slice(0,100),s:file.size}};
}
const urls=new Map();
// Object URL of the decrypted file, shared by every element that shows it.
export function sealedURL(mediaId,meta){
  if(!urls.has(mediaId))urls.set(mediaId,(async()=>{
    const response=await accountFetch(accountURL('/api/media/'+mediaId));if(!response.ok)throw new Error('Файл недоступен');
    const key=await crypto.subtle.importKey('raw',unb64(meta.k),'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(meta.iv),additionalData:AAD},key,await response.arrayBuffer());
    // Only types the page may render inline keep their type; anything else downloads.
    const safe=/^(image\/(png|jpeg|webp|gif)|audio\/(webm|ogg|mpeg|mp4|wav)|video\/(webm|mp4|ogg|quicktime))$/.test(meta.m)?meta.m:'application/octet-stream';
    return URL.createObjectURL(new Blob([plain],{type:safe}));
  })().catch(error=>{urls.delete(mediaId);throw error;}));
  if(urls.size>200){const [first,value]=urls.entries().next().value;urls.delete(first);value.then(u=>URL.revokeObjectURL(u)).catch(()=>{});}
  return urls.get(mediaId);
}
// Fills in every encrypted image, video, audio and file link inside a container.
export function hydrateSealed(root,messages){
  root.querySelectorAll('[data-sealed]:not([data-ready])').forEach(el=>{
    const m=messages.find(x=>x.media?.id===el.dataset.sealed&&x.file);if(!m)return;
    el.dataset.ready='1';
    sealedURL(m.media.id,m.file).then(url=>{
      if(el.tagName==='A'){el.href=url;el.download=m.file.n;}
      else{el.src=el.tagName==='VIDEO'&&el.classList.contains('round')?url+'#t=0.001':url;if(el.tagName!=='IMG')el.load?.();}
      el.closest('.sealed-media')?.classList.add('ready');
    }).catch(()=>{el.closest('.sealed-media')?.classList.add('failed');});
  });
}
