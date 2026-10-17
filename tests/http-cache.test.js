import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {brotliDecompressSync} from 'node:zlib';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {encodingFor,etagMatches} from '../server/http-cache.js';

let server,base,dir;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-cache-'));server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('exit',code=>reject(Error('Server exit '+code)));});});
after(async()=>{server?.kill();if(server?.exitCode===null)await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});});

// fetch() decompresses transparently; a raw request shows the bytes that actually cross the network.
function raw(path,headers={}){return new Promise((resolve,reject)=>{const r=httpRequest(base+path,{headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});r.on('error',reject);r.end();});}

test('content negotiation and ETag matching',()=>{
 assert.equal(encodingFor('gzip, deflate, br','text/javascript; charset=utf-8'),'br');
 assert.equal(encodingFor('gzip','application/json; charset=utf-8'),'gzip');
 assert.equal(encodingFor('br;q=0, gzip','text/css'),'gzip');
 assert.equal(encodingFor('br','image/png'),null);
 assert.equal(encodingFor('','text/css'),null);
 assert.ok(etagMatches('W/"abc", "def"','"def"'));assert.ok(etagMatches('"abc"','"abc"'));assert.ok(!etagMatches('"abc"','"abd"'));assert.ok(!etagMatches(undefined,'"abc"'));
});

test('app files are compressed and revalidated with a body-less 304',async()=>{
 const source=await readFile('public/app.js');
 const first=await raw('/app.js',{'Accept-Encoding':'br'});
 assert.equal(first.status,200);assert.equal(first.headers['content-encoding'],'br');assert.equal(first.headers['cache-control'],'no-cache');
 assert.ok(first.body.length<source.length/2,'compressed response must be much smaller');
 assert.deepEqual(brotliDecompressSync(first.body),source);
 const again=await raw('/app.js',{'Accept-Encoding':'br','If-None-Match':first.headers.etag});
 assert.equal(again.status,304);assert.equal(again.body.length,0);
 const plain=await raw('/app.js');assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(plain.body,source);assert.equal(plain.headers.etag,first.headers.etag);
 const sticker=await raw('/stickers-v4/packs.json');assert.match(sticker.headers['cache-control'],/max-age=604800/);
 assert.equal((await raw('/missing.js')).status,404);assert.equal((await raw('/stickers-v4/')).status,404);
 assert.match((await raw('/robots.txt')).headers['content-type'],/text\/plain/);
});

test('large API responses are compressed; media is cached privately and revalidated after access checks',async()=>{
 const auth=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:'cache_user',password:'integration-password-123'})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const bytes=await readFile('public/apple-touch-icon.png');
 const media=await (await fetch(base+'/api/media',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/png','X-File-Name':'a.png'},body:bytes})).json();
 const first=await raw('/api/media/'+media.id,{Cookie:cookie});
 assert.equal(first.status,200);assert.equal(first.headers['cache-control'],'private, max-age=86400');assert.deepEqual(first.body,bytes);
 const again=await raw('/api/media/'+media.id,{Cookie:cookie,'If-None-Match':first.headers.etag});
 assert.equal(again.status,304);assert.equal(again.body.length,0);
 // A stranger holding the ETag still gets no access.
 const other=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:'cache_other',password:'integration-password-123'})});
 assert.equal((await raw('/api/media/'+media.id,{Cookie:other.headers.get('set-cookie').split(';')[0],'If-None-Match':first.headers.etag})).status,403);
 const otherCookie=other.headers.get('set-cookie').split(';')[0],otherUser=(await (await fetch(base+'/api/me',{headers:{Cookie:otherCookie}})).json());
 const post=(path,data)=>fetch(base+'/api'+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
 const chat=await post('/chats',{users:[(otherUser.user||otherUser).id]});
 for(let i=0;i<3;i++)await post('/chats/'+chat.id+'/messages',{body:'Длинное сообщение для проверки сжатия. '.repeat(20),clientId:randomUUID()});
 const plainJSON=await raw('/api/chats/'+chat.id+'/messages',{Cookie:cookie});assert.equal(plainJSON.status,200);assert.equal(plainJSON.headers['content-encoding'],undefined);
 const packed=await raw('/api/chats/'+chat.id+'/messages',{Cookie:cookie,'Accept-Encoding':'br'});
 assert.ok(plainJSON.body.length>1024,'fixture must exceed the compression threshold');
 assert.equal(packed.headers['content-encoding'],'br');assert.ok(packed.body.length<plainJSON.body.length);
 const ids=body=>JSON.parse(body).map(m=>m.id+m.body);assert.deepEqual(ids(brotliDecompressSync(packed.body)),ids(plainJSON.body));
});

test('service worker serves the saved app shell when the network or server fails, never API data',async()=>{
 const listeners={},store=new Map();
 const cache={put:async(k,v)=>{store.set(typeof k==='string'?k:k.url,v);},match:async k=>store.get(typeof k==='string'?k:k.url)};
 let network=async()=>({ok:true,status:200,type:'basic',clone(){return this;},body:'fresh'});
 const context={self:{location:{origin:'https://c.test'},addEventListener:(n,f)=>listeners[n]=f,clients:{claim:async()=>{}}},URL,Date,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:(...a)=>network(...a),Response:{error:()=>({error:true})}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
 const fetchEvent=async request=>{let result;listeners.fetch({request,respondWith:p=>result=p});return result&&await result;};
 const page={method:'GET',mode:'navigate',url:'https://c.test/?x=1'};
 assert.equal((await fetchEvent(page)).body,'fresh');await new Promise(r=>setTimeout(r));assert.ok(store.has('/'));
 network=async()=>{throw new TypeError('offline');};assert.equal((await fetchEvent(page)).body,'fresh');
 network=async()=>({ok:false,status:503,type:'basic',body:'suspended'});assert.equal((await fetchEvent(page)).body,'fresh');
 assert.equal(await fetchEvent({method:'GET',mode:'cors',url:'https://c.test/api/chats'}),undefined);
 assert.equal(await fetchEvent({method:'POST',mode:'cors',url:'https://c.test/app.js'}),undefined);
 network=async()=>{throw new TypeError('offline');};assert.deepEqual(await fetchEvent({method:'GET',mode:'no-cors',url:'https://c.test/never-cached.js'}),{error:true});
});
