import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {database} from '../server/db.js';
import {createDelivery} from '../server/delivery.js';
import {normalizeAppearance,capabilities} from '../server/capabilities.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
test('transactional notification queue retries per device, preserves privacy, removes expired subscriptions and survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-delivery-'));const old={...process.env};Object.assign(process.env,{VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test',VAPID_SUBJECT:'mailto:test@example.com'});let clock=1000,db;
 try{const setup=()=>{db=database(dir);db.exec('CREATE TABLE IF NOT EXISTS reactions(message_id TEXT,user_id TEXT,emoji TEXT,PRIMARY KEY(message_id,user_id))');const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);return {one,all,run,service:createDelivery({db,one,all,run,fail,now:()=>clock,id:()=>'',membership:()=>{},emit:()=>{},broadcast:()=>{},family:{chatAccess:()=>{}}})};};let x=setup();
 for(const u of ['a','b'])x.run("INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,'x',0)",u,u,u);x.run("INSERT INTO chats(id,kind) VALUES('chat','direct')");for(const u of ['a','b'])x.run("INSERT INTO members(chat_id,user_id) VALUES('chat',?)",u);
 for(const d of ['one','two']){x.run("INSERT INTO sessions(id,user_id,expires) VALUES(?,'b',999999)",d);x.run("INSERT INTO push_account_devices VALUES(?,'b',?,'web',?,'{}',0)",d,d,'https://web.push.apple.com/'+d);}
 x.run("INSERT INTO notification_preferences VALUES('b',?)",JSON.stringify({showText:false,showName:false}));
 x.run("INSERT INTO messages(id,chat_id,user_id,kind,body,created,client_id) VALUES('m','chat','a','text','secret',500,'client-id-12345678')");assert.equal(x.one('SELECT COUNT(*) n FROM notification_jobs').n,1);assert.throws(()=>x.run("INSERT INTO messages(id,chat_id,user_id,created,client_id) VALUES('copy','chat','a',501,'client-id-12345678')"));assert.equal(x.one('SELECT COUNT(*) n FROM notification_jobs').n,1);
 db.close();x=setup();let calls=0;x.service.providers.set('web',async(_sub,payload)=>{calls++;assert.equal(payload.title,'Cipherion');assert.equal(payload.body,'У вас новое сообщение');assert.match(payload.url,/chat=chat&message=m/);if(calls===1)throw Object.assign(new Error('temporary'),{statusCode:503});throw Object.assign(new Error('expired'),{statusCode:410});});await x.service.tick();assert.equal(calls,2);assert.equal(x.one('SELECT COUNT(*) n FROM push_account_devices').n,1);assert.equal(x.one("SELECT COUNT(*) n FROM push_attempts WHERE status='pending'").n,1);assert.equal(x.one("SELECT delivered_at FROM members WHERE user_id='b'").delivered_at,0);
 clock+=20000;x.service.providers.set('web',async()=>{calls++;});await x.service.tick();await x.service.tick();assert.equal(calls,3);assert.equal(x.one("SELECT COUNT(*) n FROM push_attempts WHERE status='sent'").n,1);
 }finally{db?.close();for(const k of ['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];await rm(dir,{recursive:true,force:true});}
});
test('VIP appearance gates new use but preserves expired paid settings',()=>{const old={frame:'Glass',effect:'Sparkles',motion:'slow',patternMotion:true,nameStyle:'gradient'};assert.equal(normalizeAppearance({},old,capabilities(false),fail).frame,'Glass');assert.throws(()=>normalizeAppearance({frame:'Neon'},old,capabilities(false),fail),{status:403});assert.equal(normalizeAppearance({patternEmoji:['💚','✨'],patternDensity:30},{},capabilities(false),fail).patternDensity,30);assert.throws(()=>normalizeAppearance({patternDensity:NaN},{},capabilities(true),fail),{status:400});});
test('real HTTP idempotency, receipt acknowledgement, cross-account privacy and persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-http-v2-'));let child,base;
 async function start(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const url=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(url)resolve(url[0]);});child.once('exit',()=>reject(new Error('Server stopped')));});}
 async function stop(){child.kill();await new Promise(r=>child.once('exit',r));}
 async function req(path,cookie,method='GET',body){const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{await start();const a=await req('/auth','','POST',{register:true,username:'delivery_a',name:'Alice',password:'a-secure-password'}),b=await req('/auth','','POST',{register:true,username:'delivery_b',name:'Bob',password:'a-secure-password'}),c=await req('/auth','','POST',{register:true,username:'delivery_c',name:'Chris',password:'a-secure-password'});const chat=(await req('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
 const payload={body:'Persistent',clientId:'unique-client-12345678'};const results=await Promise.all(Array.from({length:4},()=>req('/chats/'+chat.id+'/messages',a.cookie,'POST',payload)));assert.equal(new Set(results.map(r=>r.data.id)).size,1);const mid=results[0].data.id;
 const rows=await req('/chats/'+chat.id+'/messages',b.cookie);assert.equal(rows.data.length,1);let chats=(await req('/chats',a.cookie)).data;assert.equal(chats[0].members.find(m=>m.user_id===b.data.user.id).delivered_at,0);
 assert.equal((await req('/receipts',c.cookie,'POST',{chat:chat.id,message:mid})).status,403);await req('/receipts',b.cookie,'POST',{chat:chat.id,message:mid});chats=(await req('/chats',a.cookie)).data;assert.equal(chats[0].members.find(m=>m.user_id===b.data.user.id).delivered_at,rows.data[0].created);
 await req('/chats/'+chat.id+'/read',b.cookie,'POST',{message:mid});assert.equal((await req('/sync',c.cookie)).data.events.length,0);assert.equal((await req('/sync',b.cookie)).data.events.length,1);
 assert.equal((await req('/profile',a.cookie,'PATCH',{patternEmoji:['💚','✨'],patternDensity:31,background:'Emerald'})).status,403);assert.equal((await req('/profile?user='+a.data.user.id,b.cookie)).data.profile.patternDensity??24,24);assert.equal((await req('/profile',a.cookie,'PATCH',{frame:'Glass'})).status,403);assert.equal((await req('/profile',a.cookie,'PATCH',{status:'Hi',description:'Free bio'})).status,200);
 await stop();await start();assert.equal((await req('/chats/'+chat.id+'/messages',b.cookie)).data[0].id,mid);assert.equal((await req('/profile',a.cookie)).data.profile.status,'Hi');assert.equal((await req('/chats/'+chat.id+'/messages',a.cookie,'POST',payload)).data.id,mid);
 }finally{if(child?.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});

