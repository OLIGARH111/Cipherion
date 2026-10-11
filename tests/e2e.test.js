import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Minimal in-memory IndexedDB: enough for public/e2e.js to keep device keys.
function fakeIndexedDB(){
  const stores=new Map();
  const db={createObjectStore:name=>stores.set(name,new Map()),transaction:name=>{const data=stores.get(name),tx={objectStore:()=>({get:k=>({result:data.get(k)}),put:v=>{data.set(v.user,v);return {};}})};setTimeout(()=>tx.oncomplete?.());return tx;}};
  return {open:()=>{const r={result:db};setTimeout(()=>{if(!stores.size)r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
}

test('end-to-end encryption: server stores only ciphertext, members decrypt, tampering and outsiders are detected',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cipherion-e2e-'));let server;
  try{
    server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
    const base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});server.once('exit',c=>reject(Error('server exited '+c)));});
    const cookies=new Map(),nativeFetch=globalThis.fetch;
    const raw=async(path,cookie,method='GET',data)=>{const res=await nativeFetch(base+'/api'+path,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
    const register=async username=>{const r=await raw('/auth',null,'POST',{register:true,username,password:'password-testing-123'});cookies.set(r.data.user.id,r.cookie);return {id:r.data.user.id,cookie:r.cookie};};
    const [alice,bob,carol]=[await register('e2ealice'),await register('e2ebob'),await register('e2ecarol')];

    globalThis.indexedDB=fakeIndexedDB();
    globalThis.fetch=(path,options={})=>{const account=options.headers?.['X-Cipherion-Account'];return nativeFetch(base+path,{...options,signal:undefined,headers:{...options.headers,Cookie:cookies.get(account)||''}});};
    const {seal,open,reveal,ensureDevice,notices}=await import('../public/e2e.js');
    const {api}=await import('../public/ui.js');
    try{
      await ensureDevice(alice.id);await ensureDevice(bob.id);
      const direct=(await raw('/chats',alice.cookie,'POST',{users:[bob.id]})).data.id;
      const envelope=await seal(alice.id,direct,'секрет :ce[nothing]');
      assert.ok(envelope&&envelope.keys.length===2);
      const sent=await raw(`/chats/${direct}/messages`,alice.cookie,'POST',{e2e:envelope,emoji:[],clientMessageId:'e2e-message-0000001'});
      assert.equal(sent.status,201);assert.equal(sent.data.body,'');
      // A retry of the identical envelope is idempotent.
      assert.equal((await raw(`/chats/${direct}/messages`,alice.cookie,'POST',{e2e:envelope,emoji:[],clientMessageId:'e2e-message-0000001'})).data.id,sent.data.id);

      const stored=new DatabaseSync(join(dir,'cipherion.sqlite'),{readOnly:true});
      const row=stored.prepare('SELECT body,e2e FROM messages WHERE id=?').get(sent.data.id);stored.close();
      assert.equal(row.body,'');assert.ok(!row.e2e.includes('секрет'));

      const history=await api(`/chats/${direct}/messages`,'GET',undefined,undefined,bob.id);
      assert.equal(history[0].body,'секрет :ce[nothing]');assert.equal(history[0].e2eState,'ok');
      const chats=await api('/chats','GET',undefined,undefined,bob.id);
      assert.equal(chats.find(c=>c.id===direct).last.body,'секрет :ce[nothing]');

      // Tampered ciphertext or signature never shows as a valid message.
      const forged=JSON.parse(sent.data.e2e);forged.ct=Buffer.from(Buffer.from(forged.ct,'base64').map((b,i)=>i===0?b^1:b)).toString('base64');
      assert.equal((await open(bob.id,{...sent.data,id:'forged',e2e:JSON.stringify(forged)})).body,notices.broken);
      // A device of another user cannot be passed off as the author.
      assert.equal((await open(bob.id,{...sent.data,id:'impostor',user_id:carol.id})).body,notices.broken);

      // Edits stay encrypted; plaintext edits of an encrypted message are refused.
      assert.equal((await raw('/messages/'+sent.data.id,alice.cookie,'PATCH',{body:'plain'})).status,400);
      assert.equal((await raw('/messages/'+sent.data.id,alice.cookie,'PATCH',{e2e:await seal(alice.id,direct,'исправлено')})).status,200);
      assert.equal((await api('/messages/'+sent.data.id,'GET',undefined,undefined,bob.id)).body,'исправлено');

      // An envelope signed by someone else's device is rejected.
      await ensureDevice(carol.id);
      const group=(await raw('/chats',alice.cookie,'POST',{kind:'group',title:'g',users:[bob.id]})).data.id;
      const groupEnvelope=await seal(alice.id,group,'для группы');
      assert.equal((await raw(`/chats/${group}/messages`,bob.cookie,'POST',{e2e:groupEnvelope})).status,400);
      const groupMessage=(await raw(`/chats/${group}/messages`,alice.cookie,'POST',{e2e:groupEnvelope})).data;
      assert.equal((await open(bob.id,groupMessage)).body,'для группы');
      // A device that was not a recipient (joined later) sees a notice instead of text.
      assert.equal((await open(carol.id,{...sent.data,id:'not-for-carol'})).body,notices.locked);

      // Channels never accept envelopes.
      const channel=(await raw('/chats',alice.cookie,'POST',{kind:'channel',title:'c'})).data.id;
      assert.equal((await api('/e2e/keys?chat='+channel,'GET',undefined,undefined,alice.id)).enabled,false);
      assert.equal(await seal(alice.id,channel,'x'),null);
      assert.equal((await raw(`/chats/${channel}/messages`,alice.cookie,'POST',{e2e:groupEnvelope})).status,403);

      // Forwarding re-encrypts for the destination chat.
      const forward=await raw('/messages/'+sent.data.id+'/forward',bob.cookie,'POST',{chat:group,e2e:await seal(bob.id,group,'исправлено')});
      assert.equal(forward.status,201);assert.equal((await open(alice.id,forward.data)).body,'исправлено');
    }finally{globalThis.fetch=nativeFetch;}
  }finally{if(server?.exitCode===null){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}await rm(dir,{recursive:true,force:true});}
});
