import {DatabaseSync, backup} from 'node:sqlite';
import {existsSync, mkdirSync, chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const schemaVersion = 1;
// This registry covers new RC migrations. Legacy module initialization remains intact.
export async function backupBeforeMigration(directory) {
  const source=resolve(directory,'cipherion.sqlite');
  if(!existsSync(source))return null;
  const db=new DatabaseSync(source,{readOnly:true});
  try {
    const registry=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const version=registry?db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version:0;
    if(version>schemaVersion)throw new Error('Database schema is newer than this application');
    if(version===schemaVersion)return null;
    const target=resolve(process.env.BACKUP_DIR || resolve(directory,'backups'));
    mkdirSync(target,{recursive:true,mode:0o700});
    const file=resolve(target,`pre-rc-${Date.now()}-${randomUUID()}.sqlite`);
    await backup(db,file);chmodSync(file,0o600);
    const snapshot=new DatabaseSync(file);try{snapshot.exec('PRAGMA journal_mode=DELETE');}finally{snapshot.close();}
    const check=new DatabaseSync(file,{readOnly:true});
    try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('Backup integrity check failed');}finally{check.close();}
    return file;
  }finally{db.close();}
}
export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL)');
  const version=db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
  if(version>schemaVersion)throw new Error('Database schema is newer than this application');
  if(version>=1)return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE message_requests(user_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,message_id TEXT NOT NULL REFERENCES messages(id),fingerprint TEXT NOT NULL,PRIMARY KEY(user_id,client_id));
      CREATE INDEX IF NOT EXISTS members_user_chat ON members(user_id,chat_id);
      CREATE INDEX IF NOT EXISTS sessions_user_expires ON sessions(user_id,expires);
      CREATE INDEX IF NOT EXISTS messages_media ON messages(media_id) WHERE media_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS media_owner ON media(user_id);
      CREATE INDEX IF NOT EXISTS ai_history_owner_created ON ai_history(user_id,created);
      CREATE INDEX IF NOT EXISTS vip_grants_owner ON vip_grants(user_id,revoked,expires);
      CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices(user_id);
      CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,created INTEGER NOT NULL);`);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(1,'release-foundation',Date.now());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
