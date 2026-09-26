import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createAdmin} from '../server/admin.js';
test('admin claim requires secret and configured account; role binds to immutable ID and can only be claimed once',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES(\'owner-id\'),(\'stranger-id\');');
 const prior={hash:process.env.ADMIN_CLAIM_HASH,name:process.env.ADMIN_CLAIM_USERNAME};process.env.ADMIN_CLAIM_HASH=createHash('sha256').update('local-test-only-secret').digest('hex');process.env.ADMIN_CLAIM_USERNAME='configured_owner';
 try{const one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);const admin=createAdmin({db,one,run,fail:(status,message)=>{throw Object.assign(Error(message),{status});},now:Date.now,rate:()=>{}});const claim=(user,code)=>admin.route({path:'/api/admin/access',req:{method:'POST'},b:{code},user,json:()=>{}});
 await assert.rejects(claim({id:'stranger-id',username:'stranger'},'local-test-only-secret'),{status:403});await assert.rejects(claim({id:'owner-id',username:'configured_owner'},'wrong'),{status:403});await claim({id:'owner-id',username:'configured_owner'},'local-test-only-secret');assert.equal(admin.isAdmin('owner-id'),true);assert.equal(admin.isAdmin('stranger-id'),false);await assert.rejects(claim({id:'stranger-id',username:'configured_owner'},'local-test-only-secret'),{status:403});
 }finally{if(prior.hash===undefined)delete process.env.ADMIN_CLAIM_HASH;else process.env.ADMIN_CLAIM_HASH=prior.hash;if(prior.name===undefined)delete process.env.ADMIN_CLAIM_USERNAME;else process.env.ADMIN_CLAIM_USERNAME=prior.name;db.close();}
});
