import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<main></main>',{url:'https://cipherion.example'});
for(const key of ['window','document','localStorage','sessionStorage','navigator','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
Object.defineProperty(globalThis,'indexedDB',{value:indexedDB});
Object.defineProperty(navigator,'onLine',{configurable:true,writable:true,value:false});
after(()=>dom.window.close());
const {createOutbox}=await import('../public/outbox.js');
const {createAccountSessionManager}=await import('../public/accounts.js');
const {setActiveAccount,activeAccount}=await import('../public/account-context.js');
test('logout waits for in-flight outbox writes before erasing only the departing account cache',async()=>{
 const a=createOutbox('logout-a',()=>{}),b=createOutbox('logout-b',()=>{});let restoredA,restoredB;
 let release,started;const gate=new Promise(r=>release=r),sending=new Promise(r=>started=r);let deactivated=false,activations=[];
 globalThis.fetch=async(path)=>{
  if(path.includes('/messages')){started();await gate;throw Error('Late network failure');}
  if(path==='/api/logout')return {ok:true,json:async()=>({ok:true})};
  if(path==='/api/accounts')return {ok:true,json:async()=>[{user:{id:'logout-b'}}]};
  throw Error(path);
 };
 const manager=createAccountSessionManager({activate:async id=>activations.push(id),deactivate:async()=>{deactivated=true;await a.dispose();}});
 try{
  setActiveAccount('logout-a');await a.enqueue('a-chat',{body:'A private draft'});await b.enqueue('b-chat',{body:'B private draft'});
  await b.dispose();navigator.onLine=true;const flushing=a.flush();await sending;
  const logout=manager.logout();await new Promise(r=>setTimeout(r,0));
  assert.equal(deactivated,true);assert.equal(activeAccount(),null);assert.deepEqual(activations,[]);
  release();await flushing;await logout;
  restoredA=createOutbox('logout-a',()=>{});restoredB=createOutbox('logout-b',()=>{});
  assert.equal((await restoredA.list()).length,0);assert.equal((await restoredB.list()).length,1);
  assert.equal(activeAccount(),'logout-b');assert.deepEqual(activations,['logout-b']);
 }finally{release();await a.dispose();await b.dispose();await restoredA?.dispose();await restoredB?.dispose();}
});
