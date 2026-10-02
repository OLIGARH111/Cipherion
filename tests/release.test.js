import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {health,logFailure,vipState} from '../server/release.js';
import {backupBeforeMigration} from '../server/migrations.js';
import {createBackup,verifyBackup} from '../scripts/backup.js';
import {totp} from '../server/security.js';

test('health reports real database failure without exposing internal details; logs never serialize the error',()=>{
  const db=new DatabaseSync(':memory:');assert.equal(health(db).status,200);db.close();
  const old=console.error,lines=[];console.error=line=>lines.push(line);
  try{assert.deepEqual(health(db),{status:503,body:{ok:false,backend:'up',database:'unavailable'}});}finally{console.error=old;}
  const error=Object.assign(new Error('password=secret postgres://private:secret@host token=secret'),{code:'ERR_SQLITE_ERROR'});
  logFailure('request_failed',error,'request-id',line=>lines.push(line));
  assert.ok(lines.every(line=>!line.includes('secret')&&!line.includes('postgres://')));
  assert.equal(JSON.parse(lines.at(-1)).requestId,'request-id');
});
test('VIP states exclude future grants and distinguish lifetime, expiry and revocation',()=>{
  const grant={source:'paid',starts:0,expires:200,revoked:0};
  assert.equal(vipState([],100).status,'Free');assert.equal(vipState([grant],100).status,'Active');
  assert.equal(vipState([{...grant,source:'gift'}],100).status,'Gifted');
  assert.equal(vipState([{...grant,expires:null}],100).status,'Lifetime');
  assert.equal(vipState([{...grant,revoked:1}],100).status,'Cancelled');
  assert.equal(vipState([grant],200).status,'Expired');assert.equal(vipState([{...grant,starts:150}],100).active,false);
});
test('backup includes committed WAL data and media; restore is verifiable and corruption is rejected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cipherion-backup-'));let db;
  try {
    const source=join(root,'source'),destination=join(root,'snapshot');await mkdir(join(source,'media'),{recursive:true});
    db=new DatabaseSync(join(source,'cipherion.sqlite'));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE media(id TEXT PRIMARY KEY,size INTEGER); INSERT INTO media VALUES('media-id',5)");
    await writeFile(join(source,'media','media-id'),'hello');
    await createBackup(source,destination);await verifyBackup(destination);
    const restored=join(root,'restored');await cp(destination,restored,{recursive:true});await verifyBackup(restored);
    const check=new DatabaseSync(join(restored,'cipherion.sqlite'),{readOnly:true});assert.equal(check.prepare('SELECT COUNT(*) n FROM media').get().n,1);check.close();
    await assert.rejects(createBackup(source,destination));
    await writeFile(join(destination,'media','media-id'),'wrong');await assert.rejects(verifyBackup(destination),/checksum/);
    const pre=await backupBeforeMigration(source);assert.ok(pre);const copy=new DatabaseSync(pre,{readOnly:true});assert.equal(copy.prepare('SELECT size FROM media').get().size,5);copy.close();
  }finally{db?.close();await rm(root,{recursive:true,force:true});}
});
test('release API regressions: concurrent retry, conflict, multi-device receipts, restart, 2FA replay, JSON validation and private media',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cipherion-release-'));let child,base;
  const snapshot=dir+'-snapshot',restored=dir+'-restored';
  async function start(dataDir=dir){
    child=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dataDir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Server startup timed out'));},10000);child.stdout.on('data',chunk=>{const url=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);resolve(url[0]);}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped before startup'));});});
  }
  async function stop(){if(child?.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
  async function request(path,cookie,method='GET',body){const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const password='release-test-password';
  try {
    await start();assert.equal((await (await fetch(base+'/health')).json()).database,'up');
    for(const body of [null,[],1,'text'])assert.equal((await request('/auth',null,'POST',body)).status,400);
    const alice=await request('/auth',null,'POST',{register:true,username:'release_alice',password}),bob=await request('/auth',null,'POST',{register:true,username:'release_bob',password}),eve=await request('/auth',null,'POST',{register:true,username:'release_eve',password});
    assert.equal(alice.status,200);assert.equal(bob.status,200);
    assert.equal((await request('/me',alice.cookie,'PATCH',{name:'Alice Release'})).status,200);
    assert.equal((await request('/users?q=release_alice',bob.cookie)).data[0].name,'Alice Release');
    const bob2=await request('/auth',null,'POST',{username:'release_bob',password});
    const chat=(await request('/chats',alice.cookie,'POST',{users:[bob.data.user.id]})).data;
    const path='/chats/'+chat.id+'/messages',payload={body:'reliable',clientId:'release-client-12345678'};
    const sent=await Promise.all(Array.from({length:6},()=>request(path,alice.cookie,'POST',payload)));
    assert.ok(sent.every(r=>[200,201].includes(r.status)));assert.equal(new Set(sent.map(r=>r.data.id)).size,1);
    const mid=sent[0].data.id;
    assert.equal((await request(path,alice.cookie,'POST',{...payload,body:'changed'})).status,409);
    assert.equal((await request(path,alice.cookie,'POST',{body:'empty key',clientId:''})).status,400);
    assert.equal((await request(path+'?before=nope',bob.cookie)).status,400);
    assert.equal((await request(path,eve.cookie)).status,403);
    assert.equal((await request(path+'?beforeId=missing-time',bob.cookie)).status,400);
    const history=(await request('/chats',alice.cookie,'POST',{kind:'group',title:'Cursor regression',users:[bob.data.user.id]})).data;
    const seed=new DatabaseSync(join(dir,'cipherion.sqlite'));
    try {
      const insert=seed.prepare('INSERT INTO messages(id,chat_id,user_id,body,kind,created) VALUES(?,?,?,?,?,?)');
      for(let i=0;i<125;i++)insert.run('cursor-'+String(i).padStart(4,'0'),history.id,alice.data.user.id,'same timestamp','text',1000);
    }finally{seed.close();}
    let cursor='',ids=[];
    for(let page=0;page<4;page++){
      const result=await request('/chats/'+history.id+'/messages'+cursor,bob.cookie);assert.equal(result.status,200);
      if(!result.data.length)break;
      ids.push(...result.data.map(m=>m.id));const first=result.data[0];cursor='?before='+first.created+'&beforeId='+encodeURIComponent(first.id);
    }
    assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);

    assert.equal((await request('/receipts',bob2.cookie,'POST',{chat:chat.id,message:mid})).status,200);
    assert.equal((await request('/chats/'+chat.id+'/read',bob.cookie,'POST',{message:mid})).status,200);
    const peers=(await request('/chats',bob2.cookie)).data[0].members;assert.ok(peers.find(m=>m.user_id===bob.data.user.id).read_at>0);
    const upload=await fetch(base+'/api/media',{method:'POST',headers:{Cookie:alice.cookie,'Content-Type':'text/plain','X-File-Name':'release.txt'},body:'private file'});assert.equal(upload.status,201);const media=await upload.json();
    await request(path,alice.cookie,'POST',{kind:'file',media:media.id,clientId:'release-file-123456789'});
    assert.equal((await fetch(base+'/api/media/'+media.id,{headers:{Cookie:eve.cookie}})).status,403);
    const setup=await request('/security/2fa/setup',alice.cookie,'POST',{password}),code=totp(setup.data.secret);
    assert.equal((await request('/security/2fa/confirm',alice.cookie,'POST',{password,code})).status,200);
    assert.equal((await request('/auth',null,'POST',{username:'release_alice',password,code})).status,401);
    assert.equal((await request('/admin/vip/grant',eve.cookie,'POST',{admin:true,user:eve.data.user.id,lifetime:true})).status,403);
    await stop();await start();
    assert.equal((await request(path,bob2.cookie)).data.filter(m=>m.id===mid).length,1);
    assert.equal((await request(path,alice.cookie,'POST',payload)).data.id,mid);
    assert.equal((await request(path,alice.cookie,'POST',{...payload,body:'changed after restart'})).status,409);
    assert.equal(await (await fetch(base+'/api/media/'+media.id,{headers:{Cookie:bob2.cookie}})).text(),'private file');
    assert.equal((await request('/logout',bob.cookie,'POST',{})).status,200);
    assert.equal((await request('/me',bob.cookie)).status,401);assert.equal((await request('/me',bob2.cookie)).status,200);
    assert.equal((await request('/auth',null,'POST',{username:'release_bob',password})).status,200);
    const db=new DatabaseSync(join(dir,'cipherion.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,1);db.close();
    await stop();await createBackup(dir,snapshot);await cp(snapshot,restored,{recursive:true});await verifyBackup(restored);await start(restored);
    assert.equal((await request(path,bob2.cookie)).data.find(m=>m.id===mid).body,'reliable');
    assert.equal(await (await fetch(base+'/api/media/'+media.id,{headers:{Cookie:bob2.cookie}})).text(),'private file');
  }finally{await stop();for(const directory of [dir,snapshot,restored])await rm(directory,{recursive:true,force:true});}
});

test('client maps transport and non-JSON failures to clear messages while preserving authorization status',async()=>{
  const {api}=await import('../public/ui.js');const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>{throw new TypeError('Load failed');};
    await assert.rejects(api('/me'),/Нет соединения/);
    globalThis.fetch=async()=>new Response('Internal Server Error',{status:502});
    await assert.rejects(api('/me'),{status:502,message:'Сервер временно недоступен. Попробуйте позже.'});
    globalThis.fetch=async()=>Response.json({error:'Нет доступа'},{status:403});
    await assert.rejects(api('/me'),{status:403,message:'Нет доступа'});
  }finally{globalThis.fetch=original;}
});
