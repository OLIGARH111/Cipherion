// Offline migration only. No table is dropped; the old user table is retained.
// Run with the service in maintenance and a verified full database backup.
export function migrateNullableUsername(db) {
 const columns=db.prepare('PRAGMA table_info(users)').all();if(!columns.find(c=>c.name==='username')?.notnull)return {changed:false};
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='users_before_email'").get())throw new Error('A previous migration snapshot exists; investigate before retrying');
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='users'").get())throw new Error('Custom user triggers require a reviewed migration');
 const original=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql;
 const definition=original.replace(/username TEXT UNIQUE NOT NULL/i,'username TEXT UNIQUE');
 if(definition===original)throw new Error('Unexpected users schema; refusing to change it');
 const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL").all();
 const foreign=Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys);
 db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;');
 if(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys)!==0)throw new Error('Database does not support this offline migration; use a verified SQLite export/import');
 db.exec('BEGIN IMMEDIATE');try{
  const before=db.prepare('SELECT COUNT(*) n FROM users').get().n;
  db.exec('ALTER TABLE users RENAME TO users_before_email');db.exec(definition);
  const names=columns.map(c=>'"'+c.name.replaceAll('"','""')+'"').join(',');
  db.exec(`INSERT INTO users(${names}) SELECT ${names} FROM users_before_email`);
  for(const row of indexes)db.exec(row.sql.replace(/(INDEX\s+(?:IF NOT EXISTS\s+)?)([\w"]+)/i,(_m,p,name)=>p+name.replaceAll('"','')+'_email_v2'));
  if(db.prepare('SELECT COUNT(*) n FROM users').get().n!==before)throw new Error('User row counts changed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key verification failed');
  const wrong=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT IN ('users','users_before_email')").all().filter(r=>/REFERENCES\s+"?users_before_email/i.test(r.sql||''));if(wrong.length)throw new Error('Foreign keys were redirected to the snapshot');
  db.exec('COMMIT');return {changed:true,users:before};
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys='+foreign);}
}
