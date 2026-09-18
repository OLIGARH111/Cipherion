import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server,base,dir;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-test-'));server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.once('exit',code=>reject(new Error('Server exit '+code)));});});
after(async()=>{server?.kill();await new Promise(resolve=>server?.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data){const response=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function account(username){return request('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});}
test('real accounts, persistent messages, media ACL, polling and server-enforced group restrictions',async()=>{
  const a=await account('alice'),b=await account('bob'),c=await account('charlie');assert.equal(a.status,200);assert.ok(a.cookie);
  assert.equal((await request('/chats')).status,401);
  assert.equal((await request('/auth',null,'POST',{username:'alice',password:'incorrect-123'})).status,401);
  const chat=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Test group',users:[b.data.user.id]})).data;
  const id=chat.id;assert.ok(id);
  assert.equal((await request(`/chats/${id}/messages`,c.cookie)).status,403);
  const streamController=new AbortController();const stream=await fetch(base+'/api/events',{headers:{Cookie:b.cookie},signal:streamController.signal});const reader=stream.body.getReader();await reader.read();
  const msg=await request(`/chats/${id}/messages`,a.cookie,'POST',{body:'hello from Alice'});assert.equal(msg.status,201);
  let events='';for(let n=0;n<10&&!events.includes('event: message');n++)events+=new TextDecoder().decode((await reader.read()).value);assert.match(events,/event: message/);streamController.abort();
  assert.equal((await request(`/chats/${id}/messages`,b.cookie)).data[0].body,'hello from Alice');
  assert.equal((await request('/messages/'+msg.data.id,b.cookie,'PATCH',{body:'tampered'})).status,403);
  assert.equal((await request('/messages/'+msg.data.id,a.cookie,'PATCH',{body:'edited'})).status,200);
  await request(`/chats/${id}/members`,a.cookie,'PATCH',{action:'restrict',user:b.data.user.id,permissions:{text:false}});
  assert.equal((await request(`/chats/${id}/messages`,b.cookie,'POST',{body:'forbidden'})).status,403);
  await request(`/chats/${id}/members`,a.cookie,'PATCH',{action:'restrict',user:b.data.user.id,permissions:{}});
  assert.equal((await request(`/chats/${id}/messages`,b.cookie,'POST',{body:'allowed'})).status,201);
  assert.equal((await request(`/chats/${id}/members`,b.cookie,'PATCH',{action:'admin',user:a.data.user.id,enabled:true})).status,403);
  const uploaded=await fetch(base+'/api/media',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'text/plain','X-File-Name':'test.txt'},body:'private attachment'});const media=await uploaded.json();assert.equal(uploaded.status,201);
  assert.equal((await fetch(base+'/api/media/'+media.id,{headers:{Cookie:b.cookie}})).status,403);
  await request(`/chats/${id}/messages`,a.cookie,'POST',{kind:'file',media:media.id});
  assert.equal((await fetch(base+'/api/media/'+media.id,{headers:{Cookie:b.cookie}})).status,200);
  assert.equal((await fetch(base+'/api/media/'+media.id,{headers:{Cookie:c.cookie}})).status,403);
  const poll=await request(`/chats/${id}/messages`,a.cookie,'POST',{kind:'poll',body:'Choose',poll:{options:['A','B'],anonymous:true}});
  assert.equal((await request(`/messages/${poll.data.id}/vote`,b.cookie,'POST',{choices:[2]})).status,400);
  assert.equal((await request(`/messages/${poll.data.id}/vote`,b.cookie,'POST',{choices:[1]})).status,200);
  assert.equal((await request(`/messages/${poll.data.id}/vote`,b.cookie,'POST',{choices:[1]})).status,200);
  const messages=(await request(`/chats/${id}/messages`,b.cookie)).data;assert.equal(messages.find(m=>m.id===poll.data.id).poll.total,1);
  await request(`/chats/${id}/members`,a.cookie,'PATCH',{action:'ban',user:b.data.user.id});
  assert.equal((await request(`/chats/${id}/messages`,b.cookie)).status,403);assert.equal((await fetch(base+'/api/media/'+media.id,{headers:{Cookie:b.cookie}})).status,403);
  const csrf=await fetch(base+'/api/chats',{method:'POST',headers:{Cookie:a.cookie,Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  assert.equal((await request('/logout',a.cookie,'POST',{})).status,200);assert.equal((await request('/me',a.cookie)).status,401);
});
test('direct chat deduplication and blocks apply to messages and calls',async()=>{
  const a=await account('diana'),b=await account('eric');const payload={users:[b.data.user.id]};const chat=await request('/chats',a.cookie,'POST',payload);const again=await request('/chats',a.cookie,'POST',payload);assert.equal(chat.data.id,again.data.id);
  await request('/blocks',b.cookie,'POST',{target:a.data.user.id});assert.equal((await request(`/chats/${chat.data.id}/messages`,a.cookie,'POST',{body:'hello'})).status,403);assert.equal((await request('/calls',a.cookie,'POST',{chat:chat.data.id})).status,403);
});
