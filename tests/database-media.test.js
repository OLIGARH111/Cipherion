import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStorage,CHUNK} from '../server/storage.js';

test('database media mode keeps photos after the local disk is wiped (redeploy)',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'cipherion-db-media-')),db=new DatabaseSync(':memory:');
 const config={db,one:(s,...p)=>db.prepare(s).get(...p),run:(s,...p)=>db.prepare(s).run(...p),data:tmp,env:{NODE_ENV:'production',RENDER:'true',MEDIA_STORAGE_MODE:'database'}};
 try{
  const photo=randomBytes(CHUNK*2+1234);await mkdir(join(tmp,'media'));await writeFile(join(tmp,'media','photo'),photo);
  let storage=createStorage(config);storage.writable();await storage.persist('media','photo','owner',join(tmp,'media','photo'),'image/jpeg');await storage.releaseLocal('media','photo');
  await rm(join(tmp,'media'),{recursive:true,force:true});
  storage=createStorage(config);
  assert.equal(storage.mode,'database');assert.equal(storage.configured,true);
  assert.deepEqual(await storage.bytes('media','photo'),photo);
  const start=CHUNK-10,end=CHUNK*2+5;assert.deepEqual(await storage.bytes('media','photo',`bytes=${start}-${end}`),photo.subarray(start,end+1));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,3);
  await storage.remove('media','photo');assert.equal(db.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);
  await assert.rejects(storage.bytes('media','photo'),{status:404});
 }finally{db.close();await rm(tmp,{recursive:true,force:true});}
});
