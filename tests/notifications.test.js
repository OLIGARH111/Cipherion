import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {database} from '../server/db.js';
import {pushConfig} from '../server/push-config.js';
import {createDelivery} from '../server/delivery.js';

test('push signing keys persist and environment override never leaks through public configuration',()=>{
 const db=new DatabaseSync(':memory:');try{
 const a=pushConfig(db,{}),b=pushConfig(db,{});assert.deepEqual(a,b);
 assert.equal(Buffer.from(a.publicKey,'base64url').length,65);
 assert.equal(Buffer.from(a.privateKey,'base64url').length,32);
 assert.equal(pushConfig(db,{VAPID_PUBLIC_KEY:'incomplete'}),null);
 assert.equal(pushConfig(db,{VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private'}).publicKey,'public');
 }finally{db.close();}
});

test('call push has priority, privacy, expiry, ownership and device-specific test protection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-push-'));const db=database(dir);let clock=100000;
 const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 try{
 db.exec('CREATE TABLE reactions(message_id TEXT,user_id TEXT,emoji TEXT)');
 const service=createDelivery({db,one,all,run,fail:(status,message)=>{throw Object.assign(new Error(message),{status});},now:()=>clock,family:{chatAccess(){}},emit(){}});
 for(const u of ['a','b','c'])run("INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,'x',0)",u,u,u);
 run("INSERT INTO chats(id,kind) VALUES('chat','direct')");for(const u of ['a','b'])run("INSERT INTO members(chat_id,user_id) VALUES('chat',?)",u);
 run("INSERT INTO sessions(id,user_id,expires) VALUES('s','b',999999)");
 run("INSERT INTO push_account_devices VALUES('device','b','s','web','https://web.push.apple.com/test','{}',0)");
 run("INSERT INTO notification_preferences VALUES('b',?)",JSON.stringify({showName:false,showText:false}));
 run("INSERT INTO messages(id,chat_id,user_id,kind,body,created) VALUES('m','chat','a','text','secret',?)",clock);
 const call=(id,at=clock)=>run("INSERT INTO calls(id,chat_id,user_id,video,created,status) VALUES(?,'chat','a',1,?,'ringing')",id,at);
 call('live');const sent=[];service.providers.set('web',async(s,p)=>sent.push(p));await service.tick();
 assert.equal(sent[0].type,'calls');assert.equal(sent[0].title,'Cipherion');assert.equal(sent[0].body,'Входящий видеозвонок');assert.equal(sent[0].expiresAt,clock+45000);assert.match(sent[0].url,/call=live&account=b/);
 assert.equal(sent[1].body,'У вас новое сообщение');
 call('old',clock-46000);call('ended');run("UPDATE calls SET ended=?,status='ended' WHERE id='ended'",clock);
 await service.tick();assert.equal(sent.length,2);
 run("UPDATE notification_preferences SET data=? WHERE user_id='b'",JSON.stringify({calls:false}));call('muted');await service.tick();assert.equal(sent.length,2);
 let config;await service.route({path:'/api/push/config',req:{method:'GET'},json:x=>config=x});assert.equal(config.configured,true);assert.equal(config.privateKey,undefined);
 const test=(uid='b',sid='s')=>service.route({path:'/api/push/test',req:{method:'POST'},b:{endpoint:'https://web.push.apple.com/test'},user:{id:uid,session:{id:sid}},json(){}});
 await assert.rejects(test('c'),{status:404});await assert.rejects(test('b','other'),{status:404});await test();await assert.rejects(test(),{status:429});
 // A queued retry must never leak to another account that reclaims this endpoint.
 run("UPDATE notification_preferences SET data='{}' WHERE user_id='b'");call('retry');service.providers.set('web',async()=>{throw new Error('temporary');});await service.tick();
 run("UPDATE push_account_devices SET user_id='c' WHERE id='device'");clock+=20000;service.providers.set('web',async(s,p)=>sent.push(p));const count=sent.length;await service.tick();assert.equal(sent.length,count);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('service worker opens live windows without navigation and renders expired calls as missed',async()=>{
 const listeners={},shown=[],posted=[];let focused=0,opened=0;
 const self={location:{origin:'https://cipherion.test'},addEventListener:(n,f)=>listeners[n]=f,registration:{showNotification:async(...v)=>shown.push(v)},clients:{matchAll:async()=>[{url:'https://cipherion.test/',focus:async()=>focused++,navigate:()=>assert.fail('Must not reload a live call'),postMessage:p=>posted.push(p)}],openWindow:async()=>opened++}};
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL,Date});
 const dispatch=async(name,event)=>{let task;listeners[name]({...event,waitUntil:p=>task=p});await task;};
 await dispatch('push',{data:{json:()=>({type:'calls',title:'Alice',body:'Входящий звонок',expiresAt:Date.now()-1,call:'c',url:'/#call=c'})}});
 assert.equal(shown[0][1].body,'Пропущенный звонок');assert.equal(shown[0][1].requireInteraction,false);
 await dispatch('notificationclick',{notification:{data:shown[0][1].data,close(){}}});assert.equal(focused,1);assert.equal(posted[0].type,'notification-open');assert.equal(opened,0);
 await dispatch('notificationclick',{notification:{data:{url:'https://evil.example/'},close(){}}});assert.equal(focused,1);
 self.clients.matchAll=async()=>[];await dispatch('notificationclick',{notification:{data:{url:'/#chat=1'},close(){}}});assert.equal(opened,1);
});

