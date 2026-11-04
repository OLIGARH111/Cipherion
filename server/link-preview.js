// Link previews built by the server: the viewer's browser never contacts the linked
// site, so the site learns neither their IP address nor that they opened the chat.
// Preview images are passed through the server too, signed so the route cannot be
// used as an open proxy.
import {createHmac,randomBytes} from 'node:crypto';
import {safeFetch,checkURL} from './safe-fetch.js';

const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',laquo:'«',raquo:'»',mdash:'—',ndash:'–',hellip:'…'};
export function decodeEntities(text){return String(text||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,code)=>{if(code[0]==='#'){const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return Number.isFinite(n)&&n>0&&n<0x110000?String.fromCodePoint(n):'';}return entities[code.toLowerCase()]??all;});}
const tidy=(value,max)=>decodeEntities(value).replace(/\s+/g,' ').trim().slice(0,max);

function attributes(tag){const out={};for(const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g))out[m[1].toLowerCase()]=m[3]??m[4]??m[5]??'';return out;}

// Reads Open Graph, Twitter card and plain HTML metadata from the start of a page.
export function parsePreview(html,pageURL){
  const head=html.slice(0,400_000),meta={};
  for(const m of head.matchAll(/<meta\b[^>]*>/gi)){const a=attributes(m[0]);const key=(a.property||a.name||a.itemprop||'').toLowerCase();if(key&&a.content!==undefined&&!(key in meta))meta[key]=a.content;}
  const title=meta['og:title']||meta['twitter:title']||(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1])||'';
  const description=meta['og:description']||meta['twitter:description']||meta.description||'';
  let image=meta['og:image:secure_url']||meta['og:image']||meta['og:image:url']||meta['twitter:image']||meta['twitter:image:src']||'';
  if(!image){const icon=[...head.matchAll(/<link\b[^>]*>/gi)].map(m=>attributes(m[0])).find(a=>/apple-touch-icon/i.test(a.rel||''));if(icon?.href)image=icon.href;}
  try{image=image?new URL(decodeEntities(image),pageURL).href:'';}catch{image='';}
  const host=new URL(pageURL).hostname.replace(/^www\./,'');
  return {url:pageURL,site:tidy(meta['og:site_name']||host,80),title:tidy(title,200),description:tidy(description,300),image:checkURL(image)?image:'',large:(meta['twitter:card']||'')==='summary_large_image'||!!meta['og:image:width']&&Number(meta['og:image:width'])>=400};
}

function charsetOf(headers,bytes){
  const header=/charset=([\w-]+)/i.exec(headers['content-type']||'')?.[1];
  const sniff=/<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0,4096).toString('latin1'))?.[1];
  const name=(header||sniff||'utf-8').toLowerCase();
  try{return new TextDecoder(name);}catch{return new TextDecoder('utf-8');}
}

const imageTypes={'image/png':b=>b.subarray(0,8).toString('hex')==='89504e470d0a1a0a','image/jpeg':b=>b.subarray(0,3).toString('hex')==='ffd8ff','image/gif':b=>['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)),'image/webp':b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'};

export function createLinkPreview({db,one,run,fail,now,rate,fetcher=safeFetch,secret=process.env.LINK_PREVIEW_SECRET||randomBytes(32).toString('hex')}){
  db.exec('CREATE TABLE IF NOT EXISTS link_previews(url TEXT PRIMARY KEY,data TEXT NOT NULL,fetched INTEGER NOT NULL)');
  const sign=url=>createHmac('sha256',secret).update(url).digest('base64url').slice(0,32);
  const images=new Map(),pending=new Map();
  const imageLink=url=>url?`/api/link-preview/image?u=${encodeURIComponent(url)}&s=${sign(url)}`:'';
  const publicView=data=>data&&{...data,image:imageLink(data.image)};

  async function build(url){
    const response=await fetcher(url,{maxBytes:600_000,headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'}});
    const type=String(response.headers['content-type']||'');
    if(response.status>=400)return null;
    if(/^image\/(png|jpeg|gif|webp)/.test(type))return {url:response.url,site:new URL(response.url).hostname.replace(/^www\./,''),title:'',description:'',image:response.url,large:true};
    if(!/html/i.test(type))return null;
    const preview=parsePreview(charsetOf(response.headers,response.body).decode(response.body),response.url);
    return preview.title||preview.description?preview:null;
  }
  async function get(raw,user){
    const url=checkURL(raw);if(!url)fail(400,'Недопустимая ссылка');
    url.hash='';const key=url.href;
    const cached=one('SELECT data,fetched FROM link_previews WHERE url=?',key);
    if(cached&&cached.fetched>now()-86400_000)return publicView(JSON.parse(cached.data));
    rate('link-preview:'+user,40);
    if(!pending.has(key))pending.set(key,build(key).catch(()=>null).then(data=>{run('INSERT INTO link_previews VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',key,JSON.stringify(data),now());return data;}).finally(()=>pending.delete(key)));
    return publicView(await pending.get(key));
  }
  async function image(url,signature){
    if(!url||signature!==sign(url))fail(403,'Недействительная ссылка на изображение');
    const hit=images.get(url);if(hit&&hit.at>now()-3600_000)return hit;
    const response=await fetcher(url,{maxBytes:3*1024*1024,headers:{Accept:'image/webp,image/png,image/jpeg,image/gif'}}).catch(()=>null);
    const type=String(response?.headers['content-type']||'').split(';')[0].trim();
    if(!response||response.status>=400||response.truncated||!imageTypes[type]?.(response.body))fail(404,'Изображение недоступно');
    const entry={type,body:response.body,at:now()};images.set(url,entry);
    if(images.size>150)images.delete(images.keys().next().value);
    return entry;
  }
  async function route({path,req,res,user,url,json}){
    if(path==='/api/link-preview'&&req.method==='GET'){json({preview:await get(url.searchParams.get('url'),user.id)});return true;}
    if(path==='/api/link-preview/image'&&req.method==='GET'){
      const entry=await image(url.searchParams.get('u'),url.searchParams.get('s'));
      res.writeHead(200,{'Content-Type':entry.type,'Content-Length':entry.body.length,'Cache-Control':'private, max-age=86400','Content-Security-Policy':"default-src 'none'"});res.end(entry.body);return true;
    }
    return false;
  }
  return {route,get,sign};
}
