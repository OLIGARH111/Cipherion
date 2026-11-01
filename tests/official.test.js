import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOfficial} from '../server/official.js';
import {allowed} from '../server/permissions.js';
import {verifiedBadge,vipBadge} from '../public/ui.js';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,name TEXT NOT NULL,password TEXT NOT NULL,bio TEXT DEFAULT '',created INTEGER);
  CREATE TABLE chats(id TEXT PRIMARY KEY,kind TEXT,title TEXT,permissions TEXT,created INTEGER);
  CREATE TABLE members(chat_id TEXT,user_id TEXT,role TEXT DEFAULT 'member',rules TEXT DEFAULT '{}',PRIMARY KEY(chat_id,user_id));
  CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT,user_id TEXT,kind TEXT,body TEXT,created INTEGER);
  CREATE TABLE site_owner(singleton INTEGER PRIMARY KEY,user_id TEXT,created INTEGER);
  INSERT INTO users VALUES('owner','serafim_mironov','Owner','x:y','',0),('alice','alice','Alice','x:y','',0);
  INSERT INTO site_owner VALUES(1,'owner',0);`);
 let n=0;const events=[];
 const init=()=>createOfficial({db,one:(s,...p)=>db.prepare(s).get(...p),all:(s,...p)=>db.prepare(s).all(...p),run:(s,...p)=>db.prepare(s).run(...p),fail:(status,message)=>{throw Object.assign(Error(message),{status});},now:()=>++n,id:()=>'id'+(++n),broadcast:(...a)=>events.push(a),isAdmin:u=>u==='owner'});
 return {db,init,events};
}
test('official bot is created once, verified, and the owner is verified too',()=>{
 const {db,init}=fixture();const a=init(),b=init();
 assert.equal(a.botId,b.botId);
 const bot=db.prepare('SELECT * FROM users WHERE id=?').get(a.botId);
 assert.equal(bot.username,'cipherion');assert.equal(bot.name,'Cipherion');assert.equal(bot.password,'');
 assert.equal(a.isVerified(a.botId),true);assert.equal(a.isVerified('owner'),true);assert.equal(a.isVerified('alice'),false);
});
test('each user gets one read-only chat with a welcome message, and announcements reach everyone',async()=>{
 const {db,init,events}=fixture();const o=init();
 const chat=o.ensure('alice');assert.equal(o.ensure('alice'),chat);assert.equal(o.isOfficialChat(chat),true);
 const c=db.prepare('SELECT * FROM chats WHERE id=?').get(chat);const me=db.prepare('SELECT * FROM members WHERE chat_id=? AND user_id=?').get(chat,'alice');
 assert.equal(allowed(me,c,'text'),false);assert.equal(allowed(me,c,'photo'),false);
 assert.match(db.prepare('SELECT body FROM messages WHERE chat_id=?').get(chat).body,/Добро пожаловать/);
 let result;await o.route({path:'/api/admin/announce',req:{method:'POST'},b:{text:'Вышло обновление'},user:{id:'owner'},json:v=>result=v});
 assert.equal(result.sent,2);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE body='Вышло обновление'").get().n,2);
 assert.ok(events.length>=3);
 await assert.rejects(o.route({path:'/api/admin/announce',req:{method:'POST'},b:{text:'x'},user:{id:'alice'},json:()=>{}}),{status:403});
 await o.route({path:'/api/admin/verify',req:{method:'POST'},b:{user:'alice'},user:{id:'owner'},json:()=>{}});
 assert.equal(o.isVerified('alice'),true);
});
test('verified badge renders before the VIP mark',()=>{
 assert.equal(verifiedBadge({}),'');
 assert.match(vipBadge({verified:true,vip:false}),/verified-badge/);
 assert.match(vipBadge({verified:true,official:true}),/Официальный аккаунт Cipherion/);
 assert.match(vipBadge({verified:true,vip:true,vipBadge:'✦'}),/verified-badge.*vip-mark/s);
});
test('official chat UI hides the composer and calls',async()=>{
 const src=(await import('node:fs')).readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(src,/official=c\.kind==='direct'&&!!people\[0\]\?\.official/);
 assert.match(src,/if\(p\?\.official\)return 'официальный аккаунт'/);
});
