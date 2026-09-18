import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function database(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'cipherion.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, bio TEXT DEFAULT '', avatar TEXT DEFAULT '', settings TEXT DEFAULT '{}', created INTEGER NOT NULL);
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
