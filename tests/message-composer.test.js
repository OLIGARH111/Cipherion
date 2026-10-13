import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
const dom=new JSDOM('<main id="app"></main><div id="toast"></div><dialog id="modal"></dialog><div id="call-root"></div>',{url:'https://cipherion.example',pretendToBeVisual:true});
for(const key of ['window','document','navigator','Event','FormData','HTMLElement','MutationObserver','localStorage','sessionStorage','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
Object.defineProperty(globalThis,'indexedDB',{value:indexedDB});Object.defineProperty(navigator,'onLine',{configurable:true,value:true,writable:true});
globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.IntersectionObserver=class{observe(){}unobserve(){}};globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
const timers=[];const originalInterval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timers.push(timer);return timer;};
class Events extends dom.window.EventTarget{constructor(url){super();this.url=url;Events.current=this;(Events.all||=[]).push(this);}close(){}emit(type,payload){this.dispatchEvent(new dom.window.MessageEvent(type,{data:JSON.stringify(payload)}));}}
globalThis.EventSource=Events;
const chat={id:'chat',kind:'direct',title:'Bob',members:[{user_id:'alice',name:'Alice'},{user_id:'bob',name:'Bob'}],unread:0};
const pending=[],requests=[];let history=[],historyWait=null,app,accounts=[{user:{id:'alice',name:'Alice'},unread:0}],aliceChats=[chat],bobWait=null;
const response=data=>({ok:true,json:async()=>structuredClone(data)});
globalThis.fetch=async(url,options={})=>{
 requests.push({url,method:options.method});
 if(url==='/api/accounts')return response(accounts);
 if(url==='/api/me'){const user=options.headers?.['X-Cipherion-Account']||'alice';if(user==='bob'&&bobWait)return bobWait;return response({user:{id:user,name:user==='bob'?'Bob':'Alice'},settings:{},iceServers:[]});}
 if(url==='/api/chats')return response(options.headers?.['X-Cipherion-Account']==='bob'?[{...chat,id:'bob-chat',title:'Only Bob'}]:aliceChats);
 if(url==='/api/chats/channel/messages')return response([]);
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
 navigator.onLine=false;send('offline');const offline=[...document.querySelectorAll('article')].at(-1);assert.match(offline.textContent,/Отправляется/);assert.doesNotMatch(offline.textContent,/Не отправлено/);await tick();assert.equal(pending.length,11);
 navigator.onLine=true;window.dispatchEvent(new Event('online'));await until(()=>pending.length===12);const key=pending[11].payload.clientMessageId;pending[11].reject(new Error('lost response'));await tick();await tick();assert.equal(offline.querySelector('.retry-send'),null);assert.doesNotMatch(offline.textContent,/Не отправлено/);window.dispatchEvent(new Event('online'));await until(()=>pending.length===13);assert.equal(pending[12].payload.clientMessageId,key);
 const m={id:'server-offline',client_id:key,chat_id:'chat',user_id:'alice',body:'offline',kind:'text',created:Date.now()+200};history.push(m);pending[12].resolve(response(m));await until(()=>!app.state.messages.at(-1).pending);assert.equal(document.querySelector('[data-id="server-offline"]'),offline);assert.equal(document.querySelectorAll('article').length,12);
});


test('actual channel removes the whole composer; account switches clear the old UI before loading',async()=>{
 const channel={id:'channel',kind:'channel',title:'Broadcast',canPost:false,muted:false,members:[{user_id:'alice',name:'Alice',role:'subscriber'}],unread:0};aliceChats.push(channel);app.state.chats.push(channel);await app.openChat('channel');
 assert.equal(document.querySelector('.composer-wrap'),null);assert.equal(document.querySelector('#draft'),null);assert.equal(document.querySelector('#attach'),null);assert.equal(document.querySelector('#channel-mute').textContent,'Выключить звук');
 accounts.push({user:{id:'bob',name:'Bob'},unread:7});let resolve;bobWait=new Promise(r=>resolve=r);const switching=app.state.accounts.switchTo('bob');await until(()=>app.state.user===null);
 assert.equal(document.querySelector('#app').textContent,'');assert.deepEqual(app.state.messages,[]);assert.deepEqual(app.state.chats,[]);
 resolve(response({user:{id:'bob',name:'Bob'},settings:{},iceServers:[]}));await switching;bobWait=null;assert.equal(app.state.user.id,'bob');assert.deepEqual(app.state.chats.map(c=>c.id),['bob-chat']);assert.doesNotMatch(document.querySelector('#app').textContent,/Broadcast/);
 await app.state.accounts.switchTo('alice');assert.equal(app.state.user.id,'alice');assert.ok(app.state.chats.some(c=>c.id==='chat'));await app.openChat('chat');assert.ok(document.querySelector('#composer'));assert.equal(document.querySelectorAll('article.message').length,12);
});

test('typing ends as soon as that person\'s message arrives; a closed realtime stream reopens itself',async()=>{
 const main=()=>Events.all.filter(e=>!e.url.includes('account=bob')).at(-1),status=()=>document.querySelector('#chat-status').textContent;
 main().emit('typing',{chat:'chat',user:'bob',name:'Bob'});assert.match(status(),/печатает/);
 const m={id:'from-bob',chat_id:'chat',user_id:'bob',kind:'text',body:'hi',created:Date.now()+500};history.push(m);
 main().emit('message',{chat:'chat',id:m.id,message:m});await until(()=>!/печатает/.test(status()));
 // An HTTP error (e.g. 502 during a deploy) leaves EventSource CLOSED for good: the app must reopen it.
 const dead=main();dead.readyState=2;dead.onerror();assert.match(document.querySelector('#connection').textContent,/Восстанавливаем/);
 for(let i=0;i<60&&main()===dead;i++)await new Promise(r=>setTimeout(r,50));assert.notEqual(main(),dead);main().emit('ready',{});assert.equal(document.querySelector('#connection').textContent,'На связи');
});
