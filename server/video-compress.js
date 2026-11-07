import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat,rename,unlink} from 'node:fs/promises';
const exec=promisify(execFile);

// Phone videos are 10-20 Mbit/s; every viewer downloads them again. Re-encoding once at upload to
// 720p H.264 makes each download several times smaller. A fast preset and a 5-minute cap keep the
// encode affordable on a fraction of a CPU; longer clips are stored as uploaded. Uploads queue so
// only one ffmpeg runs at a time; anything unexpected keeps the original file.
const MAX_SECONDS=300,MIN_BYTES=2*1024*1024,MAX_SIDE=1280;
let queue=Promise.resolve();

// The upload request waits for the encode, and the host's proxy drops requests that run too long,
// so an encode that cannot finish in a minute keeps the original file instead.
export function compressVideo(file,{run=exec,timeout=60_000}={}){
  const job=queue.then(()=>transcode(file,run,timeout));
  queue=job.catch(()=>{});
  return job;
}

async function transcode(file,run,timeout){
  const before=(await stat(file)).size;if(before<MIN_BYTES)return null;
  const output=file+'.compressed.mp4';
  try{
    const {stdout}=await run('ffprobe',['-v','error','-protocol_whitelist','file','-show_entries','format=duration','-of','json',file],{timeout:10_000,maxBuffer:100_000});
    const duration=Number(JSON.parse(stdout).format?.duration);
    if(!(duration>0&&duration<=MAX_SECONDS))return null;
    await run('ffmpeg',['-v','error','-y','-protocol_whitelist','file','-i',file,'-map','0:v:0','-map','0:a:0?',
      '-vf',`scale=w='min(${MAX_SIDE},iw)':h='min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v','libx264','-preset','superfast','-crf','28','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k',
      '-movflags','+faststart','-threads','2','-f','mp4',output],{timeout,maxBuffer:1_000_000});
    const size=(await stat(output)).size;
    // Keep the original unless the saving is real.
    if(!size||size>before*0.8){await unlink(output).catch(()=>{});return null;}
    await rename(output,file);
    return {type:'video/mp4',size};
  }catch{await unlink(output).catch(()=>{});return null;}
}
