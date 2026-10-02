import {createReadStream} from 'node:fs';
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdir, readdir, lstat, copyFile, readFile, writeFile, chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const quote=name=>'"'+name.replaceAll('"','""')+'"';
export function inventory(db) {
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('Database integrity check failed');
  const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
  if(foreignKeys.length)throw new Error('Foreign key violations: '+foreignKeys.length);
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT COUNT(*) AS n FROM '+quote(name)).get().n]));
}
async function files(root, directory='') {
  const result=[];
  for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})) {
    const name=directory?directory+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in backups');
    if(entry.isDirectory())result.push(...await files(root,name));
    else if(entry.isFile())result.push(name);
    else throw new Error('Unsupported backup entry');
  }
  return result.sort();
}
async function hash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
export async function createBackup(source, destination) {
  source=resolve(source);destination=resolve(destination);
  if(destination===source||destination.startsWith(source+sep))throw new Error('Backup must be outside DATA_DIR');
  const stat=await lstat(resolve(source,'cipherion.sqlite'));if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Expected a database file');
  // Exclusive destination avoids accidentally replacing an existing backup.
  await mkdir(destination,{mode:0o700});
  const db=new DatabaseSync(resolve(source,'cipherion.sqlite'),{readOnly:true});
  let counts;
  try{counts=inventory(db);await backup(db,resolve(destination,'cipherion.sqlite'));}finally{db.close();}
  const snapshot=new DatabaseSync(resolve(destination,'cipherion.sqlite'));try{snapshot.exec('PRAGMA journal_mode=DELETE');}finally{snapshot.close();}
  await chmod(resolve(destination,'cipherion.sqlite'),0o600);
  for(const folder of ['media','stickers']) {
    const stat=await lstat(resolve(source,folder)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(!stat)continue;if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Expected an attachment directory');
    await mkdir(resolve(destination,folder),{mode:0o700});
    for(const name of await files(source,folder)) {
      const target=resolve(destination,name);await mkdir(resolve(target,'..'),{recursive:true,mode:0o700});
      await copyFile(resolve(source,name),target);await chmod(target,0o600);
    }
  }
  const hashes={};for(const name of await files(destination))hashes[name]=await hash(resolve(destination,name));
  await writeFile(resolve(destination,'manifest.json'),JSON.stringify({version:1,created:new Date().toISOString(),counts,hashes},null,2),{flag:'wx',mode:0o600});
  await verifyBackup(destination);
  return {tables:Object.keys(counts).length,files:Object.keys(hashes).length};
}
export async function verifyBackup(directory) {
  directory=resolve(directory);
  const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
  if(manifest.version!==1||!manifest.hashes?.['cipherion.sqlite'])throw new Error('Invalid backup manifest');
  const actual=(await files(directory)).filter(name=>name!=='manifest.json');
  if(JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.hashes).sort()))throw new Error('Backup files differ from manifest');
  for(const name of actual) {
    const target=resolve(directory,name);if(relative(directory,target).startsWith('..'))throw new Error('Invalid backup path');
    if(await hash(target)!==manifest.hashes[name])throw new Error('Backup checksum mismatch');
  }
  const db=new DatabaseSync(resolve(directory,'cipherion.sqlite'),{readOnly:true});
  try{
    const counts=inventory(db);if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw new Error('Backup row counts differ');
    if(counts.media!==undefined)for(const row of db.prepare('SELECT id,size FROM media').all()) {
      if(!/^[\w-]+$/.test(row.id))throw new Error('Invalid media ID');
      if((await lstat(resolve(directory,'media',row.id))).size!==row.size)throw new Error('Media size mismatch');
    }
    if(counts.stickers!==undefined)for(const row of db.prepare('SELECT id FROM stickers WHERE source IS NULL AND deleted=0').all()) {
      if(!/^[\w-]+$/.test(row.id)||!manifest.hashes['stickers/'+row.id])throw new Error('Missing custom sticker file');
      if(counts.sticker_animation!==undefined&&db.prepare('SELECT sticker_id FROM sticker_animation WHERE sticker_id=?').get(row.id)&&!manifest.hashes['stickers/'+row.id+'.png'])throw new Error('Missing sticker poster');
    }
    return {tables:Object.keys(counts).length,files:actual.length};
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,source,destination,confirmation]=process.argv.slice(2);
    if(command==='verify'&&source&&!destination)console.log(JSON.stringify(await verifyBackup(source)));
    else if(command==='create'&&source&&destination&&confirmation==='--maintenance-confirmed')console.log(JSON.stringify(await createBackup(source,destination)));
    else throw new Error('Usage: node scripts/backup.js create DATA_DIR BACKUP_DIR --maintenance-confirmed | verify BACKUP_DIR');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
