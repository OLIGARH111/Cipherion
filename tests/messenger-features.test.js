import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {parsePreview,decodeEntities} from '../server/link-preview.js';
import {privateAddress,checkURL} from '../server/safe-fetch.js';
import {decodeCBOR} from '../server/device-login.js';
import {richText,plainText} from '../public/rich-text.js';

let server,base,dir;
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-features-'));server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);server.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/[^\s]+/);if(match){clearTimeout(timeout);resolve(match[0]);}});server.on('exit',code=>reject(new Error('Server exited '+code)));});});
after(async()=>{server?.kill();await new Promise(resolve=>server?.exitCode!==null?resolve():server.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json().catch(()=>null),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const account=async username=>request('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});

test('link previews are parsed on the server and private addresses are refused',()=>{
  const page=`<html><head><meta charset="utf-8"><title>Fallback</title><meta property="og:title" content="Новости &amp; события"><meta property="og:description" content="Коротко о главном"><meta property="og:image" content="/cover.png"><meta property="og:site_name" content="Пример"></head></html>`;
  const p=parsePreview(page,'https://example.com/news/1');
  assert.equal(p.title,'Новости & события');assert.equal(p.description,'Коротко о главном');assert.equal(p.image,'https://example.com/cover.png');assert.equal(p.site,'Пример');
  assert.equal(decodeEntities('&#x41;&#66;&laquo;'),'AB«');
  for(const ip of ['127.0.0.1','10.0.0.5','192.168.1.1','169.254.169.254','::1','fd00::1','::ffff:10.0.0.1'])assert.equal(privateAddress(ip),true,ip);
  assert.equal(privateAddress('93.184.216.34'),false);
  assert.equal(checkURL('http://localhost/x'),null);assert.equal(checkURL('http://127.0.0.1/'),null);assert.equal(checkURL('ftp://example.com'),null);assert.equal(checkURL('https://user:pw@example.com'),null);
  assert.ok(checkURL('https://example.com/a?b'));
});

test('rich text formatting escapes HTML and supports bold, italic, mono, strike and spoilers',()=>{
  const html=richText('**жирный** __курсив__ `код <b>` ~~зачёркнутый~~ ||спойлер|| <script>');
  assert.match(html,/<strong>жирный<\/strong>/);assert.match(html,/<em>курсив<\/em>/);assert.match(html,/<code>код &lt;b&gt;<\/code>/);
  assert.match(html,/<s>зачёркнутый<\/s>/);assert.match(html,/class="spoiler"/);assert.doesNotMatch(html,/<script>/);
  assert.match(richText('см. https://example.com/a?b=1&c=2.'),/<a href="https:\/\/example.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">/);
  assert.equal(plainText('**a** ||b|| `c`'),'a ▒▒▒ c');
  assert.doesNotMatch(richText('**`x`**'),/\*\*/);
  assert.match(richText('@alice привет'),/class="mention"/);
});

test('mentions, auto-delete, slow mode, topics and channel comments',async()=>{
  const a=await account('mentalice'),b=await account('mentbobby'),c=await account('mentcarol');
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Features',users:[b.data.user.id,c.data.user.id]})).data;
  // Mentions: by id (works for encrypted text) and by @username in plain text.
  const m1=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'привет',mentions:[b.data.user.id,'not-a-member']});assert.equal(m1.status,201);
  const m2=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'@mentcarol и @mentbobby, гляньте'});assert.equal(m2.status,201);
  let mentions=(await request(`/chats/${group.id}/mentions`,b.cookie)).data;assert.deepEqual(mentions.map(m=>m.id),[m1.data.id,m2.data.id]);
  assert.equal((await request(`/chats/${group.id}/mentions`,c.cookie)).data.length,1);
  assert.equal((await request('/chats?chat='+group.id,b.cookie)).data[0].mentions,2);
  assert.equal((await request(`/chats/${group.id}/messages`,b.cookie)).data.find(m=>m.id===m1.data.id).mentioned,true);
  const left=await request(`/chats/${group.id}/mentions`,b.cookie,'POST',{message:m1.data.id});assert.equal(left.data.left,1);
  // Auto-delete: only allowed values; new messages carry their expiry.
  assert.equal((await request(`/chats/${group.id}/features`,a.cookie,'PATCH',{ttl:123})).status,400);
  assert.equal((await request(`/chats/${group.id}/features`,b.cookie,'PATCH',{ttl:86400})).status,403);
  assert.equal((await request(`/chats/${group.id}/features`,a.cookie,'PATCH',{ttl:86400})).status,200);
  const timed=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'исчезнет'});
  assert.ok(Math.abs(timed.data.expires_at-(timed.data.created+86400_000))<5);
  const direct=(await request('/chats',a.cookie,'POST',{users:[b.data.user.id]})).data;
  assert.equal((await request(`/chats/${direct.id}/features`,b.cookie,'PATCH',{ttl:604800})).status,200);
  // Slow mode limits members, not administrators.
  assert.equal((await request(`/chats/${group.id}/features`,a.cookie,'PATCH',{slowMode:60})).status,200);
  assert.equal((await request(`/chats/${group.id}/messages`,b.cookie,'POST',{body:'один'})).status,201);
  const slow=await request(`/chats/${group.id}/messages`,b.cookie,'POST',{body:'два'});assert.equal(slow.status,429);assert.ok(slow.data.retryAfter>50);
  assert.ok((await request('/chats?chat='+group.id,b.cookie)).data[0].slowWait>50000);
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'админ пишет'})).status,201);
  await request(`/chats/${group.id}/features`,a.cookie,'PATCH',{slowMode:0});
  // Topics.
  assert.equal((await request(`/chats/${group.id}/topics`,a.cookie)).status,400);
  await request(`/chats/${group.id}/features`,a.cookie,'PATCH',{forum:true});
  const topic=(await request(`/chats/${group.id}/topics`,b.cookie,'POST',{title:'Отпуск',icon:'🏖'})).data;assert.ok(topic.id);
  await request(`/chats/${group.id}/messages`,c.cookie,'POST',{body:'в теме',topic:topic.id});
  const inTopic=(await request(`/chats/${group.id}/messages?topic=${topic.id}`,a.cookie)).data;assert.deepEqual(inTopic.map(m=>m.body),['в теме']);
  assert.ok(!(await request(`/chats/${group.id}/messages?topic=general`,a.cookie)).data.some(m=>m.body==='в теме'));
  const topics=(await request(`/chats/${group.id}/topics`,a.cookie)).data;assert.equal(topics[0].id,'general');assert.equal(topics.find(t=>t.id===topic.id).count,1);
  assert.equal((await request('/topics/'+topic.id,c.cookie,'PATCH',{closed:true})).status,403);
  assert.equal((await request('/topics/'+topic.id,a.cookie,'PATCH',{closed:true})).status,200);
  assert.equal((await request(`/chats/${group.id}/messages`,c.cookie,'POST',{body:'закрыто',topic:topic.id})).status,403);
  // Channel comments.
  const channel=(await request('/chats',a.cookie,'POST',{kind:'channel',title:'Канал',users:[b.data.user.id]})).data;
  const post=await request(`/chats/${channel.id}/messages`,a.cookie,'POST',{body:'Пост'});
  assert.equal((await request(`/messages/${post.data.id}/comments`,b.cookie,'POST',{body:'Отличный пост'})).status,201);
  assert.equal((await request(`/messages/${post.data.id}/comments`,c.cookie)).status,403);
  const comments=(await request(`/messages/${post.data.id}/comments`,a.cookie)).data;assert.equal(comments.length,1);assert.equal(comments[0].canDelete,true);
  assert.equal((await request(`/chats/${channel.id}/messages`,b.cookie)).data[0].comments,1);
  assert.equal((await request(`/chats/${channel.id}/features`,a.cookie,'PATCH',{comments:false})).status,200);
  assert.equal((await request(`/messages/${post.data.id}/comments`,b.cookie,'POST',{body:'ещё'})).status,403);
  assert.equal((await request(`/messages/${m1.data.id}/comments`,a.cookie)).status,400);
});

test('checklists, locations and sealed attachments',async()=>{
  const a=await account('checkalice'),b=await account('checkbobby');
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Список',users:[b.data.user.id]})).data;
  const list=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{kind:'poll',body:'Покупки',poll:{checklist:true,options:['Хлеб']}});assert.equal(list.status,201);
  assert.equal(list.data.poll.checklist,true);
  assert.equal((await request(`/polls/${list.data.id}/items`,b.cookie,'POST',{text:'Молоко'})).status,200);
  const checked=await request(`/polls/${list.data.id}/check`,b.cookie,'POST',{item:1,done:true});assert.deepEqual(checked.data.done.map(d=>d.item),[1]);
  assert.equal(checked.data.options.length,2);
  assert.equal((await request(`/messages/${list.data.id}/vote`,b.cookie,'POST',{choices:[0]})).status,400);
  assert.equal((await request(`/polls/${list.data.id}/check`,a.cookie,'POST',{item:1,done:false})).data.done.length,0);
  // Locations: validated when plain, live sharing can be updated by the author and stopped.
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{kind:'location',body:JSON.stringify({lat:200,lng:0})})).status,400);
  const place=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{kind:'location',body:JSON.stringify({lat:55.7558,lng:37.6173,acc:20}),live:900});assert.equal(place.status,201);
  assert.ok(place.data.live_until>Date.now());
  assert.equal((await request('/messages/'+place.data.id,b.cookie,'PATCH',{body:JSON.stringify({lat:1,lng:1})})).status,403);
  assert.equal((await request('/messages/'+place.data.id,a.cookie,'PATCH',{body:JSON.stringify({lat:55.76,lng:37.62,acc:10})})).status,200);
  assert.equal(JSON.parse((await request('/messages/'+place.data.id,b.cookie)).data.body).lat,55.76);
  await request('/messages/'+place.data.id,a.cookie,'PATCH',{stop:true});
  assert.equal((await request('/messages/'+place.data.id,a.cookie,'PATCH',{body:JSON.stringify({lat:1,lng:1})})).status,400);
  // A sealed attachment needs a sealed message.
  const up=await fetch(base+'/api/media',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'application/x-cipherion-sealed','X-File-Name':'encrypted.bin'},body:randomBytes(64)});assert.equal(up.status,201);
  const media=await up.json();
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{kind:'photo',media:media.id})).status,400);
});

// Minimal CBOR encoder for building authenticator responses in the test.
function cbor(value){
  const head=(major,n)=>n<24?Buffer.from([major<<5|n]):n<256?Buffer.from([major<<5|24,n]):Buffer.from([major<<5|25,n>>8,n&255]);
  if(typeof value==='number')return value>=0?head(0,value):head(1,-1-value);
  if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);
  if(typeof value==='string'){const b=Buffer.from(value);return Buffer.concat([head(3,b.length),b]);}
  if(value instanceof Map)return Buffer.concat([head(5,value.size),...[...value].flatMap(([k,v])=>[cbor(k),cbor(v)])]);
  throw new Error('unsupported');
}
test('CBOR decoder reads maps, byte strings and negative keys',()=>{
  const {value}=decodeCBOR(cbor(new Map([[1,2],[-1,1],['x',Buffer.from([1,2])]])));
  assert.equal(value.get(1),2);assert.equal(value.get(-1),1);assert.deepEqual([...value.get('x')],[1,2]);
});

test('passkey registration and sign-in, QR login approval',async()=>{
  const a=await account('passalice');
  const origin=base;const rpHash=createHash('sha256').update(new URL(origin).hostname).digest();
  const options=(await request('/passkeys/register/options',a.cookie,'POST',{})).data;assert.equal(options.authenticatorSelection.userVerification,'required');
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});const jwk=publicKey.export({format:'jwk'});
  const credentialId=randomBytes(16),cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const counter=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
  const authData=Buffer.concat([rpHash,Buffer.from([0x45]),counter(1),Buffer.alloc(16),Buffer.from([0,16]),credentialId,cose]);
  const clientData=(type,challenge)=>Buffer.from(JSON.stringify({type,challenge,origin})).toString('base64url');
  const attestationObject=cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]])).toString('base64url');
  const registered=await request('/passkeys/register',a.cookie,'POST',{id:credentialId.toString('base64url'),clientDataJSON:clientData('webauthn.create',options.challenge),attestationObject,name:'Тестовый ключ'});
  assert.equal(registered.status,201,JSON.stringify(registered.data));assert.equal(registered.data[0].name,'Тестовый ключ');
  // A reused challenge is refused.
  assert.equal((await request('/passkeys/register',a.cookie,'POST',{id:credentialId.toString('base64url'),clientDataJSON:clientData('webauthn.create',options.challenge),attestationObject})).status,400);
  const login=async(n,tamper=false)=>{
    const {challenge}=(await request('/passkeys/login/options',null,'POST',{})).data;
    const data=Buffer.concat([rpHash,Buffer.from([0x05]),counter(n)]),cd=clientData('webauthn.get',challenge);
    const signature=sign('sha256',Buffer.concat([data,createHash('sha256').update(Buffer.from(cd,'base64url')).digest()]),privateKey);
    if(tamper)signature[signature.length-1]^=1;
    return request('/passkeys/login',null,'POST',{id:credentialId.toString('base64url'),clientDataJSON:cd,authenticatorData:data.toString('base64url'),signature:signature.toString('base64url'),userHandle:Buffer.from(a.data.user.id).toString('base64url')});
  };
  const ok=await login(2);assert.equal(ok.status,200,JSON.stringify(ok.data));assert.ok(ok.cookie);assert.equal((await request('/me',ok.cookie)).data.user.id,a.data.user.id);
  assert.equal((await login(3,true)).status,401);
  assert.equal((await login(2)).status,401,'a replayed counter is refused');
  // QR login: the new device polls with a secret, the phone approves the short code.
  const qr=(await request('/qr-login',null,'POST',{})).data;assert.match(qr.code,/^[A-Z2-9]{8}$/);assert.ok(qr.link.includes(qr.code));
  assert.equal((await request('/qr-login/status',null,'POST',{secret:qr.secret})).data.state,'pending');
  assert.equal((await request('/qr-login/approve',null,'POST',{code:qr.code})).status,401);
  assert.equal((await request('/qr-login/info?code='+qr.code,a.cookie)).status,200);
  assert.equal((await request('/qr-login/approve',a.cookie,'POST',{code:qr.code.toLowerCase()})).status,200);
  const done=await request('/qr-login/status',null,'POST',{secret:qr.secret});assert.equal(done.data.state,'approved');assert.ok(done.cookie);
  assert.equal((await request('/qr-login/status',null,'POST',{secret:qr.secret})).status,404);
  assert.equal((await request('/qr-login/status',null,'POST',{secret:'wrong'})).status,404);
});

test('bots: token API, updates, no end-to-end encryption in bot chats',async()=>{
  const a=await account('botowner');
  assert.equal((await request('/bots',a.cookie,'POST',{username:'helper',name:'Помощник'})).status,400);
  const created=await request('/bots',a.cookie,'POST',{username:'helper_bot',name:'Помощник'});assert.equal(created.status,201);
  const token=created.data.token,botId=created.data.bot.id;
  const call=(method,data)=>fetch(base+'/api/bot/'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})}).then(r=>r.json());
  assert.equal((await call('getMe')).result.username,'helper_bot');
  assert.equal((await fetch(base+'/api/bot/00000000:'+'x'.repeat(32)+'/getMe').then(r=>r.json())).ok,false);
  const chat=(await request('/chats',a.cookie,'POST',{users:[botId]})).data;
  assert.equal(chat.hasBot,true);
  const keys=(await request('/e2e/keys?chat='+chat.id,a.cookie)).data;assert.equal(keys.enabled,false);
  await request(`/chats/${chat.id}/messages`,a.cookie,'POST',{body:'/start'});
  const updates=(await call('getUpdates')).result;assert.equal(updates[0].message.text,'/start');assert.equal(updates[0].message.chat.id,chat.id);
  const sent=await call('sendMessage',{chat_id:chat.id,text:'Привет! Я бот.',reply_to_message_id:updates[0].message.message_id});assert.equal(sent.ok,true);
  assert.equal((await call('getUpdates',{offset:updates[0].update_id+1})).result.length,0);
  const history=(await request(`/chats/${chat.id}/messages`,a.cookie)).data;assert.equal(history.at(-1).body,'Привет! Я бот.');assert.equal(history.at(-1).author.bot,true);
  assert.equal((await call('editMessageText',{message_id:sent.result.message_id,text:'Изменено'})).ok,true);
  assert.equal((await call('setWebhook',{url:'http://127.0.0.1/hook'})).ok,false);
  assert.equal((await call('sendMessage',{chat_id:'nope',text:'x'})).error_code,403);
  const fresh=(await request('/bots/'+botId+'/token',a.cookie,'POST',{})).data.token;assert.notEqual(fresh,token);
  assert.equal((await call('getMe')).ok,false);
  assert.equal((await request('/bots',a.cookie)).data.length,1);
});
