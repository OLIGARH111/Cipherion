import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,stat,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync,randomBytes} from 'node:crypto';
import {database} from '../server/db.js';
import {createTraffic,category} from '../server/traffic.js';
import {compressVideo} from '../server/video-compress.js';

const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
let server,base,dir,video;
const password='integration-password-123';
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'cipherion-traffic-'));
 const db=database(dir);db.prepare('INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,?,?)').run('test-admin','serafim_mironov','Admin','salt:'+scryptSync(password,'salt',64).toString('hex'),Date.now());db.close();
 // A short, deliberately oversized 1080p clip, like a phone camera produces.
 if(ffmpeg){video=join(dir,'source.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-f','lavfi','-i','sine=frequency=440','-t','4','-c:v','libx264','-preset','ultrafast','-crf','8','-pix_fmt','yuv420p','-c:a','aac','-shortest',video]);}
 server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',ADMIN_USER_IDS:'test-admin'},stdio:['ignore','pipe','pipe']});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);server.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('exit',code=>reject(Error('Server exit '+code)));});
});
after(async()=>{server?.kill();if(server?.exitCode===null)await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});});
const login=async(username,register=false)=>(await fetch(base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({register,username,password})})).headers.get('set-cookie').split(';')[0];

test('traffic meter counts bytes per month and category, throttles writes and forecasts the limit',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'cipherion-meter-'));const db=database(tmp);
 try{
  let clock=Date.UTC(2026,10,11,12);const all=(sql,...p)=>db.prepare(sql).all(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
  const meter=createTraffic({db,run,all,now:()=>clock,limitGB:1});
  const response=()=>({write(){return true;},end(){}});
  const media=response();meter.track(media,'/api/media/abc');media.write({length:40_000_000});media.end('x');
  const live=response();meter.track(live,'/api/events');live.write('data: {}\n\n');
  const page=response();meter.track(page,'/app.js');page.end(Buffer.alloc(1000));
  meter.flush();assert.equal(all('SELECT * FROM traffic_usage').length,3,'first flush writes');
  const later=response();meter.track(later,'/api/chats');later.end('[]');meter.flush();
  assert.equal(all("SELECT * FROM traffic_usage WHERE category='api'").length,0,'second flush within a minute is deferred');
  const r=meter.report();
  assert.equal(r.month,'2026-11');assert.equal(r.categories[0].category,'media');assert.equal(r.categories[0].bytes,40_000_001+300);
  assert.equal(r.bytes,r.categories.reduce((s,c)=>s+c.bytes,0));assert.equal(r.limit,1e9);
  assert.ok(r.projected>r.bytes);assert.equal(r.resetsAt,Date.UTC(2026,11,1));
  // ~40 MB in 10.5 days projects to ~115 MB: within a 1 GB limit, so no run-out date.
  assert.equal(r.runsOutAt,null);
  const big=response();meter.track(big,'/api/media/x');big.end({length:500_000_000});
  const warning=meter.report();assert.ok(warning.runsOutAt>clock&&warning.runsOutAt<warning.resetsAt);
  clock=Date.UTC(2026,11,1,0,5);assert.equal(meter.report().bytes,0,'a new month starts from zero');
  assert.equal(meter.report().history.length,1);
  assert.deepEqual(['/api/events','/api/media/1','/api/stickers/s/file','/api/me','/'].map(category),['events','media','stickers','api','app']);
 }finally{db.close();await rm(tmp,{recursive:true,force:true});}
});

test('only the owner can read traffic statistics',async()=>{
 const admin=await login('serafim_mironov'),user=await login('traffic_user',true);
 const own=await fetch(base+'/api/admin/traffic',{headers:{Cookie:admin}});assert.equal(own.status,200);
 const report=await own.json();assert.ok(report.bytes>0);assert.equal(report.limit,5e9);
 assert.equal((await fetch(base+'/api/admin/traffic',{headers:{Cookie:user}})).status,403);
});

test('large videos are re-encoded smaller; small or broken files keep their original bytes',{skip:!ffmpeg&&'ffmpeg not installed'},async()=>{
 const copy=join(dir,'copy.mp4');await copyFile(video,copy);const before=(await stat(copy)).size;
 const packed=await compressVideo(copy);
 assert.ok(packed,'expected compression');assert.equal(packed.type,'video/mp4');assert.ok(packed.size<before*0.8);assert.equal((await stat(copy)).size,packed.size);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height','-of','json',copy]));
 assert.equal(probe.streams[0].codec_name,'h264');assert.ok(probe.streams[0].width<=1280);assert.ok(probe.streams.some(s=>s.codec_name==='aac'));
 const broken=join(dir,'broken.webm');const noise=randomBytes(3*1024*1024);await writeFile(broken,noise);
 assert.equal(await compressVideo(broken),null);assert.deepEqual(await readFile(broken),noise);
 const small=join(dir,'small.mp4');await writeFile(small,Buffer.alloc(1000));assert.equal(await compressVideo(small),null);
});

test('uploaded videos are stored compressed and served as MP4',{skip:!ffmpeg&&'ffmpeg not installed'},async()=>{
 const cookie=await login('video_user',true);const bytes=await readFile(video);
 const media=await (await fetch(base+'/api/media',{method:'POST',headers:{Cookie:cookie,'Content-Type':'video/mp4','X-File-Name':'clip.mov.mp4'},body:bytes})).json();
 assert.equal(media.type,'video/mp4');assert.ok(media.size<bytes.length*0.8);assert.equal(media.name,'clip.mov.mp4');
 const served=await fetch(base+'/api/media/'+media.id,{headers:{Cookie:cookie}});
 assert.equal(served.headers.get('content-type'),'video/mp4');assert.equal((await served.arrayBuffer()).byteLength,media.size);
});
