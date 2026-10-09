import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseConfig,retryTransient,isTransientDatabaseError} from '../server/db.js';

test('Turso configuration rejects partial credentials and unsafe destinations instead of local fallback',()=>{
  assert.deepEqual(databaseConfig({}),{remote:false});
  for(const env of [{TURSO_DATABASE_URL:'libsql://test.turso.io'},{TURSO_AUTH_TOKEN:'test'}])assert.throws(()=>databaseConfig(env));
  for(const url of ['http://test.turso.io','libsql://test.turso.io.evil.example','libsql://user:secret@test.turso.io','libsql://test.turso.io?token=secret','libsql://test.turso.io/path'])assert.throws(()=>databaseConfig({TURSO_DATABASE_URL:url,TURSO_AUTH_TOKEN:'test'}));
  const configured=databaseConfig({TURSO_DATABASE_URL:'libsql://cipherion-oligarh111.aws-us-west-2.turso.io',TURSO_AUTH_TOKEN:'test'});
  assert.equal(configured.remote,true);
});

test('transient Turso errors are retried once outside transactions and never inside one',()=>{
  const fake=()=>{const db={calls:0,failures:0,prepare(){db.calls++;if(db.failures>0){db.failures--;throw new Error('Hrana(Api("status=404 Not Found, body={\\"error\\":\\"stream not found: x\\"}"))');}return {get:()=>({ok:1})};},exec(){}};return db;};
  const db=retryTransient(fake());db.failures=1;assert.equal(db.prepare('SELECT 1').get().ok,1);assert.equal(db.calls,2);
  db.failures=2;assert.throws(()=>db.prepare('SELECT 1'));
  const permanent=retryTransient({prepare(){throw new Error('no such table: x');},exec(){}});assert.throws(()=>permanent.prepare('SELECT 1'),/no such table/);
  const tx=retryTransient(fake());tx.exec('BEGIN');tx.failures=1;assert.throws(()=>tx.prepare('INSERT'));tx.exec('ROLLBACK');tx.failures=1;assert.equal(tx.prepare('SELECT 1').get().ok,1);
  tx.exec("BEGIN; INSERT INTO t VALUES(1); COMMIT");tx.failures=1;assert.equal(tx.prepare('SELECT 1').get().ok,1);
  assert.equal(isTransientDatabaseError(new Error('Hrana(Api("status=502 Bad Gateway, body={\\"error\\":\\"connect to upstream failed\\"}"))')),true);
});
