import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseConfig} from '../server/db.js';

test('Turso configuration rejects partial credentials and unsafe destinations instead of local fallback',()=>{
  assert.deepEqual(databaseConfig({}),{remote:false});
  for(const env of [{TURSO_DATABASE_URL:'libsql://test.turso.io'},{TURSO_AUTH_TOKEN:'test'}])assert.throws(()=>databaseConfig(env));
  for(const url of ['http://test.turso.io','libsql://test.turso.io.evil.example','libsql://user:secret@test.turso.io','libsql://test.turso.io?token=secret','libsql://test.turso.io/path'])assert.throws(()=>databaseConfig({TURSO_DATABASE_URL:url,TURSO_AUTH_TOKEN:'test'}));
  const configured=databaseConfig({TURSO_DATABASE_URL:'libsql://cipherion-oligarh111.aws-us-west-2.turso.io',TURSO_AUTH_TOKEN:'test'});
  assert.equal(configured.remote,true);
});
