import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
Object.defineProperty(globalThis,'indexedDB',{value:indexedDB});Object.defineProperty(globalThis,'window',{value:new EventTarget()});Object.defineProperty(globalThis,'navigator',{value:{onLine:false}});
const {createOutbox}=await import('../public/outbox.js');
test('offline outbox survives recreation and retries lost responses with the same idempotency key',async()=>{let changes=0;const first=createOutbox('alice',async()=>changes++);await first.enqueue('chat',{body:'offline'});const pending=await first.list();assert.equal(pending.length,1);first.dispose();const second=createOutbox('alice',async()=>changes++);const other=createOutbox('bob',async()=>{});assert.equal((await other.list()).length,0);const ids=[];let lost=true;globalThis.fetch=async(url,options)=>{ids.push(JSON.parse(options.body).clientId);if(lost){lost=false;throw new TypeError('Connection lost after server committed');}return {ok:true,json:async()=>({id:'server-id',chat_id:'chat',user_id:'alice',created:Date.now(),body:'offline'})};};navigator.onLine=true;await second.flush();assert.equal((await second.list()).length,1);await second.flush();assert.equal((await second.list()).length,0);assert.deepEqual(ids,[pending[0].id,pending[0].id]);second.dispose();other.dispose();assert.ok(changes>=3);});

