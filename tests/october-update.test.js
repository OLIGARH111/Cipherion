import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,unlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createStorage,validateUpload} from '../server/storage.js';
import {migrateNullableUsername} from '../server/email-migration.js';
import {mediaReferenced} from '../server/media-references.js';
import {createBackup,verifyBackup} from '../scripts/backup.js';
let server,base,dir,mail;const mailbox=[];
async function start(){server=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'test',DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',EMAIL_AUTH_ENABLED:'1',EMAIL_CODE_SECRET:'test-only-secret-'.repeat(4),EMAIL_VERIFICATION_URL:`http://127.0.0.1:${mail.address().port}`},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{let errors='';server.stderr.on('data',b=>errors+=b);server.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0]);});server.once('exit',()=>reject(Error(errors)));});}
async function stop(){server.kill();await new Promise(r=>server.once('exit',r));}
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-october-'));mail=createServer(async(req,res)=>{let s='';for await(const b of req)s+=b;mailbox.push(JSON.parse(s));res.end('{}');});await new Promise(r=>mail.listen(0,'127.0.0.1',r));await start();});
after(async()=>{if(server?.exitCode===null)await stop();await new Promise(r=>mail.close(r));await rm(dir,{recursive:true,force:true});});
const device=()=>({cookies:new Map(),user:null});
async function request(path,d,method='GET',body,override){const r=await fetch(base+'/api'+path,{method,headers:{Cookie:d?[...d.cookies].map(([k,v])=>k+'='+v).join('; '):'',...(override||d?.user?{'X-Cipherion-Account':override||d.user}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(d)for(const line of r.headers.getSetCookie()){const [key,value]=line.split(';')[0].split('=');if(value)d.cookies.set(key,value);else d.cookies.delete(key);}return {status:r.status,data:await r.json()};}
async function register(email,d=device()){const r=await request('/auth/email/start',d,'POST',{purpose:'register',email,firstName:'Имя',lastName:'Фамилия'});assert.equal(r.status,200,JSON.stringify(r.data));const confirm=await request('/auth/email/confirm',d,'POST',{challengeId:r.data.challengeId,code:mailbox.findLast(m=>m.to===email.toLowerCase()).code});assert.equal(confirm.status,200,JSON.stringify(confirm.data));d.user=confirm.data.user.id;return {d,user:confirm.data.user,challenge:r.data};}
const sql=fn=>{const db=new DatabaseSync(join(dir,'cipherion.sqlite'));try{return fn(db);}finally{db.close();}};
let a,b,c;
test('email registration validates input, one-use codes, no username, independent cookies, server identity and restart',async()=>{
 const d=device();assert.equal((await request('/auth/email/start',d,'POST',{purpose:'register',email:'bad',firstName:'A',lastName:'B'})).status,400);
 a=await register('ALICE@example.test',d);assert.equal(a.user.username,null);assert.equal(a.user.emailVerified,true);assert.equal((await request('/me',d)).data.user.id,a.user.id);
 assert.equal((await request('/auth/email/confirm',d,'POST',{challengeId:a.challenge.challengeId,code:mailbox[0].code})).status,400);
 b=await register('bob@example.test',d);assert.equal((await request('/accounts',d)).data.length,2);assert.equal((await request('/me',d,'GET',undefined,a.user.id)).data.user.id,a.user.id);assert.equal((await request('/me',d,'GET',undefined,randomUUID())).status,401);
 const outsider=device();assert.equal((await request('/me',outsider,'GET',undefined,a.user.id)).status,401);
 assert.equal((await request('/profile/details',d,'PATCH',{username:'alice_handle'},a.user.id)).status,200);assert.equal((await request('/profile/details',d,'PATCH',{username:'alice_handle'},b.user.id)).status,409);
 const direct=await request('/chats',d,'POST',{users:[b.user.id]},a.user.id);assert.equal(direct.status,201);assert.equal((await request('/chats/'+direct.data.id+'/messages',d,'POST',{body:'From A'},a.user.id)).data.user_id,a.user.id);
 c=await register('carol@example.test');assert.equal((await request('/chats/'+direct.data.id+'/messages',c.d)).status,403);
 await stop();await start();assert.equal((await request('/me',d,'GET',undefined,a.user.id)).status,200);assert.equal((await request('/me',d,'GET',undefined,b.user.id)).status,200);
 assert.equal((await request('/logout',d,'POST',{},b.user.id)).status,200);assert.equal((await request('/me',d,'GET',undefined,b.user.id)).status,401);assert.equal((await request('/me',d,'GET',undefined,a.user.id)).status,200);d.user=a.user.id;
});
test('email errors retain account safety: attempts, expiry, cooldown, neutral recovery and verified change',async()=>{
 const d=device();const start=await request('/auth/email/start',d,'POST',{purpose:'register',email:'wrong@example.test',firstName:'A',lastName:'B'});const code=mailbox.at(-1).code;
 assert.equal((await request('/auth/email/start',d,'POST',{purpose:'register',email:'wrong@example.test',firstName:'A',lastName:'B'})).status,429);
 for(let i=0;i<5;i++)assert.equal((await request('/auth/email/confirm',d,'POST',{challengeId:start.data.challengeId,code:code==='000000'?'999999':'000000'})).status,400);
 assert.equal((await request('/auth/email/confirm',d,'POST',{challengeId:start.data.challengeId,code})).status,400);
 sql(db=>db.prepare('UPDATE email_cooldowns SET last_sent=0 WHERE email=?').run('wrong@example.test'));
 const renewed=await request('/auth/email/start',d,'POST',{purpose:'register',email:'wrong@example.test',firstName:'A',lastName:'B'});assert.equal(renewed.status,200);sql(db=>db.prepare('UPDATE email_challenges SET expires=0 WHERE id=?').run(renewed.data.challengeId));assert.equal((await request('/auth/email/confirm',d,'POST',{challengeId:renewed.data.challengeId,code:mailbox.at(-1).code})).status,400);
 const missing=await request('/auth/email/start',d,'POST',{purpose:'recovery',email:'absent@example.test'});const sent=mailbox.length;sql(db=>db.prepare('UPDATE email_cooldowns SET last_sent=0 WHERE email=?').run('alice@example.test'));
 const existing=await request('/auth/email/start',d,'POST',{purpose:'recovery',email:'alice@example.test'});assert.equal(existing.data.message,missing.data.message);assert.equal(mailbox.length,sent+1);const recovered=await request('/auth/email/confirm',d,'POST',{challengeId:existing.data.challengeId,code:mailbox.at(-1).code});assert.equal(recovered.data.user.id,a.user.id);
 const change=await request('/auth/email/start',a.d,'POST',{purpose:'change',email:'newalice@example.test'});assert.equal(change.status,200);assert.equal((await request('/me',a.d)).data.user.email,'alice@example.test');assert.equal((await request('/auth/email/confirm',c.d,'POST',{challengeId:change.data.challengeId,code:mailbox.at(-1).code})).status,403);assert.equal((await request('/auth/email/confirm',a.d,'POST',{challengeId:change.data.challengeId,code:mailbox.at(-1).code})).status,200);assert.equal((await request('/me',a.d)).data.user.email,'newalice@example.test');
 sql(db=>{const row=db.prepare('SELECT code_hash,payload FROM email_challenges WHERE id=?').get(change.data.challengeId);assert.equal(row.code_hash.length,64);assert.ok(!row.payload.includes(mailbox.at(-1).code));});
});
test('channels enforce publication, editing, reactions, invitation and owner-only deletion through real APIs',async()=>{
 const channel=(await request('/chats',a.d,'POST',{kind:'channel',title:'Broadcast',users:[c.user.id]})).data;const cid=channel.id;
 assert.equal(channel.canPost,true);assert.equal((await request('/chats',c.d)).data.find(c=>c.id===cid).canPost,false);
 const message=(await request('/chats/'+cid+'/messages',a.d,'POST',{body:'Publication'})).data;
 for(const payload of [{body:'forbidden'},{kind:'poll',body:'poll',poll:{options:['A','B']}},{kind:'photo',media:'fake'}])assert.equal((await request('/chats/'+cid+'/messages',c.d,'POST',payload)).status,403);
 await request('/chats/'+cid+'/members',a.d,'PATCH',{action:'restrict',user:c.user.id,permissions:{text:true,photo:true}});assert.equal((await request('/chats/'+cid+'/messages',c.d,'POST',{body:'still forbidden'})).status,403);
 await request('/chats/'+cid+'/members',a.d,'PATCH',{action:'admin',user:c.user.id,enabled:true,permissions:{edit:true}});assert.equal((await request('/chats/'+cid+'/messages',c.d,'POST',{body:'no publish permission'})).status,403);assert.equal((await request('/messages/'+message.id,c.d,'PATCH',{body:'Edited by editor'})).status,200);assert.equal((await request('/messages/'+message.id,c.d,'DELETE',{})).status,403);
 await request('/chats/'+cid+'/members',a.d,'PATCH',{action:'admin',user:c.user.id,enabled:true,permissions:{canPost:true,delete:true}});assert.equal((await request('/chats/'+cid+'/messages',c.d,'POST',{body:'Authorized publication'})).status,201);assert.equal((await request('/communities/'+cid,c.d,'DELETE',{})).status,403);
 await request('/chats/'+cid,a.d,'PATCH',{reactionsEnabled:false});assert.equal((await request('/reactions',c.d,'POST',{message:message.id,emoji:'👍'})).status,403);
 const invite=(await request('/communities/'+cid+'/invite',a.d,'POST',{})).data.invite;
 assert.equal((await request('/communities/'+cid+'/leave',c.d,'POST',{})).status,200);
 assert.equal((await request('/communities/'+cid+'/join',c.d,'POST',{invite:'wrong'})).status,403);
 assert.equal((await request('/communities/'+cid+'/join',c.d,'POST',{invite})).status,200);
 assert.equal((await request('/chats/'+cid+'/messages',c.d,'POST',{body:'Rejoined as subscriber'})).status,403);
 const group=(await request('/chats',a.d,'POST',{kind:'group',users:[c.user.id]})).data;assert.equal((await request('/chats/'+group.id+'/messages',c.d,'POST',{body:'Group member can write'})).status,201);
 const controller=new AbortController();const stream=await fetch(base+'/api/events?account='+c.user.id,{headers:{Cookie:[...c.d.cookies].map(([k,v])=>k+'='+v).join('; ')},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
 assert.equal((await request('/communities/'+cid,a.d,'DELETE',{})).status,200);let events='';for(let i=0;i<10&&!events.includes('chat-deleted');i++)events+=new TextDecoder().decode((await reader.read()).value);controller.abort();assert.match(events,/chat-deleted/);assert.ok(!(await request('/chats',c.d)).data.some(c=>c.id===cid));assert.equal((await request('/communities/'+group.id,a.d,'DELETE',{})).status,200);
});
test('non-destructive nullable username migration retains original users, sessions, FK targets and data',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,name TEXT,password TEXT,created INTEGER);CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));INSERT INTO users VALUES('a','alice','Alice','hash',1);INSERT INTO sessions VALUES('session','a');");assert.equal(migrateNullableUsername(db).changed,true);db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('b',null,'Bob','',2);assert.equal(db.prepare('SELECT COUNT(*) n FROM users_before_email').get().n,1);assert.equal(db.prepare('PRAGMA foreign_key_list(sessions)').get().table,'users');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(migrateNullableUsername(db).changed,false);}finally{db.close();}
});
test('object storage verifies upload, survives local deletion/restart, ranges and shared-reference cleanup',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'cipherion-storage-')),objects=new Map();const db=new DatabaseSync(join(tmp,'cipherion.sqlite'));const client={send:async command=>{const p=command.input;if(command.constructor.name==='PutObjectCommand'){const chunks=[];for await(const b of p.Body)chunks.push(b);objects.set(p.Key,{bytes:Buffer.concat(chunks),meta:p.Metadata});return {};}const object=objects.get(p.Key);if(!object)throw Object.assign(Error('missing'),{name:'NoSuchKey'});if(command.constructor.name==='HeadObjectCommand')return {ContentLength:object.bytes.length,Metadata:object.meta};if(command.constructor.name==='GetObjectCommand'){let bytes=object.bytes;if(p.Range){const [start,end]=p.Range.slice(6).split('-').map(Number);bytes=bytes.subarray(start,end+1);}return {Body:(async function*(){yield bytes;})()};}if(command.constructor.name==='DeleteObjectCommand'){objects.delete(p.Key);return {};}}};
 const config={db,one:(s,...p)=>db.prepare(s).get(...p),run:(s,...p)=>db.prepare(s).run(...p),data:tmp,client,env:{S3_BUCKET:'test',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test'}};
 try{await mkdir(join(tmp,'media'));await writeFile(join(tmp,'media','photo'),'persistent media');let storage=createStorage(config);await storage.persist('media','photo','owner',join(tmp,'media','photo'),'text/plain');await unlink(join(tmp,'media','photo'));storage=createStorage(config);db.exec("CREATE TABLE media(id TEXT PRIMARY KEY,size INTEGER);INSERT INTO media VALUES('photo',16);");await createBackup(tmp,tmp+'-backup',{env:config.env,client});await verifyBackup(tmp+'-backup');assert.equal((await readFile(join(tmp+'-backup','media','photo'))).toString(),'persistent media');const restored=new DatabaseSync(join(tmp+'-backup','cipherion.sqlite'));assert.equal(restored.prepare('SELECT provider FROM media_objects').get().provider,'local');restored.close();assert.equal((await storage.bytes('media','photo')).toString(),'persistent media');assert.equal((await storage.bytes('media','photo','bytes=0-9')).toString(),'persistent');
 db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY,media_id TEXT);INSERT INTO messages VALUES('original','photo');INSERT INTO messages VALUES('forward','photo');");assert.equal(mediaReferenced(db,'photo'),true);db.exec("DELETE FROM messages WHERE id='original'");assert.equal(mediaReferenced(db,'photo'),true);db.exec('DELETE FROM messages');assert.equal(mediaReferenced(db,'photo'),false);await storage.remove('media','photo');assert.equal(objects.size,0);assert.throws(()=>validateUpload(Buffer.from('not a png'),'image/png','photo.png'),{status:400});assert.throws(()=>validateUpload(Buffer.from('MZfake'),'application/octet-stream','safe.txt'),{status:400});
 }finally{db.close();await rm(tmp,{recursive:true,force:true});await rm(tmp+'-backup',{recursive:true,force:true});}
});

test('temporary media mode keeps uploads local despite configured but unusable S3 credentials',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'cipherion-temporary-storage-')),db=new DatabaseSync(':memory:');let calls=0;
 const config={db,one:(s,...p)=>db.prepare(s).get(...p),run:(s,...p)=>db.prepare(s).run(...p),data:tmp,env:{NODE_ENV:'production',RENDER:'true',MEDIA_STORAGE_MODE:'temporary',S3_BUCKET:'configured',S3_ACCESS_KEY_ID:'invalid',S3_SECRET_ACCESS_KEY:'invalid'},client:{send:async()=>{calls++;throw Error('Invalid credentials');}}};
 try{
  await mkdir(join(tmp,'media'));await writeFile(join(tmp,'media','photo'),'temporary bytes');let storage=createStorage(config);storage.writable();await storage.persist('media','photo','owner',join(tmp,'media','photo'),'text/plain');await storage.releaseLocal('media','photo');storage=createStorage(config);
  assert.equal((await storage.bytes('media','photo')).toString(),'temporary bytes');assert.equal(storage.configured,false);assert.equal(storage.mode,'temporary');assert.equal(db.prepare('SELECT provider FROM media_objects').get().provider,'local');assert.equal(calls,0);
 }finally{db.close();await rm(tmp,{recursive:true,force:true});}
});

test('passwordless 2FA requires a fresh session-bound email approval and protects later login',async()=>{
 await stop();await start();const p=await register('security@example.test');sql(db=>db.prepare("UPDATE email_cooldowns SET last_sent=0 WHERE email='security@example.test'").run());
 const begin=await request('/auth/email/start',p.d,'POST',{purpose:'security',email:'ignored@example.test'});assert.equal(begin.status,200);assert.equal(mailbox.at(-1).to,'security@example.test');const code=mailbox.at(-1).code;
 assert.equal((await request('/auth/email/confirm',c.d,'POST',{challengeId:begin.data.challengeId,code})).status,403);
 const approval=await request('/auth/email/confirm',p.d,'POST',{challengeId:begin.data.challengeId,code});assert.equal(approval.status,200);const approvalToken=approval.data.approvalToken;assert.equal(approvalToken.length,64);
 assert.equal((await request('/security/2fa/setup',p.d,'POST',{})).status,403);assert.equal((await request('/security/2fa/setup',c.d,'POST',{approvalToken})).status,403);
 const setup=await request('/security/2fa/setup',p.d,'POST',{approvalToken});assert.equal(setup.status,200);const {totp}=await import('../server/security.js');
 const confirmed=await request('/security/2fa/confirm',p.d,'POST',{approvalToken,code:totp(setup.data.secret)});assert.equal(confirmed.status,200);assert.equal(confirmed.data.codes.length,10);assert.equal((await request('/security/2fa/setup',p.d,'POST',{approvalToken})).status,403);
 sql(db=>db.prepare("UPDATE email_cooldowns SET last_sent=0 WHERE email='security@example.test'").run());const other=device();const login=await request('/auth/email/start',other,'POST',{purpose:'login',email:'security@example.test'});assert.equal(login.status,200);const loginCode=mailbox.at(-1).code;
 assert.equal((await request('/auth/email/confirm',other,'POST',{challengeId:login.data.challengeId,code:loginCode})).status,401);
 const success=await request('/auth/email/confirm',other,'POST',{challengeId:login.data.challengeId,code:loginCode,secondFactor:confirmed.data.codes[0]});assert.equal(success.status,200);other.user=p.user.id;
 sql(db=>db.prepare("UPDATE email_cooldowns SET last_sent=0 WHERE email='security@example.test'").run());const step=await request('/auth/email/start',p.d,'POST',{purpose:'security'});const stepCode=mailbox.at(-1).code;
 assert.equal((await request('/auth/email/confirm',other,'POST',{challengeId:step.data.challengeId,code:stepCode})).status,403);
 const proof=(await request('/auth/email/confirm',p.d,'POST',{challengeId:step.data.challengeId,code:stepCode})).data.approvalToken;
 assert.equal((await request('/security/2fa',p.d,'DELETE',{approvalToken:proof,code:confirmed.data.codes[1]})).status,200);
 assert.equal((await request('/security/2fa',p.d)).data.enabled,false);
});

test('cloud password is set at registration and asked after the email code on login',async()=>{
 const email='cloud@example.test',d=device();
 const reg=await request('/auth/email/start',d,'POST',{purpose:'register',email,firstName:'Облако',lastName:'Паролев'});
 assert.equal((await request('/auth/email/confirm',d,'POST',{challengeId:reg.data.challengeId,code:mailbox.at(-1).code,cloudPassword:'123'})).status,400);
 const made=await request('/auth/email/confirm',d,'POST',{challengeId:reg.data.challengeId,code:mailbox.at(-1).code,cloudPassword:'cloud-secret'});assert.equal(made.status,200,JSON.stringify(made.data));d.user=made.data.user.id;
 assert.deepEqual((await request('/auth/cloud-password',d)).data,{enabled:true});
 sql(db=>db.prepare('UPDATE email_cooldowns SET last_sent=0 WHERE email=?').run(email));
 const other=device(),login=await request('/auth/email/start',other,'POST',{purpose:'login',email});const code=mailbox.at(-1).code;
 const missing=await request('/auth/email/confirm',other,'POST',{challengeId:login.data.challengeId,code});assert.equal(missing.status,401);assert.equal(missing.data.need,'cloudPassword');
 for(let i=0;i<5;i++){const wrong=await request('/auth/email/confirm',other,'POST',{challengeId:login.data.challengeId,code,cloudPassword:'nope-nope'});assert.equal(wrong.status,401);assert.equal(wrong.data.need,'cloudPassword');}
 const ok=await request('/auth/email/confirm',other,'POST',{challengeId:login.data.challengeId,code,cloudPassword:'cloud-secret'});assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(ok.data.user.id,d.user);assert.equal(ok.data.user.cloud_password,undefined);
 assert.equal((await request('/auth/cloud-password',d,'DELETE',{current:'bad'})).status,403);
 assert.deepEqual((await request('/auth/cloud-password',d,'DELETE',{current:'cloud-secret'})).data,{enabled:false});
});
