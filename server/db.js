import { DatabaseSync } from 'node:sqlite';
import Libsql from 'libsql';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function databaseConfig(env=process.env) {
  const url=env.TURSO_DATABASE_URL?.trim(),token=env.TURSO_AUTH_TOKEN?.trim();
  if(Boolean(url)!==Boolean(token))throw new Error('Both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required');
  if(url){
    let parsed;try{parsed=new URL(url);}catch{throw new Error('Invalid TURSO_DATABASE_URL');}
    if(parsed.protocol!=='libsql:'||!parsed.hostname.endsWith('.turso.io')||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.port||!['','/'].includes(parsed.pathname))throw new Error('Expected a secure Turso libsql URL');
    return {remote:true,url,token};
  }
  return {remote:false};
}
// Turso drops idle Hrana streams and its edge occasionally answers 502. Those
// errors surface from prepare() before anything runs, so one retry on a fresh
// stream is safe — except inside an explicit transaction, which died with the stream.
const TRANSIENT=/stream not found|stream expired|Bad Gateway|Service Unavailable|Gateway Timeout|connect to upstream failed|connection (?:reset|closed|refused)|error sending request/i;
export function isTransientDatabaseError(error){return TRANSIENT.test(String(error?.message||''));}
export function retryTransient(db){
  let transaction=false;
  const prepare=db.prepare.bind(db),exec=db.exec.bind(db);
  db.prepare=sql=>{try{return prepare(sql);}catch(error){if(transaction||!isTransientDatabaseError(error))throw error;return prepare(sql);}};
  db.exec=sql=>{
    const text=String(sql).trim(),ends=/(?:^|;)\s*(?:COMMIT|ROLLBACK|END)\b[^;]*;?\s*$/i.test(text);
    try{return exec(sql);}catch(error){if(!transaction&&!/^BEGIN\b/i.test(text)&&isTransientDatabaseError(error))return exec(sql);throw error;}
    finally{if(/^BEGIN\b/i.test(text)&&!ends)transaction=true;else if(ends)transaction=false;}
  };
  return db;
}
export function database(directory) {
  mkdirSync(directory, { recursive: true });
  const config=databaseConfig();
  const db = config.remote ? retryTransient(new Libsql(config.url,{authToken:config.token}))
    : process.env.CIPHERION_TEST_LIBSQL==='1' ? new Libsql(resolve(directory,'cipherion.sqlite')) : new DatabaseSync(resolve(directory, 'cipherion.sqlite'));
  // Remote errors must propagate; never fall back to an ephemeral local database.
  if(!config.remote)db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  if(config.remote){
    const registry=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const version=registry?db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version:0;
    if(version>1)throw new Error('Database schema is newer than this application');
    const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if(existing.length&&version!==1)throw new Error('Remote database requires a verified migration before startup');
    if(!existing.length&&process.env.TURSO_ALLOW_EMPTY_INIT!=='1')throw new Error('Empty Turso database: import existing data first, or explicitly enable empty initialization');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, bio TEXT DEFAULT '', avatar TEXT DEFAULT '', settings TEXT DEFAULT '{}', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), agent TEXT, created INTEGER, active INTEGER, expires INTEGER);
    CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, avatar TEXT DEFAULT '', permissions TEXT DEFAULT '{}', created INTEGER);
    CREATE TABLE IF NOT EXISTS members(chat_id TEXT REFERENCES chats(id), user_id TEXT REFERENCES users(id), role TEXT DEFAULT 'member', rules TEXT DEFAULT '{}', tag TEXT DEFAULT '', read_at INTEGER DEFAULT 0, delivered_at INTEGER DEFAULT 0, PRIMARY KEY(chat_id,user_id));
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id), user_id TEXT REFERENCES users(id), kind TEXT, body TEXT, media_id TEXT, reply_id TEXT, forwarded TEXT, poll TEXT, created INTEGER, edited INTEGER, deleted INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, transcript TEXT);
    CREATE INDEX IF NOT EXISTS message_chat ON messages(chat_id,created);
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT, type TEXT, size INTEGER, created INTEGER);
    CREATE TABLE IF NOT EXISTS votes(message_id TEXT REFERENCES messages(id), user_id TEXT REFERENCES users(id), choice INTEGER, PRIMARY KEY(message_id,user_id,choice));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id), actor TEXT REFERENCES users(id), action TEXT, target TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS blocks(user_id TEXT, target TEXT, PRIMARY KEY(user_id,target));
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id), user_id TEXT REFERENCES users(id), video INTEGER, created INTEGER, ended INTEGER, status TEXT);
  `);
  return db;
}


