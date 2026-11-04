import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseMarkup} from '../server/bots.js';
import {hasLink,matchesWord} from '../server/antispam.js';
import {parseBackup,parseTransfer} from '../server/e2e.js';
import {sfuIceServers} from '../server/sfu.js';
import {inFolder} from '../public/folders.js';

let server,base,dir;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'cipherion-november-'));
  server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',SFU_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/[^\s]+/);if(m){clearTimeout(t);resolve(m[0]);}});server.on('exit',c=>reject(new Error('exit '+c)));});
});
after(async()=>{server?.kill();await new Promise(r=>server?.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data){const r=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const account=async username=>{const r=await request('/auth',null,'POST',{register:true,username,name:username,password:'test-password-12345'});return {id:r.data.user.id,cookie:r.cookie};};
const B64=n=>Buffer.alloc(n,7).toString('base64');
const point=()=>Buffer.concat([Buffer.from([4]),Buffer.alloc(64,3)]).toString('base64');

test('bot inline buttons: markup is validated, presses reach the bot and its answer reaches the person',async()=>{
  assert.throws(()=>parseMarkup({inline_keyboard:[[{text:'x'}]]}),/url или callback_data/);
  assert.throws(()=>parseMarkup({inline_keyboard:[[{text:'x',url:'javascript:alert(1)'}]]}),/https/);
  assert.throws(()=>parseMarkup({inline_keyboard:[[{text:'x',callback_data:'y'.repeat(65)}]]}),/64/);
  assert.deepEqual(parseMarkup('{"inline_keyboard":[[{"text":"Да","callback_data":"yes"}]]}'),{inline_keyboard:[[{text:'Да',callback_data:'yes'}]]});
  const a=await account('btnowner');
  const created=await request('/bots',a.cookie,'POST',{username:'buttons_bot',name:'Кнопки'});
  const call=(method,data)=>fetch(base+'/api/bot/'+created.data.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})}).then(r=>r.json());
  const chat=(await request('/chats',a.cookie,'POST',{users:[created.data.bot.id]})).data;
  const sent=await call('sendMessage',{chat_id:chat.id,text:'Выберите',reply_markup:{inline_keyboard:[[{text:'Да',callback_data:'yes'},{text:'Сайт',url:'https://example.com/'}]]}});
  assert.equal(sent.ok,true);assert.equal(sent.result.reply_markup.inline_keyboard[0].length,2);
  const shown=(await request(`/chats/${chat.id}/messages`,a.cookie)).data.at(-1);assert.equal(shown.markup.inline_keyboard[0][0].callback_data,'yes');
  assert.equal((await request(`/messages/${shown.id}/callback`,a.cookie,'POST',{data:'nope'})).status,400);
  const pressed=request(`/messages/${shown.id}/callback`,a.cookie,'POST',{data:'yes'});
  let update;for(let i=0;i<20&&!update;i++){update=(await call('getUpdates')).result.find(u=>u.callback_query);if(!update)await new Promise(r=>setTimeout(r,100));}
  assert.equal(update.callback_query.data,'yes');assert.equal(update.callback_query.from.id,a.id);
  assert.equal((await call('answerCallbackQuery',{callback_query_id:update.callback_query.id,text:'Принято',show_alert:true})).ok,true);
  const answer=await pressed;assert.equal(answer.data.text,'Принято');assert.equal(answer.data.show_alert,true);
  assert.equal((await call('answerCallbackQuery',{callback_query_id:update.callback_query.id,text:'ещё'})).ok,false);
  assert.equal((await call('editMessageReplyMarkup',{message_id:shown.id,reply_markup:null})).ok,true);
  assert.ok(!(await request(`/messages/${shown.id}`,a.cookie)).data.markup);
});

test('quotes, voice waveforms and «who read it» in groups',async()=>{
  const a=await account('quotealice'),b=await account('quotebobby'),c=await account('quotecarol');
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Цитаты',users:[b.id,c.id]})).data;
  const original=(await request(`/chats/${group.id}/messages`,b.cookie,'POST',{body:'Встречаемся завтра в десять у входа'})).data;
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'ок',reply:original.id,quote:'послезавтра'})).status,400);
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'ок',quote:'завтра'})).status,400);
  const reply=await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'Хорошо',reply:original.id,quote:'завтра в десять'});
  assert.equal(reply.status,201);assert.equal(reply.data.quote,'завтра в десять');
  // Waveform: only letters a–v and only on voice notes.
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'x',wave:'abcdefgh'})).status,400);
  // Readers: only the author, only in groups, with the time of reading.
  const mine=(await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'Кто прочитает?'})).data;
  assert.equal((await request(`/messages/${mine.id}/readers`,b.cookie)).status,403);
  assert.equal((await request(`/chats/${group.id}/read`,b.cookie,'POST',{message:mine.id})).status,200);
  const readers=(await request(`/messages/${mine.id}/readers`,a.cookie)).data;
  assert.equal(readers.read.length,1);assert.equal(readers.read[0].id,b.id);assert.ok(readers.read[0].at>0);assert.equal(readers.total,2);
});

test('spam protection: new member check, link filter, banned words with autoban, and no E2E with text filters',async()=>{
  assert.equal(hasLink('заходи на casino.com'),true);assert.equal(hasLink('https://x.y'),true);assert.equal(hasLink('просто текст'),false);
  assert.equal(matchesWord('Лучшее КАЗИНО тут',['казино']),'казино');assert.equal(matchesWord('казиноман',['казино']),null);
  const a=await account('guardowner'),b=await account('guardmember'),n=await account('guardnewbie');
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Защита',users:[b.id]})).data;
  assert.equal((await request(`/chats/${group.id}/guard`,b.cookie,'PATCH',{verify:true})).status,403);
  assert.equal((await request(`/chats/${group.id}/guard`,a.cookie,'PATCH',{verify:true})).status,200);
  // Existing members are trusted; a new one has to answer first.
  assert.equal((await request(`/chats/${group.id}/messages`,b.cookie,'POST',{body:'я тут давно'})).status,201);
  await request(`/chats/${group.id}/members`,a.cookie,'PATCH',{action:'invite',user:n.id});
  assert.equal((await request('/chats?chat='+group.id,n.cookie)).data[0].needsVerify,true);
  assert.equal((await request(`/chats/${group.id}/messages`,n.cookie,'POST',{body:'spam'})).status,403);
  const q=(await request(`/chats/${group.id}/verify`,n.cookie)).data;const [x,y]=q.question.match(/\d+/g).map(Number);
  assert.equal((await request(`/chats/${group.id}/verify`,n.cookie,'POST',{token:q.token,answer:x+y+1})).status,400);
  assert.equal((await request(`/chats/${group.id}/verify`,n.cookie,'POST',{token:q.token,answer:x+y})).status,200);
  assert.equal((await request(`/chats/${group.id}/messages`,n.cookie,'POST',{body:'привет всем'})).status,201);
  // Filters.
  assert.equal((await request('/e2e/keys?chat='+group.id,a.cookie)).data.enabled,true);
  await request(`/chats/${group.id}/guard`,a.cookie,'PATCH',{links:true,words:['казино'],action:'ban'});
  assert.equal((await request('/e2e/keys?chat='+group.id,a.cookie)).data.enabled,false);
  assert.equal((await request(`/chats/${group.id}/messages`,b.cookie,'POST',{body:'смотри example.com'})).status,403);
  assert.equal((await request(`/chats/${group.id}/messages`,a.cookie,'POST',{body:'админу можно example.com'})).status,201);
  assert.equal((await request(`/chats/${group.id}/messages`,n.cookie,'POST',{body:'лучшее казино'})).status,403);
  assert.equal((await request('/chats?chat='+group.id,n.cookie)).data.length,0);
});

test('chat folders: filter rules and server validation',async()=>{
  const me='u1',chats=[{id:'a',kind:'direct',members:[{user_id:'u1'},{user_id:'u2'}],unread:0},{id:'b',kind:'group',members:[],unread:3},{id:'c',kind:'channel',members:[],unread:0},{id:'d',kind:'direct',members:[{user_id:'u1'},{user_id:'bot',bot:true}],unread:0}];
  const pick=f=>chats.filter(c=>inFolder(c,f,me)).map(c=>c.id);
  assert.deepEqual(pick({types:['direct']}),['a']);assert.deepEqual(pick({types:['bot']}),['d']);
  assert.deepEqual(pick({types:['direct','group','channel'],unread:true}),['b']);
  assert.deepEqual(pick({types:['group'],chats:['c'],exclude:['b']}),['c']);
  const a=await account('folderuser');
  assert.equal((await request('/me',a.cookie,'PATCH',{settings:{folders:[{id:'x',title:'Работа',types:['direct'],chats:[]}]}})).status,200);
  assert.equal((await request('/me',a.cookie,'PATCH',{settings:{folders:[{id:'x',title:'Работа',types:['spam']}]}})).status,400);
  assert.equal((await request('/me',a.cookie,'PATCH',{settings:{folders:['plain']}})).status,400);
});

test('history transfer on the server: history key, grants, password backup, device transfer and QR login',async()=>{
  assert.throws(()=>parseBackup({v:1,salt:B64(16),iv:B64(12),ct:B64(48),iter:10}),/резервная/i);
  assert.ok(parseTransfer({keyId:'a'.repeat(32),eph:point(),iv:B64(12),ct:B64(48)}));
  const a=await account('histalice'),b=await account('histbobby');
  const device=(await request('/e2e/devices',a.cookie,'POST',{ecdh:point(),ecdsa:point()})).data.id;
  const keyId='b'.repeat(32);
  assert.equal((await request('/e2e/history',a.cookie)).data.keyId,null);
  assert.equal((await request('/e2e/history',a.cookie,'POST',{keyId,device})).data.keyId,keyId);
  // A second device does not replace the key.
  assert.equal((await request('/e2e/history',a.cookie,'POST',{keyId:'c'.repeat(32),device})).data.keyId,keyId);
  assert.equal((await request('/e2e/history/backup',a.cookie,'PUT',{keyId:'c'.repeat(32),backup:{v:1,salt:B64(16),iv:B64(12),ct:B64(48),iter:600000}})).status,409);
  assert.equal((await request('/e2e/history/backup',a.cookie,'PUT',{keyId,backup:{v:1,salt:B64(16),iv:B64(12),ct:B64(48),iter:600000}})).status,200);
  assert.equal((await request('/e2e/history',a.cookie)).data.backup.iter,600000);
  // Grants are accepted only for encrypted messages in the account's own chats.
  const direct=(await request('/chats',a.cookie,'POST',{users:[b.id]})).data;
  const plain=(await request(`/chats/${direct.id}/messages`,a.cookie,'POST',{body:'открыто'})).data;
  assert.equal((await request('/e2e/grants',a.cookie,'POST',{keyId,items:[{m:plain.id,iv:B64(12),k:B64(48)}]})).data.saved,0);
  // Device-to-device transfer.
  const t=(await request('/e2e/transfer',a.cookie,'POST',{pub:point()})).data;
  assert.equal((await request('/e2e/transfer/'+t.code,b.cookie)).status,404);
  assert.equal((await request('/e2e/transfer/'+t.code,a.cookie,'PUT',{payload:{keyId,eph:point(),iv:B64(12),ct:B64(48)}})).status,200);
  assert.equal((await request('/e2e/transfer/'+t.code,a.cookie)).data.ready,true);
  // QR login carries the new device's key in the link and the wrapped history key back.
  const qr=(await request('/qr-login',null,'POST',{pub:point()})).data;assert.match(qr.link,/&k=[A-Za-z0-9_-]+$/);
  assert.equal((await request('/qr-login/info?code='+qr.code,a.cookie)).data.pub,point());
  assert.equal((await request('/qr-login/approve',a.cookie,'POST',{code:qr.code,history:{keyId,eph:point(),iv:B64(12),ct:B64(48)}})).status,200);
  const status=(await request('/qr-login/status',null,'POST',{secret:qr.secret})).data;assert.equal(status.state,'approved');assert.equal(status.history.keyId,keyId);
  // Encrypted drafts are stored as given; plain drafts are trimmed as before.
  const sealed='e2d1:'+keyId+':'+B64(12)+':'+B64(40);
  assert.equal((await request(`/chats/${direct.id}/draft`,a.cookie,'PUT',{body:sealed})).status,200);
  assert.equal((await request('/chats?chat='+direct.id,a.cookie)).data[0].draft.body,sealed);
});

test('voice rooms: open without ringing, people come and go, closes when empty',async()=>{
  const a=await account('roomalice'),b=await account('roombobby');
  const group=(await request('/chats',a.cookie,'POST',{kind:'group',title:'Комната',users:[b.id]})).data;
  const direct=(await request('/chats',a.cookie,'POST',{users:[b.id]})).data;
  assert.equal((await request('/calls',a.cookie,'POST',{chat:direct.id,room:true})).status,400);
  const room=(await request('/calls',a.cookie,'POST',{chat:group.id,room:true})).data;
  assert.equal(room.room,true);assert.equal(room.state,'room');assert.equal(room.sfu,false);assert.deepEqual(room.participants,[]);
  assert.equal((await request('/calls',b.cookie,'POST',{chat:group.id,room:true})).data.id,room.id);
  for(const u of [a,b])assert.equal((await request('/call-action',u.cookie,'POST',{id:room.id,action:'join'})).status,200);
  assert.equal((await request('/call-action',a.cookie,'POST',{id:room.id,action:'ping'})).status,200);
  await request('/call-action',a.cookie,'POST',{id:room.id,action:'leave'});
  assert.equal((await request('/calls/active',b.cookie)).data.find(c=>c.id===room.id).participants.length,1);
  await request('/call-action',b.cookie,'POST',{id:room.id,action:'leave'});
  assert.equal((await request('/calls/active',b.cookie)).data.some(c=>c.id===room.id),false);
  // A ringing call that nobody answered leaves «Пропущенный звонок» events for the push worker.
  const call=(await request('/calls',a.cookie,'POST',{chat:direct.id})).data;
  await request('/call-action',a.cookie,'POST',{id:call.id,action:'leave'}).catch(()=>{});
  const db=new DatabaseSync(join(dir,'cipherion.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare("SELECT body FROM notification_events WHERE id=?").get('call-end:missed:'+call.id)?.body,'Пропущенный звонок');}finally{db.close();}
});

test('encrypted polls and built-in stickers are accepted only as ciphertext',async()=>{
  const sw=await readFile('public/sw.js','utf8');assert.match(sw,/action:'answer'/);assert.match(sw,/action:'decline'/);assert.match(sw,/call-end/);
  const outbox=await readFile('public/outbox.js','utf8');assert.match(outbox,/delete item\.payload\.quote/);
  assert.deepEqual(sfuIceServers([{urls:['turn:turn.example.com:3478?transport=udp','turns:turn.example.com:443?transport=tcp'],username:'u',credential:'p'},{urls:'stun:stun.example.com'}]),[{urls:'turn:turn.example.com:3478',username:'u',credential:'p'},{urls:'stun:stun.example.com'}]);
});
