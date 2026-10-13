import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheReads} from '../server/db.js';
import {clientAddress} from '../server/security.js';

test('repeated reads in one task hit the database once; any write or the next task sees fresh rows',async()=>{
 const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE t(id TEXT PRIMARY KEY,v INTEGER)');raw.prepare("INSERT INTO t VALUES('a',1)").run();
 let executed=0;const prepare=raw.prepare.bind(raw);raw.prepare=sql=>{const s=prepare(sql);return {get:(...p)=>{executed++;return s.get(...p);},all:(...p)=>{executed++;return s.all(...p);},run:(...p)=>s.run(...p)};};
 const db=cacheReads(raw),one=(sql,...p)=>db.prepare(sql).get(...p);
 for(let i=0;i<50;i++)assert.equal(one('SELECT v FROM t WHERE id=?','a').v,1);
 assert.equal(executed,1);
 one('SELECT v FROM t WHERE id=?','a').v=99;assert.equal(one('SELECT v FROM t WHERE id=?','a').v,1,'callers cannot corrupt cached rows');
 db.prepare('UPDATE t SET v=2 WHERE id=?').run('a');assert.equal(one('SELECT v FROM t WHERE id=?','a').v,2);
 assert.equal(one("INSERT INTO t VALUES('b',5) RETURNING v").v,5);assert.equal(one("SELECT COUNT(*) n FROM t").n,2);
 raw.exec("UPDATE t SET v=3 WHERE id='a'");await new Promise(r=>setImmediate(r));assert.equal(one('SELECT v FROM t WHERE id=?','a').v,3,'the cache never outlives the current task');
});

test('behind the proxy, clients are told apart by X-Forwarded-For',()=>{
 const req={headers:{'x-forwarded-for':'203.0.113.7, 10.0.0.1'},socket:{remoteAddress:'10.0.0.1'}};const old=process.env.RENDER;
 try{delete process.env.RENDER;assert.equal(clientAddress(req),process.env.TRUST_PROXY==='1'?'203.0.113.7':'10.0.0.1');process.env.RENDER='true';assert.equal(clientAddress(req),'203.0.113.7');}
 finally{if(old===undefined)delete process.env.RENDER;else process.env.RENDER=old;}
});

test('one busy account cannot exhaust the request limit for everyone else on the same address',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-load-'));const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.once('exit',code=>reject(new Error('Server exited '+code)));});
  const register=async username=>(await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username,name:username,password:'test-password-12345'})})).headers.get('set-cookie').split(';')[0];
  const busy=await register('busy_user'),calm=await register('calm_user');
  let limited=0;for(let i=0;i<620;i+=20){const statuses=await Promise.all(Array.from({length:20},()=>fetch(base+'/api/me',{headers:{Cookie:busy}}).then(r=>r.status)));limited+=statuses.filter(s=>s===429).length;}
  assert.ok(limited>0,'the busy account is limited');
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:calm}})).status,200,'another account on the same address is not');
 }finally{server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
