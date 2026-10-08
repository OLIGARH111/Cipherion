import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createStorage} from '../server/storage.js';

test('partial production storage configuration keeps the server usable but rejects uploads', async () => {
 const db=new DatabaseSync(':memory:');
 try {
  const storage=createStorage({db,one:(sql,...p)=>db.prepare(sql).get(...p),run:(sql,...p)=>db.prepare(sql).run(...p),data:'/tmp/cipherion-storage-readiness',env:{NODE_ENV:'production',RENDER:'true',S3_BUCKET:'private-bucket',S3_ENDPOINT:'https://s3.us-east-005.backblazeb2.com'}});
  assert.equal(storage.configured,false);
  assert.throws(()=>storage.writable(),{status:503});
  await assert.rejects(storage.persist('media','test','user','/nonexistent','image/png'),{status:503});
  assert.equal(db.prepare('SELECT count(*) AS n FROM media_objects').get().n,0);
  db.prepare('INSERT INTO media_objects(namespace,media_id,owner_id,provider,storage_key,mime_type,size,checksum,status,created) VALUES(?,?,?,?,?,?,?,?,?,?)').run('media','old-object','owner','s3','users/owner/media/old-object','image/png',12,'sha','ready',1);
  await assert.rejects(storage.get('media','old-object'),{status:503});
  assert.equal(db.prepare('SELECT count(*) AS n FROM media_objects').get().n,1);
 } finally { db.close(); }
});
