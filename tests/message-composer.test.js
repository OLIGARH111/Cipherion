import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
const dom=new JSDOM('<main id="app"></main><div id="toast"></div><dialog id="modal"></dialog><div id="call-root"></div>',{url:'https://cipherion.example',pretendToBeVisual:true});
for(const key of ['window','document','navigator','Event','FormData','HTMLElement','MutationObserver','localStorage','sessionStorage','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
Object.defineProperty(globalThis,'indexedDB',{value:indexedDB});Object.defineProperty(navigator,'onLine',{configurable:true,value:true,writable:true});
globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.IntersectionObserver=class{observe(){}unobserve(){}};globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
const timers=[];const originalInterval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timers.push(timer);return timer;};
class Events extends dom.window.EventTarget{constructor(){super();Events.current=this;}close(){}emit(type,payload){this.dispatchEvent(new dom.window.MessageEvent(type,{data:JSON.stringify(payload)}));}}
globalThis.EventSource=Events;
const chat={id:'chat',kind:'direct',title:'Bob',members:[{user_id:'alice',name:'Alice'},{user_id:'bob',name:'Bob'}],unread:0};
const pending=[],requests=[];let history=[],historyWait=null,app;
const response=data=>({ok:true,json:async()=>structuredClone(data)});
globalThis.fetch=async(url,options={})=>{
 requests.push({url,method:options.method});
 if(url==='/api/me')return response({user:{id:'alice',name:'Alice'},settings:{},iceServers:[]});
 if(url==='/api/chats')return response([chat]);
 if(url==='/api/chats/chat/messages'&&options.method==='POST')return new Promise((resolve,reject)=>pending.push({payload:JSON.parse(options.body),resolve,reject}));
 if(url==='/api/chats/chat/messages')return historyWait?historyWait:response(history);
 if(url==='/api/sync?after=0')return response({events:[],cursor:0,hasMore:false});
 if(url.startsWith('/api/messages/'))return response(history.find(m=>m.id===url.split('/').at(-1)));
 if(url==='/api/stories'||url==='/api/calls/active')return response([]);
 if(url==='/api/stickers/recommend')return response([]);
 return response({ok:true});
};
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick();}assert.fail('timed out');}
after(()=>{for(const timer of timers)clearInterval(timer);globalThis.setInterval=originalInterval;dom.window.close();});
test('actual composer: immediate clear, button/Enter, 10 rapid sends, delayed ACK/SSE, offline, retry and history races',async()=>{
 app=await import('../public/app.js');await until(()=>Events.current);await app.openChat('chat');
 const input=document.querySelector('#draft'),form=document.querySelector('#composer');
 function send(text,enter=false){input.value=text;if(enter)input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));else document.querySelector('.send').click();assert.equal(input.value,'');}
 send('first',true);const first=document.querySelector('article.message');assert.ok(first);assert.match(first.textContent,/Отправляется/);
 // Duplicate submit after Enter sees the cleared draft.
 form.dispatchEvent(new Event('submit',{cancelable:true}));await until(()=>pending.length===1);assert.equal(document.querySelectorAll('article.message').length,1);
 for(let i=0;i<10;i++)send('rapid '+i,i%2===0);
 assert.equal(document.querySelectorAll('article.message').length,11);
 const getCount=()=>requests.filter(r=>r.url==='/api/chats/chat/messages'&&r.method==='GET').length;
 const reads=getCount();
 // A one-second server delay must not leave the old draft or remove bubbles.
 await new Promise(r=>setTimeout(r,1000));assert.equal(input.value,'');assert.equal(document.querySelectorAll('article.message').length,11);
 let resolveHistory;historyWait=new Promise(r=>resolveHistory=r);document.dispatchEvent(new Event('visibilitychange'));await tick();
 for(let i=0;i<11;i++){
  await until(()=>pending.length>i);const req=pending[i],m={id:'server-'+i,clientMessageId:req.payload.clientMessageId,client_id:req.payload.clientMessageId,chat_id:'chat',user_id:'alice',kind:'text',body:req.payload.body,created:Date.now()+i};history.push(m);
  if(i%2===0){Events.current.emit('message',{chat:'chat',id:m.id,message:m});req.resolve(response(m));}else{req.resolve(response(m));await tick();Events.current.emit('message',{chat:'chat',id:m.id,message:m});}
 }
 await until(()=>app.state.messages.every(m=>!m.pending));resolveHistory(response([]));historyWait=null;await tick();
 assert.equal(document.querySelectorAll('article.message').length,11);assert.equal(document.querySelector('[data-id="server-0"]'),first);assert.equal(getCount(),reads+1);
 Events.current.emit('receipt',{chat:'chat',user:'bob',delivered:Date.now()+100});assert.equal(first.querySelector('span[title]').title,'Доставлено');
 Events.current.emit('receipt',{chat:'chat',user:'bob',read:Date.now()+100});assert.equal(first.querySelector('span[title]').title,'Прочитано');
 navigator.onLine=false;send('offline');const offline=[...document.querySelectorAll('article')].at(-1);assert.match(offline.textContent,/Не отправлено/);await tick();assert.equal(pending.length,11);
 navigator.onLine=true;window.dispatchEvent(new Event('online'));await until(()=>pending.length===12);const key=pending[11].payload.clientMessageId;pending[11].reject(new Error('lost response'));await until(()=>offline.querySelector('.retry-send'));offline.querySelector('.retry-send').click();await until(()=>pending.length===13);assert.equal(pending[12].payload.clientMessageId,key);
 const m={id:'server-offline',client_id:key,chat_id:'chat',user_id:'alice',body:'offline',kind:'text',created:Date.now()+200};history.push(m);pending[12].resolve(response(m));await until(()=>!app.state.messages.at(-1).pending);assert.equal(document.querySelector('[data-id="server-offline"]'),offline);assert.equal(document.querySelectorAll('article').length,12);
});
