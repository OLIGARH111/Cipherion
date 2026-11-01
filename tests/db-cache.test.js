import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,StatementSync} from 'node:sqlite';
import {cacheReads} from '../server/db.js';

test('identical reads within one task reach the database once; writes and the next task see fresh data',async()=>{
 const db=cacheReads(new DatabaseSync(':memory:'));
 db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT)');db.prepare('INSERT INTO users VALUES(?,?)').run('a','Alice');
 let reads=0;const original=StatementSync.prototype.get;StatementSync.prototype.get=function(...a){reads++;return original.apply(this,a);};
 try{
  const one=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  assert.equal(one('a').name,'Alice');assert.equal(one('a').name,'Alice');assert.equal(one('a').name,'Alice');
  assert.equal(reads,1,'repeated identical reads are answered once');
  one('b');assert.equal(reads,2,'different parameters are separate reads');
  // Callers may change the rows they get without affecting anyone else.
  const row=one('a');row.name='changed';assert.equal(one('a').name,'Alice');
  db.prepare('UPDATE users SET name=? WHERE id=?').run('Alicia','a');
  assert.equal(one('a').name,'Alicia','a write clears saved reads at once');
  db.exec("UPDATE users SET name='Ali' WHERE id='a'");assert.equal(one('a').name,'Ali','exec clears too');
  const before=reads;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  one('a');assert.equal(reads,before+1,'the next task reads again');
  assert.deepEqual(db.prepare('SELECT name FROM users ORDER BY id').all().map(r=>r.name),['Ali']);
  assert.equal(db.prepare('INSERT INTO users VALUES(?,?) RETURNING name').get('c','Carol').name,'Carol');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
 }finally{StatementSync.prototype.get=original;}
});
