import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUpdates,RELEASES,EVENTS} from '../server/updates.js';

test('the official account announces a release once and posts its stories and the running event',()=>{
  const db=new DatabaseSync(':memory:');let n=0,clock=Date.UTC(2026,10,7);
  db.exec("CREATE TABLE stories(id TEXT PRIMARY KEY,user_id TEXT,media_id TEXT,kind TEXT,caption TEXT,design TEXT,created INTEGER,expires INTEGER,audience TEXT,targets TEXT,replies INTEGER DEFAULT 1,highlight TEXT DEFAULT '',deleted INTEGER DEFAULT 0)");
  const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
  const sent=[];const official={botId:'bot',announce:text=>{sent.push(text);return 3;}};
  const updates=createUpdates({db,one,all,run,now:()=>clock,id:()=>'id'+(++n),official});
  const first=updates.publish();
  assert.equal(first.releases[0].sent,3);assert.deepEqual(first.events,['halloween-2026']);
  assert.equal(sent.length,1);
  assert.equal(all('SELECT * FROM stories').length,RELEASES[0].stories.length+EVENTS[0].stories.length);
  assert.ok(all('SELECT * FROM stories').every(s=>s.user_id==='bot'&&s.audience==='everyone'));
  updates.publish();assert.equal(sent.length,1,'a release is announced only once');
  const event=updates.currentEvent();assert.equal(event.title,'Хэллоуин');assert.equal(event.stories.length,EVENTS[0].stories.length);
  clock=Date.UTC(2026,11,2);assert.equal(updates.currentEvent(),null,'the event ends with the season');
});
