import {createAccounts} from './accounts.js';
import {createEmailAuth} from './email-auth.js';
import {createStorage,validateUpload} from './storage.js';
import {createCommunities} from './communities.js';
import {health, logFailure, messageFingerprint} from './release.js';
import {backupBeforeMigration, migrate} from './migrations.js';
import {createDelivery} from './delivery.js';
import {createAdmin} from './admin.js';
import {vipBadgeValue} from '../public/vip-badges.js';
import {createProfiles} from './profiles.js';
import {createPolls} from './polls.js';
import {createStories} from './stories.js';
import {createStickers} from './stickers.js';
import {createChatTools} from './chat-tools.js';
import {createRecovery} from './recovery.js';
import {createReadStream} from 'node:fs';
import { createPrivacy } from './privacy.js';
import { createSecurity } from './security.js';
import http from 'node:http';
import { rtcConfiguration, rtcConfigurationAsync, managedTurnConfigured } from './turn.js';
import { createFamily } from './family.js';
import { createVip } from './vip.js';
import { createSocial } from './social.js';
import { createAI } from './ai.js';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, open, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database, databaseConfig } from './db.js';
import { allowed, defaults, adminPermissions, memberPermissions } from './permissions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(process.env.DATA_DIR || resolve(root, 'data'));
await mkdir(resolve(data, 'media'), { recursive: true });
if(!databaseConfig().remote)await backupBeforeMigration(data);
const db = database(data);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const id = () => randomUUID();
const now = () => Date.now();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const publicUser = (u, viewer) => ({...privacy.project(u, viewer, streams.has(u?.id)),...(u?.id===viewer?{isAdmin:adminAccess.isAdmin(u.id),email:u.email||null,emailVerified:!!u.email_verified,surname:one('SELECT surname FROM profile_details WHERE user_id=?',u.id)?.surname||''}:{})});
const streams = new Map(), liveCalls = new Map(), limits = new Map();
let uploadsInFlight=0;
function rate(key, count, window = 60_000) {
  const entry = limits.get(key);
  if (!entry || entry.until < now()) { limits.set(key, { n: 1, until: now() + window }); return; }
  if (++entry.n > count) fail(429, 'Слишком много запросов. Попробуйте позже.');
}
function emit(user, event, payload) {
  // A stream ended by logout or a password change stays in the set until its socket closes.
  for (const res of streams.get(user) || []) if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}
function broadcast(chat, event, payload) {
  if(event==='message'){
    // Let the HTTP acknowledgement leave before projecting realtime payloads.
    setImmediate(()=>{try{
      const row=one('SELECT * FROM messages WHERE id=?',payload.id);
      if(!row)return;
      for(const m of all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat))
        emit(m.user_id,event,{...payload,clientMessageId:row.client_id,message:message(row,m.user_id)});
    }catch(error){logFailure('message_event_failed',error);}});
    return;
  }
  for(const m of all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat))emit(m.user_id,event,payload);
}

function membership(chatId, userId) {
  const chat = one('SELECT * FROM chats WHERE id=?', chatId);
  const member = one('SELECT * FROM members WHERE chat_id=? AND user_id=?', chatId, userId);
  if (!chat || !member || member.role === 'banned') fail(403, 'Нет доступа к чату');
  return { chat, member };
}
function requirePermission(chatId, userId, permission) {
  const { chat, member } = membership(chatId, userId);
  if (!allowed(member, chat, permission)) fail(403, 'Недостаточно прав');
  return { chat, member };
}
function audit(chat, actor, action, target = '') {
  run('INSERT INTO audit VALUES(?,?,?,?,?,?)', id(), chat, actor, action, target, now());
  broadcast(chat, 'refresh', { chat });
}
function message(row, viewer) {
  row={...row,clientMessageId:row.client_id,serverMessageId:row.id,status:'sent'};
  const author = publicUser(one('SELECT * FROM users WHERE id=?', row.user_id), viewer);
  if (row.deleted) return { id: row.id, chat_id: row.chat_id, user_id: row.user_id, created: row.created, client_id:row.client_id,clientMessageId:row.client_id,serverMessageId:row.id,status:'sent', deleted: true, author };
  const result = { ...row, author, reactions:social.reactions(row.id), myReaction:one('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?',row.id,viewer)?.emoji||null, media: row.media_id ? one('SELECT id,name,type,size FROM media WHERE id=?', row.media_id) : null };
  if(row.poll)result.poll=polls.project(row,viewer);
  if(row.kind==='sticker')result.sticker=stickers.asset(row.body);
  result.story=stories.replyPreview(row.id,viewer);
  return result;
}
function chatView(c, user) {
  const members = all('SELECT m.*,u.username,u.name,u.avatar FROM members m JOIN users u ON u.id=m.user_id WHERE chat_id=?', c.id);
  const mine = members.find(m => m.user_id === user), cleared = mine?.cleared_at || 0;
  const last = one('SELECT * FROM messages WHERE chat_id=? AND created>? AND deleted=0 ORDER BY created DESC,id DESC LIMIT 1', c.id, cleared);
  return { ...c, invite_key:undefined, canPost:allowed(mine,c,'text'),canEdit:allowed(mine,c,'edit'),canDelete:allowed(mine,c,'delete'),canPin:allowed(mine,c,'pin'), muted:!!one('SELECT 1 FROM chat_mutes WHERE user_id=? AND chat_id=? AND (until_at=-1 OR until_at>?)',user,c.id,now()), title: c.kind === 'direct' ? members.find(m => m.user_id !== user)?.name || 'Личный чат' : c.kind === 'saved' ? 'Избранное' : c.title, cleared_at: cleared, draft: chatTools.draft(user, c.id),
    members: members.filter(m => m.role !== 'banned').map(m => ({ ...m, ...publicUser(one('SELECT * FROM users WHERE id=?',m.user_id),user), read_at:m.user_id===user||privacy.canRead(m.user_id,c.kind)?m.read_at:0 })),
    last: last ? message(last, user) : null,
    unread: one('SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND user_id!=? AND created>? AND deleted=0', c.id, user, Math.max(mine.read_at, cleared)).n };
}
async function body(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Файл слишком большой'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function endCall(call, status = 'ended') {
  run('UPDATE calls SET ended=?,status=? WHERE id=?', now(), status, call.id);
  broadcast(call.chat, 'call', { ...call, participants: [...call.participants], state: status });
  liveCalls.delete(call.id);
}
const mime = { '.webp':'image/webp', '.png':'image/png', '.jpeg':'image/jpeg', '.webmanifest':'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const storage=createStorage({db,one,run,data});
const adminAccess=createAdmin({db,one,run,fail,now,rate});
const privacy=createPrivacy({db,one,all,run,fail,now,id,emit,isOnline:uid=>streams.has(uid),vipInfo:uid=>{const active=vip.active(uid);return {vip:active,vipBadge:active?vipBadgeValue(social.profile(uid).badge):null};}});
const security=createSecurity({db,one,all,run,fail,now,privacy,rate});
const family=createFamily({db,one,all,run,fail,now,emit});
const vip=createVip({db,one,all,run,fail,now,id,rate,isAdmin:adminAccess.isAdmin});
const stickers=createStickers({db,one,all,run,fail,now,id,data,storage,rate,membership,requirePermission,privacy,family,broadcast,isAdmin:adminAccess.isAdmin});
const social=createSocial({db,one,all,run,fail,now,id,membership,requirePermission,family,vip,broadcast,privacy,stickers,emit});
const profiles=createProfiles({db,one,all,run,fail,now,id,rate,privacy,family,vip,emit,social,isAdmin:adminAccess.isAdmin});
const ai=createAI({db,one,all,run,fail,now,id,rate,membership,family,vip,data,storage});
const polls=createPolls({db,one,all,run,fail,now,id,rate,membership,requirePermission,family,privacy,broadcast,emit});
const stories=createStories({db,one,all,run,fail,now,id,rate,privacy,family,vip,emit,broadcast,data,storage});
const delivery=createDelivery({db,one,all,run,fail,now,id,membership,emit,broadcast,family,projectMessage:message});
migrate(db);
const accounts=createAccounts({one,all,run,now,fail,clean,publicUser,privacy,streams});
const emailAuth=createEmailAuth({db,one,all,run,fail,now,id,rate,accounts,publicUser,security,emit});
const recovery=createRecovery({db,one,run,fail,now,rate,accounts,publicUser,security,streams});
const chatTools=createChatTools({db,one,all,run,fail,now,id,clean,membership,family,emit,broadcast,projectMessage:message});
const communities=createCommunities({db,one,all,run,fail,now,id,membership,family,chatView,emit,liveCalls,endCall});
let databaseHealth=health(db);
setInterval(()=>delivery.tick().catch(e=>logFailure('push_worker_failed',e)),3000).unref();
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
    if (path === '/health' && req.method === 'GET') {
      // Liveness must not wait on the remote database: a slow Turso round trip would make
      // Render restart a healthy instance. Database state comes from the background probe.
      const result=databaseHealth;return json({...result.body,notifications:'web-push-v2',pushConfigured:delivery.configured(),mediaConfigured:storage.configured,mediaStorage:storage.mode,emailAuthConfigured:!!emailAuth.ready()},200);
    }
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод не поддерживается');
      const file = resolve(root, 'public', path === '/' ? 'index.html' : '.' + decodeURIComponent(path));
      if (!file.startsWith(resolve(root, 'public') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) fail(404, 'Не найдено');
      const content = await readFile(file).catch(() => fail(404, 'Не найдено'));
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': /^\/brand\/icon-\d+-[a-f0-9]+\.png$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : content);
    }
    const protocol = process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-proto'] || 'http') : 'http';
    const expectedOrigin = process.env.PUBLIC_ORIGIN || `${protocol}://${req.headers.host}`;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== expectedOrigin) fail(403, 'Недопустимый источник запроса');
    rate(req.socket.remoteAddress, 600);
    const user = accounts.authenticate(req);
    let b = {};
    if (!['GET', 'HEAD'].includes(req.method) && path !== '/api/media') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Ожидается JSON');
      try { b = JSON.parse((await body(req)).toString() || '{}'); } catch (error) { if (error.status) throw error; fail(400, 'Некорректный JSON'); }
    }
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail(400, 'Ожидается JSON-объект');
    if(path==='/api/accounts'&&req.method==='GET')return json(accounts.list(req));
    if(await emailAuth.route({path,req,res,b,user,json}))return;
    if(await recovery.route({path,req,res,b,user,json}))return;
    if (path === '/api/auth' && req.method === 'POST') {
      if(b.register&&emailAuth.enabled)fail(410,'Создайте аккаунт через подтверждение email');
      accounts.assertCapacity(req,one('SELECT id FROM users WHERE username=?',String(b.username||'').trim().toLowerCase())?.id);
      rate('auth:' + req.socket.remoteAddress, 20, 900_000);
      const username = String(b.username ?? '').trim().toLowerCase(); const password = String(b.password || '');
      if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 10 || password.length > 256) fail(400, 'Username: 3–32 латинских символа. Пароль: 10–256 символов.');
      if (b.register && username.length < 5) fail(400, 'Username: от 5 до 32 латинских букв, цифр или _');
      rate('auth-account:'+createHash('sha256').update(username).digest('hex'),10,900_000);
      let account = one('SELECT * FROM users WHERE username=?', username); let familyCode;
      if (b.register) {
        if (account) fail(409, 'Этот username уже занят');
        const salt = randomBytes(16).toString('hex'); const hash = scryptSync(password, salt, 64).toString('hex');
        run('INSERT INTO users(id,username,name,password,created) VALUES(?,?,?,?,?)', id(), username, clean(b.name, 80) || username, salt + ':' + hash, now());
        account = one('SELECT * FROM users WHERE username=?', username);
        if(b.child){try{familyCode=family.register(account.id,b.birth);}catch(error){run('DELETE FROM users WHERE id=?',account.id);throw error;}}
      } else {
        const [salt, hash] = (account?.password || 'dummy:' + '0'.repeat(128)).split(':');
        const attempt = scryptSync(password, salt, 64);
        if (!account || !hash || Buffer.from(hash,'hex').length!==attempt.length || !timingSafeEqual(attempt, Buffer.from(hash, 'hex'))) fail(401, 'Неверный username или пароль');
      }
      if(!b.register)security.verify(account.id,b.code);
      accounts.create(req,res,account);
      return json({ user: publicUser(account,account.id), settings: JSON.parse(account.settings), familyCode, ...(b.register?{recoveryKey:recovery.issue(account.id)}:{}) });
    }
    if (!user) fail(401, 'Войдите в аккаунт');
    if (path === '/api/me' && req.method === 'GET') return json({ user: {...publicUser(user,user.id),vip:vip.active(user.id)}, settings: JSON.parse(user.settings), family:family.info(user.id), rtcDebug:process.env.NODE_ENV==='development', transcription: !!process.env.TRANSCRIPTION_KEY, ...await rtcConfigurationAsync(user.id) });
    if(await communities.route({path,req,b,user,json}))return;
    if(await family.route({path,req,b,user,json}))return;
    if(!['/api/me','/api/logout','/api/sessions','/api/events'].includes(path)&&!(path==='/api/call-action'&&['leave','reject'].includes(b.action)))family.assertUse(user.id);
    if(await delivery.route({path,req,b,user,json,url}))return;
    if(path==='/api/rtc-config'&&req.method==='GET')return json(await rtcConfigurationAsync(user.id));
    if(path==='/api/activity'&&req.method==='POST')return json({ok:true});
    if(await privacy.route({path,req,b,user,json}))return;
    if(await security.route({path,req,b,user,json}))return;
    if(await stories.route({path,req,b,user,json,url}))return;
    if(await polls.route({path,req,b,user,json,url}))return;
    if(await adminAccess.route({path,req,b,user,json}))return;
    if(await vip.route({path,req,b,user,json}))return;
    if(await stickers.route({path,req,res,b,user,json,url}))return;
    if(await profiles.route({path,req,b,user,json,url}))return;
    if(await social.route({path,req,b,user,json,url}))return;
    if(await ai.route({path,req,res,b,user,json}))return;
    if (path === '/api/logout' && req.method === 'POST') {
      ai.abortUser(user.id);
      run('DELETE FROM push_account_devices WHERE session_id=?',user.session.id);
      run('DELETE FROM sessions WHERE id=?', user.session.id);
      for (const stream of streams.get(user.id) || []) if (stream.sessionId === user.session.id) stream.end();
      accounts.logout(req,res,user); return json({ ok: true });
    }
    if (path === '/api/me' && req.method === 'PATCH') {
      ai.abortUser(user.id);
      const avatar = b.avatar === undefined ? user.avatar : clean(b.avatar, 200);
      if (avatar && !one("SELECT id FROM media WHERE id=? AND user_id=? AND type IN ('image/png','image/jpeg','image/webp','image/gif')", avatar, user.id)) fail(400, 'Недопустимый аватар');
      const settings = b.settings === undefined ? JSON.parse(user.settings) : b.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || JSON.stringify(settings).length > 80_000) fail(400, 'Некорректные настройки');
      if(settings.ai){if(typeof settings.ai!=='object'||Array.isArray(settings.ai))fail(400,'Некорректные настройки AI');if(settings.ai.chatIds!==undefined&&(!Array.isArray(settings.ai.chatIds)||settings.ai.chatIds.length>100||settings.ai.chatIds.some(v=>typeof v!=='string')))fail(400,'Некорректные разрешения чатов');}
      if(settings.folders!==undefined&&(!Array.isArray(settings.folders)||settings.folders.length>Math.max(vip.active(user.id)?50:10,JSON.parse(user.settings).folders?.length||0)))fail(400,'Превышен лимит папок');
      if(settings.pins!==undefined&&(!Array.isArray(settings.pins)||settings.pins.length>Math.max(vip.active(user.id)?20:5,JSON.parse(user.settings).pins?.length||0)))fail(400,'Превышен лимит закреплённых чатов');
      const oldSettings=JSON.parse(user.settings);if(settings.theme!==oldSettings.theme&&['Emerald VIP','Diamond Glass','Golden Glass','Aurora VIP','Cosmic'].includes(settings.theme)&&!vip.active(user.id))fail(403,'Эта тема доступна с VIP');for(const k of ['vipGlow','vipBadge','presets'])if(JSON.stringify(settings[k])!==JSON.stringify(oldSettings[k])&&settings[k]&&!vip.active(user.id))fail(403,'Требуется VIP');
      run('UPDATE users SET name=?,bio=?,avatar=?,settings=? WHERE id=?', clean(b.name ?? user.name, 80) || user.username, b.bio===undefined?user.bio:clean(b.bio, vip.active(user.id)?500:300), avatar, JSON.stringify(settings), user.id);
      emit(user.id,'settings',{});
      return json({ user: {...publicUser(one('SELECT * FROM users WHERE id=?', user.id),user.id),vip:vip.active(user.id)}, settings });
    }
    if (path === '/api/users' && req.method === 'GET') {
      const q = clean(url.searchParams.get('q'), 80).toLowerCase();
      return json(q ? all('SELECT u.* FROM users u LEFT JOIN private_profiles p ON p.user_id=u.id WHERE u.id!=? AND (instr(lower(username),?)>0 OR instr(lower(name),?)>0 OR p.phone=?) LIMIT 30', user.id, q, q,q).filter(u=>!q.startsWith('+')||privacy.permits(u.id,user.id,'phoneDiscovery')).filter(u=>{try{family.contact(user.id,u.id);return true;}catch{return false;}}).map(u=>publicUser(u,user.id)) : []);
    }
    if (path === '/api/sessions' && req.method === 'GET') return json(all('SELECT id,agent,created,active FROM sessions WHERE user_id=? AND expires>?', user.id, now()).map(s => ({ ...s, current: s.id === user.session.id })));
    if (path === '/api/sessions' && req.method === 'DELETE') {
      const doomed = all('SELECT id FROM sessions WHERE user_id=? AND id!=? AND (?=\'all\' OR id=?)', user.id, user.session.id, b.id, b.id);
      for (const s of doomed) { run('DELETE FROM push_account_devices WHERE session_id=?',s.id); run('DELETE FROM sessions WHERE id=?', s.id); for (const stream of streams.get(user.id) || []) if (stream.sessionId === s.id) stream.end(); }
      return json({ ok: true });
    }
    if (path === '/api/blocks' && req.method === 'GET') return json(all('SELECT u.* FROM blocks b JOIN users u ON b.target=u.id WHERE b.user_id=?', user.id).map(u=>publicUser(u,user.id)));
    if (path === '/api/blocks' && ['POST','DELETE'].includes(req.method)) {
      if (req.method === 'POST') run('INSERT OR IGNORE INTO blocks VALUES(?,?)', user.id, clean(b.target)); else run('DELETE FROM blocks WHERE user_id=? AND target=?', user.id, clean(b.target));
      return json({ ok: true });
    }
    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (!streams.has(user.id)) streams.set(user.id, new Set());
      if (streams.get(user.id).size >= 6) { res.end(); return; }
      res.sessionId = user.session.id; streams.get(user.id).add(res); res.write('event: ready\ndata: {}\n\n');
      const heartbeat = setInterval(() => {
        try { if (!one('SELECT id FROM sessions WHERE id=? AND expires>?', user.session.id, now())) { res.end(); return; } }
        catch (error) { logFailure('stream_heartbeat_failed', error); }
        res.write(': heartbeat\n\n');
      }, 20_000);
      req.on('close', () => { clearInterval(heartbeat); try { run('UPDATE sessions SET active=? WHERE id=?', now(), user.session.id); } catch (error) { logFailure('stream_close_failed', error); } streams.get(user.id)?.delete(res); if (!streams.get(user.id)?.size) streams.delete(user.id); });
      return;
    }
    if(await chatTools.route({path,req,b,user,json,url}))return;
    if (path === '/api/chats' && req.method === 'GET') return json(all("SELECT c.*,m.hidden AS member_hidden,m.cleared_at AS member_cleared FROM chats c JOIN members m ON c.id=m.chat_id WHERE m.user_id=? AND m.role!='banned'", user.id).filter(c => chatTools.visible(c.id, {hidden:c.member_hidden, cleared_at:c.member_cleared})).map(({member_hidden, member_cleared, ...c}) => chatView(c, user.id)).sort((a,b) => (b.last?.created || b.created) - (a.last?.created || a.created)));
    if (path === '/api/chats' && req.method === 'POST') {
      if (b.kind === 'saved') return json(chatView(chatTools.ensureSaved(user.id), user.id), 201);
      const kind = ['group','channel'].includes(b.kind) ? b.kind : 'direct';
      const users = [...new Set([user.id, ...(Array.isArray(b.users) ? b.users : [])])];
      if (users.length > 100 || (kind === 'direct' && users.length !== 2)) fail(400, 'Проверьте участников');
      for (const target of users) {
        if(target!==user.id){family.contact(user.id,target);privacy.assertContact(user.id,target,kind==='direct'?'messages':'groups');}
        if(kind!=='direct'&&family.child(target))fail(403,'Детей можно добавить только в одобренное родителем сообщество');
        if (!one('SELECT id FROM users WHERE id=?', target)) fail(400, 'Пользователь не найден');
        if (one('SELECT * FROM blocks WHERE (user_id=? AND target=?) OR (user_id=? AND target=?)', target, user.id, user.id, target)) fail(403, 'Общение с этим пользователем недоступно');
      }
      if (kind === 'direct') {
        const existing = one("SELECT c.* FROM chats c JOIN members a ON a.chat_id=c.id JOIN members b ON b.chat_id=c.id WHERE c.kind='direct' AND a.user_id=? AND b.user_id=?", user.id, users.find(u => u !== user.id));
        if (existing) { run('UPDATE members SET hidden=0 WHERE chat_id=? AND user_id=?', existing.id, user.id); return json(chatView(existing, user.id)); }
      }
      const chatId = id(); const perms = kind === 'channel' ? Object.fromEntries(memberPermissions.map(k => [k, false])) : defaults;
      run('INSERT INTO chats(id,kind,title,permissions,created) VALUES(?,?,?,?,?)', chatId, kind, clean(b.title, 80) || (kind === 'channel' ? 'Новый канал' : 'Новая группа'), JSON.stringify(perms), now());
      for (const u of users) run('INSERT INTO members(chat_id,user_id,role) VALUES(?,?,?)', chatId, u, u === user.id && kind !== 'direct' ? 'owner' : kind==='channel'?'subscriber':'member');
      broadcast(chatId, 'refresh', { chat: chatId }); return json(chatView(one('SELECT * FROM chats WHERE id=?', chatId), user.id), 201);
    }
    const chatMatch = /^\/api\/chats\/([^/]+)(?:\/(messages|read|typing|members|audit))?$/.exec(path);
    if (chatMatch) {
      const chatId = chatMatch[1], action = chatMatch[2]; const { chat, member } = membership(chatId, user.id); family.chatAccess(chatId,user.id);
      if (!action && req.method === 'PATCH') {
        requirePermission(chatId, user.id, 'info');
        if (['direct','saved'].includes(chat.kind)) fail(400, 'Это личный чат');
        const avatar = b.avatar === undefined ? chat.avatar : clean(b.avatar, 200);
        if (avatar && !one("SELECT id FROM media WHERE id=? AND user_id=? AND type IN ('image/png','image/jpeg','image/webp','image/gif')", avatar, user.id)) fail(400, 'Недопустимый аватар');
        if(b.reactionsEnabled!==undefined){if(member.role!=='owner')fail(403,'Только владелец управляет реакциями');run('UPDATE chats SET reactions_enabled=? WHERE id=?',b.reactionsEnabled===true?1:0,chatId);}
        run('UPDATE chats SET title=?,avatar=? WHERE id=?', clean(b.title ?? chat.title, 80), avatar, chatId); audit(chatId, user.id, 'info'); return json({ ok: true });
      }
      if (action === 'messages' && req.method === 'GET') {
        const before = url.searchParams.has('before')?Number(url.searchParams.get('before')):Number.MAX_SAFE_INTEGER;
        if(!Number.isSafeInteger(before)||before<0)fail(400,'Некорректный курсор');
        const beforeId=url.searchParams.get('beforeId');
        if(beforeId!==null&&(!url.searchParams.has('before')||!beforeId||beforeId.length>100))fail(400,'Некорректный курсор');
        const rows = (beforeId===null
          ? all('SELECT * FROM messages WHERE chat_id=? AND created>? AND created<? ORDER BY created DESC,id DESC LIMIT 60',chatId,member.cleared_at||0,before)
          : all('SELECT * FROM messages WHERE chat_id=? AND created>? AND (created<? OR (created=? AND id<?)) ORDER BY created DESC,id DESC LIMIT 60',chatId,member.cleared_at||0,before,before,beforeId)).reverse();
        return json(rows.map(m => message(m, user.id)));
      }
      if (action === 'messages' && req.method === 'POST') {
        const clientId=(b.clientMessageId??b.clientId)==null?null:String(b.clientMessageId??b.clientId);if(b.clientMessageId&&b.clientId&&b.clientMessageId!==b.clientId)fail(400,'ID сообщения не совпадают');if(clientId!==null&&!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId))fail(400,'Некорректный ID сообщения');
        if(clientId){const existing=one('SELECT * FROM messages WHERE user_id=? AND client_id=?',user.id,clientId);if(existing){const request=one('SELECT fingerprint FROM message_requests WHERE user_id=? AND client_id=?',user.id,clientId);if(existing.chat_id!==chatId || request&&request.fingerprint!==messageFingerprint(chatId,b))fail(409,'ID сообщения уже использован для другого запроса');return json(message(existing,user.id));}}
        rate('message:' + user.id, 90); family.content(chatId,clean(b.body)+' '+JSON.stringify(b.poll||{}),!!b.media);
        const kind = ['text','photo','video','file','voice','round','poll'].includes(b.kind) ? b.kind : 'text';
        requirePermission(chatId, user.id, kind);
        if (chat.kind === 'direct') for (const m of all('SELECT user_id FROM members WHERE chat_id=?', chatId)) if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'messages');
        let media = null, poll = null;
        if (b.media) { media = one('SELECT * FROM media WHERE id=? AND user_id=?', b.media, user.id); if (!media) fail(400, 'Нет доступа к файлу'); }
        if (['photo','video','file','voice','round'].includes(kind) && !media) fail(400, 'Добавьте файл');
        if (kind === 'photo' && !media.type.startsWith('image/')) fail(400, 'Ожидается изображение');
        if (['video','round'].includes(kind) && !media.type.startsWith('video/')) fail(400, 'Ожидается видео');
        if (kind === 'voice' && !media.type.startsWith('audio/')) fail(400, 'Ожидается аудио');
        if (kind === 'poll') {
          const options = Array.isArray(b.poll?.options) ? b.poll.options.map(o => clean(o, 150)).filter(Boolean) : [];
          if (options.length < 2 || options.length > 20 || !clean(b.body)) fail(400, 'Нужны вопрос и от 2 до 20 вариантов');
          poll = polls.normalize(b.poll,chatId);
        }
        if (!clean(b.body) && !media && !poll) fail(400, 'Пустое сообщение');
        if (b.reply && !one('SELECT id FROM messages WHERE id=? AND chat_id=?', b.reply, chatId)) fail(400, 'Ответ недоступен');
        const emojiKeys=stickers.tokens(clean(b.body),user.id);if(emojiKeys.length)family.content(chatId,'',true);
        const messageId = id();
        db.exec('BEGIN');try{run('INSERT INTO messages(id,chat_id,user_id,kind,body,media_id,reply_id,poll,created,client_id) VALUES(?,?,?,?,?,?,?,?,?,?)', messageId, chatId, user.id, kind, clean(b.body), media?.id || null, b.reply || null, poll ? JSON.stringify(poll) : null, Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',chatId)?.n||0)+1),clientId);
        if(clientId)run('INSERT INTO message_requests VALUES(?,?,?,?)',user.id,clientId,messageId,messageFingerprint(chatId,b));
        stickers.bind(messageId,emojiKeys);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}broadcast(chatId, 'message', { chat: chatId, id: messageId }); return json(message(one('SELECT * FROM messages WHERE id=?', messageId), user.id), 201);
      }
      if (action === 'read' && req.method === 'POST') { const last = b.message ? one('SELECT created n FROM messages WHERE id=? AND chat_id=?',String(b.message),chatId)?.n : one('SELECT MAX(created) AS n FROM messages WHERE chat_id=?', chatId).n || 0;if(last===undefined)fail(400,'Сообщение не найдено'); run('UPDATE members SET read_at=MAX(read_at,?),delivered_at=MAX(delivered_at,?) WHERE chat_id=? AND user_id=?', last, last, chatId, user.id);emit(user.id,'receipt',{chat:chatId,user:user.id,read:last,delivered:last}); if(privacy.canRead(user.id,chat.kind))broadcast(chatId, 'receipt', { chat: chatId, user: user.id, read: last, delivered: last }); return json({ ok: true }); }
      if (action === 'typing' && req.method === 'POST') { requirePermission(chatId, user.id, 'text'); broadcast(chatId, 'typing', { chat: chatId, user: user.id, name: user.name }); return json({ ok: true }); }
      if (action === 'audit' && req.method === 'GET') { if (!['owner','admin'].includes(member.role)) fail(403, 'Только для администраторов'); return json(all('SELECT a.*,u.name FROM audit a JOIN users u ON u.id=a.actor WHERE chat_id=? ORDER BY created DESC LIMIT 100', chatId)); }
      if (action === 'members' && req.method === 'GET') {
        if (!['owner','admin'].includes(member.role)) return json(chatView(chat,user.id).members);
        return json(all('SELECT m.*,u.name,u.username,u.avatar FROM members m JOIN users u ON u.id=m.user_id WHERE chat_id=?', chatId).map(m=>({...m,...publicUser(one('SELECT * FROM users WHERE id=?',m.user_id),user.id),read_at:m.user_id===user.id||privacy.canRead(m.user_id,chat.kind)?m.read_at:0})));
      }
      if (action === 'members' && req.method === 'PATCH') {
        if (['direct','saved'].includes(chat.kind)) fail(400, 'Это личный чат');
        if (b.action === 'defaults') {
          requirePermission(chatId,user.id,'permissions');
          const perms = Object.fromEntries(memberPermissions.map(k => [k, b.permissions?.[k] === true]));
          run('UPDATE chats SET permissions=? WHERE id=?', JSON.stringify(perms), chatId); audit(chatId,user.id,'permissions'); return json({ ok:true });
        }
        const target = one('SELECT * FROM members WHERE chat_id=? AND user_id=?',chatId,b.user);
        if (b.action === 'invite') {
          privacy.assertContact(user.id,b.user,'groups');family.contact(user.id,b.user);family.group(b.user,chatId);
          requirePermission(chatId,user.id,'invite');
          if (!one('SELECT id FROM users WHERE id=?',b.user)) fail(404,'Пользователь не найден');
          if (target) fail(409,'Пользователь уже в группе или заблокирован');
          run('INSERT INTO members(chat_id,user_id,role) VALUES(?,?,?)',chatId,b.user,chat.kind==='channel'?'subscriber':'member');
        } else {
          if (!target || target.user_id === user.id || target.role === 'owner' || (target.role === 'admin' && member.role !== 'owner')) fail(403,'Нельзя изменить этого участника');
          const rules = JSON.parse(target.rules);
          if (['admin','transfer'].includes(b.action)) {
            if (member.role !== 'owner') fail(403,'Только владелец');
            if (b.action === 'transfer') {
              if (target.role === 'banned') fail(400,'Участник заблокирован');
              db.exec('BEGIN'); try { run("UPDATE members SET role=?,rules='{}' WHERE chat_id=? AND user_id=?",chat.kind==='channel'?'subscriber':'member',chatId,user.id); run("UPDATE members SET role='owner',rules='{}' WHERE chat_id=? AND user_id=?",chatId,b.user); db.exec('COMMIT'); } catch(error) { db.exec('ROLLBACK'); throw error; }
            } else { rules.admin = Object.fromEntries(adminPermissions.map(k => [k,b.permissions?.[k]===true])); run('UPDATE members SET role=?,rules=? WHERE chat_id=? AND user_id=?',b.enabled ? 'admin':chat.kind==='channel'?'subscriber':'member',JSON.stringify(rules),chatId,b.user); }
          } else if (b.action === 'restrict') {
            requirePermission(chatId,user.id,'permissions');
            rules.overrides = Object.fromEntries(memberPermissions.filter(k => typeof b.permissions?.[k] === 'boolean').map(k => [k,b.permissions[k]]));
            rules.until = Number(b.until) > now() ? Number(b.until) : null;
            run('UPDATE members SET rules=? WHERE chat_id=? AND user_id=?',JSON.stringify(rules),chatId,b.user);
          } else if (b.action === 'tag') { requirePermission(chatId,user.id,'tags'); run('UPDATE members SET tag=? WHERE chat_id=? AND user_id=?',clean(b.tag,30),chatId,b.user); }
          else if (['ban','unban','remove'].includes(b.action)) {
            requirePermission(chatId,user.id,b.action==='remove'?'remove':'ban');
            if (b.action === 'remove') run('DELETE FROM members WHERE chat_id=? AND user_id=?',chatId,b.user);
            else run('UPDATE members SET role=?,rules=? WHERE chat_id=? AND user_id=?', b.action === 'ban' ? 'banned':chat.kind==='channel'?'subscriber':'member', '{}',chatId,b.user);
            emit(b.user,'refresh',{chat:chatId});
            for (const call of liveCalls.values()) if(call.chat===chatId && call.participants.has(b.user)) { call.participants.delete(b.user); broadcast(chatId,'call',{...call,participants:[...call.participants],state:'active'}); emit(b.user,'call',{id:call.id,state:'removed'}); }
          } else fail(400,'Неизвестное действие');
        }
        audit(chatId,user.id,b.action,b.user); return json({ok:true});
      }
    }
    const msgMatch = /^\/api\/messages\/([^/]+)(?:\/(vote|forward|transcribe))?$/.exec(path);
    if (msgMatch) {
      const m = one('SELECT * FROM messages WHERE id=?',msgMatch[1]); if(!m) fail(404,'Сообщение не найдено');
      membership(m.chat_id,user.id); family.chatAccess(m.chat_id,user.id); const action = msgMatch[2];
      if (!action && req.method === 'GET') return json(message(m,user.id));
      if (!action && req.method === 'DELETE') { if(m.user_id!==user.id||one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind==='channel') requirePermission(m.chat_id,user.id,'delete'); run('UPDATE messages SET deleted=1,body=\'\',transcript=NULL WHERE id=?',m.id); }
      else if (!action && req.method === 'PATCH') {
        if (b.pinned !== undefined) { requirePermission(m.chat_id,user.id,'pin'); run('UPDATE messages SET pinned=? WHERE id=?',b.pinned?1:0,m.id); audit(m.chat_id,user.id,'pin',m.id); }
        else { if(one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind==='channel')requirePermission(m.chat_id,user.id,'edit'); if((m.user_id!==user.id && one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind!=='channel') || m.deleted || ['poll','sticker'].includes(m.kind)) fail(403,'Редактирование недоступно'); if(!clean(b.body)) fail(400,'Пустое сообщение'); family.content(m.chat_id,clean(b.body),false);const keys=stickers.tokens(clean(b.body),user.id);if(keys.length)family.content(m.chat_id,'',true);stickers.bind(m.id,keys); run('UPDATE messages SET body=?,edited=? WHERE id=?',clean(b.body),now(),m.id); }
      } else if (action==='vote' && req.method==='POST') {
        if(!m.poll||m.deleted)fail(400,'Опрос недоступен');polls.vote(m,user.id,b.choices);
      } else if(action==='forward' && req.method==='POST') {
        membership(b.chat,user.id);family.chatAccess(b.chat,user.id);
        const clientId=(b.clientMessageId??b.clientId)==null?null:String(b.clientMessageId??b.clientId);
        if(clientId!==null&&!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId))fail(400,'Некорректный ID сообщения');
        const fingerprint=messageFingerprint(b.chat,{body:m.id,kind:'forward'});
        if(clientId){const existing=one('SELECT * FROM messages WHERE user_id=? AND client_id=?',user.id,clientId);if(existing){const request=one('SELECT fingerprint FROM message_requests WHERE user_id=? AND client_id=?',user.id,clientId);if(existing.chat_id!==b.chat||request?.fingerprint!==fingerprint)fail(409,'ID сообщения уже использован');return json(message(existing,user.id));}}
        if(m.deleted || m.kind==='poll') fail(400,'Пересылка недоступна');
        const {chat:destination}=requirePermission(b.chat,user.id,m.kind==='sticker'?'photo':m.kind);family.content(b.chat,m.body,!!m.media_id||m.kind==='sticker'||!!one('SELECT sticker_id FROM message_stickers WHERE message_id=?',m.id));
        if(destination.kind==='direct')for(const member of all('SELECT user_id FROM members WHERE chat_id=?',b.chat))if(member.user_id!==user.id)privacy.assertContact(user.id,member.user_id,'messages');
        const newId=id();db.exec('BEGIN');try{
          run('INSERT INTO messages(id,chat_id,user_id,kind,body,media_id,forwarded,created,client_id) VALUES(?,?,?,?,?,?,?,?,?)',newId,b.chat,user.id,m.kind,m.body,m.media_id,m.author || one('SELECT name FROM users WHERE id=?',m.user_id).name,Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',b.chat)?.n||0)+1),clientId);
          if(clientId)run('INSERT INTO message_requests VALUES(?,?,?,?)',user.id,clientId,newId,fingerprint);
          stickers.bind(newId,all('SELECT sticker_id FROM message_stickers WHERE message_id=?',m.id).map(s=>s.sticker_id));db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        broadcast(b.chat,'message',{chat:b.chat,id:newId});return json(message(one('SELECT * FROM messages WHERE id=?',newId),user.id),201);
      } else if(action==='transcribe' && req.method==='POST') {
        if(b.consent!==true||ai.settings(user.id).voice!==true)fail(403,'Разрешите AI доступ к голосовым сообщениям и подтвердите передачу записи');
        if(!['voice','round'].includes(m.kind)||m.deleted) fail(400,'Нет записи для расшифровки');
        if(!process.env.TRANSCRIPTION_KEY || !process.env.TRANSCRIPTION_URL) fail(503,'Администратор ещё не подключил сервис расшифровки');
        rate('transcribe:'+user.id,6,60_000);
        const media=one('SELECT * FROM media WHERE id=?',m.media_id); if(media.size>25*1024*1024) fail(413,'Запись превышает лимит расшифровки 25 МБ');
        const form=new FormData();form.set('file',new Blob([await storage.bytes('media',media.id)],{type:media.type}),media.name);form.set('model',process.env.TRANSCRIPTION_MODEL || 'gpt-4o-transcribe');form.set('language','ru');
        const response=await fetch(process.env.TRANSCRIPTION_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.TRANSCRIPTION_KEY},body:form,signal:AbortSignal.timeout(90_000)});
        if(!response.ok) fail(502,'Сервис расшифровки временно недоступен');
        const result=await response.json(); run('UPDATE messages SET transcript=? WHERE id=?',clean(result.text,30000),m.id);
      } else fail(405,'Метод не поддерживается');
      broadcast(m.chat_id,'message',{chat:m.chat_id,id:m.id}); return json({ok:true});
    }
    if(path==='/api/media' && req.method==='POST') {
      storage.writable();rate('upload:'+user.id,30);
      if(family.child(user.id)&&!JSON.parse(family.child(user.id).rules).media)fail(403,'Вложения отключены родителем');
      const mediaId=id(); const type=clean(req.headers['content-type']||'application/octet-stream',100).split(';')[0];
      const name=clean(decodeURIComponent(req.headers['x-file-name']||'file'),200);
      if(uploadsInFlight>=2)fail(429,'Сервер занят загрузками. Повторите немного позже.');
      const maximum=vip.uploadMB(user.id)*1024*1024;
      if((one('SELECT SUM(size) n FROM media WHERE user_id=?',user.id).n||0)>20*1024*1024*1024)fail(413,'Лимит хранилища аккаунта: 20 ГБ');
      uploadsInFlight++;let file,size=0;const destination=resolve(data,'media',mediaId);
      try{file=await open(destination,'wx');for await(const chunk of req){size+=chunk.length;if(size>maximum)fail(413,'Файл превышает лимит аккаунта');await file.write(chunk);}if(!size)fail(400,'Пустой файл');await file.close();file=null;validateUpload(await storage.bytes('media',mediaId,'bytes=0-31'),type,name);await storage.persist('media',mediaId,user.id,destination,type);run('INSERT INTO media VALUES(?,?,?,?,?,?)',mediaId,user.id,name,type,size,now());}
      catch(error){await file?.close();await unlink(destination).catch(()=>{});throw error;}finally{uploadsInFlight--;}
      await storage.releaseLocal('media',mediaId);return json({id:mediaId,name,type,size},201);
    }
    if(path.startsWith('/api/media/') && req.method==='GET') {
      const mediaId=path.slice('/api/media/'.length);const media=one('SELECT * FROM media WHERE id=?',mediaId);if(!media)fail(404,'Файл не найден');
      const visible=media.user_id===user.id || one("SELECT m.id FROM messages m JOIN members p ON p.chat_id=m.chat_id WHERE m.media_id=? AND m.deleted=0 AND p.user_id=? AND p.role!='banned'",mediaId,user.id) || all('SELECT id FROM users WHERE avatar=?',mediaId).some(u=>privacy.permits(u.id,user.id,'avatar')) || one('SELECT user_id FROM private_profiles WHERE public_avatar=?',mediaId) || one("SELECT c.id FROM chats c JOIN members p ON p.chat_id=c.id WHERE c.avatar=? AND p.user_id=? AND p.role!='banned'",mediaId,user.id);
      const profileVisible=all('SELECT user_id,data FROM profiles').some(p=>{const info=JSON.parse(p.data);if(info.cover!==mediaId&&info.videoAvatar!==mediaId&&info.backgroundImage!==mediaId&&!(info.gallery||[]).includes(mediaId))return false;try{family.contact(user.id,p.user_id);return privacy.permits(p.user_id,user.id,'avatar');}catch{return false;}});
      if(!visible&&!profileVisible&&!stories.mediaVisible(mediaId,user.id))fail(403,'Нет доступа к файлу');
      if(family.child(user.id)&&media.user_id!==user.id&&!JSON.parse(family.child(user.id).rules).media)fail(403,'Медиа ограничены семейными настройками');
      const safe=/^(image\/(png|jpeg|webp|gif)|audio\/(webm|ogg|mpeg|mp4|wav)|video\/(webm|mp4|ogg))$/.test(media.type);
      const mediaPath=resolve(data,'media',mediaId);const byteLength=media.size;
      res.setHeader('Content-Type',safe?media.type:'application/octet-stream');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`${safe?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(media.name)}`);res.setHeader('Accept-Ranges','bytes');
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
      if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):byteLength-1,byteLength-1);if(start>end || start>=byteLength){res.writeHead(416,{'Content-Range':`bytes */${byteLength}`});return res.end();}const stream=await storage.get('media',mediaId,`bytes=${start}-${end}`);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${byteLength}`,'Content-Length':end-start+1});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);}
      const stream=await storage.get('media',mediaId);res.setHeader('Content-Length',byteLength);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    if(path==='/api/calls/active'&&req.method==='GET')return json([...liveCalls.values()].filter(c=>one("SELECT user_id FROM members WHERE chat_id=? AND user_id=? AND role!='banned'",c.chat,user.id)).map(c=>({...c,participants:[...c.participants],state:c.participants.size>1?'active':'ringing'})));
    if(path==='/api/calls' && req.method==='GET') return json(all("SELECT c.*,h.title,h.kind,u.name FROM calls c JOIN members m ON m.chat_id=c.chat_id JOIN chats h ON h.id=c.chat_id JOIN users u ON u.id=c.user_id WHERE m.user_id=? AND m.role!='banned' ORDER BY c.created DESC LIMIT 100",user.id));
    if(path==='/api/calls' && req.method==='POST') {
      const {chat}=membership(b.chat,user.id);family.chatAccess(b.chat,user.id,true);
      if(['channel','saved'].includes(chat.kind))fail(400,'Звонки доступны в личных и групповых чатах');
      const members=all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",b.chat);
      for(const m of members)if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'calls');
      if(members.some(m=>m.user_id!==user.id && one('SELECT * FROM blocks WHERE user_id=? AND target=?',m.user_id,user.id)))fail(403,'Звонок недоступен');
      if([...liveCalls.values()].some(c=>c.chat===b.chat || members.some(m=>c.participants.has(m.user_id))))fail(409,'Участник занят другим звонком');
      const relayOnly=members.some(a=>members.some(b=>a.user_id!==b.user_id&&!privacy.permits(a.user_id,b.user_id,'p2p')));if(relayOnly&&!rtcConfiguration(user.id).relayConfigured&&!managedTurnConfigured())fail(503,'Для приватного звонка требуется настроенный TURN');
      const call={relayOnly,id:id(),chat:b.chat,caller:user.id,name:user.name,video:!!b.video,participants:new Set([user.id]),created:now(),sharing:null};liveCalls.set(call.id,call);
      run('INSERT INTO calls(id,chat_id,user_id,video,created,status) VALUES(?,?,?,?,?,?)',call.id,b.chat,user.id,b.video?1:0,now(),'ringing');
      broadcast(b.chat,'call',{...call,participants:[...call.participants],state:'ringing'});delivery.tick().catch(e=>logFailure('push_worker_failed',e));return json({...call,participants:[...call.participants]});
    }
    if(path==='/api/call-action' && req.method==='POST') {
      const call=liveCalls.get(b.id);if(!call)fail(404,'Звонок завершён');membership(call.chat,user.id);if(!['leave','reject'].includes(b.action))family.chatAccess(call.chat,user.id,true);
      if(b.action==='join') {for(const m of all('SELECT user_id FROM members WHERE chat_id=?',call.chat))if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'calls');if([...liveCalls.values()].some(c=>c.id!==call.id&&c.participants.has(user.id)))fail(409,'Вы уже в другом звонке');if(call.participants.size>=6&&!call.participants.has(user.id))fail(409,'В этом выпуске до 6 участников');call.participants.add(user.id);run("UPDATE calls SET status='active' WHERE id=?",call.id);}
      else if(b.action==='leave') {if(!call.participants.has(user.id))fail(403,'Вы не в звонке');call.participants.delete(user.id);if(call.sharing===user.id)call.sharing=null;if(call.participants.size<2){endCall(call,'ended');return json({ok:true});}}
      else if(b.action==='reject') {if(one('SELECT kind FROM chats WHERE id=?',call.chat).kind==='direct'){endCall(call,'declined');return json({ok:true});}return json({ok:true});}
      else if(b.action==='share') {if(!call.participants.has(user.id))fail(403,'Вы не в звонке');if(b.enabled&&call.sharing&&call.sharing!==user.id)fail(409,'Другой участник уже демонстрирует экран');call.sharing=b.enabled?user.id:null;}
      else if(b.action==='signal') {if(!call.participants.has(user.id)||!call.participants.has(b.target))fail(403,'Нет доступа к медиасигналам');if(!b.signal||typeof b.signal!=='object')fail(400,'Некорректный сигнал');if(JSON.stringify(b.signal).length>60_000)fail(400,'Сигнал слишком большой');if(call.relayOnly){const candidate=b.signal.candidate?.candidate;if(candidate&&!/ typ relay(?: |$)/.test(candidate))fail(403,'Разрешены только TURN-кандидаты');const sdp=b.signal.description?.sdp;if(sdp){if(typeof sdp!=='string')fail(400,'Некорректный SDP');b.signal.description.sdp=sdp.split('\r\n').filter(l=>!l.startsWith('a=candidate:')||/ typ relay(?: |$)/.test(l)).filter(l=>!l.startsWith('a=remote-candidates:')).map(l=>l.startsWith('c=')?'c=IN IP4 0.0.0.0':l.startsWith('o=')?l.replace(/ IN IP[46] .+$/,' IN IP4 0.0.0.0'):l.startsWith('a=rtcp:')?l.replace(/ IN IP[46] .+$/,' IN IP4 0.0.0.0'):l).join('\r\n');}}emit(b.target,'signal',{call:call.id,from:user.id,signal:b.signal});return json({ok:true});}
      else fail(400,'Неизвестное действие');
      broadcast(call.chat,'call',{...call,participants:[...call.participants],state:'active'});return json({ok:true});
    }
    fail(404,'Не найдено');
  } catch(error) { const requestId=!error.status?logFailure('request_failed',error):undefined; if(!res.headersSent) json({error:error.status?error.message:'Не удалось выполнить действие. Попробуйте позже.',...(requestId?{requestId}:{})},error.status||500); else res.end(); }
});
// Each maintenance step is isolated: a transient database error must be logged, never crash the process.
const maintenance=[()=>social.tick(),()=>polls.tick(),()=>{for(const [key,value] of limits)if(value.until<now())limits.delete(key);},()=>{for(const call of liveCalls.values())if(call.participants.size<2 && now()-call.created>45_000)endCall(call,'missed');},()=>run('DELETE FROM sessions WHERE expires<?',now()),()=>{databaseHealth=health(db);}];
setInterval(()=>{for(const step of maintenance)try{step();}catch(error){logFailure('maintenance_failed',error);}},15_000).unref();
const port=Number(process.env.PORT||3000);
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Cipherion: http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`));
function shutdown(){for(const call of liveCalls.values())endCall(call);for(const set of streams.values())for(const res of set)res.end();server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);






