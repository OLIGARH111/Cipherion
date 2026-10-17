// Shrinks camera photos before upload, the way Telegram does: a 4-8 MB shot becomes a few hundred KB
// that looks the same on a phone screen. Re-encoding also drops EXIF metadata such as GPS location.
const MAX_SIDE=2560,QUALITY=0.85,SKIP_BELOW=300*1024;
const lossy=new Set(['image/jpeg','image/png','image/webp']);

function encode(canvas,type){
  if(canvas.convertToBlob)return canvas.convertToBlob({type,quality:QUALITY});
  return new Promise(resolve=>canvas.toBlob(resolve,type,QUALITY));
}

export async function compressPhoto(file){
  try{
    if(!file||!lossy.has(file.type)||file.size<SKIP_BELOW||typeof createImageBitmap!=='function')return file;
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,MAX_SIDE/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
    const context=canvas.getContext('2d');
    // PNG/WebP may be transparent: keep alpha with WebP when the browser can encode it, else leave as is.
    const type=file.type==='image/jpeg'?'image/jpeg':'image/webp';
    context.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const blob=await encode(canvas,type);
    if(!blob||blob.type!==type||blob.size>=file.size)return file;
    const name=String(file.name||'photo').replace(/\.[^.]*$/,'')+(type==='image/jpeg'?'.jpg':'.webp');
    return new File([blob],name,{type,lastModified:file.lastModified||Date.now()});
  }catch{return file;}
}
