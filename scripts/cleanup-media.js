import {database} from '../server/db.js';
import {createStorage} from '../server/storage.js';
import {mediaReferenced} from '../server/media-references.js';
import {resolve} from 'node:path';
// Offline cleanup prevents a reference from being added between the scan and deletion.
if(!process.argv.includes('--maintenance-confirmed'))throw new Error('Stop application writes before orphan cleanup');
const data=resolve(process.env.DATA_DIR||'data'),db=database(data),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p),storage=createStorage({db,one,run,data});
try{const candidates=db.prepare("SELECT media_id FROM media_objects WHERE namespace='media' AND created<?").all(Date.now()-7*86400000);let count=0;for(const m of candidates){if(mediaReferenced(db,m.media_id))continue;count++;if(process.argv.includes('--apply')){await storage.remove('media',m.media_id);run('DELETE FROM media WHERE id=?',m.media_id);}}console.log(JSON.stringify({candidates:count,applied:process.argv.includes('--apply')}));}finally{db.close();}
