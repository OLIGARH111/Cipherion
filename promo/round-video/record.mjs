// Renders scene.html frame by frame into an MP4 (1080×1920, 30 fps, H.264).
// Usage: node promo/round-video/record.mjs [out.mp4] [--fps 30]
// Needs playwright (with Chromium) and ffmpeg on PATH.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const args=process.argv.slice(2);
const fps=Number(args[args.indexOf('--fps')+1])||30;
const output=resolve(args.find(a=>a.endsWith('.mp4'))||join(root,'promo/round-video/round-video.mp4'));
const types={'.html':'text/html; charset=utf-8','.png':'image/png','.js':'text/javascript'};

// The page draws the app logo onto a canvas; serving over http keeps the canvas untainted.
const server=createServer(async(req,res)=>{
  const path=normalize(join(root,decodeURIComponent(new URL(req.url,'http://x').pathname)));
  if(!path.startsWith(root)){res.writeHead(403).end();return;}
  try{res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'}).end(await readFile(path));}
  catch{res.writeHead(404).end();}
}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const url=`http://127.0.0.1:${server.address().port}/promo/round-video/scene.html?t=0`;

const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const page=await browser.newPage();
await page.goto(url);
await page.evaluate(()=>window.ready);
const duration=await page.evaluate(()=>window.DURATION);
const total=Math.round(duration*fps);

const ffmpeg=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','-','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
const done=new Promise((ok,fail)=>ffmpeg.on('close',code=>code===0?ok():fail(new Error('ffmpeg exited with '+code))));

for(let i=0;i<total;i++){
  const png=await page.evaluate(t=>{window.frame(t);return document.getElementById('c').toDataURL('image/png').slice(22);},i/fps);
  if(!ffmpeg.stdin.write(Buffer.from(png,'base64')))await new Promise(r=>ffmpeg.stdin.once('drain',r));
  if(i%fps===0)process.stdout.write(`\r${Math.round(i/total*100)}%`);
}
ffmpeg.stdin.end();
await done;
await browser.close();server.close();
console.log(`\r100% → ${output}`);
