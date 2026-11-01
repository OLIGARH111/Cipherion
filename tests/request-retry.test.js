import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="toast"></div>',{url:'https://cipherion.example'});
for(const key of ['window','document','navigator','localStorage','location'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
after(()=>dom.window.close());
const html=status=>({ok:false,status,json:async()=>{throw new SyntaxError('Unexpected token <');}});
const json=(status,data)=>({ok:status<400,status,json:async()=>data});
let replies=[],calls=[];
globalThis.fetch=async(url,options={})=>{calls.push(options.method||'GET');const next=replies.shift();if(next instanceof Error)throw next;return next;};
const {api}=await import('../public/ui.js');

test('reads ride out a server restart: proxy error pages and dropped connections are retried quietly',async()=>{
 replies=[html(502),new TypeError('Failed to fetch'),json(200,{ok:1})];calls=[];
 assert.deepEqual(await api('/chats'),{ok:1});assert.equal(calls.length,3);
});
test('errors written by the app itself are shown at once, never retried',async()=>{
 replies=[json(503,{error:'AI-провайдер не настроен'})];calls=[];
 await assert.rejects(api('/ai'),/AI-провайдер не настроен/);assert.equal(calls.length,1);
 replies=[json(404,{error:'Не найдено'})];calls=[];await assert.rejects(api('/x'),/Не найдено/);assert.equal(calls.length,1);
});
test('writes are never repeated automatically',async()=>{
 replies=[html(502)];calls=[];
 await assert.rejects(api('/chats','POST',{}),/Сервер временно недоступен/);assert.equal(calls.length,1);
});
