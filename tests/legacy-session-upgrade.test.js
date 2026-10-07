import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../server/db.js';
import {migrateNullableUsername} from '../server/email-migration.js';

test('pre-update session cookie survives username migration and restarts with original history and media',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-legacy-session-'));
 const uid=randomUUID(),peer=randomUUID(),chat=randomUUID(),mid=randomUUID(),media=randomUUID();
 // Exact token/cookie/hash format used by production commit 418ee3c.
 const token=randomBytes(32).toString('hex'),sid=createHash('sha256').update(token).digest('hex');
 const at=Date.now(),expires=at+86400000,bytes=Buffer.from('original private attachment');
 let server,base;
 async function start(){
  server=spawn(process.execPath,['server/index.js'],{env:{...process.env,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',S3_BUCKET:'',S3_ACCESS_KEY_ID:'',S3_SECRET_ACCESS_KEY:'',NODE_ENV:'test',DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',EMAIL_AUTH_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let errors='';server.stderr.on('data',b=>errors+=b);server.stdout.on('data',b=>{const match=String(b).match(/http:\/\/127.0.0.1:\d+/);if(match)resolve(match[0]);});server.once('exit',()=>reject(Error(errors)));});
 }
 async function stop(){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}
 const request=(path,selected=false)=>fetch(base+'/api'+path,{headers:{Cookie:'session='+token,...(selected?{'X-Cipherion-Account':uid}:{})}});
 try{
  let db=new DatabaseSync(join(dir,'cipherion.sqlite'));
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,bio TEXT DEFAULT '',avatar TEXT DEFAULT '',settings TEXT DEFAULT '{}',created INTEGER NOT NULL)");db.close();
  db=database(dir);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(uid,'legacy_alice','Alice','unchanged-password-hash','original bio',media,JSON.stringify({theme:'Ocean'}),at);
  db.prepare('INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,?,?)').run(peer,'legacy_bob','Bob','unchanged-peer-hash',at);
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(sid,uid,'original device',at,at,expires);
  db.prepare('INSERT INTO chats(id,kind,created) VALUES(?,?,?)').run(chat,'direct',at);
  for(const id of [uid,peer])db.prepare('INSERT INTO members(chat_id,user_id) VALUES(?,?)').run(chat,id);
  db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?)').run(media,uid,'old.txt','text/plain',bytes.length,at);
  db.prepare('INSERT INTO messages(id,chat_id,user_id,kind,body,media_id,created) VALUES(?,?,?,?,?,?,?)').run(mid,chat,uid,'file','Original message',media,at);
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
  const rows=()=>Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'" ORDER BY rowid').all()]));
  const before=rows();assert.equal(migrateNullableUsername(db).changed,true);assert.deepEqual(rows(),before);db.close();
  await mkdir(join(dir,'media'));await writeFile(join(dir,'media',media),bytes);
  for(let restart=0;restart<2;restart++){
   await start();
   const accounts=await request('/accounts');assert.equal(accounts.status,200);assert.equal((await accounts.json())[0].user.id,uid);
   for(const selected of [false,true]){
    const me=await request('/me',selected);assert.equal(me.status,200);assert.equal(me.headers.get('set-cookie'),null);
    const profile=await me.json();assert.equal(profile.user.id,uid);assert.equal(profile.user.username,'legacy_alice');assert.equal(profile.settings.theme,'Ocean');
   }
   const history=await request('/chats/'+chat+'/messages',true);assert.equal(history.status,200);assert.equal((await history.json())[0].id,mid);
   const file=await request('/media/'+media,true);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
   await stop();
   db=new DatabaseSync(join(dir,'cipherion.sqlite'));
   const session=db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);assert.equal(session.expires,expires);assert.equal(session.user_id,uid);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
   assert.equal(db.prepare('SELECT password FROM users WHERE id=?').get(uid).password,'unchanged-password-hash');
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
  }
 }finally{if(server&&server.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
