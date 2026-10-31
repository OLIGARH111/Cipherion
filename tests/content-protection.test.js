import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server,base,dir;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-protect-'));server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.once('exit',code=>reject(new Error('Server exit '+code)));});});
after(async()=>{server?.kill();await new Promise(resolve=>server?.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data){const response=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const account=username=>request('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});

test('private chat protection: either side switches it, nobody can forward',async()=>{
  const a=await account('protecta'),b=await account('protectb');
  const chat=(await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  const saved=(await request('/chats/saved',b.cookie,'POST',{})).data;
  const msg=(await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'secret draft'})).data;
  assert.equal((await request('/chats',a.cookie)).data.find(c=>c.id===chat.id).canShare,true);
  assert.equal((await request(`/chats/${chat.id}/protection`,b.cookie,'POST',{enabled:true})).status,200);
  const view=(await request('/chats',a.cookie)).data.find(c=>c.id===chat.id);assert.equal(view.protect_content,1);assert.equal(view.canShare,false);
  for(const who of [a,b])assert.equal((await request(`/messages/${msg.id}/forward`,who.cookie,'POST',{chat:saved.id})).status,403);
  assert.equal((await request(`/chats/${chat.id}/protection`,a.cookie,'POST',{enabled:'yes'})).status,400);
  assert.equal((await request(`/chats/${chat.id}/protection`,a.cookie,'POST',{enabled:false})).status,200);
  assert.equal((await request(`/messages/${msg.id}/forward`,b.cookie,'POST',{chat:saved.id})).status,201);
  assert.equal((await request(`/chats/${saved.id}/protection`,b.cookie,'POST',{enabled:true})).status,400);
});

test('channel protection: only the owner switches it; subscribers cannot forward, owner can',async()=>{
  const a=await account('protectowner'),c=await account('protectsub');
  const channel=(await request('/chats',a.cookie,'POST',{kind:'channel',title:'Art',users:[c.data.user.id]})).data;
  const post=(await request(`/chats/${channel.id}/messages`,a.cookie,'POST',{body:'original artwork'})).data;
  const savedC=(await request('/chats/saved',c.cookie,'POST',{})).data,savedA=(await request('/chats/saved',a.cookie,'POST',{})).data;
  assert.equal((await request(`/chats/${channel.id}/protection`,c.cookie,'POST',{enabled:true})).status,403);
  assert.equal((await request(`/chats/${channel.id}/protection`,a.cookie,'POST',{enabled:true})).status,200);
  assert.equal((await request('/chats',c.cookie)).data.find(x=>x.id===channel.id).canShare,false);
  assert.equal((await request('/chats',a.cookie)).data.find(x=>x.id===channel.id).canShare,true);
  assert.equal((await request(`/messages/${post.id}/forward`,c.cookie,'POST',{chat:savedC.id})).status,403);
  assert.equal((await request(`/messages/${post.id}/forward`,a.cookie,'POST',{chat:savedA.id})).status,201);
});
