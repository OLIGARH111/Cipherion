import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
const dom=new JSDOM('<div id="launch"></div><main id="app"></main><div id="toast"></div><dialog id="modal"></dialog><div id="call-root"></div>',{url:'https://cipherion.example',pretendToBeVisual:true});
for(const key of ['window','document','navigator','Event','FormData','HTMLElement','MutationObserver','localStorage','sessionStorage','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
Object.defineProperty(globalThis,'indexedDB',{value:indexedDB});Object.defineProperty(navigator,'onLine',{configurable:true,value:true,writable:true});
globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.IntersectionObserver=class{observe(){}unobserve(){}};globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
const timers=[];const originalInterval=globalThis.setInterval;globalThis.setInterval=(...args)=>{const timer=originalInterval(...args);timers.push(timer);return timer;};
class Events extends dom.window.EventTarget{constructor(){super();Events.current=this;}close(){}}
globalThis.EventSource=Events;
const member=(id,name)=>({user_id:id,name});
const saved={id:'old',kind:'direct',title:'Saved chat',members:[member('alice','Alice'),member('bob','Bob')],unread:0,last:{id:'m1',chat_id:'old',user_id:'bob',body:'cached text',created:1}};
const fresh={id:'new',kind:'direct',title:'Fresh chat',members:[member('alice','Alice'),member('carol','Carol')],unread:0,last:{id:'m2',chat_id:'new',user_id:'carol',body:'secret words',e2e:'cipher',created:2}};
localStorage.setItem('cipherion-active-account','alice');
localStorage.setItem('accounts/alice/snapshot',JSON.stringify({v:1,user:{id:'alice',name:'Alice'},settings:{},chats:[saved]}));
let release;const serverReady=new Promise(r=>release=r);
const response=data=>({ok:true,json:async()=>structuredClone(data)});
globalThis.fetch=async url=>{
 await serverReady;
 if(url==='/api/accounts')return response([{user:{id:'alice',name:'Alice'},unread:0}]);
 if(url==='/api/me')return response({user:{id:'alice',name:'Alice'},settings:{},iceServers:[]});
 if(url==='/api/chats')return response([fresh]);
 if(url.startsWith('/api/sync'))return response({events:[],cursor:0,hasMore:false});
 if(url==='/api/stories'||url==='/api/calls/active'||url==='/api/stickers/recommend')return response([]);
 return response({ok:true});
};
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await tick();}assert.fail('timed out');}
after(()=>{for(const timer of timers)clearInterval(timer);globalThis.setInterval=originalInterval;dom.window.close();});

test('the saved chat list appears before the server answers, then is replaced; encrypted text is not saved',async()=>{
 await import('../public/app.js');
 // Nothing has come back from the server yet, but the app is already usable.
 assert.ok(document.querySelector('.shell'),'shell is drawn from the saved copy');
 assert.match(document.querySelector('.chat-list').textContent,/Saved chat/);
 assert.equal(document.getElementById('launch'),null,'launch screen is gone');
 const shell=document.querySelector('.shell');
 release();
 await until(()=>/Fresh chat/.test(document.querySelector('.chat-list')?.textContent||''));
 assert.equal(document.querySelector('.shell'),shell,'the same screen is updated, not rebuilt');
 assert.doesNotMatch(document.querySelector('.chat-list').textContent,/Saved chat/);
 await until(()=>JSON.parse(localStorage.getItem('accounts/alice/snapshot')).chats[0].id==='new');
 const stored=localStorage.getItem('accounts/alice/snapshot');
 assert.doesNotMatch(stored,/secret words|cipher"/);assert.match(stored,/Зашифрованное сообщение/);
});
