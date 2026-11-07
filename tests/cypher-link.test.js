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

test('Cypher links by code: commands from the AI section, notifications, shared memory and revocation',async()=>{
  const alice=await account('cyl_alice'),bob=await account('cyl_bob');
  assert.equal((await api('/cypher/me',{token:'cyl_'+'x'.repeat(43)})).status,401);
  assert.equal((await api('/cypher/links')).status,401);

  const first=await link(alice.cookie,'Домашний ПК');
  assert.equal(first.user.username,'cyl_alice');assert.match(first.token,/^cyl_/);assert.equal(first.bot,undefined,'no remote bot any more');
  const me=await api('/cypher/me',{token:first.token});assert.equal(me.data.user.id,alice.data.user.id);assert.equal(me.data.link.device,'Домашний ПК');
  const chatsBefore=(await api('/chats',{cookie:alice.cookie})).data;assert.ok(chatsBefore.every(c=>!c.hasBot),'linking creates no chat');

  // A command from the AI section waits for the PC, the PC takes it once and answers into the AI history.
  const links=(await api('/cypher/links',{cookie:alice.cookie})).data.links;assert.equal(links[0].online,true);
  assert.equal((await api('/cypher/remote',{cookie:bob.cookie,method:'POST',data:{link:links[0].id,text:'чужая команда'}})).status,404);
  const sent=await api('/cypher/remote',{cookie:alice.cookie,method:'POST',data:{link:links[0].id,text:'включи музыку'}});assert.equal(sent.status,201);
  assert.equal((await api('/cypher/remote/result?id='+sent.data.id,{cookie:alice.cookie})).data.status,'waiting');
  const next=(await api('/cypher/remote/next?timeout=0',{token:first.token})).data.items;assert.deepEqual(next.map(i=>i.text),['включи музыку']);
  assert.equal((await api('/cypher/remote/next?timeout=0',{token:first.token})).data.items.length,0,'handed out once');
  assert.equal((await api('/cypher/remote/result?id='+sent.data.id,{cookie:alice.cookie})).data.status,'running');
  // The person waits (long poll) while the PC replies.
  const waiting=api('/cypher/remote/result?id='+sent.data.id+'&timeout=5',{cookie:alice.cookie});
  await new Promise(r=>setTimeout(r,200));
  assert.equal((await api('/cypher/remote/reply',{token:first.token,method:'POST',data:{id:next[0].id,text:'Включаю музыку.'}})).status,200);
  const result=(await waiting).data;assert.deepEqual(result,{status:'done',reply:'Включаю музыку.'});
  assert.equal((await api('/cypher/remote/reply',{token:first.token,method:'POST',data:{id:next[0].id,text:'ещё раз'}})).status,409);
  const history=(await api('/ai/history',{cookie:alice.cookie})).data.slice(-2);
  assert.deepEqual(history.map(h=>[h.role,h.body]),[['user','💻 Домашний ПК: включи музыку'],['assistant','Включаю музыку.']]);
  // The PC waiting for commands wakes up as soon as one is sent.
  const poll=api('/cypher/remote/next?timeout=5',{token:first.token});await new Promise(r=>setTimeout(r,200));
  await api('/cypher/remote',{cookie:alice.cookie,method:'POST',data:{link:links[0].id,text:'громкость 30'}});
  assert.deepEqual((await poll).data.items.map(i=>i.text),['громкость 30']);

  // Notifications: new messages from others, not after reading.
  const dm=(await api('/chats',{cookie:bob.cookie,method:'POST',data:{users:[alice.data.user.id]}})).data;
  await api('/chats/'+dm.id+'/messages',{cookie:bob.cookie,method:'POST',data:{body:'Привет, ты дома?'}});
  const list=(await api('/cypher/notifications?after=0',{token:first.token})).data.items;
  const hello=list.find(n=>n.chat===dm.id);assert.equal(hello.sender,'cyl_bob');assert.equal(hello.text,'Привет, ты дома?');assert.equal(hello.encrypted,false);assert.equal(hello.chatKind,'direct');

  // Shared memory: the same records as the messenger's AI memory.
  const added=await api('/cypher/memory',{token:first.token,method:'POST',data:{body:'Любимый цвет — изумрудный'}});assert.equal(added.status,201);
  assert.equal((await api('/ai/memory',{cookie:alice.cookie})).data[0].body,'Любимый цвет — изумрудный');
  await api('/cypher/memory',{token:first.token,method:'POST',data:{id:added.data.id,body:'Любимый цвет — зелёный'}});
  assert.equal((await api('/cypher/memory',{token:first.token})).data[0].body,'Любимый цвет — зелёный');
  await api('/cypher/memory',{token:first.token,method:'DELETE',data:{id:added.data.id}});
  assert.equal((await api('/cypher/memory',{token:first.token})).data.length,0);
  const bobLink=await link(bob.cookie,'Ноутбук Боба');
  await api('/cypher/memory',{token:first.token,method:'POST',data:{body:'Секрет Алисы'}});
  assert.equal((await api('/cypher/memory',{token:bobLink.token})).data.length,0);
  assert.equal((await api('/cypher/remote/next?timeout=0',{token:bobLink.token})).data.items.length,0,'commands go only to the chosen PC');

  // Two PCs: each gets its own commands. Revoking one cuts only its token.
  const second=await link(alice.cookie,'Рабочий ПК');
  const all2=(await api('/cypher/links',{cookie:alice.cookie})).data.links;assert.deepEqual(all2.map(l=>l.device),['Рабочий ПК','Домашний ПК']);
  await api('/cypher/remote',{cookie:alice.cookie,method:'POST',data:{link:all2[0].id,text:'открой почту'}});
  assert.deepEqual((await api('/cypher/remote/next?timeout=0',{token:second.token})).data.items.map(i=>i.text),['открой почту']);
  assert.equal((await api('/cypher/remote/next?timeout=0',{token:first.token})).data.items.length,0);
  assert.equal((await api('/cypher/links',{cookie:bob.cookie,method:'DELETE',data:{id:all2[0].id}})).status,404);
  await api('/cypher/links',{cookie:alice.cookie,method:'DELETE',data:{id:all2[0].id}});
  assert.equal((await api('/cypher/me',{token:second.token})).status,401);assert.equal((await api('/cypher/me',{token:first.token})).status,200);
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
