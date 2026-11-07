import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyManifest,createCypherRelease,cypherInstructions} from '../server/cypher.js';

// The real Cypher 1.0.6 manifest from github.com/OLIGARH111/Cypher, signed with the administrator key.
const MANIFEST={"version":"1.0.6","url":"https://raw.githubusercontent.com/OLIGARH111/Cypher/main/Cypher_1.0.6_x64-setup.exe","sha256":"6df4e2d064bee6454d8c10affae8c598606c93f0614a8b0bcd8c7c834c76b6c2","size":19906382,"notes":"• Новая вкладка «Обновления» в настройках: версия, проверка и установка в один клик\n• Из админ-панели убрана публикация выпусков","published":"2026-10-30","signature":"cmqvuXe/ijtXnCe+ilV3AjiGbH/3o/9k13HI7I4pzrVKKisZJUK1nFZ8jId+eotPVDp1NbADHBzRnJm4jFwNBA=="};

test('genuine Cypher release passes, any change to a signed field is rejected',()=>{
  const r=verifyManifest(MANIFEST);assert.equal(r.version,'1.0.6');assert.equal(r.size,19906382);assert.match(r.url,/^https:\/\/raw\.githubusercontent\.com\/OLIGARH111\/Cypher\//);
  for(const change of [{notes:'подмена'},{url:'https://evil.example/Cypher.exe'},{sha256:'0'.repeat(64)},{size:1},{version:'9.9.9'},{signature:''},{signature:'not base64!'}])
    assert.throws(()=>verifyManifest({...MANIFEST,...change}),/Cypher/);
  assert.throws(()=>verifyManifest(null));assert.throws(()=>verifyManifest([]));
});

test('release cache refreshes after its lifetime and keeps the last verified release on failure',async()=>{
  let time=0,calls=0,mode='ok';
  const fetcher=async()=>{calls++;if(mode==='down')throw Object.assign(new Error('offline'),{name:'TimeoutError'});if(mode==='forged')return new Response(JSON.stringify({...MANIFEST,notes:'x'}));return new Response(JSON.stringify(MANIFEST));};
  const release=createCypherRelease({fetcher,url:()=>'https://updates.example/latest.json',ttl:1000,clock:()=>time});
  const [a,b]=await Promise.all([release.get(),release.get()]);assert.equal(calls,1);assert.equal(a.release.version,'1.0.6');assert.equal(b,a);
  mode='forged';time=2000;let r=await release.get();assert.equal(calls,2);assert.equal(r.release.version,'1.0.6');assert.match(r.error,/Подпись/);
  mode='down';time=4000;r=await release.get();assert.equal(r.release.version,'1.0.6');assert.match(r.error,/Нет связи/);
  const empty=createCypherRelease({fetcher:async()=>new Response('nope',{status:404}),url:()=>'https://x.example/'});r=await empty.get();assert.equal(r.release,null);assert.match(r.error,/пуст/);
});

test('Cypher persona is honest about what it can do inside the messenger',()=>{
  const text=cypherInstructions({language:'Русский',style:'Кратко',address:'Алекс'});
  assert.match(text,/Cypher AI/);assert.match(text,/«Алекс»/);assert.match(text,/здесь не умеешь/);assert.match(text,/никогда сам не отправляешь/);
  assert.doesNotMatch(cypherInstructions({}),/Обращайся/);
});

let server,base,dir,provider,received=[];
before(async()=>{
  // A Chat Completions provider (as Groq, Cypher's default) that first calls a tool, then answers.
  provider=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/latest.json')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(MANIFEST));return;}
    let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);received.push({url:req.url,data});res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunks=data.messages.some(m=>m.role==='tool')
      ?[{choices:[{delta:{content:'Встреча '}}]},{choices:[{delta:{content:'в 10:00.'},finish_reason:'stop'}]}]
      :[{choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'search_messages',arguments:''}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:JSON.stringify({query:'Meeting',chat:data.messages[0].content.match(/"id":"([^"]+)"/)[1]})}}]},finish_reason:'tool_calls'}]}];
    for(const c of chunks)res.write('data: '+JSON.stringify(c)+'\n\n');res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+provider.address().port;
  dir=await mkdtemp(join(tmpdir(),'cipherion-cypher-'));
  server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',AI_API_KEY:'test-only',AI_BASE_URL:origin,AI_MODEL:'llama-test',AI_API_STYLE:'chat-completions',CYPHER_UPDATE_URL:origin+'/latest.json'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Startup timeout')),10000);server.stdout.on('data',c=>{const m=String(c).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});server.once('error',reject);server.once('exit',c=>reject(new Error('Exit '+c)));});
});
after(async()=>{server?.kill();if(server?.exitCode===null)await new Promise(r=>server.once('exit',r));await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true});});
async function req(path,cookie,method='GET',data){const r=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const account=username=>req('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});

test('AI section serves the verified Cypher release and Cypher answers through Chat Completions with tools',async()=>{
  const a=await account('cy_alice'),b=await account('cy_bob');
  assert.equal((await req('/ai/cypher')).status,401);
  const rel=(await req('/ai/cypher',a.cookie)).data;assert.equal(rel.release.version,'1.0.6');assert.equal(rel.error,'');
  assert.equal((await req('/ai/config',a.cookie)).data.settings.assistant,'cypher');
  const chat=(await req('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  await req(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'Meeting at 10:00'});
  await req('/me',a.cookie,'PATCH',{settings:{ai:{enabled:true,direct:true,chatIds:[chat.id]}}});
  const r=await fetch(base+'/api/ai/chat',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'Когда встреча?'})});const events=await r.text();
  assert.match(events,/event: done/);assert.match(events,/Встреча /);
  assert.equal(received.length,2);assert.ok(received.every(x=>x.url==='/chat/completions'&&x.data.stream===true&&x.data.model==='llama-test'));
  assert.match(received[0].data.messages[0].content,/Cypher AI/);assert.equal(received[0].data.tools[0].function.name,'search_messages');
  const tool=received[1].data.messages.find(m=>m.role==='tool');assert.equal(tool.tool_call_id,'call_1');assert.match(tool.content,/Meeting at 10:00/);
  assert.equal(received[1].data.messages.find(m=>m.tool_calls).tool_calls[0].function.name,'search_messages');
  const history=(await req('/ai/history',a.cookie)).data;assert.equal(history.at(-1).body,'Встреча в 10:00.');
  // Switching back to the neutral assistant uses the Cipherion prompt.
  await req('/me',a.cookie,'PATCH',{settings:{ai:{assistant:'cipherion',enabled:true,direct:true,chatIds:[chat.id]}}});received=[];
  await (await fetch(base+'/api/ai/chat',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'Привет'})})).text();
  assert.match(received[0].data.messages[0].content,/You are Cipherion AI/);
});
