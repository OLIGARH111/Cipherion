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

// Profile photos: any picture the phone offers (JPG, PNG, WebP, HEIC from iPhone, files with no type)
// becomes a JPEG the server accepts. GIFs stay animated.
const AVATAR_SIDE=1280,AVATAR_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif']);
const EXTENSION_TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif'};
async function decodeImage(file){
  if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file);}catch{}}
  const url=URL.createObjectURL(file);
  try{const img=new Image();img.src=url;await img.decode();return img;}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export function imageType(file){return file?.type||EXTENSION_TYPES[String(file?.name||'').split('.').pop().toLowerCase()]||'';}
// Any photo from the phone becomes a small JPEG the server accepts (re-encoding also drops EXIF such as GPS).
// Stories, avatars and the profile gallery use it.
export async function preparePhoto(file,side=2160){
  if(!file)throw new Error('Фото не выбрано');
  const type=imageType(file);
  if(type==='image/gif')return file.type===type?file:new File([file],file.name||'photo.gif',{type});
  let image;try{image=await decodeImage(file);}catch{image=null;}
  if(!image||!(image.width||image.naturalWidth)){
    if(AVATAR_TYPES.has(type))return file.type===type?file:new File([file],file.name||'photo',{type});
    throw new Error('Не удалось открыть фото. Выберите снимок в формате JPG или PNG.');
  }
  const w=image.width||image.naturalWidth,h=image.height||image.naturalHeight,scale=Math.min(1,side/Math.max(w,h));
  const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
  const canvas=Object.assign(document.createElement('canvas'),{width,height}),context=canvas.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);image.close?.();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
  if(!blob){if(AVATAR_TYPES.has(type))return file.type===type?file:new File([file],file.name||'photo',{type});throw new Error('Не удалось обработать фото');}
  return new File([blob],String(file.name||'photo').replace(/\.[^.]*$/,'')+'.jpg',{type:'image/jpeg',lastModified:Date.now()});
}
export async function prepareAvatar(file){return preparePhoto(file,AVATAR_SIDE);}
// iOS Safari may drop the change event of a file input that is not in the page, so keep it attached until used.
export function pickImage(callback){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.style.cssText='position:fixed;left:-9999px;width:1px;height:1px;opacity:0';(document.querySelector('dialog[open]')||document.body).append(input);
  const cleanup=()=>setTimeout(()=>input.remove(),0);
  input.addEventListener('change',()=>{const file=input.files?.[0];cleanup();if(file)callback(file);},{once:true});
  input.addEventListener('cancel',cleanup,{once:true});
  input.click();
}
// Several photos at once (profile gallery). Same iOS precaution as pickImage.
export function pickImages(callback){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;
  input.style.cssText='position:fixed;left:-9999px;width:1px;height:1px;opacity:0';(document.querySelector('dialog[open]')||document.body).append(input);
  const cleanup=()=>setTimeout(()=>input.remove(),0);
  input.addEventListener('change',()=>{const files=[...(input.files||[])];cleanup();if(files.length)callback(files);},{once:true});
  input.addEventListener('cancel',cleanup,{once:true});
  input.click();
}
