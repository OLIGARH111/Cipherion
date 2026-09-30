import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
const exec=promisify(execFile);
let busy=false;
export async function normalizeStickerAnimation(input,output,type='image/gif'){
 if(busy)throw Object.assign(new Error('Обработка анимации занята. Повторите позже.'),{status:429});busy=true;
 try{const format=type==='image/gif'?'gif':type==='video/mp4'?'mov':'matroska';const {stdout}=await exec('ffprobe',['-v','error','-f',format,'-protocol_whitelist','file,pipe','-show_entries','stream=width,height','-of','json',input],{timeout:5000,maxBuffer:10000});const stream=JSON.parse(stdout).streams?.find(s=>s.width);if(!stream||stream.width>4096||stream.height>4096)throw new Error('Размер кадра до 4096×4096');await exec('ffmpeg',['-nostdin','-v','error','-threads','1','-max_alloc','67108864','-f',format,'-protocol_whitelist','file,pipe','-i',input,'-t','3','-an','-vf','fps=15,scale=512:512:force_original_aspect_ratio=decrease','-c:v','libwebp_anim','-quality','70','-loop','0','-f','webp','-y',output],{timeout:25000,maxBuffer:100000});if((await stat(output)).size>2*1024*1024)throw new Error('Анимация слишком тяжёлая: выберите более короткий ролик');await exec('ffmpeg',['-nostdin','-v','error','-threads','1','-f',format,'-protocol_whitelist','file,pipe','-i',input,'-vf','scale=512:512:force_original_aspect_ratio=decrease','-frames:v','1','-f','image2','-y',output+'.png'],{timeout:10000,maxBuffer:100000});}
 catch(e){if(e.code==='ENOENT')throw Object.assign(new Error('Обработчик анимаций не установлен на сервере'),{status:503});throw e;}
 finally{busy=false;}
}
