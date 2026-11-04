import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,verify} from 'node:crypto';
import {database} from '../server/db.js';
import {createDelivery} from '../server/delivery.js';
import {apnsConfig,apnsToken,callUUID} from '../server/apns.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};

test('APNs auth token is a valid ES256 JWT and call UUIDs are stable',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pem=privateKey.export({type:'pkcs8',format:'pem'});
  const config=apnsConfig({APNS_KEY_ID:'KEY123',APNS_TEAM_ID:'TEAM456',APNS_PRIVATE_KEY:pem.replace(/\n/g,'\\n')});
  assert.equal(config.bundleId,'com.cipherion.app');
  const [h,p,s]=apnsToken(config,1700000000).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h,'base64url')),{alg:'ES256',kid:'KEY123'});
  assert.deepEqual(JSON.parse(Buffer.from(p,'base64url')),{iss:'TEAM456',iat:1700000000});
  assert.ok(verify('sha256',Buffer.from(h+'.'+p),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));
  assert.equal(apnsConfig({}),null);
  assert.equal(callUUID('abc'),callUUID('abc'));
  assert.notEqual(callUUID('abc'),callUUID('abd'));
  assert.match(callUUID('abc'),/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});

test('iPhone gets a VoIP push for calls only, alert pushes for messages, and an end push after the call',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cipherion-ios-'));let clock=1000,db;
  const sent=[];const apns={bundleId:'com.cipherion.app',send:async m=>{sent.push(m);}};
  try{
    db=database(dir);db.exec('CREATE TABLE IF NOT EXISTS reactions(message_id TEXT,user_id TEXT,emoji TEXT,PRIMARY KEY(message_id,user_id))');
    const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
    const service=createDelivery({db,one,all,run,fail,now:()=>clock,id:()=>'',membership:()=>{},emit:()=>{},broadcast:()=>{},family:{chatAccess:()=>{}},apns});
    for(const u of ['a','b'])run("INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,'x',0)",u,u,u==='a'?'Alice':'Bob');
    run("INSERT INTO chats(id,kind) VALUES('chat','direct')");for(const u of ['a','b'])run("INSERT INTO members(chat_id,user_id) VALUES('chat',?)",u);
    run("INSERT INTO sessions(id,user_id,expires) VALUES('s','b',99999999)");
    const json=()=>{},user={id:'b',session:{id:'s'}},route=b=>service.route({path:'/api/push/native',req:{method:'POST'},b,user,json,url:null});
    const voip='ab'.repeat(32),alert='cd'.repeat(32);
    await assert.rejects(route({kind:'voip',token:'nope'}),{status:400});
    await route({kind:'voip',token:voip,sandbox:true});await route({kind:'alert',token:alert});await route({kind:'voip',token:voip,sandbox:true});
    assert.equal(one('SELECT COUNT(*) n FROM push_account_devices').n,2);
    clock=2000;
    run("INSERT INTO messages(id,chat_id,user_id,kind,body,created) VALUES('m','chat','a','text','hello',2000)");
    run("INSERT INTO calls(id,chat_id,user_id,video,created,status) VALUES('call1','chat','a',1,2000,'ringing')");
    await service.tick();
    const ring=sent.find(m=>m.type==='voip'),msg=sent.find(m=>m.type==='alert');
    assert.equal(sent.length,2);
    assert.equal(ring.token,voip);assert.equal(ring.sandbox,true);assert.equal(ring.payload.title,'Alice');
    assert.equal(ring.payload.uuid,callUUID('call1'));assert.equal(ring.payload.video,true);assert.equal(ring.payload.call,'call1');assert.equal(ring.payload.chat,'chat');
    assert.equal(msg.token,alert);assert.equal(msg.payload.aps.alert.body,'hello');assert.match(msg.payload.url,/chat=chat&message=m/);
    sent.length=0;
    await service.endNativeCall('call1','answered','a');assert.equal(sent.length,0);
    await service.endNativeCall('call1','ended');
    assert.equal(sent.length,1);assert.equal(sent[0].type,'voip');assert.equal(sent[0].payload.type,'end');assert.equal(sent[0].payload.uuid,callUUID('call1'));
    await service.route({path:'/api/push/native',req:{method:'DELETE'},b:{},user,json,url:null});
    assert.equal(one('SELECT COUNT(*) n FROM push_account_devices').n,0);
  }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});
