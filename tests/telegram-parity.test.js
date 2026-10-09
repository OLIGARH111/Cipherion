import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server,base,dir;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-parity-'));server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.once('exit',code=>reject(new Error('Server exit '+code)));});});
after(async()=>{server?.kill();await new Promise(resolve=>server?.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data){const response=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const account=username=>request('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});

test('saved messages is a private self chat without calls or invitations',async()=>{
  const a=await account('saveda'),b=await account('savedb');
  const saved=await request('/chats/saved',a.cookie,'POST',{});assert.equal(saved.status,201);
  assert.equal((await request('/chats',a.cookie,'POST',{kind:'saved'})).data.id,saved.data.id);
  const view=(await request('/chats',a.cookie)).data.find(c=>c.id===saved.data.id);assert.equal(view.kind,'saved');assert.equal(view.title,'Избранное');assert.equal(view.members.length,1);
  assert.equal((await request(`/chats/${saved.data.id}/messages`,a.cookie,'POST',{body:'note to self'})).status,201);
  assert.equal((await request(`/chats/${saved.data.id}/messages`,b.cookie)).status,403);
  assert.equal((await request('/calls',a.cookie,'POST',{chat:saved.data.id})).status,400);
  assert.equal((await request(`/communities/${saved.data.id}/invite`,a.cookie,'POST',{})).status,404);
  assert.equal((await request(`/chats/${saved.data.id}/members`,a.cookie,'PATCH',{action:'invite',user:b.data.user.id})).status,400);
});

test('clear history, delete chat for me or for both, and drafts',async()=>{
  const a=await account('cleara'),b=await account('clearb');
  const chat=(await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'first'});await request(`/chats/${chat.id}/messages`,b.cookie,'POST',{body:'second'});
  assert.equal((await request(`/chats/${chat.id}/clear`,a.cookie,'POST',{})).status,200);
  assert.equal((await request(`/chats/${chat.id}/messages`,a.cookie)).data.length,0);
  assert.equal((await request(`/chats/${chat.id}/messages`,b.cookie)).data.length,2);
  assert.equal((await request('/chats',a.cookie)).data.find(c=>c.id===chat.id).last,null);
  // Hidden chats come back with the next message.
  await request(`/chats/${chat.id}/hide`,a.cookie,'POST',{});
  assert.equal((await request('/chats',a.cookie)).data.some(c=>c.id===chat.id),false);
  await request(`/chats/${chat.id}/messages`,b.cookie,'POST',{body:'are you there?'});
  const back=(await request('/chats',a.cookie)).data.find(c=>c.id===chat.id);assert.equal(back.last.body,'are you there?');assert.equal(back.unread,1);
  // Re-opening a hidden private chat from search restores it immediately.
  await request(`/chats/${chat.id}/hide`,a.cookie,'POST',{});
  assert.equal((await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data.id,chat.id);
  assert.ok((await request('/chats',a.cookie)).data.some(c=>c.id===chat.id));
  await request(`/chats/${chat.id}/hide`,a.cookie,'POST',{forEveryone:true});
  assert.equal((await request(`/chats/${chat.id}/messages`,b.cookie)).data.length,0);
  assert.equal((await request('/chats',b.cookie)).data.some(c=>c.id===chat.id),false);
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'G',users:[b.data.user.id]})).data;
  assert.equal((await request(`/chats/${group.id}/clear`,a.cookie,'POST',{forEveryone:true})).status,400);
  assert.equal((await request(`/chats/${group.id}/hide`,a.cookie,'POST',{})).status,400);
  assert.equal((await request(`/chats/${group.id}/draft`,a.cookie,'PUT',{body:'unsent words'})).status,200);
  assert.equal((await request('/chats',a.cookie)).data.find(c=>c.id===group.id).draft.body,'unsent words');
  assert.equal((await request('/chats',b.cookie)).data.find(c=>c.id===group.id).draft,null);
  await request(`/chats/${group.id}/draft`,a.cookie,'PUT',{body:''});
  assert.equal((await request('/chats',a.cookie)).data.find(c=>c.id===group.id).draft,null);
});

test('global search finds messages, media and links only in the user\'s chats',async()=>{
  const a=await account('searcha'),b=await account('searchb'),c=await account('searchc');
  const chat=(await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'Встреча в Пятницу у фонтана'});
  await request(`/chats/${chat.id}/messages`,b.cookie,'POST',{body:'Ссылка https://example.com/plan'});
  const upload=await fetch(base+'/api/media',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'image/png','X-File-Name':'vacation.png'},body:Buffer.from('89504e470d0a1a0a0000000d49484452','hex')});const media=await upload.json();
  if(upload.status===201)await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{kind:'photo',media:media.id});
  const found=(await request('/search?q='+encodeURIComponent('пятницу'),a.cookie)).data;assert.equal(found.length,1);assert.equal(found[0].chat_id,chat.id);
  assert.equal((await request('/search?q='+encodeURIComponent('пятницу'),c.cookie)).data.length,0);
  const links=(await request('/search?type=links&q=plan',b.cookie)).data;assert.equal(links.length,1);
  if(upload.status===201)assert.equal((await request('/search?type=media&q=vacation',b.cookie)).data.length,1);
  await request(`/chats/${chat.id}/clear`,a.cookie,'POST',{});
  assert.equal((await request('/search?q='+encodeURIComponent('пятницу'),a.cookie)).data.length,0);
});

test('own reaction is reported so a double tap can toggle it',async()=>{
  const a=await account('reacta'),b=await account('reactb');
  const chat=(await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  const m=(await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'hi'})).data;
  await request('/reactions',b.cookie,'POST',{message:m.id,emoji:'❤️'});
  const [mine]=(await request(`/chats/${chat.id}/messages`,b.cookie)).data;assert.equal(mine.myReaction,'❤️');
  const [theirs]=(await request(`/chats/${chat.id}/messages`,a.cookie)).data;assert.equal(theirs.myReaction,null);
});

test('password recovery with the one-time key shown at registration',async()=>{
  const a=await account('recovera');assert.match(a.data.recoveryKey,/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
  const reset=body=>request('/auth/password-reset',null,'POST',{username:'recovera',...body});
  assert.equal((await reset({key:'AAAA-BBBB-CCCC-DDDD-EEEE',password:'brand-new-password'})).status,401);
  assert.equal((await reset({key:a.data.recoveryKey,password:'short'})).status,400);
  // An open realtime stream must be closed without crashing the server.
  const controller=new AbortController(),stream=await fetch(base+'/api/events',{headers:{Cookie:a.cookie},signal:controller.signal});await stream.body.getReader().read();
  const ok=await reset({key:a.data.recoveryKey.toLowerCase(),password:'brand-new-password'});controller.abort();assert.equal(ok.status,200);assert.ok(ok.data.recoveryKey);assert.notEqual(ok.data.recoveryKey,a.data.recoveryKey);
  assert.equal((await request('/me',a.cookie)).status,401,'old sessions end');
  assert.equal((await reset({key:a.data.recoveryKey,password:'another-password-1'})).status,401,'keys are single use');
  assert.equal((await request('/auth',null,'POST',{username:'recovera',password:'test-password-12345'})).status,401);
  const login=await request('/auth',null,'POST',{username:'recovera',password:'brand-new-password'});assert.equal(login.status,200);
  assert.equal((await request('/recovery-key',login.cookie,'POST',{password:'wrong-password-1'})).status,403);
  const rotated=await request('/recovery-key',login.cookie,'POST',{password:'brand-new-password'});assert.equal(rotated.status,200);
  assert.ok((await request('/recovery-key',login.cookie)).data.created);
  assert.equal((await request('/password',login.cookie,'POST',{password:'brand-new-password',newPassword:'third-password-123'})).status,200);
  assert.equal((await request('/auth',null,'POST',{username:'recovera',password:'third-password-123'})).status,200);
});
