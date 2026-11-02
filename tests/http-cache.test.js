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
import {encodingFor,etagMatches,createAppShell,createStaticFiles} from '../server/http-cache.js';

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

// A tiny Cache Storage + fetch double for running sw.js in a sandbox.
async function serviceWorker(network){
 const listeners={},stores=new Map(),messages=[];
 const keyOf=x=>{const u=new URL(typeof x==='string'?x:x.url,'https://c.test');return u.pathname+u.search;};
 const open=async name=>{if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {put:async(key,v)=>{store.set(keyOf(key),v);},match:async key=>store.get(keyOf(key)),keys:async()=>[...store.keys()].map(p=>({url:'https://c.test'+p})),delete:async key=>store.delete(keyOf(key))};};
 const context={self:{location:{origin:'https://c.test'},addEventListener:(n,f)=>listeners[n]=f,clients:{claim:async()=>{},matchAll:async()=>[{postMessage:m=>messages.push(m)}]}},URL,Date,setTimeout,caches:{open,keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n)},fetch:(...a)=>network.fn(...a),Response:{error:()=>({error:true})}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
 const fetchEvent=async request=>{let result;const waits=[];listeners.fetch({request,respondWith:p=>result=p,waitUntil:p=>waits.push(p)});const value=result&&await result;return {value,settled:()=>Promise.all(waits)};};
 return {fetchEvent,stores,messages};
}
const reply=(body,cacheControl='no-cache',status=200)=>({ok:status<400,status,type:'basic',headers:{get:n=>n==='Cache-Control'?cacheControl:null},clone(){return reply(body,cacheControl,status);},text:async()=>body,body});
const pathOf=url=>new URL(String(url?.url||url),'https://c.test').pathname;

test('service worker opens the saved app at once and never waits for the server; API data is never cached',async()=>{
 const pageA='<link rel="stylesheet" href="/v/aaaaaaaaaaaa/bundle.css"><script type="module" src="/v/aaaaaaaaaaaa/bundle.js"></script>';
 const network={fn:async url=>pathOf(url)==='/'?reply(pageA):reply('asset '+pathOf(url),'public, max-age=31536000, immutable')};
 const sw=await serviceWorker(network);
 const page={method:'GET',mode:'navigate',url:'https://c.test/?x=1'};
 // First start: from the network; the page is saved only together with every file it links.
 const first=await sw.fetchEvent(page);assert.equal(first.value.body,pageA);await first.settled();
 assert.equal(sw.stores.get('cipherion-shell-v2').get('/').body,pageA);
 for(const file of ['bundle.js','bundle.css'])assert.ok(sw.stores.get('cipherion-assets-v1').has('/v/aaaaaaaaaaaa/'+file));
 // Next start: a server that never answers does not delay the app.
 network.fn=()=>new Promise(()=>{});
 const started=Date.now(),again=await sw.fetchEvent(page);assert.equal(again.value.body,pageA);assert.ok(Date.now()-started<200,'saved page must open without waiting');
 network.fn=async()=>{throw new TypeError('offline');};assert.equal((await sw.fetchEvent(page)).value.body,pageA);
 assert.equal((await sw.fetchEvent({method:'GET',mode:'cors',url:'https://c.test/api/chats'})).value,undefined);
 assert.equal((await sw.fetchEvent({method:'POST',mode:'cors',url:'https://c.test/app.js'})).value,undefined);
 assert.deepEqual((await sw.fetchEvent({method:'GET',mode:'no-cors',url:'https://c.test/never-cached.js'})).value,{error:true});
});

test('a new version is saved in the background only after all its files are downloaded',async()=>{
 const pageA='<script type="module" src="/v/aaaaaaaaaaaa/bundle.js"></script>',pageB='<link rel="stylesheet" href="/v/bbbbbbbbbbbb/bundle.css"><script type="module" src="/v/bbbbbbbbbbbb/bundle.js"></script>';
 let page=pageA,assetsReady=true;
 const network={fn:async url=>pathOf(url)==='/'?reply(page):assetsReady?reply('asset '+pathOf(url),'public, max-age=31536000, immutable'):reply('busy','no-cache',503)};
 const sw=await serviceWorker(network);
 const nav={method:'GET',mode:'navigate',url:'https://c.test/'};
 await (await sw.fetchEvent(nav)).settled();
 // A deploy happened, but its files cannot be downloaded yet: keep the old, complete version.
 page=pageB;assetsReady=false;
 let opened=await sw.fetchEvent(nav);assert.equal(opened.value.body,pageA);await opened.settled();
 assert.equal(sw.stores.get('cipherion-shell-v2').get('/').body,pageA);assert.equal(sw.messages.length,0);
 // Files available: the new version is stored for the next start and the open app is told.
 assetsReady=true;opened=await sw.fetchEvent(nav);assert.equal(opened.value.body,pageA,'this start still uses the saved version');await opened.settled();
 assert.equal(sw.stores.get('cipherion-shell-v2').get('/').body,pageB);
 assert.ok(sw.stores.get('cipherion-assets-v1').has('/v/bbbbbbbbbbbb/bundle.css'));
 assert.equal(JSON.stringify(sw.messages),JSON.stringify([{type:'app-updated'}]));
 assert.equal((await sw.fetchEvent(nav)).value.body,pageB);
});

test('hashed icons and sticker art open from the saved copy, also offline',async()=>{
 const network={fn:async()=>reply('icon v1','public, max-age=31536000, immutable')};
 const sw=await serviceWorker(network);
 const icon={method:'GET',mode:'no-cors',url:'https://c.test/brand/icon-192-99e4c7990351.png'};
 let r=await sw.fetchEvent(icon);assert.equal(r.value.body,'icon v1');await r.settled();
 network.fn=async()=>{throw new TypeError('offline');};
 r=await sw.fetchEvent(icon);assert.equal(r.value.body,'icon v1');await r.settled();
});

test('the page links one bundled script and one stylesheet, cached forever',async()=>{
 const page=await raw('/');assert.equal(page.status,200);assert.equal(page.headers['cache-control'],'no-cache');
 const html=page.body.toString();const version=html.match(/src="\/v\/([a-f0-9]{12})\/bundle\.js"/)?.[1];
 assert.ok(version,'the bundle must be linked through /v/<version>/');
 assert.equal((html.match(/<script /g)||[]).length,1,'one script for the whole app');
 assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1,'one stylesheet for the whole app');
 assert.match(html,new RegExp(`<link rel="stylesheet" href="/v/${version}/bundle.css">`));
 assert.ok(!html.includes('modulepreload'));
 assert.equal((await raw('/index.html')).headers.etag,page.headers.etag);
 const js=await raw(`/v/${version}/bundle.js`,{'Accept-Encoding':'br'});assert.equal(js.status,200);
 assert.equal(js.headers['cache-control'],'public, max-age=31536000, immutable');assert.match(js.headers['content-type'],/text\/javascript/);assert.equal(js.headers['content-encoding'],'br');
 const code=brotliDecompressSync(js.body).toString();
 assert.ok(code.includes('cipherion-active-account'),'bundle carries the app code, with Russian text kept readable');
 assert.ok(code.includes('Не удалось подключиться'));
 assert.ok(!/(^|[;}])\s*import\s*[{"'*]/m.test(code)&&!/\bimport\(["']\.\//.test(code),'no module is loaded separately');
 const css=(await raw(`/v/${version}/bundle.css`)).body.toString();
 const sheets=[...(await readFile('public/index.html','utf8')).matchAll(/href="\/([\w.-]+\.css)"/g)].map(m=>m[1]);
 // Stylesheets keep the page order, so the cascade is unchanged.
 let at=-1;for(const name of sheets){const found=css.indexOf((await readFile('public/'+name,'utf8')).trim());assert.ok(found>at,name+' must follow the previous sheet');at=found;}
 // An older version still loads today's bundle, but is never stored for a year under the wrong name.
 assert.equal((await raw('/v/000000000000/bundle.js')).headers['cache-control'],'no-cache');
 const asset=await raw(`/v/${version}/ui.js`);assert.equal(asset.status,200);assert.deepEqual(asset.body,await readFile('public/ui.js'));
 assert.equal((await raw(`/v/${version}/missing.js`)).status,404);
 assert.equal((await raw(`/v/${version}/%2e%2e/%2e%2e/package.json`)).status,404);
 assert.ok(!(await readFile('public/style.css','utf8')).includes('@import'),'no stylesheet waits for another one');
});

test('without bundling the page links the separate files and preloads the whole module tree',async()=>{
 const previous=process.env.CIPHERION_BUNDLE;process.env.CIPHERION_BUNDLE='0';
 try{
  const built=await createAppShell(join(process.cwd(),'public'),createStaticFiles()).get();
  const html=built.body.toString(),version=built.version;
  assert.equal(built.bundled,false);
  assert.match(html,new RegExp(`src="/v/${version}/app\\.js"`));assert.match(html,new RegExp(`href="/v/${version}/style.css"`));
  for(const module of ['ui.js','account-context.js','chat-ui.js','email-auth.js'])assert.match(html,new RegExp(`<link rel="modulepreload" href="/v/${version}/${module}">`));
  assert.ok(!html.includes(`modulepreload" href="/v/${version}/app.js"`),'entry scripts are not preloaded twice');
 }finally{if(previous===undefined)delete process.env.CIPHERION_BUNDLE;else process.env.CIPHERION_BUNDLE=previous;}
});

test('a phone back from the background gets a fresh event stream at once, even with old ones still open',async()=>{
 const auth=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:'stream_user',password:'integration-password-123'})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const streams=[];
 const open=()=>new Promise((resolve,reject)=>{const r=httpRequest(base+'/api/events',{headers:{Cookie:cookie}},res=>{let text='';const s={res,ended:false,text:()=>text};res.on('data',c=>{text+=c;if(text.includes('event: ready'))resolve(s);});res.on('end',()=>{s.ended=true;});res.on('close',()=>{s.ended=true;});});r.on('error',reject);r.end();streams.push(r);});
 try{
  const first=await open();assert.match(first.text(),/^retry: 1000\n/,'browsers retry after one second');
  for(let i=0;i<6;i++)await open();
  await new Promise(r=>setTimeout(r,100));
  assert.ok(first.ended,'the oldest stream makes room for the new one');
 }finally{for(const r of streams)r.destroy();}
});

test('service worker opens versioned files from its cache without the network',async()=>{
 const listeners={},stores=new Map();
 const open=async name=>{if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {put:async(k,v)=>{store.set(typeof k==='string'?k:k.url,v);},match:async k=>store.get(typeof k==='string'?k:k.url),keys:async()=>[...store.keys()].map(url=>({url})),delete:async k=>store.delete(k.url)};};
 let calls=0;const network=async()=>{calls++;return {ok:true,status:200,type:'basic',headers:{get:()=>'public, max-age=31536000, immutable'},clone(){return this;},body:'module'};};
 const context={self:{location:{origin:'https://c.test'},addEventListener:(n,f)=>listeners[n]=f,clients:{claim:async()=>{}}},URL,Date,setTimeout,caches:{open,keys:async()=>[],delete:async()=>true},fetch:network,Response:{error:()=>({error:true})}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
 const fetchEvent=async request=>{let result;listeners.fetch({request,respondWith:p=>result=p});return result&&await result;};
 const asset={method:'GET',mode:'cors',url:'https://c.test/v/0123456789ab/ui.js'};
 assert.equal((await fetchEvent(asset)).body,'module');await new Promise(r=>setTimeout(r));
 assert.equal((await fetchEvent(asset)).body,'module');assert.equal(calls,1,'second load must not touch the network');
});

test('the chat list can be asked for one chat, and never returns a chat the user is not in',async()=>{
 const reg=async name=>{const r=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:name,password:'integration-password-123'})});return r.headers.get('set-cookie').split(';')[0];};
 const a=await reg('one_chat_a'),b=await reg('one_chat_b'),c=await reg('one_chat_c');
 const me=async cookie=>(await (await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json()).user;
 const chat=await (await fetch(base+'/api/chats',{method:'POST',headers:{Cookie:a,'Content-Type':'application/json'},body:JSON.stringify({users:[(await me(b)).id]})})).json();
 const list=async(cookie,q='')=>(await fetch(base+'/api/chats'+q,{headers:{Cookie:cookie}})).json();
 const one=await list(a,'?chat='+chat.id);assert.equal(one.length,1);assert.equal(one[0].id,chat.id);
 const shape=x=>({id:x.id,kind:x.kind,unread:x.unread,last:x.last?.id,members:x.members.map(m=>m.user_id).sort(),canPost:x.canPost});
 assert.deepEqual(shape(one[0]),shape((await list(a)).find(x=>x.id===chat.id)),'same view as in the full list');
 assert.deepEqual(await list(c,'?chat='+chat.id),[],'outsiders get nothing');
 assert.ok((await list(a)).length>1,'without the parameter the whole list is returned');
});

test('a page of messages and the sync feed match the single-message view, reactions included',async()=>{
 const reg=async name=>{const r=await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register:true,username:name,password:'integration-password-123'})});return r.headers.get('set-cookie').split(';')[0];};
 const a=await reg('batch_a'),b=await reg('batch_b');
 const call=(cookie,path,method='GET',data)=>fetch(base+'/api'+path,{method,headers:{Cookie:cookie,...(data?{'Content-Type':'application/json'}:{})},body:data&&JSON.stringify(data)}).then(r=>r.json());
 const bId=(await call(b,'/me')).user.id,chat=await call(a,'/chats','POST',{users:[bId]});
 const sent=[];for(let i=0;i<4;i++)sent.push(await call(i%2?b:a,'/chats/'+chat.id+'/messages','POST',{body:'m'+i,clientId:randomUUID()}));
 await call(a,'/reactions','POST',{message:sent[1].id,emoji:'👍'});await call(b,'/reactions','POST',{message:sent[1].id,emoji:'👍'});await call(b,'/reactions','POST',{message:sent[2].id,emoji:'🔥'});
 const strip=m=>{const {author,_metadata,...rest}=m;return {...rest,author:author?.id};};
 const page=await call(a,'/chats/'+chat.id+'/messages');assert.equal(page.length,4);
 assert.deepEqual(page.find(m=>m.id===sent[1].id).reactions,[{emoji:'👍',count:2}]);assert.equal(page.find(m=>m.id===sent[1].id).myReaction,'👍');
 assert.equal(page.find(m=>m.id===sent[2].id).myReaction,null);assert.equal(page.find(m=>m.id===sent[0].id).story,null);
 for(const m of page)assert.deepEqual(strip(m),strip(await call(a,'/messages/'+m.id)),'page entry equals single view');
 const feed=(await call(b,'/sync?after=0')).events.map(e=>e.message).filter(m=>m.chat_id===chat.id);
 for(const m of feed)assert.deepEqual(strip(m),strip(await call(b,'/messages/'+m.id)),'sync entry equals single view');
 assert.ok(feed.length>=4);
});
