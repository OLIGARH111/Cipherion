import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorage} from '../server/storage.js';

function setup(env){
 const db=new DatabaseSync(':memory:'),data=mkdtempSync(join(tmpdir(),'cipherion-dbmedia-'));
 mkdirSync(join(data,'media'));
 const storage=createStorage({db,one:(s,...p)=>db.prepare(s).get(...p),run:(s,...p)=>db.prepare(s).run(...p),data,env:{NODE_ENV:'production',RENDER:'true',MEDIA_STORAGE_MODE:'database',...env}});
 return {db,data,storage,close(){db.close();rmSync(data,{recursive:true,force:true});}};
}

test('database mode keeps photo bytes in the database and serves ranges after the local file is gone', async()=>{
 const t=setup();
 try{
  const photo=Buffer.alloc(1300*1024);for(let i=0;i<photo.length;i++)photo[i]=i*7%251;
  const file=join(t.data,'media','photo1');writeFileSync(file,photo);
  t.storage.writable();
  const saved=await t.storage.persist('media','photo1','owner',file,'image/jpeg');
  assert.equal(saved.provider,'db');assert.equal(t.storage.mode,'database');assert.equal(t.storage.configured,true);
  await t.storage.releaseLocal('media','photo1');assert.equal(existsSync(file),false);
  assert.ok(t.db.prepare('SELECT count(*) n FROM media_blobs').get().n>1);
  assert.deepEqual(await t.storage.bytes('media','photo1'),photo);
  const start=500*1024,end=600*1024;
  assert.deepEqual(await t.storage.bytes('media','photo1',`bytes=${start}-${end}`),photo.subarray(start,end+1));
  assert.deepEqual(await t.storage.bytes('media','photo1','bytes=0-31'),photo.subarray(0,32));
  await t.storage.remove('media','photo1');
  assert.equal(t.db.prepare('SELECT count(*) n FROM media_blobs').get().n,0);
  await assert.rejects(t.storage.bytes('media','photo1'),{status:404});
 }finally{t.close();}
});

test('files above the database limit stay local, and existing local files move into the database', async()=>{
 const t=setup({MEDIA_DB_MAX_MB:'1'});
 try{
  const big=join(t.data,'media','big');writeFileSync(big,Buffer.alloc(2*1024*1024,1));
  assert.equal((await t.storage.persist('media','big','owner',big,'video/mp4')).provider,'local');
  t.db.prepare('INSERT INTO media_objects(namespace,media_id,owner_id,provider,storage_key,mime_type,size,checksum,status,created) VALUES(?,?,?,?,?,?,?,?,?,?)').run('media','old','owner','local','users/owner/media/old','image/png',5,'x','ready',1);
  writeFileSync(join(t.data,'media','old'),'hello');
  assert.equal(await t.storage.adoptLocal(),1);
  assert.equal(t.db.prepare("SELECT provider FROM media_objects WHERE media_id='old'").get().provider,'db');
  assert.equal(existsSync(join(t.data,'media','old')),false);
  assert.equal((await t.storage.bytes('media','old')).toString(),'hello');
  assert.equal(t.db.prepare("SELECT provider FROM media_objects WHERE media_id='big'").get().provider,'local');
 }finally{t.close();}
});
