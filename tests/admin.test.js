import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAdmin} from '../server/admin.js';

function fixture(withOwner=true){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE); INSERT INTO users VALUES('stranger-id','stranger');");
 if(withOwner)db.exec("INSERT INTO users VALUES('owner-id','serafim_mironov')");
 const init=()=>createAdmin({db,one:(s,...p)=>db.prepare(s).get(...p),run:(s,...p)=>db.prepare(s).run(...p),fail:(status,message)=>{throw Object.assign(Error(message),{status});},now:Date.now});
 return {db,init};
}
test('only the existing owner has admin access, including after username changes and restart',async()=>{
 const {db,init}=fixture();const prior=process.env.ADMIN_USER_IDS;
 try{
  process.env.ADMIN_USER_IDS='stranger-id';
  let admin=init();
  db.exec("INSERT INTO site_administrators VALUES('stranger-id',0)");
  assert.equal(admin.isAdmin('owner-id'),true);
  assert.equal(admin.isAdmin('stranger-id'),false);
  let access;
  await admin.route({path:'/api/admin/access',req:{method:'GET'},user:{id:'stranger-id'},json:v=>access=v});
  assert.deepEqual(access,{admin:false,claimAvailable:false});
  await assert.rejects(admin.route({path:'/api/admin/access',req:{method:'POST'},user:{id:'stranger-id',username:'serafim_mironov'},b:{code:'any'},json:()=>{}}),{status:403});
  db.exec("UPDATE users SET username='renamed_owner' WHERE id='owner-id'; UPDATE users SET username='serafim_mironov' WHERE id='stranger-id'");
  admin=init();
  assert.equal(admin.isAdmin('owner-id'),true);
  assert.equal(admin.isAdmin('stranger-id'),false);
  db.exec("DELETE FROM users WHERE id='owner-id'");
  assert.equal(admin.isAdmin('owner-id'),false);
 }finally{db.close();if(prior===undefined)delete process.env.ADMIN_USER_IDS;else process.env.ADMIN_USER_IDS=prior;}
});
test('missing owner fails closed and later registration cannot claim ownership',()=>{
 const {db,init}=fixture(false);
 try{const admin=init();assert.equal(admin.isAdmin('stranger-id'),false);db.exec("INSERT INTO users VALUES('new-id','serafim_mironov')");assert.equal(init().isAdmin('new-id'),false);}finally{db.close();}
});
