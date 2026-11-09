import {createAccounts} from './accounts.js';
import {createEmailAuth} from './email-auth.js';
import {createStorage,validateUpload} from './storage.js';
import {createCommunities} from './communities.js';
import {health, logFailure, messageFingerprint} from './release.js';
import {backupBeforeMigration, migrate} from './migrations.js';
import {createDelivery} from './delivery.js';
import {createAdmin} from './admin.js';
import {createOfficial,OFFICIAL_NAME} from './official.js';
import {createUpdates} from './updates.js';
import {vipBadgeValue} from '../public/vip-badges.js';
import {createProfiles} from './profiles.js';
import {createPolls} from './polls.js';
import {createStories} from './stories.js';
import {createStickers} from './stickers.js';
import {createChatTools} from './chat-tools.js';
import {createContentProtection,canShare} from './content-protection.js';
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
import { validateWallpaperSettings } from './wallpapers.js';
import { createE2E } from './e2e.js';
import { createHalloween, GHOST_SECONDS } from './halloween.js';
import { createLinkPreview } from './link-preview.js';
import { createChatFeatures } from './chat-features.js';
import { createDeviceLogin } from './device-login.js';
import { createBots } from './bots.js';
import { createCypherLink } from './cypher-link.js';
import { createMessageExtras } from './message-extras.js';
import { createAntispam } from './antispam.js';
import { createSFU, sfuOptions } from './sfu.js';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { open, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database, databaseConfig } from './db.js';
import { createStaticFiles, createAppShell, encodingFor, compress, etagMatches } from './http-cache.js';
import { createTraffic } from './traffic.js';
import { createPacer, throttle } from './pacer.js';
import { compressVideo } from './video-compress.js';
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
// Custom emoji in an encrypted message are declared next to the ciphertext so the server can still authorise their files.
const emojiTokens = keys => (Array.isArray(keys) ? keys.slice(0, 51) : []).map(k => `:ce[${String(k).replace(/[^a-zA-Z0-9-]/g, '')}]`).join(' ');
const publicUser = (u, viewer) => ({...privacy.project(u, viewer, streams.has(u?.id)),...(u&&bots?.isBot(u.id)?{bot:true}:{}),...(u?.id===viewer?{isAdmin:adminAccess.isAdmin(u.id),email:u.email||null,emailVerified:!!u.email_verified,surname:one('SELECT surname FROM profile_details WHERE user_id=?',u.id)?.surname||''}:{})});
const streams = new Map(), liveCalls = new Map(), limits = new Map();
// Uploads are streamed to disk, so several can run at once; a per-user cap keeps one account from taking them all.
let uploadsInFlight=0;const userUploads=new Map();
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
      // Reactions and story links are read once for everyone, not once per member.
      const reactions=social.reactions(row.id),mine=new Map(all('SELECT user_id,emoji FROM reactions WHERE message_id=?',row.id).map(r=>[r.user_id,r.emoji]));
      const story=!!one('SELECT 1 FROM story_replies WHERE message_id=?',row.id),comments=chatFeatures.commentCounts([row.id]).get(row.id)||0;
      for(const m of all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat))
        emit(m.user_id,event,{...payload,clientMessageId:row.client_id,message:message(row,m.user_id,{reactions:()=>reactions,mine:()=>mine.get(m.user_id)||null,story:()=>story,comments:()=>comments})});
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
// Reactions, the viewer's own reaction and story links for a whole page of messages: three queries
// in total instead of three for every message.
function messageExtras(rows, viewer) {
  const ids = [...new Set(rows.filter(r => r && !r.deleted).map(r => r.id))], reactions = new Map(), mine = new Map(), storyLinks = new Set();
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400), marks = part.map(() => '?').join(',');
    for (const r of all(`SELECT message_id,emoji,COUNT(*) count FROM reactions WHERE message_id IN (${marks}) GROUP BY message_id,emoji`, ...part)) { if (!reactions.has(r.message_id)) reactions.set(r.message_id, []); reactions.get(r.message_id).push({ emoji: r.emoji, count: r.count }); }
    for (const r of all(`SELECT message_id,emoji FROM reactions WHERE user_id=? AND message_id IN (${marks})`, viewer, ...part)) mine.set(r.message_id, r.emoji);
    for (const r of all(`SELECT message_id FROM story_replies WHERE message_id IN (${marks})`, ...part)) storyLinks.add(r.message_id);
  }
  const comments = chatFeatures.commentCounts(ids), grants = e2e.grants(viewer, rows.filter(r => r && r.e2e && !r.deleted).map(r => r.id));
  return { reactions: id => reactions.get(id) || [], mine: id => mine.get(id) || null, story: id => storyLinks.has(id), comments: id => comments.get(id) || 0, grant: id => grants.get(id) || null };
}
// A message created a moment ago has no reactions and no story link yet.
const freshMessage = { reactions: () => [], mine: () => null, story: () => false, comments: () => 0, grant: () => null };
function message(row, viewer, extras) {
  row={...row,clientMessageId:row.client_id,serverMessageId:row.id,status:'sent'};
  const author = publicUser(one('SELECT * FROM users WHERE id=?', row.user_id), viewer);
  if (row.deleted) return { id: row.id, chat_id: row.chat_id, user_id: row.user_id, created: row.created, client_id:row.client_id,clientMessageId:row.client_id,serverMessageId:row.id,status:'sent', deleted: true, author };
  const result = { ...row, author, reactions:extras?extras.reactions(row.id):social.reactions(row.id), myReaction:extras?extras.mine(row.id):one('SELECT emoji FROM reactions WHERE message_id=? AND user_id=?',row.id,viewer)?.emoji||null, media: row.media_id ? one('SELECT id,name,type,size FROM media WHERE id=?', row.media_id) : null };
  if(row.markup){try{result.markup=JSON.parse(row.markup);}catch{result.markup=null;}}
  if(row.poll)result.poll=polls.project(row,viewer);
  if(row.kind==='treat')result.game=halloween.project(row)||{};
  if(row.kind==='sticker')result.sticker=stickers.asset(row.body);
  result.story=extras&&!extras.story(row.id)?null:stories.replyPreview(row.id,viewer);
  result.comments=extras?.comments?extras.comments(row.id):chatFeatures.commentCounts([row.id]).get(row.id)||0;
  result.mentioned=!!one('SELECT 1 FROM mentions WHERE message_id=? AND user_id=? AND seen=0',row.id,viewer);
  // A history grant lets this account's other devices open the message after a key transfer.
  if(row.e2e)result.grant=extras?.grant?extras.grant(row.id):e2e.grants(viewer,[row.id]).get(row.id)||null;
  return result;
}
function chatView(c, user) {
  const members = all('SELECT m.*,u.username,u.name,u.avatar FROM members m JOIN users u ON u.id=m.user_id WHERE chat_id=?', c.id);
  const mine = members.find(m => m.user_id === user), cleared = mine?.cleared_at || 0;
  const last = one('SELECT * FROM messages WHERE chat_id=? AND created>? AND deleted=0 ORDER BY created DESC,id DESC LIMIT 1', c.id, cleared);
  return { ...c, invite_key:undefined, canPost:allowed(mine,c,'text'),canEdit:allowed(mine,c,'edit'),canDelete:allowed(mine,c,'delete'),canPin:allowed(mine,c,'pin'),canShare:canShare(c,mine), muted:!!one('SELECT 1 FROM chat_mutes WHERE user_id=? AND chat_id=? AND (until_at=-1 OR until_at>?)',user,c.id,now()), title: c.kind === 'direct' ? members.find(m => m.user_id !== user)?.name || 'Личный чат' : c.kind === 'saved' ? 'Избранное' : c.title, cleared_at: cleared, draft: chatTools.draft(user, c.id),
    members: members.filter(m => m.role !== 'banned').map(m => ({ ...m, ...publicUser(one('SELECT * FROM users WHERE id=?',m.user_id),user), read_at:m.user_id===user||privacy.canRead(m.user_id,c.kind)?m.read_at:0 })),
    last: last ? message(last, user) : null,
    unread: one('SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND user_id!=? AND created>? AND deleted=0', c.id, user, Math.max(mine.read_at, cleared)).n,
    mentions: chatFeatures.mentionCount(c.id, user), slowWait: chatFeatures.slowWait(c, mine, user), staff: ['owner','admin'].includes(mine?.role), hasBot: members.some(m => bots.isBot(m.user_id)), ...antispam.view(c, mine, user) };
}
async function body(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Файл слишком большой'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function endCall(call, status = 'ended') {
  if(call.sfu)sfu.end(call.id);roomSeen.delete(call.id);
  run('UPDATE calls SET ended=?,status=? WHERE id=?', now(), status, call.id);
  // Phones that are still ringing from a push replace it: «Пропущенный звонок», or a silent close
  // on the other devices of people who answered.
  if(!call.room)try{
    const ringing='call:'+call.id,joined=[...(call.joined||[])];
    run('INSERT OR IGNORE INTO notification_events VALUES(?,?,?,?,?,?,?)','call-end:missed:'+call.id,'call-end',call.chat,call.caller,status==='declined'?'Звонок отклонён':'Пропущенный звонок',now(),call.id);
    run('INSERT OR IGNORE INTO notification_events VALUES(?,?,?,?,?,?,?)','call-end:done:'+call.id,'call-end',call.chat,call.caller,'Звонок завершён',now(),call.id);
    for(const r of all('SELECT user_id FROM notification_jobs WHERE message_id=?',ringing))run('INSERT OR IGNORE INTO notification_jobs(user_id,message_id,created) VALUES(?,?,?)',r.user_id,(joined.includes(r.user_id)?'call-end:done:':'call-end:missed:')+call.id,now());
    setImmediate(()=>delivery.tick().catch(e=>logFailure('push_worker_failed',e)));
  }catch(error){logFailure('call_end_push_failed',error);}
  broadcast(call.chat, 'call', { ...call, participants: [...call.participants], state: status });
  liveCalls.delete(call.id);
}
const mime = { '.webp':'image/webp', '.png':'image/png', '.jpeg':'image/jpeg', '.jpg':'image/jpeg', '.gif':'image/gif', '.txt':'text/plain; charset=utf-8', '.xml':'application/xml; charset=utf-8', '.webmanifest':'application/manifest+json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const storage=createStorage({db,one,run,data});
const adminAccess=createAdmin({db,one,run,fail,now,rate});
const traffic=createTraffic({db,run,all,now});
// Background jobs run fast while people use the app and slow down when it is idle (see pacer.js).
const pacer=createPacer();
const privacy=createPrivacy({db,one,all,run,fail,now,id,emit,isOnline:uid=>streams.has(uid),vipInfo:uid=>{const active=vip.active(uid);return {vip:active,vipBadge:active?vipBadgeValue(social.profile(uid).badge):null,verified:official.isVerified(uid),...(official.isBot(uid)?{official:true}:{})};}});
const security=createSecurity({db,one,all,run,fail,now,privacy,rate});
const family=createFamily({db,one,all,run,fail,now,emit});
const vip=createVip({db,one,all,run,fail,now,id,rate,isAdmin:adminAccess.isAdmin});
const stickers=createStickers({beforeSend:(chat,uid)=>antispam.check(chat,one('SELECT * FROM members WHERE chat_id=? AND user_id=?',chat.id,uid),uid,''),sealSticker:(chat,user,raw)=>e2e.accept(chat,user,raw),db,one,all,run,fail,now,id,data,storage,rate,membership,requirePermission,privacy,family,broadcast,isAdmin:adminAccess.isAdmin});
const social=createSocial({db,one,all,run,fail,now,id,membership,requirePermission,family,vip,broadcast,privacy,stickers,emit});
const profiles=createProfiles({db,one,all,run,fail,now,id,rate,privacy,family,vip,emit,social,stickers,isAdmin:adminAccess.isAdmin});
const ai=createAI({db,one,all,run,fail,now,id,rate,membership,family,vip,data,storage});
const polls=createPolls({db,one,all,run,fail,now,id,rate,membership,requirePermission,family,privacy,broadcast,emit});
const stories=createStories({db,one,all,run,fail,now,id,rate,privacy,family,vip,emit,broadcast,data,storage});
const e2e=createE2E({db,one,all,run,fail,now,id,membership,family,isBot:uid=>bots.isBot(uid),unavailableExtra:chat=>antispam.blocksEncryption(chat)});
const halloween=createHalloween({db,one,all,run,fail,now,broadcast,rate});
const chatFeatures=createChatFeatures({db,one,all,run,fail,now,id,clean,membership,requirePermission,family,emit,broadcast,audit,allowed});
const linkPreview=createLinkPreview({db,one,run,fail,now,rate});
const antispam=createAntispam({db,one,all,run,fail,now,emit,broadcast,audit,isBot:uid=>bots.isBot(uid)});
const messageExtras2=createMessageExtras({db,one,all,run,fail,now,privacy,isBot:uid=>bots.isBot(uid)});
pacer.every(5000,60_000,()=>{try{halloween.sweep();chatFeatures.sweep();}catch(error){logFailure('ghost_sweep_failed',error);}});
const delivery=createDelivery({db,one,all,run,fail,now,id,membership,emit,broadcast,family,projectMessage:message,messageExtras});
migrate(db);
const official=createOfficial({db,one,all,run,fail,now,id,broadcast,isAdmin:adminAccess.isAdmin});
const updates=createUpdates({db,one,all,run,now,id,official});
try{updates.publish();}catch(error){logFailure('official_release_failed',error);}
const accounts=createAccounts({one,all,run,now,fail,clean,publicUser,privacy,streams});
const emailAuth=createEmailAuth({db,one,all,run,fail,now,id,rate,accounts,publicUser,security,emit,family});
const recovery=createRecovery({db,one,run,fail,now,rate,accounts,publicUser,security,streams});
const chatTools=createChatTools({db,one,all,run,fail,now,id,clean,membership,family,emit,broadcast,projectMessage:message});
const contentProtection=createContentProtection({db,all,run,fail,membership,audit});
const deviceLogin=createDeviceLogin({db,one,all,run,fail,now,id,rate,accounts,publicUser,privacy,family});
// Messages written by bots go through the same timers, topics and notifications as people's.
function botPost({chat,botId,text,reply,topic,markup=null}){
  const member=one('SELECT * FROM members WHERE chat_id=? AND user_id=?',chat.id,botId);
  if(!allowed(member,chat,'text'))fail(403,'Боту не разрешено писать в этом чате');
  if(reply&&!one('SELECT id FROM messages WHERE id=? AND chat_id=?',reply,chat.id))fail(400,'Ответ недоступен');
  family.content(chat.id,text,false);
  const info=chatFeatures.prepare(chat,member,botId,{topic},text),messageId=id(),created=Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',chat.id)?.n||0)+1);
  run("INSERT INTO messages(id,chat_id,user_id,kind,body,reply_id,created,topic_id,expires_at,markup) VALUES(?,?,?,'text',?,?,?,?,?,?)",messageId,chat.id,botId,text,reply,created,info.topic,info.expires?created+info.expires:null,markup?JSON.stringify(markup):null);
  chatFeatures.deliver(messageId,chat,one('SELECT * FROM users WHERE id=?',botId),info);
  broadcast(chat.id,'message',{chat:chat.id,id:messageId});return one('SELECT * FROM messages WHERE id=?',messageId);
}
const bots=createBots({db,one,all,run,fail,now,id,clean,rate,family,privacy,broadcast,logFailure,post:botPost,
  edit:(m,text,markup)=>{if(text!==undefined){family.content(m.chat_id,text,false);run('UPDATE messages SET body=?,edited=? WHERE id=?',text,now(),m.id);}if(markup!==undefined)run('UPDATE messages SET markup=? WHERE id=?',markup?JSON.stringify(markup):null,m.id);broadcast(m.chat_id,'message',{chat:m.chat_id,id:m.id});},
  remove:m=>{run("UPDATE messages SET deleted=1,body='',transcript=NULL,e2e=NULL WHERE id=?",m.id);broadcast(m.chat_id,'message',{chat:m.chat_id,id:m.id});}});
pacer.every(2000,60_000,()=>bots.tick());
const cypherLink=createCypherLink({db,one,all,run,fail,now,id,clean,rate,family,bots,vip,broadcast});
// Group calls and voice rooms go through the server's SFU when it can be reached (see server/sfu.js).
const sfuEnabled=()=>process.env.SFU_ENABLED==='1'||(process.env.SFU_ENABLED!=='0'&&(!!process.env.SFU_PUBLIC_IP||rtcConfiguration('sfu').relayConfigured||managedTurnConfigured()));
const roomSeen=new Map();
const callView=(call,state)=>({...call,participants:[...call.participants],state:state||(call.room?'room':call.participants.size>1?'active':'ringing')});
const sfu=createSFU({options:sfuOptions(),iceServers:async()=>(await rtcConfigurationAsync('sfu')).iceServers,log:logFailure,
  send:(userId,callId,signal)=>emit(userId,'signal',{call:callId,from:'sfu',signal}),
  onFailed:(callId,userId)=>emit(userId,'signal',{call:callId,from:'sfu',signal:{reconnect:true}})});
const communities=createCommunities({db,one,all,run,fail,now,id,membership,family,chatView,emit,liveCalls,endCall});
let databaseHealth=health(db);
pacer.every(3000,60_000,()=>delivery.tick().catch(e=>logFailure('push_worker_failed',e)));
const staticFiles = createStaticFiles();
const appShell = createAppShell(resolve(root, 'public'), staticFiles);
// The bundle is built at start-up, not on the first visitor's request.
appShell.get().catch(error => logFailure('app_shell_failed', error));
try{const removed=cypherLink.purgeLegacyBots();if(removed)console.log(`Removed ${removed} legacy Cypher remote chats`);}catch(error){logFailure('cypher_purge_failed',error);}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  traffic.track(res, req.url.split('?')[0]);
  {const p=req.url.split('?')[0];if(p!=='/health'&&p!=='/api/events')pacer.nudge();}
  const json = (value, status = 200) => {
    let body = Buffer.from(JSON.stringify(value));const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding' };
    const encoding = body.length > 1024 && encodingFor(req.headers['accept-encoding'], headers['Content-Type']);
    if (encoding) { body = compress(body, encoding, true); headers['Content-Encoding'] = encoding; }
    res.writeHead(status, { ...headers, 'Content-Length': body.length }); res.end(body);
  };
  try {
    const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
    if (path === '/health' && req.method === 'GET') {
      // Liveness must not wait on the remote database: a slow Turso round trip would make
      // Render restart a healthy instance. Database state comes from the background probe.
      const result=databaseHealth;return json({...result.body,notifications:'web-push-v2',pushConfigured:delivery.configured(),mediaConfigured:storage.configured,mediaStorage:storage.mode,emailAuthConfigured:!!emailAuth.ready()},200);
    }
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод не поддерживается');
      if (path === '/' || path === '/index.html') return staticFiles.send(req, res, await appShell.get(), { type: mime['.html'], cacheControl: 'no-cache' });
      // /v/<version>/file is the same file as /file. Only the current version may be cached forever:
      // a request for an older version gets today's file, revalidated as usual.
      const versioned = path.match(/^\/v\/([a-f0-9]{12})(\/.+)$/);
      const filePath = versioned ? versioned[2] : path;
      // The joined bundle.js / bundle.css live in memory. An older version asks for today's bundle,
      // which is complete on its own, revalidated as usual.
      if (versioned && /^\/bundle\.(js|css)$/.test(filePath)) {
        const shell = await appShell.get(), asset = shell.assets.get(filePath.slice(1));
        if (!asset) fail(404, 'Не найдено');
        return staticFiles.send(req, res, asset, { type: mime[extname(filePath)], cacheControl: versioned[1] === shell.version ? 'public, max-age=31536000, immutable' : 'no-cache' });
      }
      const file = resolve(root, 'public', '.' + decodeURIComponent(filePath));
      if (!file.startsWith(resolve(root, 'public') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) fail(404, 'Не найдено');
      // Hashed icons never change; bundled sticker art changes only with a new versioned folder;
      // everything else is revalidated by ETag, which costs a tiny 304 instead of the whole file.
      const cacheControl = versioned ? (versioned[1] === (await appShell.get()).version && /\.(js|css)$/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache') : /^\/brand\/icon-\d+-[a-f0-9]+\.(png|webp)$/.test(filePath) ? 'public, max-age=31536000, immutable' : /^\/stickers(-v\d+)?\//.test(filePath) ? 'public, max-age=604800' : 'no-cache';
      return await staticFiles.serve(req, res, file, { type: mime[extname(file)] || 'application/octet-stream', cacheControl }).catch(error => error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR' ? fail(404, 'Не найдено') : Promise.reject(error));
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
    if(await bots.route({path,req,b,user,json,url}))return;
    if(await deviceLogin.route({path,req,res,b,user,json,url,origin:expectedOrigin}))return;
    if(await cypherLink.route({path,req,b,user,json,url,origin:expectedOrigin}))return;
    if (path === '/api/auth' && req.method === 'POST') {
      if(b.register&&emailAuth.ready())fail(410,'Создайте аккаунт через подтверждение email');
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
      if(!b.register){try{security.verify(account.id,b.code);}catch(e){e.need='secondFactor';throw e;}}
      accounts.create(req,res,account);
      return json({ user: publicUser(account,account.id), settings: JSON.parse(account.settings), familyCode, ...(b.register?{recoveryKey:recovery.issue(account.id)}:{}) });
    }
    if (!user) fail(401, 'Войдите в аккаунт');
    if (path === '/api/me' && req.method === 'GET') { official.ensure(user.id); return json({ user: {...publicUser(user,user.id),vip:vip.active(user.id)}, settings: JSON.parse(user.settings), family:family.info(user.id), rtcDebug:process.env.NODE_ENV==='development', transcription: !!process.env.TRANSCRIPTION_KEY, halloween:{active:halloween.season(),ghostSeconds:GHOST_SECONDS}, ...await rtcConfigurationAsync(user.id) }); }
    if(await communities.route({path,req,b,user,json}))return;
    if(await family.route({path,req,b,user,json}))return;
    // A child may finish the profile and manage parent linking before a parent is attached.
    const setup=['/api/profile/details','/api/vip'].includes(path)||path==='/api/media'&&req.method==='POST'||path.startsWith('/api/family');
    if(!setup&&!['/api/me','/api/logout','/api/sessions','/api/events'].includes(path)&&!(path==='/api/call-action'&&['leave','reject'].includes(b.action)))family.assertUse(user.id);
    if(await delivery.route({path,req,b,user,json,url}))return;
    if(path==='/api/rtc-config'&&req.method==='GET')return json(await rtcConfigurationAsync(user.id));
    if(path==='/api/activity'&&req.method==='POST')return json({ok:true});
    if(await privacy.route({path,req,b,user,json}))return;
    if(await security.route({path,req,b,user,json}))return;
    if(path==='/api/stories/event'&&req.method==='GET')return json(updates.currentEvent());
    if(await stories.route({path,req,b,user,json,url}))return;
    if(await polls.route({path,req,b,user,json,url}))return;
    if(await adminAccess.route({path,req,b,user,json}))return;
    if(await official.route({path,req,b,user,json}))return;
    if(path==='/api/admin/traffic'&&req.method==='GET'){if(!adminAccess.isAdmin(user.id))fail(403,'Только администратор');return json(traffic.report());}
    if(await vip.route({path,req,b,user,json}))return;
    if(await stickers.route({path,req,res,b,user,json,url}))return;
    if(await profiles.route({path,req,b,user,json,url}))return;
    if(await social.route({path,req,b,user,json,url}))return;
    if(await ai.route({path,req,res,b,user,json}))return;
    if(await e2e.route({path,req,b,user,url,json}))return;
    if(await linkPreview.route({path,req,res,user,url,json}))return;
    if(await chatFeatures.route({path,req,b,user,json}))return;
    if(await antispam.route({path,req,b,user,json,membership,requirePermission}))return;
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
      if(Array.isArray(settings.folders)&&settings.folders.some(f=>!f||typeof f!=='object'||Array.isArray(f)||typeof f.title!=='string'||f.title.length>24||typeof f.id!=='string'||f.id.length>20||(f.chats!==undefined&&(!Array.isArray(f.chats)||f.chats.length>500))||(f.exclude!==undefined&&(!Array.isArray(f.exclude)||f.exclude.length>500))||(f.types!==undefined&&(!Array.isArray(f.types)||f.types.some(t=>!['direct','group','channel','bot'].includes(t))))))fail(400,'Некорректная папка');
            if(settings.pins!==undefined&&(!Array.isArray(settings.pins)||settings.pins.length>Math.max(vip.active(user.id)?20:5,JSON.parse(user.settings).pins?.length||0)))fail(400,'Превышен лимит закреплённых чатов');
      const oldSettings=JSON.parse(user.settings);const wallpaperError=validateWallpaperSettings(settings,oldSettings);if(wallpaperError)fail(400,wallpaperError);if(settings.theme!==oldSettings.theme&&['Emerald VIP','Diamond Glass','Golden Glass','Aurora VIP','Cosmic'].includes(settings.theme)&&!vip.active(user.id))fail(403,'Эта тема доступна с VIP');for(const k of ['vipGlow','vipBadge','presets'])if(JSON.stringify(settings[k])!==JSON.stringify(oldSettings[k])&&settings[k]&&!vip.active(user.id))fail(403,'Требуется VIP');
      if (b.name !== undefined && clean(b.name, 80).toLowerCase() === OFFICIAL_NAME.toLowerCase() && !official.isBot(user.id)) fail(400, 'Это имя зарезервировано для официального аккаунта');
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
      // A phone that was frozen in the background reconnects while its old stream still looks open
      // here. The newest connection is the live one, so the oldest makes room instead of refusing it.
      const open = streams.get(user.id);
      while (open.size >= 6) { const oldest = open.values().next().value; open.delete(oldest); try { oldest.end(); } catch {} }
      res.sessionId = user.session.id; open.add(res); res.write('retry: 1000\nevent: ready\ndata: {}\n\n');
      const heartbeat = setInterval(() => {
        try { if (!one('SELECT id FROM sessions WHERE id=? AND expires>?', user.session.id, now())) { res.end(); return; } }
        catch (error) { logFailure('stream_heartbeat_failed', error); }
        res.write(': heartbeat\n\n');
      }, 20_000);
      req.on('close', () => { clearInterval(heartbeat); try { run('UPDATE sessions SET active=? WHERE id=?', now(), user.session.id); } catch (error) { logFailure('stream_close_failed', error); } streams.get(user.id)?.delete(res); if (!streams.get(user.id)?.size) streams.delete(user.id); });
      return;
    }
    if(contentProtection.route({path,req,b,user,json}))return;
    if(await chatTools.route({path,req,b,user,json,url}))return;
    if (path === '/api/chats' && req.method === 'GET') { official.ensure(user.id); // ?chat=<id> returns just that chat (or nothing), so a new message refreshes one row, not the whole list.
      const only = url.searchParams.get('chat');
      return json(all("SELECT c.*,m.hidden AS member_hidden,m.cleared_at AS member_cleared FROM chats c JOIN members m ON c.id=m.chat_id WHERE m.user_id=? AND m.role!='banned'" + (only ? ' AND c.id=?' : ''), ...(only ? [user.id, only] : [user.id])).filter(c => chatTools.visible(c.id, {hidden:c.member_hidden, cleared_at:c.member_cleared})).map(({member_hidden, member_cleared, ...c}) => chatView(c, user.id)).sort((a,b) => (b.last?.created || b.created) - (a.last?.created || a.created))); }
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
      if (kind === 'direct' && users.some(official.isBot)) return json(chatView(one('SELECT * FROM chats WHERE id=?', official.ensure(user.id)), user.id));
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
        const [topicSql,topicParams]=chatFeatures.topicFilter(chat,url.searchParams.get('topic'));
        const rows = (beforeId===null
          ? all('SELECT * FROM messages WHERE chat_id=? AND created>? AND created<?'+topicSql+' ORDER BY created DESC,id DESC LIMIT 60',chatId,member.cleared_at||0,before,...topicParams)
          : all('SELECT * FROM messages WHERE chat_id=? AND created>? AND (created<? OR (created=? AND id<?))'+topicSql+' ORDER BY created DESC,id DESC LIMIT 60',chatId,member.cleared_at||0,before,before,beforeId,...topicParams)).reverse();
        const extras = messageExtras(rows, user.id);
        return json(rows.map(m => message(m, user.id, extras)));
      }
      if (action === 'messages' && req.method === 'POST') {
        const clientId=(b.clientMessageId??b.clientId)==null?null:String(b.clientMessageId??b.clientId);if(b.clientMessageId&&b.clientId&&b.clientMessageId!==b.clientId)fail(400,'ID сообщения не совпадают');if(clientId!==null&&!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId))fail(400,'Некорректный ID сообщения');
        if(clientId){const existing=one('SELECT * FROM messages WHERE user_id=? AND client_id=?',user.id,clientId);if(existing){const request=one('SELECT fingerprint FROM message_requests WHERE user_id=? AND client_id=?',user.id,clientId);if(existing.chat_id!==chatId || request&&request.fingerprint!==messageFingerprint(chatId,b))fail(409,'ID сообщения уже использован для другого запроса');return json(message(existing,user.id));}}
        rate('message:' + user.id, 90); const sealed=b.e2e===undefined||b.e2e===null?null:e2e.accept(chat,user.id,b.e2e); if(sealed){if(b.kind==='treat')fail(400,'Игра не шифруется');b.body='';} const quoteWave=messageExtras2.accept(b,chatId,!!sealed); family.content(chatId,clean(b.body)+' '+JSON.stringify(b.poll||{}),!!b.media);
        const kind = ['text','photo','video','file','voice','round','poll','treat','location'].includes(b.kind) ? b.kind : 'text';
        if (official.isOfficialChat(chatId) && !official.isBot(user.id)) fail(403, 'Это официальный чат уведомлений Cipherion');
        requirePermission(chatId, user.id, ['treat','location'].includes(kind)?'text':kind);const features=chatFeatures.prepare(chat,member,user.id,b,sealed?'':clean(b.body));
        antispam.check(chat,member,user.id,sealed?'':clean(b.body));
        const ghost=halloween.ghostFlag(chat,user.id,b,kind);
        if(kind==='treat'&&['channel','saved'].includes(chat.kind))fail(400,'Игра доступна в личных чатах и группах');
        if (chat.kind === 'direct') for (const m of all('SELECT user_id FROM members WHERE chat_id=?', chatId)) if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'messages');
        let media = null, poll = null;
        if (b.media) { media = one('SELECT * FROM media WHERE id=? AND user_id=?', b.media, user.id); if (!media) fail(400, 'Нет доступа к файлу'); }
        // An attachment encrypted on the device is opaque here; its real type travels inside the sealed text.
        const sealedMedia=media?.type==='application/x-cipherion-sealed';if(sealedMedia&&!sealed)fail(400,'Зашифрованное вложение требует зашифрованного сообщения');
        let liveUntil=null;
        if(kind==='location'){
          if(!sealed){let point;try{point=JSON.parse(String(b.body||''));}catch{point=null;}if(!point||!(Math.abs(point.lat)<=90)||!(Math.abs(point.lng)<=180))fail(400,'Некорректная геопозиция');b.body=JSON.stringify({lat:+Number(point.lat).toFixed(6),lng:+Number(point.lng).toFixed(6),acc:Math.min(100000,Math.max(0,Math.round(Number(point.acc)||0)))});}
          const live=Number(b.live||0);if(live){if(![900,3600,28800].includes(live))fail(400,'Выберите срок трансляции');liveUntil=now()+live*1000;}
        }
        if (['photo','video','file','voice','round'].includes(kind) && !media) fail(400, 'Добавьте файл');
        if (kind === 'photo' && !sealedMedia && !media.type.startsWith('image/')) fail(400, 'Ожидается изображение');
        if (['video','round'].includes(kind) && !sealedMedia && !media.type.startsWith('video/')) fail(400, 'Ожидается видео');
        if (kind === 'voice' && !sealedMedia && !media.type.startsWith('audio/')) fail(400, 'Ожидается аудио');
        if (kind === 'poll') {
          const options = Array.isArray(b.poll?.options) ? b.poll.options.map(o => clean(o, 150)).filter(Boolean) : [];
          if (!b.poll?.checklist && (options.length < 2 || options.length > 20 || (!clean(b.body)&&!sealed))) fail(400, 'Нужны вопрос и от 2 до 20 вариантов');
          if (b.poll?.checklist && !clean(b.body) && !sealed) fail(400, 'Введите название чек-листа');
          // In an encrypted chat the question and options are inside the ciphertext; the server keeps numbered placeholders.
          poll = polls.normalize(sealed?{...b.poll,description:'',explanation:'',options:options.map((_,i)=>String(i+1))}:b.poll,chatId);if(sealed)poll.sealed=true;
        }
        if (!clean(b.body) && !media && !poll && !sealed && kind!=='treat') fail(400, 'Пустое сообщение');
        if (b.reply && !one('SELECT id FROM messages WHERE id=? AND chat_id=?', b.reply, chatId)) fail(400, 'Ответ недоступен');
        const emojiKeys=stickers.tokens(sealed?emojiTokens(b.emoji):clean(b.body),user.id);if(emojiKeys.length)family.content(chatId,'',true);
        const messageId = id();
        const created=Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',chatId)?.n||0)+1);
        db.exec('BEGIN');try{run('INSERT INTO messages(id,chat_id,user_id,kind,body,media_id,reply_id,poll,created,client_id,e2e,ghost,game,topic_id,expires_at,live_until,quote,wave) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', messageId, chatId, user.id, kind, kind==='treat'?'':clean(b.body), media?.id || null, b.reply || null, poll ? JSON.stringify(poll) : null, created,clientId,sealed,ghost,kind==='treat'?'{}':null,features.topic,features.expires?created+features.expires:null,liveUntil,quoteWave.quote,quoteWave.wave);
        if(clientId)run('INSERT INTO message_requests VALUES(?,?,?,?)',user.id,clientId,messageId,messageFingerprint(chatId,b));
        stickers.bind(messageId,emojiKeys);run('DELETE FROM drafts WHERE user_id=? AND chat_id=?',user.id,chatId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}chatFeatures.deliver(messageId,chat,user,features);bots.notify(one('SELECT * FROM messages WHERE id=?',messageId));broadcast(chatId, 'message', { chat: chatId, id: messageId });
        // The sent text is no longer a draft: other devices clear their composer without a separate request.
        emit(user.id,'draft',{chat:chatId,body:'',updated:now()}); return json(message(one('SELECT * FROM messages WHERE id=?', messageId), user.id, freshMessage), 201);
      }
      if (action === 'read' && req.method === 'POST') { const last = b.message ? one('SELECT created n FROM messages WHERE id=? AND chat_id=?',String(b.message),chatId)?.n : one('SELECT MAX(created) AS n FROM messages WHERE chat_id=?', chatId).n || 0;if(last===undefined)fail(400,'Сообщение не найдено'); run('UPDATE members SET read_at=MAX(read_at,?),delivered_at=MAX(delivered_at,?) WHERE chat_id=? AND user_id=?', last, last, chatId, user.id);messageExtras2.logRead(chatId,user.id,last,member.read_at||0);halloween.read(chatId,user.id,last);emit(user.id,'receipt',{chat:chatId,user:user.id,read:last,delivered:last}); if(privacy.canRead(user.id,chat.kind))broadcast(chatId, 'receipt', { chat: chatId, user: user.id, read: last, delivered: last }); return json({ ok: true }); }
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
            for (const call of liveCalls.values()) if(call.chat===chatId && call.participants.has(b.user)) { call.participants.delete(b.user); if(call.sfu)sfu.leave(call.id,b.user); broadcast(chatId,'call',{...call,participants:[...call.participants],state:'active'}); emit(b.user,'call',{id:call.id,state:'removed'}); }
          } else fail(400,'Неизвестное действие');
        }
        audit(chatId,user.id,b.action,b.user); return json({ok:true});
      }
    }
    const msgMatch = /^\/api\/messages\/([^/]+)(?:\/(vote|forward|transcribe|treat|callback|readers))?$/.exec(path);
    if (msgMatch) {
      const m = one('SELECT * FROM messages WHERE id=?',msgMatch[1]); if(!m) fail(404,'Сообщение не найдено');
      const {chat:source,member:sourceMember}=membership(m.chat_id,user.id); family.chatAccess(m.chat_id,user.id); const action = msgMatch[2];
      if (!action && req.method === 'GET') return json(message(m,user.id));
      if (action==='readers' && req.method==='GET') return json(messageExtras2.readers(m,user.id));
      if (!action && req.method === 'DELETE') { if(m.user_id!==user.id||one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind==='channel') requirePermission(m.chat_id,user.id,'delete'); run('UPDATE messages SET deleted=1,body=\'\',transcript=NULL,e2e=NULL WHERE id=?',m.id); }
      else if (!action && req.method === 'PATCH') {
        if (m.kind==='location') {
          if(m.user_id!==user.id||m.deleted)fail(403,'Геопозицию меняет только автор');
          if(b.stop){run('UPDATE messages SET live_until=? WHERE id=? AND live_until>?',now(),m.id,now());}
          else{
            if(!m.live_until||m.live_until<=now())fail(400,'Трансляция геопозиции завершена');
            const sealedUpdate=b.e2e==null?null:e2e.accept(one('SELECT * FROM chats WHERE id=?',m.chat_id),user.id,b.e2e);if(m.e2e&&!sealedUpdate)fail(400,'Геопозиция зашифрована');
            let body='';if(!sealedUpdate){let point;try{point=JSON.parse(String(b.body||''));}catch{point=null;}if(!point||!(Math.abs(point.lat)<=90)||!(Math.abs(point.lng)<=180))fail(400,'Некорректная геопозиция');body=JSON.stringify({lat:+Number(point.lat).toFixed(6),lng:+Number(point.lng).toFixed(6),acc:Math.min(100000,Math.max(0,Math.round(Number(point.acc)||0)))});}
            rate('live-location:'+user.id,20);run('UPDATE messages SET body=?,e2e=?,edited=? WHERE id=?',body,sealedUpdate,now(),m.id);
          }
        }
        else if (b.pinned !== undefined) { requirePermission(m.chat_id,user.id,'pin'); run('UPDATE messages SET pinned=? WHERE id=?',b.pinned?1:0,m.id); audit(m.chat_id,user.id,'pin',m.id); }
        else { if(one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind==='channel')requirePermission(m.chat_id,user.id,'edit'); if((m.user_id!==user.id && one('SELECT kind FROM chats WHERE id=?',m.chat_id).kind!=='channel') || m.deleted || ['poll','sticker','treat'].includes(m.kind)) fail(403,'Редактирование недоступно'); const sealed=b.e2e===undefined||b.e2e===null?null:e2e.accept(one('SELECT * FROM chats WHERE id=?',m.chat_id),user.id,b.e2e); if(m.e2e&&!sealed)fail(400,'Сообщение зашифровано: обновите приложение, чтобы его изменить'); if(sealed)b.body=''; if(!clean(b.body)&&!sealed) fail(400,'Пустое сообщение'); family.content(m.chat_id,clean(b.body),false);const keys=stickers.tokens(sealed?emojiTokens(b.emoji):clean(b.body),user.id);if(keys.length)family.content(m.chat_id,'',true);stickers.bind(m.id,keys); run('UPDATE messages SET body=?,e2e=?,edited=? WHERE id=?',clean(b.body),sealed,now(),m.id); }
      } else if (action==='callback' && req.method==='POST') {
        if(typeof b.data!=='string')fail(400,'Нет данных кнопки');return json(await bots.press(m,user,b.data));
      } else if (action==='treat' && req.method==='POST') {
        requirePermission(m.chat_id,user.id,'text');halloween.play(m,user,b.choice);
      } else if (action==='vote' && req.method==='POST') {
        if(!m.poll||m.deleted)fail(400,'Опрос недоступен');polls.vote(m,user.id,b.choices);
      } else if(action==='forward' && req.method==='POST') {
        if(!canShare(source,sourceMember))fail(403,'В этом чате включена защита контента: пересылка запрещена');        if(m.ghost)fail(403,'Призрачные сообщения нельзя пересылать');if(m.kind==='treat')fail(400,'Игру нельзя переслать');
        membership(b.chat,user.id);family.chatAccess(b.chat,user.id);
        const clientId=(b.clientMessageId??b.clientId)==null?null:String(b.clientMessageId??b.clientId);
        if(clientId!==null&&!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId))fail(400,'Некорректный ID сообщения');
        const fingerprint=messageFingerprint(b.chat,{body:m.id,kind:'forward',e2e:b.e2e??undefined});
        if(clientId){const existing=one('SELECT * FROM messages WHERE user_id=? AND client_id=?',user.id,clientId);if(existing){const request=one('SELECT fingerprint FROM message_requests WHERE user_id=? AND client_id=?',user.id,clientId);if(existing.chat_id!==b.chat||request?.fingerprint!==fingerprint)fail(409,'ID сообщения уже использован');return json(message(existing,user.id));}}
        if(m.deleted || m.kind==='poll') fail(400,'Пересылка недоступна');
        const {chat:destination,member:destinationMember}=requirePermission(b.chat,user.id,m.kind==='sticker'?'photo':['location','treat'].includes(m.kind)?'text':m.kind);const forwardInfo=chatFeatures.prepare(destination,destinationMember,user.id,{topic:b.topic},'');
        if(m.media_id&&one('SELECT type FROM media WHERE id=?',m.media_id)?.type==='application/x-cipherion-sealed'&&b.e2e==null)fail(400,'Зашифрованное вложение можно переслать только в зашифрованный чат');
        // An encrypted original is unreadable here: the client re-encrypts it for the destination, or sends the text it decrypted.
        if(b.e2e!=null&&m.kind==='sticker')fail(400,'Стикеры не шифруются');const sealed=b.e2e==null?null:e2e.accept(destination,user.id,b.e2e),forwardBody=sealed?'':m.e2e?clean(b.body):m.body;if(m.e2e&&!sealed&&!forwardBody&&!m.media_id)fail(400,'Это зашифрованное сообщение недоступно на вашем устройстве');antispam.check(destination,destinationMember,user.id,forwardBody);
        family.content(b.chat,forwardBody,!!m.media_id||m.kind==='sticker'||!!one('SELECT sticker_id FROM message_stickers WHERE message_id=?',m.id));
        if(destination.kind==='direct')for(const member of all('SELECT user_id FROM members WHERE chat_id=?',b.chat))if(member.user_id!==user.id)privacy.assertContact(user.id,member.user_id,'messages');
        const newId=id();db.exec('BEGIN');try{
          const forwardCreated=Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',b.chat)?.n||0)+1);run('INSERT INTO messages(id,chat_id,user_id,kind,body,media_id,forwarded,created,client_id,e2e,topic_id,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',newId,b.chat,user.id,m.kind,forwardBody,m.media_id,m.author || one('SELECT name FROM users WHERE id=?',m.user_id).name,forwardCreated,clientId,sealed,forwardInfo.topic,forwardInfo.expires?forwardCreated+forwardInfo.expires:null);
          if(clientId)run('INSERT INTO message_requests VALUES(?,?,?,?)',user.id,clientId,newId,fingerprint);
          stickers.bind(newId,all('SELECT sticker_id FROM message_stickers WHERE message_id=?',m.id).map(s=>s.sticker_id));db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        bots.notify(one('SELECT * FROM messages WHERE id=?',newId));broadcast(b.chat,'message',{chat:b.chat,id:newId});return json(message(one('SELECT * FROM messages WHERE id=?',newId),user.id,freshMessage),201);
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
      storage.writable();rate('upload:'+user.id,60);
      if(family.child(user.id)&&!JSON.parse(family.child(user.id).rules).media)fail(403,'Вложения отключены родителем');
      const mediaId=id(); let type=clean(req.headers['content-type']||'application/octet-stream',100).split(';')[0];
      let name=clean(decodeURIComponent(req.headers['x-file-name']||'file'),200);
      if(uploadsInFlight>=16||(userUploads.get(user.id)||0)>=4)fail(429,'Сервер занят загрузками. Повторите немного позже.');
      const maximum=vip.uploadMB(user.id)*1024*1024;
      if((one('SELECT SUM(size) n FROM media WHERE user_id=?',user.id).n||0)>20*1024*1024*1024)fail(413,'Лимит хранилища аккаунта: 20 ГБ');
      uploadsInFlight++;userUploads.set(user.id,(userUploads.get(user.id)||0)+1);let file,size=0;const destination=resolve(data,'media',mediaId);
      try{file=await open(destination,'wx');for await(const chunk of req){size+=chunk.length;if(size>maximum)fail(413,'Файл превышает лимит аккаунта');await file.write(chunk);}if(!size)fail(400,'Пустой файл');await file.close();file=null;validateUpload(await storage.bytes('media',mediaId,'bytes=0-31'),type,name);
        // Videos are re-encoded once here so every later download is several times smaller.
        if(type.startsWith('video/')){const packed=await compressVideo(destination);if(packed){size=packed.size;type=packed.type;name=name.replace(/\.[^.]*$/,'')+'.mp4';}}
        await storage.persist('media',mediaId,user.id,destination,type);run('INSERT INTO media VALUES(?,?,?,?,?,?)',mediaId,user.id,name,type,size,now());}
      catch(error){await file?.close();await unlink(destination).catch(()=>{});throw error;}finally{uploadsInFlight--;const left=(userUploads.get(user.id)||1)-1;if(left)userUploads.set(user.id,left);else userUploads.delete(user.id);}
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
      // Media bytes never change for an id: devices keep a private copy for a day, then a 304 re-checks access.
      const etag=`"m-${mediaId}"`;res.setHeader('ETag',etag);res.setHeader('Cache-Control','private, max-age=86400');
      if(etagMatches(req.headers['if-none-match'],etag)){res.writeHead(304);return res.end();}
      res.setHeader('Content-Type',safe?media.type:'application/octet-stream');res.setHeader('Content-Disposition',`${safe?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(media.name)}`);res.setHeader('Accept-Ranges','bytes');
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
      if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):byteLength-1,byteLength-1);if(start>end || start>=byteLength){res.writeHead(416,{'Content-Range':`bytes */${byteLength}`});return res.end();}const stream=await storage.get('media',mediaId,`bytes=${start}-${end}`);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${byteLength}`,'Content-Length':end-start+1});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);}
      const stream=await storage.get('media',mediaId);res.setHeader('Content-Length',byteLength);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    if(path==='/api/calls/active'&&req.method==='GET')return json([...liveCalls.values()].filter(c=>one("SELECT user_id FROM members WHERE chat_id=? AND user_id=? AND role!='banned'",c.chat,user.id)).map(c=>callView(c)));
    if(path==='/api/calls' && req.method==='GET') return json(all("SELECT c.*,h.title,h.kind,u.name FROM calls c JOIN members m ON m.chat_id=c.chat_id JOIN chats h ON h.id=c.chat_id JOIN users u ON u.id=c.user_id WHERE m.user_id=? AND m.role!='banned' ORDER BY c.created DESC LIMIT 100",user.id));
    if(path==='/api/calls' && req.method==='POST') {
      const {chat}=membership(b.chat,user.id);family.chatAccess(b.chat,user.id,true);
      if(['channel','saved'].includes(chat.kind))fail(400,'Звонки доступны в личных и групповых чатах');
      if(official.isOfficialChat(b.chat))fail(400,'Официальному аккаунту нельзя позвонить');
      const members=all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",b.chat);
      for(const m of members)if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'calls');
      if(members.some(m=>m.user_id!==user.id && one('SELECT * FROM blocks WHERE user_id=? AND target=?',m.user_id,user.id)))fail(403,'Звонок недоступен');
      // A voice room stays open: people join and leave whenever they like, nobody is called.
      if(b.room){
        if(chat.kind!=='group')fail(400,'Голосовые комнаты есть только в группах');
        const existing=[...liveCalls.values()].find(c=>c.chat===b.chat);
        if(existing){if(!existing.room)fail(409,'В группе уже идёт звонок');return json(callView(existing));}
        if([...liveCalls.values()].some(c=>c.participants.has(user.id)))fail(409,'Вы уже в другом звонке');
        const room={relayOnly:false,room:true,sfu:sfuEnabled(),id:id(),chat:b.chat,caller:user.id,name:user.name,video:false,participants:new Set(),created:now(),sharing:null};
        liveCalls.set(room.id,room);run('INSERT INTO calls(id,chat_id,user_id,video,created,status) VALUES(?,?,?,?,?,?)',room.id,b.chat,user.id,0,now(),'room');
        broadcast(b.chat,'call',callView(room));return json(callView(room));
      }
      if([...liveCalls.values()].some(c=>c.chat===b.chat || members.some(m=>c.participants.has(m.user_id))))fail(409,'Участник занят другим звонком');
      const relayOnly=members.some(a=>members.some(b=>a.user_id!==b.user_id&&!privacy.permits(a.user_id,b.user_id,'p2p')));if(relayOnly&&!rtcConfiguration(user.id).relayConfigured&&!managedTurnConfigured())fail(503,'Для приватного звонка требуется настроенный TURN');
      const call={relayOnly,sfu:chat.kind==='group'&&sfuEnabled(),id:id(),chat:b.chat,caller:user.id,name:user.name,video:!!b.video,participants:new Set([user.id]),created:now(),sharing:null};liveCalls.set(call.id,call);
      run('INSERT INTO calls(id,chat_id,user_id,video,created,status) VALUES(?,?,?,?,?,?)',call.id,b.chat,user.id,b.video?1:0,now(),'ringing');
      broadcast(b.chat,'call',{...call,participants:[...call.participants],state:'ringing'});delivery.tick().catch(e=>logFailure('push_worker_failed',e));return json({...call,participants:[...call.participants]});
    }
    if(path==='/api/call-action' && req.method==='POST') {
      const call=liveCalls.get(b.id);if(!call)fail(404,'Звонок завершён');membership(call.chat,user.id);if(!['leave','reject'].includes(b.action))family.chatAccess(call.chat,user.id,true);
      if(b.action==='join') {for(const m of all('SELECT user_id FROM members WHERE chat_id=?',call.chat))if(m.user_id!==user.id)privacy.assertContact(user.id,m.user_id,'calls');if([...liveCalls.values()].some(c=>c.id!==call.id&&c.participants.has(user.id)))fail(409,'Вы уже в другом звонке');const limit=call.sfu?sfu.maxParticipants:6;if(call.participants.size>=limit&&!call.participants.has(user.id))fail(409,call.sfu?`В звонке уже ${limit} участников`:'Без сервера звонков (SFU) в звонке до 6 участников');call.participants.add(user.id);(call.joined||=new Set()).add(user.id);if(call.room){if(!roomSeen.has(call.id))roomSeen.set(call.id,new Map());roomSeen.get(call.id).set(user.id,now());}else run("UPDATE calls SET status='active' WHERE id=?",call.id);}
      else if(b.action==='ping') {if(!call.participants.has(user.id))fail(403,'Вы не в звонке');roomSeen.get(call.id)?.set(user.id,now());return json({ok:true});}
      else if(b.action==='leave') {if(!call.participants.has(user.id))fail(403,'Вы не в звонке');call.participants.delete(user.id);roomSeen.get(call.id)?.delete(user.id);if(call.sfu)sfu.leave(call.id,user.id);if(call.sharing===user.id)call.sharing=null;if(call.room?call.participants.size===0:call.participants.size<2){endCall(call,'ended');return json({ok:true});}}
      else if(b.action==='reject') {if(one('SELECT kind FROM chats WHERE id=?',call.chat).kind==='direct'){endCall(call,'declined');return json({ok:true});}return json({ok:true});}
      else if(b.action==='share') {if(!call.participants.has(user.id))fail(403,'Вы не в звонке');if(b.enabled&&call.sharing&&call.sharing!==user.id)fail(409,'Другой участник уже демонстрирует экран');call.sharing=b.enabled?user.id:null;}
      else if(b.action==='signal'&&b.target==='sfu') {if(!call.sfu||!call.participants.has(user.id))fail(403,'Нет доступа к серверу звонка');if(!b.signal||typeof b.signal!=='object'||JSON.stringify(b.signal).length>60_000)fail(400,'Некорректный сигнал');await sfu.signal(call.id,user.id,b.signal);roomSeen.get(call.id)?.set(user.id,now());return json({ok:true});}
      else if(b.action==='signal') {if(!call.participants.has(user.id)||!call.participants.has(b.target))fail(403,'Нет доступа к медиасигналам');if(!b.signal||typeof b.signal!=='object')fail(400,'Некорректный сигнал');if(JSON.stringify(b.signal).length>60_000)fail(400,'Сигнал слишком большой');if(call.relayOnly){const candidate=b.signal.candidate?.candidate;if(candidate&&!/ typ relay(?: |$)/.test(candidate))fail(403,'Разрешены только TURN-кандидаты');const sdp=b.signal.description?.sdp;if(sdp){if(typeof sdp!=='string')fail(400,'Некорректный SDP');b.signal.description.sdp=sdp.split('\r\n').filter(l=>!l.startsWith('a=candidate:')||/ typ relay(?: |$)/.test(l)).filter(l=>!l.startsWith('a=remote-candidates:')).map(l=>l.startsWith('c=')?'c=IN IP4 0.0.0.0':l.startsWith('o=')?l.replace(/ IN IP[46] .+$/,' IN IP4 0.0.0.0'):l.startsWith('a=rtcp:')?l.replace(/ IN IP[46] .+$/,' IN IP4 0.0.0.0'):l).join('\r\n');}}emit(b.target,'signal',{call:call.id,from:user.id,signal:b.signal});return json({ok:true});}
      else fail(400,'Неизвестное действие');
      broadcast(call.chat,'call',callView(call,call.room?'room':'active'));return json({ok:true});
    }
    fail(404,'Не найдено');
  } catch(error) { const requestId=!error.status?logFailure('request_failed',error):undefined; if(!res.headersSent) json({error:error.status?error.message:'Не удалось выполнить действие. Попробуйте позже.',...(error.status&&error.need?{need:error.need}:{}),...(error.status&&error.retryAfter?{retryAfter:error.retryAfter}:{}),...(requestId?{requestId}:{})},error.status||500); else res.end(); }
});
// Each maintenance step is isolated: a transient database error must be logged, never crash the process.
const rareCleanup=throttle(600_000,()=>{run('DELETE FROM sessions WHERE expires<?',now());messageExtras2.sweep();});
const databaseMaintenance=[()=>traffic.flush(),()=>social.tick(),()=>polls.tick(),()=>rareCleanup(),()=>{databaseHealth=health(db);}];
const maintenance=[()=>{for(const [key,value] of limits)if(value.until<now())limits.delete(key);},()=>{for(const call of liveCalls.values()){
  // A voice room forgets people whose app stopped answering, and closes when empty.
  if(call.room){const seen=roomSeen.get(call.id)||new Map();let changed=false;for(const uid of [...call.participants])if((seen.get(uid)||0)<now()-50_000){call.participants.delete(uid);seen.delete(uid);if(call.sfu)sfu.leave(call.id,uid);changed=true;}
    if(!call.participants.size&&now()-call.created>60_000)endCall(call,'ended');else if(changed)broadcast(call.chat,'call',callView(call,'room'));continue;}
  if(call.participants.size<2 && now()-call.created>45_000)endCall(call,'missed');}}];
setInterval(()=>{for(const step of maintenance)try{step();}catch(error){logFailure('maintenance_failed',error);}},15_000).unref();
pacer.every(15_000,60_000,()=>{for(const step of databaseMaintenance)try{step();}catch(error){logFailure('maintenance_failed',error);}});
const port=Number(process.env.PORT||3000);
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Cipherion: http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`));
function shutdown(){try{traffic.flush(true);}catch(error){logFailure('traffic_flush_failed',error);}for(const call of liveCalls.values())endCall(call);for(const set of streams.values())for(const res of set)res.end();server.close(()=>{db.close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);






