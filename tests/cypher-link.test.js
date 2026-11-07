import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let server,base,dir;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'cipherion-cypher-link-'));
  server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Startup timeout')),10000);server.stdout.on('data',c=>{const m=String(c).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});server.once('error',reject);server.once('exit',c=>reject(new Error('Exit '+c)));});
});
after(async()=>{server?.kill();if(server?.exitCode===null)await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});});

async function req(path,{cookie,token,method='GET',data}={}){
  const r=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const api=(path,opts)=>req('/api'+path,opts);
const account=username=>api('/auth',{method:'POST',data:{register:true,username,name:username,password:'test-password-12345'}});
const bot=(token,method,data={})=>req('/api/bot/'+encodeURIComponent(token)+'/'+method,{method:'POST',data});

async function link(cookie,device){
  const start=await api('/cypher/link/start',{method:'POST',data:{device}});
  assert.equal(start.status,201);assert.match(start.data.code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);assert.match(start.data.url,/#cypher-link=[A-Z2-9]{8}$/);
  assert.equal((await api('/cypher/link/poll',{method:'POST',data:{secret:start.data.secret}})).data.status,'pending');
  // The person sees which computer asks, then approves; the code works with or without the dash.
  const info=await api('/cypher/link/info?code='+start.data.code.replace('-','').toLowerCase(),{cookie});assert.equal(info.data.device,device);
  assert.equal((await api('/cypher/link/approve',{cookie,method:'POST',data:{code:start.data.code}})).status,200);
  const done=await api('/cypher/link/poll',{method:'POST',data:{secret:start.data.secret}});
  assert.equal(done.data.status,'approved');
  // The secret works once.
  assert.equal((await api('/cypher/link/poll',{method:'POST',data:{secret:start.data.secret}})).status,404);
  return done.data;
}

test('Cypher links by code: personal remote bot, notifications, shared memory and revocation',async()=>{
  const alice=await account('cyl_alice'),bob=await account('cyl_bob');
  assert.equal((await api('/cypher/me',{token:'cyl_'+'x'.repeat(43)})).status,401);
  assert.equal((await api('/cypher/links')).status,401);

  const first=await link(alice.cookie,'Домашний ПК');
  assert.equal(first.user.username,'cyl_alice');assert.match(first.token,/^cyl_/);assert.match(first.bot.username,/^cypher_[a-f0-9]{10}bot$/);
  const me=await api('/cypher/me',{token:first.token});assert.equal(me.data.user.id,alice.data.user.id);assert.equal(me.data.bot.chat,first.bot.chat);assert.equal(me.data.link.remote,true);

  // The remote chat exists for the person, with the bot's welcome, and is not end-to-end encrypted.
  const chats=(await api('/chats',{cookie:alice.cookie})).data;const remote=chats.find(c=>c.id===first.bot.chat);
  assert.ok(remote);assert.equal(remote.hasBot,true);
  const welcome=(await api('/chats/'+first.bot.chat+'/messages',{cookie:alice.cookie})).data;
  assert.match(JSON.stringify(welcome),/пульт Cypher на компьютере «Домашний ПК»/);

  // Remote control: what the person writes reaches the desktop app through the bot API, the reply comes back.
  await api('/chats/'+first.bot.chat+'/messages',{cookie:alice.cookie,method:'POST',data:{body:'включи музыку'}});
  const updates=(await bot(first.bot.token,'getUpdates',{timeout:0})).data.result;
  const incoming=updates.at(-1).message;assert.equal(incoming.text,'включи музыку');assert.equal(incoming.from.id,alice.data.user.id);
  const sent=await bot(first.bot.token,'sendMessage',{chat_id:first.bot.chat,text:'Включаю музыку.'});assert.equal(sent.data.ok,true);

  // Notifications: new messages from others, not from the remote bot, not after reading.
  const dm=(await api('/chats',{cookie:bob.cookie,method:'POST',data:{users:[alice.data.user.id]}})).data;
  await api('/chats/'+dm.id+'/messages',{cookie:bob.cookie,method:'POST',data:{body:'Привет, ты дома?'}});
  const list=(await api('/cypher/notifications?after=0',{token:first.token})).data.items;
  const hello=list.find(n=>n.chat===dm.id);assert.equal(hello.sender,'cyl_bob');assert.equal(hello.text,'Привет, ты дома?');assert.equal(hello.encrypted,false);assert.equal(hello.chatKind,'direct');
  assert.ok(list.every(n=>n.chat!==first.bot.chat),'the remote chat is not announced as a notification');

  // Shared memory: the same records as the messenger's AI memory.
  const added=await api('/cypher/memory',{token:first.token,method:'POST',data:{body:'Любимый цвет — изумрудный'}});assert.equal(added.status,201);
  assert.equal((await api('/ai/memory',{cookie:alice.cookie})).data[0].body,'Любимый цвет — изумрудный');
  await api('/cypher/memory',{token:first.token,method:'POST',data:{id:added.data.id,body:'Любимый цвет — зелёный'}});
  assert.equal((await api('/cypher/memory',{token:first.token})).data[0].body,'Любимый цвет — зелёный');
  await api('/cypher/memory',{token:first.token,method:'DELETE',data:{id:added.data.id}});
  assert.equal((await api('/cypher/memory',{token:first.token})).data.length,0);
  // Another person's desktop token never reaches Alice's memory.
  const bobLink=await link(bob.cookie,'Ноутбук Боба');
  await api('/cypher/memory',{token:first.token,method:'POST',data:{body:'Секрет Алисы'}});
  assert.equal((await api('/cypher/memory',{token:bobLink.token})).data.length,0);

  // A second PC takes over the remote: the first PC's bot token stops working, its link stays.
  const second=await link(alice.cookie,'Рабочий ПК');
  assert.equal(second.bot.username,first.bot.username,'the same personal bot is reused');
  assert.equal((await bot(first.bot.token,'getMe')).status,401);assert.equal((await bot(second.bot.token,'getMe')).data.result.id,second.bot.id);
  const links=(await api('/cypher/links',{cookie:alice.cookie})).data;assert.equal(links.links.length,2);assert.deepEqual(links.links.map(l=>l.remote),[true,false]);assert.equal(links.chat,first.bot.chat);

  // Revoking a PC from the messenger cuts its desktop token and, for the remote holder, the bot token.
  assert.equal((await api('/cypher/links',{cookie:bob.cookie,method:'DELETE',data:{id:links.links[0].id}})).status,404);
  await api('/cypher/links',{cookie:alice.cookie,method:'DELETE',data:{id:links.links[0].id}});
  assert.equal((await api('/cypher/me',{token:second.token})).status,401);assert.equal((await bot(second.bot.token,'getMe')).status,401);
  assert.equal((await api('/cypher/me',{token:first.token})).status,200);
  // The desktop app can unlink itself.
  await api('/cypher/unlink',{token:first.token,method:'POST',data:{}});assert.equal((await api('/cypher/me',{token:first.token})).status,401);
});

test('Cypher link codes: declined, unknown, and not for bots or wrong accounts',async()=>{
  const carol=await account('cyl_carol');
  const start=(await api('/cypher/link/start',{method:'POST',data:{device:'ПК'}})).data;
  await api('/cypher/link/approve',{cookie:carol.cookie,method:'POST',data:{code:start.code,approve:false}});
  assert.equal((await api('/cypher/link/poll',{method:'POST',data:{secret:start.secret}})).data.status,'declined');
  assert.equal((await api('/cypher/link/approve',{cookie:carol.cookie,method:'POST',data:{code:'AAAA-BBBB'}})).status,404);
  assert.equal((await api('/cypher/link/approve',{method:'POST',data:{code:start.code}})).status,401);
  assert.equal((await api('/cypher/link/poll',{method:'POST',data:{secret:'nope'}})).status,404);
});
