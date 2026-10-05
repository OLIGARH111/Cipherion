import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
test('real server: simultaneous users/devices, SSE correlation, retries, forwards and durable history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-send-'));let server,base;
 async function start(){server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',s=>{const m=String(s).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});server.once('exit',()=>reject(Error('startup failed')));});}
 async function stop(){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}
 async function api(path,cookie,method='GET',data){const res=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const register=username=>api('/auth',null,'POST',{register:true,username,password:'password-testing-123'});
 let controller;
 try{
  await start();const a=await register('sendalice'),b=await register('sendbob');const device=await api('/auth',null,'POST',{username:'sendalice',password:'password-testing-123'});
  assert.equal(device.data.user.id,a.data.user.id);
  const chat=(await api('/chats',a.cookie,'POST',{kind:'group',title:'race',users:[b.data.user.id]})).data.id;
  controller=new AbortController();const stream=await fetch(base+'/api/events',{headers:{Cookie:b.cookie},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
  const key=randomUUID(),payload={body:'hello',clientMessageId:key};
  const responses=await Promise.all([api(`/chats/${chat}/messages`,a.cookie,'POST',payload),api(`/chats/${chat}/messages`,device.cookie,'POST',payload),api(`/chats/${chat}/messages`,b.cookie,'POST',payload)]);
  assert.ok(responses.every(r=>[200,201].includes(r.status)));assert.equal(responses[0].data.id,responses[1].data.id);assert.notEqual(responses[0].data.id,responses[2].data.id);
  assert.ok(responses.every(r=>r.data.clientMessageId===key));
  let events='';while(!events.includes('event: message'))events+=new TextDecoder().decode((await reader.read()).value);
  const event=events.split('\n\n').find(s=>s.startsWith('event: message'));const realtime=JSON.parse(event.split('\ndata: ')[1]);assert.equal(realtime.clientMessageId,key);assert.equal(realtime.message.clientMessageId,key);controller.abort();
  const burst=await Promise.all(Array.from({length:10},(_,i)=>api(`/chats/${chat}/messages`,i%2?a.cookie:b.cookie,'POST',{body:'burst '+i,clientMessageId:randomUUID()})));assert.ok(burst.every(r=>r.status===201));
  assert.equal((await api(`/chats/${chat}/messages`,a.cookie,'POST',{...payload,body:'changed'})).status,409);
  const forwardId=randomUUID(),source=responses[0].data.id;
  const forwards=await Promise.all([a.cookie,device.cookie].map(cookie=>api('/messages/'+source+'/forward',cookie,'POST',{chat,clientMessageId:forwardId})));assert.equal(forwards[0].data.id,forwards[1].data.id);assert.equal(forwards[0].data.clientMessageId,forwardId);
  const rows=(await api(`/chats/${chat}/messages`,device.cookie)).data;assert.equal(rows.length,13);assert.equal(new Set(rows.map(m=>m.id)).size,13);
  assert.equal((await api('/receipts',b.cookie,'POST',{chat,message:rows.at(-1).id})).status,200);assert.equal((await api(`/chats/${chat}/read`,b.cookie,'POST',{message:rows.at(-1).id})).status,200);
  await stop();await start();assert.equal((await api(`/chats/${chat}/messages`,a.cookie,'POST',payload)).data.id,source);assert.equal((await api(`/chats/${chat}/messages`,device.cookie)).data.length,13);
 }finally{controller?.abort();if(server?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
