import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync,randomUUID,randomBytes,createHash} from 'node:crypto';
import {database} from '../server/db.js';
import {totp} from '../server/security.js';
import {sanitizePNG} from '../server/stickers.js';
let server,base,dir,admin;
const password='integration-password-123';
before(async()=>{dir=await mkdtemp(join(tmpdir(),'cipherion-badge-'));const db=database(dir);db.prepare('INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,?,?)').run('test-admin','serafim_mironov','Admin','salt:'+scryptSync(password,'salt',64).toString('hex'),Date.now());db.close();server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',ADMIN_USER_IDS:'test-admin'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('exit',code=>reject(Error('Server exit '+code)));});admin=(await request('/auth',null,'POST',{username:'serafim_mironov',password})).cookie;});
after(async()=>{server?.kill();if(server?.exitCode===null)await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});});
async function request(path,cookie,method='GET',data){const r=await fetch(base+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const account=async username=>request('/auth',null,'POST',{register:true,username,password});
async function setRule(cookie,field,audience,allow=[],deny=[]){const p=(await request('/privacy',cookie)).data;p.rules[field]={audience,allow,deny};const r=await request('/privacy',cookie,'PATCH',p);assert.equal(r.status,200);return r.data;}
async function png(cookie){const bytes=await readFile('public/apple-touch-icon.png');assert.ok(sanitizePNG(bytes));const r=await fetch(base+'/api/media',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/png','X-File-Name':'test.png'},body:bytes});return (await r.json()).id;}
test('VIP badge next to the name accepts any emoji or accessible sticker; emoji status is gone',async()=>{
 const a=await account('badge_a'),b=await account('badge_b');
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:'🦊'})).status,403);
 await request('/admin/vip/grant',admin,'POST',{user:a.data.user.id,days:30});
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:'🦊'})).data.badge,'🦊');
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:'abc'})).status,400);
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:'<img>'})).status,400);
 const pack=(await request('/packs',b.cookie,'POST',{title:'Private stickers'})).data;const foreign=(await request('/packs/'+pack.id+'/items',b.cookie,'POST',{media:await png(b.cookie)})).data;
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:':ce['+foreign.id+']'})).status,404);
 const own=(await request('/packs',a.cookie,'POST',{title:'Mine'})).data;const sticker=(await request('/packs/'+own.id+'/items',a.cookie,'POST',{media:await png(a.cookie)})).data;
 assert.equal((await request('/profile',a.cookie,'PATCH',{badge:':ce['+sticker.id+']',emoji:'🎩'})).status,200);
 const seen=(await request('/profile?user='+a.data.user.id,b.cookie)).data;
 assert.equal(seen.vipBadge,':ce['+sticker.id+']');assert.equal(seen.profile.emoji,undefined);
 assert.equal((await fetch(base+'/api/stickers/'+sticker.id+'/file',{headers:{Cookie:b.cookie},redirect:'manual'})).status,200);
 assert.equal((await request('/profile/details',a.cookie,'PATCH',{badge:'🐸'})).status,200);
 assert.equal((await request('/profile?user='+a.data.user.id,b.cookie)).data.vipBadge,'🐸');
});
