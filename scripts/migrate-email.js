import {database} from '../server/db.js';
import {migrateNullableUsername} from '../server/email-migration.js';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const data=resolve(process.env.DATA_DIR||'data');
if(!process.argv.includes('--maintenance-confirmed'))throw new Error('Stop application writes first, then pass --maintenance-confirmed');
const backupPath=process.env.EMAIL_MIGRATION_BACKUP;if(!backupPath)throw new Error('Set EMAIL_MIGRATION_BACKUP to a secure durable backup path');
const db=database(data);try{
 const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();const snapshot={created:Date.now(),schema:db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL").all(),tables:{}};
 db.exec('BEGIN');try{for(const t of tables)snapshot.tables[t.name]=db.prepare('SELECT * FROM "'+t.name.replaceAll('"','""')+'"').all();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const bytes=Buffer.from(JSON.stringify(snapshot,(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v));await writeFile(backupPath,bytes,{flag:'wx',mode:0o600});const expected=createHash('sha256').update(bytes).digest('hex');if(createHash('sha256').update(await readFile(backupPath)).digest('hex')!==expected)throw new Error('Backup verification failed');
 console.log(JSON.stringify({backupVerified:true,tables:tables.length}));
 if(process.argv.includes('--apply'))console.log(JSON.stringify(migrateNullableUsername(db)));else console.log('Backup complete. Schema unchanged; --apply is required to migrate.');
}finally{db.close();}
