import {database} from '../server/db.js';
import {createStorage} from '../server/storage.js';
import {resolve} from 'node:path';
import {stat} from 'node:fs/promises';
const data=resolve(process.env.DATA_DIR||'data'),db=database(data),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p),storage=createStorage({db,one,run,data});
if(!storage.configured)throw new Error('Configure private S3 object storage first');
let copied=0,missing=0,already=0;const apply=process.argv.includes('--apply');
try{
 const entries=db.prepare('SELECT id,user_id,type FROM media').all().map(m=>({...m,namespace:'media'}));
 if(one("SELECT name FROM sqlite_master WHERE name='stickers'"))for(const s of db.prepare('SELECT s.id,p.author FROM stickers s JOIN sticker_packs p ON p.id=s.pack_id WHERE s.source IS NULL').all()){
  const animated=one('SELECT mime FROM sticker_animation WHERE sticker_id=?',s.id);entries.push({id:s.id,user_id:s.author,type:animated?.mime||'image/png',namespace:'stickers'});if(animated)entries.push({id:s.id+'.png',user_id:s.author,type:'image/png',namespace:'stickers'});
 }
 for(const m of entries){if(one("SELECT 1 FROM media_objects WHERE namespace=? AND media_id=? AND provider='s3' AND status='ready'",m.namespace,m.id)){already++;continue;}if(!/^[a-zA-Z0-9_-]+(?:\.png)?$/.test(m.id))throw new Error('Invalid stored media ID');const file=resolve(data,m.namespace,m.id);if(!await stat(file).catch(()=>null)){missing++;continue;}if(apply)await storage.persist(m.namespace,m.id,m.user_id,file,m.type);copied++;}
 // Keep the source files for rollback. Reruns skip verified objects.
 console.log(JSON.stringify({apply,copied,already,missing}));
}finally{db.close();}
