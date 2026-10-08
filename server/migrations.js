import {DatabaseSync, backup} from 'node:sqlite';
import {existsSync, mkdirSync, chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const schemaVersion = 2;
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
const columns=(db,table)=>db.prepare(`PRAGMA table_info("${table}")`).all();
const tableSql=(db,table)=>db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql||'';
function addColumn(db,table,name,definition){
  if(!columns(db,table).some(column=>column.name===name))db.exec(`ALTER TABLE "${table}" ADD COLUMN ${name} ${definition}`);
}
// Rebuilds users so username and password may be NULL. Every existing column and row is copied as-is;
// nothing is dropped except the NOT NULL constraints. Runs with foreign keys disabled (see migrate()).
function relaxUsers(db){
  const existing=columns(db,'users');
  if(!existing.some(column=>['username','password'].includes(column.name)&&column.notnull))return;
  const relaxed=new Set(['username','password']);
  const definition=existing.map(column=>`"${column.name}" ${column.type||''}${column.pk?' PRIMARY KEY':''}${column.notnull&&!column.pk&&!relaxed.has(column.name)?' NOT NULL':''}${column.dflt_value!==null?` DEFAULT ${column.dflt_value}`:''}${column.name==='username'?' UNIQUE':''}`).join(',');
  const names=existing.map(column=>`"${column.name}"`).join(',');
  const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL").all();
  db.exec(`CREATE TABLE users_rebuild(${definition})`);
  db.exec(`INSERT INTO users_rebuild(${names}) SELECT ${names} FROM users`);
  const before=db.prepare('SELECT COUNT(*) n FROM users').get().n,after=db.prepare('SELECT COUNT(*) n FROM users_rebuild').get().n;
  if(before!==after)throw new Error('users rebuild lost rows');
  db.exec('DROP TABLE users');db.exec('ALTER TABLE users_rebuild RENAME TO users');
  for(const index of indexes)db.exec(index.sql);
}
// One physical push subscription (endpoint) may now belong to several accounts on the same device.
function relaxPushDevices(db){
  if(!/endpoint\s+TEXT\s+UNIQUE/i.test(tableSql(db,'push_devices')))return;
  db.exec('CREATE TABLE push_devices_rebuild(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,provider TEXT NOT NULL,endpoint TEXT NOT NULL,subscription TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,endpoint))');
  db.exec('INSERT INTO push_devices_rebuild(id,user_id,session_id,provider,endpoint,subscription,created) SELECT id,user_id,session_id,provider,endpoint,subscription,created FROM push_devices');
  db.exec('DROP TABLE push_devices');db.exec('ALTER TABLE push_devices_rebuild RENAME TO push_devices');
  db.exec('CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices(user_id)');
}
const steps=[
  {version:1,name:'release-foundation',up(db){
    db.exec(`CREATE TABLE message_requests(user_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,message_id TEXT NOT NULL REFERENCES messages(id),fingerprint TEXT NOT NULL,PRIMARY KEY(user_id,client_id));
      CREATE INDEX IF NOT EXISTS members_user_chat ON members(user_id,chat_id);
      CREATE INDEX IF NOT EXISTS sessions_user_expires ON sessions(user_id,expires);
      CREATE INDEX IF NOT EXISTS messages_media ON messages(media_id) WHERE media_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS media_owner ON media(user_id);
      CREATE INDEX IF NOT EXISTS ai_history_owner_created ON ai_history(user_id,created);
      CREATE INDEX IF NOT EXISTS vip_grants_owner ON vip_grants(user_id,revoked,expires);
      CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices(user_id);
      CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,created INTEGER NOT NULL);`);
  }},
  {version:2,name:'email-auth-persistent-media-channels',foreignKeysOff:true,up(db){
    // Accounts: username/password optional, verified e-mail, split name. Existing rows are preserved untouched.
    relaxUsers(db);
    addColumn(db,'users','first_name',"TEXT DEFAULT ''");
    addColumn(db,'users','last_name',"TEXT DEFAULT ''");
    addColumn(db,'users','email','TEXT');
    addColumn(db,'users','normalized_email','TEXT');
    addColumn(db,'users','email_verified','INTEGER NOT NULL DEFAULT 0');
    addColumn(db,'users','updated','INTEGER');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email ON users(normalized_email) WHERE normalized_email IS NOT NULL');
    db.exec(`CREATE TABLE IF NOT EXISTS pending_registrations(id TEXT PRIMARY KEY,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email TEXT NOT NULL,normalized_email TEXT NOT NULL UNIQUE,created INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS email_verifications(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL,purpose TEXT NOT NULL,email TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,used_at INTEGER);
      CREATE INDEX IF NOT EXISTS email_verifications_lookup ON email_verifications(subject_id,purpose,created);`);
    // Sessions are grouped per physical device so several accounts can stay signed in side by side.
    db.exec('CREATE TABLE IF NOT EXISTS session_devices(session_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,user_id TEXT NOT NULL,last_used INTEGER NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS session_devices_device ON session_devices(device_id,user_id)');
    relaxPushDevices(db);
    // Media: the existing table becomes the MediaFile entity (messages keep referencing media.id).
    addColumn(db,'media','storage_provider',"TEXT NOT NULL DEFAULT 'local'");
    addColumn(db,'media','storage_key','TEXT');
    addColumn(db,'media','width','INTEGER');
    addColumn(db,'media','height','INTEGER');
    addColumn(db,'media','duration','REAL');
    addColumn(db,'media','thumbnail_key','TEXT');
    addColumn(db,'media','checksum','TEXT');
    addColumn(db,'media','upload_status',"TEXT NOT NULL DEFAULT 'ready'");
    db.exec('CREATE INDEX IF NOT EXISTS media_provider ON media(storage_provider,upload_status)');
    // Channels: optional public discovery. Existing channels stay private.
    addColumn(db,'chats','public','INTEGER NOT NULL DEFAULT 0');
  }}
];
export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL)');
  const version=()=>db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
  if(version()>schemaVersion)throw new Error('Database schema is newer than this application');
  for(const step of steps){
    if(version()>=step.version)continue;
    // PRAGMA foreign_keys is ignored inside a transaction, so table rebuilds switch it off first.
    if(step.foreignKeysOff)db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      step.up(db);
      if(step.foreignKeysOff){const broken=db.prepare('PRAGMA foreign_key_check').all();if(broken.length)throw new Error(`Migration ${step.version} would break ${broken.length} foreign key reference(s)`);}
      db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(step.version,step.name,Date.now());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    finally{if(step.foreignKeysOff)db.exec('PRAGMA foreign_keys=ON');}
  }
}
