import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// In-memory IndexedDB with several stores, one per "device" (each module instance gets its own).
function fakeIndexedDB(){
  const stores=new Map();
  const db={objectStoreNames:{contains:n=>stores.has(n)},createObjectStore:name=>stores.set(name,new Map()),transaction:name=>{const data=stores.get(name),tx={objectStore:()=>({get:k=>({result:data.get(k)}),put:v=>{data.set(v.user,v);return {};},delete:k=>{data.delete(k);return {};}})};setTimeout(()=>tx.oncomplete?.());return tx;}};
  return {open:()=>{const r={result:db};setTimeout(()=>{if(!stores.size)r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('a new device reads old encrypted messages after a QR-style transfer or a password backup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cipherion-history-'));let server;
  try{
    server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
    const base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(t);resolve(m[0]);}});server.once('exit',c=>reject(Error('exit '+c)));});
    const nativeFetch=globalThis.fetch,cookies=new Map();
    const raw=async(path,cookie,method='GET',data)=>{const r=await nativeFetch(base+'/api'+path,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
    const register=async u=>{const r=await raw('/auth',null,'POST',{register:true,username:u,password:'password-testing-123'});return {id:r.data.user.id,cookie:r.cookie};};
    const alice=await register('histcalice'),bob=await register('histcbobby');
    // Each device signs in separately; the fetch shim picks its cookie.
    let current=null;
    globalThis.fetch=(path,options={})=>nativeFetch(base+path,{...options,signal:undefined,headers:{...options.headers,Cookie:current||''}});
    const device=async(name,cookie)=>{globalThis.indexedDB=fakeIndexedDB();current=cookie;const m=await import('../public/e2e.js?'+name);const ui=await import('../public/ui.js');return {m,cookie};};
    const as=async(d,fn)=>{current=d.cookie;return fn(d.m);};
    const {api}=await import('../public/ui.js');

    const aliceDevice=await device('alice',alice.cookie);await as(aliceDevice,m=>m.ensureDevice(alice.id));
    const bobOld=await device('bobold',bob.cookie);await as(bobOld,m=>m.ensureDevice(bob.id));
    // The first device of an account creates the history key.
    assert.ok(await as(bobOld,m=>m.historyKey(bob.id)));
    const chat=(await raw('/chats',alice.cookie,'POST',{users:[bob.id]})).data.id;
    const sent=await as(aliceDevice,async m=>(await raw(`/chats/${chat}/messages`,alice.cookie,'POST',{e2e:await m.seal(alice.id,chat,'старая тайна',null,{q:'цитата'}),emoji:[]})).data);
    // The old device opens the message and uploads a grant for it.
    const opened=await as(bobOld,async m=>{const rows=await api(`/chats/${chat}/messages`,'GET',undefined,undefined,bob.id);return rows.find(r=>r.id===sent.id);});
    assert.equal(opened.body,'старая тайна');assert.equal(opened.quote,'цитата');
    await wait(2200);

    // A new phone signs in: the message was not encrypted for it.
    const login=(await raw('/auth',null,'POST',{username:'histcbobby',password:'password-testing-123'})).cookie;
    const bobNew=await device('bobnew',login);await as(bobNew,m=>m.ensureDevice(bob.id));
    assert.equal(await as(bobNew,m=>m.historyKey(bob.id)),null);
    let row=await as(bobNew,async()=>(await api(`/chats/${chat}/messages`,'GET',undefined,undefined,bob.id)).find(r=>r.id===sent.id));
    assert.equal(row.e2eState,'locked');assert.ok(row.grant);

    // Transfer: the new device shows its one-time key, the old one wraps the history key for it.
    const receiver=await as(bobNew,m=>m.transferReceiver());
    const {code}=await as(bobNew,()=>api('/e2e/transfer','POST',{pub:receiver.pub},undefined,bob.id));
    const payload=await as(bobOld,m=>m.wrapHistoryFor(bob.id,receiver.pub));
    await as(bobOld,()=>api('/e2e/transfer/'+code,'PUT',{payload},undefined,bob.id));
    const ready=await as(bobNew,()=>api('/e2e/transfer/'+code,'GET',undefined,undefined,bob.id));
    assert.equal(ready.ready,true);
    await as(bobNew,()=>receiver.accept(bob.id,ready.payload));
    row=await as(bobNew,async()=>(await api(`/chats/${chat}/messages`,'GET',undefined,undefined,bob.id)).find(r=>r.id===sent.id));
    assert.equal(row.body,'старая тайна');assert.equal(row.e2eState,'ok');

    // Password backup: a third device restores the same key with the password only.
    await as(bobOld,m=>m.saveBackup(bob.id,'очень-длинный-пароль'));
    const login2=(await raw('/auth',null,'POST',{username:'histcbobby',password:'password-testing-123'})).cookie;
    const bobThird=await device('bobthird',login2);await as(bobThird,m=>m.ensureDevice(bob.id));
    await assert.rejects(as(bobThird,m=>m.restoreBackup(bob.id,'неверный-пароль')),/Неверный пароль/);
    await as(bobThird,m=>m.restoreBackup(bob.id,'очень-длинный-пароль'));
    row=await as(bobThird,async()=>(await api(`/chats/${chat}/messages`,'GET',undefined,undefined,bob.id)).find(r=>r.id===sent.id));
    assert.equal(row.body,'старая тайна');

    // Drafts sealed with the history key open on another device of the same account.
    const draft=await as(bobOld,m=>m.sealDraft(bob.id,'черновик'));assert.match(draft,/^e2d1:/);
    assert.equal(await as(bobThird,m=>m.openDraft(bob.id,draft)),'черновик');
    globalThis.fetch=nativeFetch;
  }finally{server?.kill();await new Promise(r=>server?.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
