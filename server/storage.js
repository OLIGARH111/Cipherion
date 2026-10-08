import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {createReadStream} from 'node:fs';
import {readFile,stat,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export function createStorage({db,one,run,data,env=process.env,client}) {
 db.exec(`CREATE TABLE IF NOT EXISTS media_objects(namespace TEXT NOT NULL,media_id TEXT NOT NULL,owner_id TEXT NOT NULL,provider TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,size INTEGER NOT NULL,checksum TEXT NOT NULL,width INTEGER,height INTEGER,duration REAL,thumbnail_key TEXT,status TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(namespace,media_id));`);
 const temporary=env.MEDIA_STORAGE_MODE==='temporary';
 const configured=!!(env.S3_BUCKET&&env.S3_ACCESS_KEY_ID&&env.S3_SECRET_ACCESS_KEY);
 if([env.S3_BUCKET,env.S3_ACCESS_KEY_ID,env.S3_SECRET_ACCESS_KEY].some(Boolean)&&!configured)console.warn('Object storage configuration is incomplete; durable uploads are unavailable.');
 if(env.S3_ENDPOINT&&!/^https:\/\//.test(env.S3_ENDPOINT)&&env.NODE_ENV!=='test')throw new Error('Object storage requires HTTPS');
 const s3=client||(configured?new S3Client({region:env.S3_REGION||'auto',endpoint:env.S3_ENDPOINT||undefined,forcePathStyle:env.S3_FORCE_PATH_STYLE==='1',credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED'}):null);
 const uploadToS3=!!s3&&!temporary;
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 function local(namespace,key){if(!['media','stickers'].includes(namespace)||!/^[a-zA-Z0-9_-]+(?:\.png)?$/.test(key))fail(400,'Некорректный ID файла');return resolve(data,namespace,key);}
 function writable(){if(!s3&&!temporary&&(env.NODE_ENV==='production'||env.RENDER==='true'))fail(503,'Постоянное хранилище ещё не подключено. Загрузка временно недоступна.');}
 async function persist(namespace,key,owner,file,type) {
  writable();const size=(await stat(file)).size,hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);const checksum=hash.digest('hex');
  const storageKey=`users/${owner}/${namespace}/${key}`;
  if(uploadToS3){await s3.send(new PutObjectCommand({Bucket:env.S3_BUCKET,Key:storageKey,Body:createReadStream(file),ContentLength:size,ContentType:type,Metadata:{sha256:checksum}}));const head=await s3.send(new HeadObjectCommand({Bucket:env.S3_BUCKET,Key:storageKey}));if(head.ContentLength!==size||head.Metadata?.sha256!==checksum)fail(502,'Хранилище не подтвердило сохранение файла');}
  run(`INSERT INTO media_objects(namespace,media_id,owner_id,provider,storage_key,mime_type,size,checksum,status,created) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,media_id) DO UPDATE SET provider=excluded.provider,storage_key=excluded.storage_key,size=excluded.size,checksum=excluded.checksum,status=excluded.status`,namespace,key,owner,uploadToS3?'s3':'local',storageKey,type,size,checksum,'ready',Date.now());
  return {storageKey,checksum,size};
 }
 async function get(namespace,key,range) {
  const row=one('SELECT * FROM media_objects WHERE namespace=? AND media_id=?',namespace,key);
  try{if(row?.provider==='s3'){if(!s3)fail(503,'Хранилище временно недоступно');const obj=await s3.send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:row.storage_key,...(range?{Range:range}:{})}));return obj.Body;}
   const path=local(namespace,key);await stat(path);const m=/^bytes=(\d+)-(\d+)$/.exec(range||'');return createReadStream(path,m?{start:Number(m[1]),end:Number(m[2])}:undefined);
  }catch(e){if(e.code==='ENOENT'||e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)fail(404,'Файл недоступен: исходный файл не сохранился');throw e;}
 }
 async function bytes(namespace,key,range){const stream=await get(namespace,key,range),chunks=[];for await(const c of stream)chunks.push(c);return Buffer.concat(chunks);}
 async function releaseLocal(namespace,key){if(uploadToS3)await unlink(local(namespace,key)).catch(()=>{});}
 async function remove(namespace,key){const row=one('SELECT * FROM media_objects WHERE namespace=? AND media_id=?',namespace,key);if(row?.provider==='s3'){if(!s3)fail(503,'Хранилище недоступно');await s3.send(new DeleteObjectCommand({Bucket:env.S3_BUCKET,Key:row.storage_key}));}else await unlink(local(namespace,key)).catch(e=>{if(e.code!=='ENOENT')throw e;});run('DELETE FROM media_objects WHERE namespace=? AND media_id=?',namespace,key);}
 return {persist,get,bytes,releaseLocal,remove,writable,configured:uploadToS3,mode:temporary?'temporary':s3?'s3':'local'};
}
export function validateUpload(bytes,type,name) {
 const error=()=>{throw Object.assign(new Error('Содержимое файла не соответствует формату или этот тип запрещён'),{status:400});};
 if(/\.(exe|dll|com|bat|cmd|ps1|msi|scr|vbs|js|mjs|html|htm|svg|jar|apk)$/i.test(name)||bytes.subarray(0,2).toString()==='MZ'||bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))error();
 const ascii=(a,b)=>bytes.toString('ascii',a,b),hex=bytes.subarray(0,4).toString('hex');
 const checks={'image/png':()=>bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a','image/jpeg':()=>hex.startsWith('ffd8ff'),'image/gif':()=>['GIF87a','GIF89a'].includes(ascii(0,6)),'image/webp':()=>ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP','video/mp4':()=>ascii(4,8)==='ftyp','audio/mp4':()=>ascii(4,8)==='ftyp','video/webm':()=>hex==='1a45dfa3','audio/webm':()=>hex==='1a45dfa3','audio/ogg':()=>ascii(0,4)==='OggS','video/ogg':()=>ascii(0,4)==='OggS','audio/wav':()=>ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE','audio/mpeg':()=>ascii(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224,'application/pdf':()=>ascii(0,5)==='%PDF-'};
 if(checks[type]){if(!checks[type]())error();}else if(/^(image|audio|video)\//.test(type)||['text/html','image/svg+xml','application/javascript'].includes(type))error();
}
