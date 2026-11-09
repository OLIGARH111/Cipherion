// Shrinks camera photos before upload, the way Telegram does: a 4-8 MB shot becomes a few hundred KB
// that looks the same on a phone screen. Re-encoding also drops EXIF metadata such as GPS location.
// iPhone HEIC photos and pictures with no type are converted too, because the server accepts only JPG/PNG/WebP/GIF.
const MAX_SIDE=2048,QUALITY=0.82,SKIP_BELOW=200*1024;
const accepted=new Set(['image/jpeg','image/png','image/webp']);

function encode(canvas,type,quality=QUALITY){
  if(canvas.convertToBlob)return canvas.convertToBlob({type,quality}).catch(()=>null);
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}

export async function compressPhoto(file){
  if(!file)return file;
  const type=imageType(file);
  if(type==='image/gif')return file.type===type?file:new File([file],file.name||'photo.gif',{type});
  // Already small and in a format the server takes: send as is.
  if(accepted.has(file.type)&&file.size<SKIP_BELOW)return file;
  let image=null;
  try{image=await decodeImage(file);}catch{}
  const w=image?.width||image?.naturalWidth,h=image?.height||image?.naturalHeight;
  if(!w||!h){
    if(accepted.has(file.type))return file;
    if(accepted.has(type))return new File([file],file.name||'photo',{type});
    throw Object.assign(new Error('Не удалось открыть фото. Выберите снимок в формате JPG или PNG.'),{status:400});
  }
  try{
    const scale=Math.min(1,MAX_SIDE/Math.max(w,h));
    const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
    const context=canvas.getContext('2d');
    // PNG/WebP may be transparent: try WebP to keep alpha. Safari cannot encode WebP, so then use JPEG on white.
    const transparent=type==='image/png'||type==='image/webp';
    let blob=null,out='image/jpeg';
    if(transparent){context.drawImage(image,0,0,width,height);blob=await encode(canvas,'image/webp');if(blob?.type==='image/webp')out='image/webp';else blob=null;}
    if(!blob){context.clearRect(0,0,width,height);context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);blob=await encode(canvas,'image/jpeg');}
    if(!blob||blob.type!==out){if(accepted.has(file.type))return file;throw Object.assign(new Error('Не удалось обработать фото'),{status:400});}
    if(accepted.has(file.type)&&blob.size>=file.size)return file;
    const name=String(file.name||'photo').replace(/\.[^.]*$/,'')+(out==='image/jpeg'?'.jpg':'.webp');
    return new File([blob],name,{type:out,lastModified:file.lastModified||Date.now()});
  }finally{image?.close?.();}
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
// A small copy of a photo for chat bubbles, avatars and grids (the full photo loads only when opened).
// Returns null when the photo is already small enough to show as is.
const PREVIEW_SIDE=800,PREVIEW_QUALITY=0.72,PREVIEW_SKIP_BELOW=90*1024;
export async function makePreview(file){
  if(!file||!accepted.has(file.type)||file.size<PREVIEW_SKIP_BELOW)return null;
  let image=null;
  try{
    try{image=await decodeImage(file);}catch{return null;}
    const w=image?.width||image?.naturalWidth,h=image?.height||image?.naturalHeight;
    if(!w||!h||Math.max(w,h)<=PREVIEW_SIDE)return null;
    const scale=PREVIEW_SIDE/Math.max(w,h),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
    const context=canvas.getContext('2d');let blob=null;
    // Transparent pictures keep alpha as WebP; where WebP cannot be encoded (Safari) they keep no preview.
    if(file.type!=='image/jpeg'){context.drawImage(image,0,0,width,height);blob=await encode(canvas,'image/webp',PREVIEW_QUALITY);if(blob?.type!=='image/webp')return null;}
    else{context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);blob=await encode(canvas,'image/jpeg',PREVIEW_QUALITY);if(blob?.type!=='image/jpeg')return null;}
    return blob.size<file.size*0.7&&blob.size<=280*1024?blob:null;
  }catch{return null;}finally{image?.close?.();}
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
