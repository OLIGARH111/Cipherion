import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('a new realtime stream is never refused: past the limit the oldest (possibly half-open) stream is dropped',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cipherion-streams-'));const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 const controllers=[];
 try{
  const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.once('exit',code=>reject(new Error('Server exited '+code)));});
  const auth=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:'streamer',name:'Streamer',password:'test-password-12345'})});const cookie=auth.headers.get('set-cookie').split(';')[0];
  const open=async()=>{const c=new AbortController();controllers.push(c);const r=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:c.signal});const reader=r.body.getReader();return {reader,first:new TextDecoder().decode((await reader.read()).value||new Uint8Array())};};
  const streams=[];for(let i=0;i<7;i++)streams.push(await open());
  for(const s of streams)assert.match(s.first,/event: ready/);
  // The oldest stream was closed to make room.
  const ended=await Promise.race([streams[0].reader.read().then(r=>r.done,()=>true),new Promise(r=>setTimeout(()=>r(false),3000))]);assert.equal(ended,true);
 }finally{for(const c of controllers)c.abort();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
