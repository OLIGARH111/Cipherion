// Shapes of stored chat wallpapers. The client draws them; the server only checks that
// settings hold small, well-formed values (no foreign URLs, no oversized blobs).
export const MOTIFS=['aurora','waves','dunes','stars','mesh','bokeh','poly','flow'];
const PRESETS=new Set(['aurora','emerald','sunset','cosmos','peach','lagoon','city','crystal','lavender','desert','neon','mint']);
const hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const media=v=>typeof v==='string'&&/^\/api\/media\/[A-Za-z0-9_-]{1,80}$/.test(v);
const dimOk=v=>v===undefined||(typeof v==='number'&&v>=0&&v<=.7);

export function cleanSpec(v){
  if(!v||typeof v!=='object'||!MOTIFS.includes(v.motif)||!Array.isArray(v.colors)||v.colors.length<2||v.colors.length>4||!v.colors.every(hex))return null;
  return{kind:'ai',name:String(v.name||'Обои ИИ').replace(/\s+/g,' ').trim().slice(0,40)||'Обои ИИ',motif:v.motif,colors:v.colors.map(c=>c.toLowerCase()),seed:Math.abs(Math.trunc(Number(v.seed)||0))%1e9};
}
export function validWallpaper(v){
  if(media(v))return true;
  if(!v||typeof v!=='object'||Array.isArray(v)||!dimOk(v.dim))return false;
  if(v.kind==='preset')return PRESETS.has(v.id);
  if(v.kind==='photo')return media(v.src);
  if(v.kind==='ai'){const clean=cleanSpec(v);return!!clean&&clean.name===v.name&&clean.seed===v.seed&&JSON.stringify(v).length<400;}
  return false;
}
export function validateWallpaperSettings(settings,old={}){
  // A wallpaper saved before this check existed stays valid until it is changed.
  if(JSON.stringify(settings.wallpaper)!==JSON.stringify(old.wallpaper)&&settings.wallpaper!==undefined&&settings.wallpaper!==null&&settings.wallpaper!==''&&!validWallpaper(settings.wallpaper))return'Некорректные обои';
  const chats=settings.chatWallpapers;
  if(chats!==undefined&&(!chats||typeof chats!=='object'||Array.isArray(chats)||Object.keys(chats).length>300||Object.entries(chats).some(([k,v])=>k.length>80||!validWallpaper(v))))return'Некорректные обои чатов';
  const mine=settings.aiWallpapers;
  if(mine!==undefined&&(!Array.isArray(mine)||mine.length>12||mine.some(v=>v?.kind!=='ai'||v.dim!==undefined||!validWallpaper(v))))return'Некорректный список ИИ-обоев';
  return null;
}
