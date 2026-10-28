import {pushConfig} from './push-config.js';
import {createHash} from 'node:crypto';
export function createDelivery({db,one,all,run,fail,now,id,membership,emit,broadcast,family,projectMessage}) {
  if(!all('PRAGMA table_info(messages)').some(c=>c.name==='client_id'))db.exec('ALTER TABLE messages ADD COLUMN client_id TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS message_idempotency ON messages(user_id,client_id) WHERE client_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS message_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,message_id TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS message_event_insert AFTER INSERT ON messages BEGIN INSERT INTO message_events(chat_id,message_id) VALUES(NEW.chat_id,NEW.id); END;
    CREATE TRIGGER IF NOT EXISTS message_event_update AFTER UPDATE ON messages BEGIN INSERT INTO message_events(chat_id,message_id) VALUES(NEW.chat_id,NEW.id); END;
    CREATE TABLE IF NOT EXISTS push_account_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,provider TEXT NOT NULL,endpoint TEXT NOT NULL,subscription TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,endpoint));
    CREATE TABLE IF NOT EXISTS notification_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,message_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,message_id));
    CREATE TABLE IF NOT EXISTS push_attempts(job INTEGER NOT NULL,device TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(job,device));
    CREATE TRIGGER IF NOT EXISTS message_push_insert AFTER INSERT ON messages BEGIN
      INSERT OR IGNORE INTO notification_jobs(user_id,message_id,created) SELECT user_id,NEW.id,NEW.created FROM members WHERE chat_id=NEW.chat_id AND user_id!=NEW.user_id AND role!='banned';
    END;
    CREATE INDEX IF NOT EXISTS message_events_chat ON message_events(chat_id,seq);
    CREATE TABLE IF NOT EXISTS notification_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,chat_id TEXT NOT NULL,actor TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,reference TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS call_push_insert AFTER INSERT ON calls WHEN NEW.status='ringing' BEGIN
      INSERT INTO notification_events VALUES('call:'||NEW.id,'calls',NEW.chat_id,NEW.user_id,CASE WHEN NEW.video=1 THEN 'Входящий видеозвонок' ELSE 'Входящий аудиозвонок' END,NEW.created,NEW.id);
      INSERT OR IGNORE INTO notification_jobs(user_id,message_id,created) SELECT user_id,'call:'||NEW.id,NEW.created FROM members WHERE chat_id=NEW.chat_id AND user_id!=NEW.user_id AND role!='banned';
    END;
    CREATE TRIGGER IF NOT EXISTS reaction_push_insert AFTER INSERT ON reactions WHEN NEW.emoji!='' BEGIN
      INSERT INTO notification_events SELECT 'reaction:'||NEW.message_id||':'||NEW.user_id||':'||hex(randomblob(8)),'reactions',m.chat_id,NEW.user_id,'Новая реакция '||NEW.emoji,CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.message_id FROM messages m WHERE m.id=NEW.message_id AND m.user_id!=NEW.user_id;
      INSERT OR IGNORE INTO notification_jobs(user_id,message_id,created) SELECT m.user_id,e.id,e.created FROM notification_events e JOIN messages m ON m.id=e.reference WHERE e.type='reactions' AND e.actor=NEW.user_id AND e.reference=NEW.message_id;
    END;
    CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_mutes(user_id TEXT NOT NULL,chat_id TEXT NOT NULL,until_at INTEGER NOT NULL,PRIMARY KEY(user_id,chat_id));`);
  db.exec(`CREATE TABLE IF NOT EXISTS push_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,provider TEXT NOT NULL,endpoint TEXT UNIQUE NOT NULL,subscription TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS push_multi_migration(done INTEGER PRIMARY KEY);`);
  if(!one('SELECT done FROM push_multi_migration WHERE done=1')){db.exec('BEGIN');try{db.exec('INSERT OR IGNORE INTO push_account_devices SELECT * FROM push_devices');run('INSERT INTO push_multi_migration VALUES(1)');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  const defaults={direct:true,group:true,channel:true,calls:true,reactions:true,mentions:true,showText:true,showName:true,sound:true,vibration:true};
  const preferences=u=>({...defaults,...JSON.parse(one('SELECT data FROM notification_preferences WHERE user_id=?',u)?.data||'{}')});
  const vapid=pushConfig(db);
  const configured=()=>!!vapid;
  const providers=new Map();
  providers.set('web',async(subscription,payload)=>{const {default:webpush}=await import('web-push');return webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:payload.type==='calls'?Math.max(0,Math.ceil((payload.expiresAt-now())/1000)):86400,urgency:payload.type==='calls'?'high':'normal',timeout:5000,vapidDetails:vapid});});
  function validateSubscription(s){
    let url;try{url=new URL(s?.endpoint);}catch{fail(400,'Некорректная push-подписка');}
    const host=url.hostname;const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
    if(url.protocol!=='https:'||url.port||url.username||url.password||!allowed||s.endpoint.length>2048)fail(400,'Неподдерживаемый push-провайдер');
    if(!/^[\w-]+$/.test(s.keys?.p256dh||'')||Buffer.from(s.keys.p256dh,'base64url').length!==65||! /^[\w-]+$/.test(s.keys?.auth||'')||Buffer.from(s.keys.auth,'base64url').length!==16)fail(400,'Некорректные ключи подписки');
    return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
  }
  const lastTests=new Map();
  async function route({path,req,b,user,json,url}){
    if(path==='/api/push/config'&&req.method==='GET'){json({configured:configured(),publicKey:vapid?.publicKey||null});return true;}
    if(path==='/api/push/subscriptions'){
      if(req.method==='POST'){if(one('SELECT COUNT(*) n FROM push_account_devices WHERE user_id=?',user.id).n>=30&&!one('SELECT id FROM push_account_devices WHERE user_id=? AND endpoint=?',user.id,String(b.subscription?.endpoint)))fail(409,'До 30 устройств для уведомлений');if(!configured())fail(503,'Серверные push ещё не настроены');const s=validateSubscription(b.subscription);const key=createHash('sha256').update(user.id+':'+s.endpoint).digest('hex');run(`INSERT INTO push_account_devices VALUES(?,?,?,'web',?,?,?) ON CONFLICT(user_id,endpoint) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,subscription=excluded.subscription,created=CASE WHEN push_account_devices.user_id=excluded.user_id THEN push_account_devices.created ELSE excluded.created END`,key,user.id,user.session.id,s.endpoint,JSON.stringify(s),now());json({ok:true});}
      else if(req.method==='DELETE'){run('DELETE FROM push_account_devices WHERE user_id=? AND endpoint=?',user.id,String(b.endpoint));json({ok:true});}else fail(405,'Метод не поддерживается');return true;
    }
    if(path==='/api/push/test'&&req.method==='POST'){
      const device=one('SELECT * FROM push_account_devices WHERE user_id=? AND session_id=? AND endpoint=?',user.id,user.session.id,String(b.endpoint));
      if(!device)fail(404,'Сначала включите уведомления на этом устройстве');
      if(!configured())fail(503,'Уведомления сервера не настроены');
      if(lastTests.get(device.id)>now()-15000)fail(429,'Повторите проверку через 15 секунд');
      if(lastTests.size>1000)for(const [key,time] of lastTests)if(time<now()-15000)lastTests.delete(key);
      lastTests.set(device.id,now());
      try{await providers.get(device.provider)(JSON.parse(device.subscription),{title:'Cipherion',body:'Уведомления о сообщениях и звонках подключены',tag:'cipherion-test',url:'/',account:user.id});}
      catch(e){if([404,410].includes(e.statusCode)){run('DELETE FROM push_account_devices WHERE id=?',device.id);fail(410,'Подписка устарела. Включите уведомления заново');}fail(502,'Не удалось отправить уведомление. Попробуйте ещё раз');}
      json({ok:true});return true;
    }
    if(path==='/api/notification-settings'){
      if(req.method==='GET')json(preferences(user.id));
      else if(req.method==='PATCH'){const p=preferences(user.id);for(const k of Object.keys(defaults))if(b[k]!==undefined){if(typeof b[k]!=='boolean')fail(400,'Ожидается переключатель');p[k]=b[k];}run('INSERT INTO notification_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',user.id,JSON.stringify(p));emit(user.id,'settings',{});json(p);}else fail(405,'Метод не поддерживается');return true;
    }
    if(path==='/api/chat-mute'&&req.method==='POST'){membership(b.chat,user.id);const durations={off:0,hour:3600000,hours8:28800000,day:86400000,week:604800000,forever:-1};if(!(b.duration in durations))fail(400,'Неизвестный срок');const d=durations[b.duration];run('INSERT INTO chat_mutes VALUES(?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET until_at=excluded.until_at',user.id,b.chat,d>0?now()+d:d);emit(user.id,'settings',{});json({ok:true});return true;}
    if(path==='/api/sync'&&req.method==='GET'){
      const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)fail(400,'Некорректный курсор');
      const rows=all(`SELECT e.* FROM message_events e JOIN members m ON m.chat_id=e.chat_id WHERE m.user_id=? AND m.role!='banned' AND e.seq>? AND NOT EXISTS(SELECT 1 FROM messages x WHERE x.id=e.message_id AND x.created<=m.cleared_at) ORDER BY e.seq LIMIT 200`,user.id,after);
      json({events:rows.flatMap(e=>{try{family.chatAccess(e.chat_id,user.id);const m=one('SELECT * FROM messages WHERE id=?',e.message_id);return m?[{...e,message:projectMessage?projectMessage(m,user.id):m}]:[];}catch{return [];}}),cursor:rows.at(-1)?.seq||after,hasMore:rows.length===200});return true;
    }
    if(path==='/api/receipts'&&req.method==='POST'){
      const {chat}=membership(b.chat,user.id);family.chatAccess(b.chat,user.id);
      const m=one('SELECT created FROM messages WHERE id=? AND chat_id=?',String(b.message),b.chat);if(!m)fail(400,'Сообщение не найдено');
      run('UPDATE members SET delivered_at=MAX(delivered_at,?) WHERE chat_id=? AND user_id=?',m.created,b.chat,user.id);
      broadcast(b.chat,'receipt',{chat:b.chat,user:user.id,delivered:m.created});json({ok:true});return true;
    }
    return false;
  }
  let busy=false,cleaned=-Infinity;
  async function tick(){if(busy||!configured())return;busy=true;try{
    // Housekeeping runs every few minutes, not every tick: on Turso each query is a blocking round trip.
    const housekeeping=now()-cleaned>=300000;if(housekeeping)cleaned=now();
    if(housekeeping)run('DELETE FROM push_account_devices WHERE session_id NOT IN (SELECT id FROM sessions WHERE expires>?)',now());
    // Devices are snapshotted durably. Provider acceptance never marks a message as delivered.
    run(`INSERT OR IGNORE INTO push_attempts(job,device) SELECT j.id,d.id FROM notification_jobs j JOIN push_account_devices d ON d.user_id=j.user_id WHERE j.created>? AND d.created<=j.created`,now()-86400000);
    const jobs=all(`SELECT a.*,j.user_id,j.message_id,d.subscription,d.provider FROM push_attempts a JOIN notification_jobs j ON j.id=a.job JOIN push_account_devices d ON d.id=a.device AND d.user_id=j.user_id WHERE a.status='pending' AND a.next_at<=? ORDER BY CASE WHEN j.message_id LIKE 'call:%' THEN 0 ELSE 1 END,a.job LIMIT 20`,now());
    for(const job of jobs){let m=one('SELECT m.*,c.kind AS chat_kind,u.name FROM messages m JOIN chats c ON c.id=m.chat_id JOIN users u ON u.id=m.user_id WHERE m.id=?',job.message_id);if(!m)m=one("SELECT e.*,e.actor AS user_id,'event' AS kind,c.kind AS chat_kind,u.name FROM notification_events e JOIN chats c ON c.id=e.chat_id JOIN users u ON u.id=e.actor WHERE e.id=?",job.message_id);const member=m&&one("SELECT * FROM members WHERE chat_id=? AND user_id=? AND role!='banned'",m.chat_id,job.user_id);const p=preferences(job.user_id);const settings=JSON.parse(one('SELECT settings FROM users WHERE id=?',job.user_id)?.settings||'{}');const mute=m&&one('SELECT until_at FROM chat_mutes WHERE user_id=? AND chat_id=?',job.user_id,m.chat_id)?.until_at;
      const recipient=one('SELECT username FROM users WHERE id=?',job.user_id);const mentioned=m&&m.kind!=='event'&&m.body?.split(/\s+/).includes('@'+recipient?.username);let permitted=true;try{if(m)family.chatAccess(m.chat_id,job.user_id);}catch{permitted=false;}
      if(!m||m.deleted||!member||!permitted||(m.kind!=='event'&&member.read_at>=m.created)||!(m.type?p[m.type]:p[m.chat_kind]||(p.mentions&&mentioned))||(m.type==='calls'&&(now()>=m.created+45000||!one("SELECT id FROM calls WHERE id=? AND status='ringing' AND ended IS NULL",m.reference)))||settings.notifications===false||(settings.muted||[]).includes(m.chat_id)||mute===-1||mute>now()){run("UPDATE push_attempts SET status='skipped' WHERE job=? AND device=?",job.job,job.device);continue;}
      const payload={title:p.showName?m.name:'Cipherion',body:m.type==='calls'?m.body:p.showText&&settings.preview!==false?(m.ghost?'👻 Призрачное сообщение':m.kind==='treat'?'🍬 Сладость или гадость?':m.e2e?'🔒 Зашифрованное сообщение':['text','event'].includes(m.kind)?m.body.slice(0,180):'Новое сообщение'):'У вас новое сообщение',tag:m.id,url:'/#chat='+encodeURIComponent(m.chat_id)+'&message='+encodeURIComponent(m.type==='reactions'?m.reference:m.type==='calls'?'':m.id),silent:!p.sound,vibrate:p.vibration?[120]:[],account:job.user_id,type:m.type||'message',...(m.type==='calls'?{call:m.reference,expiresAt:m.created+45000}:{})};
      if(m.type==='calls')payload.url='/#chat='+encodeURIComponent(m.chat_id)+'&call='+encodeURIComponent(m.reference)+'&account='+encodeURIComponent(job.user_id);
      else payload.url+='&account='+encodeURIComponent(job.user_id);
      try{await providers.get(job.provider)(JSON.parse(job.subscription),payload);run("UPDATE push_attempts SET status='sent' WHERE job=? AND device=?",job.job,job.device);}
      catch(e){if([404,410].includes(e.statusCode)){run('DELETE FROM push_account_devices WHERE id=?',job.device);run("UPDATE push_attempts SET status='expired' WHERE job=? AND device=?",job.job,job.device);}else run('UPDATE push_attempts SET attempts=attempts+1,next_at=? WHERE job=? AND device=?',now()+Math.min(3600000,10000*2**Math.min(job.attempts,9)),job.job,job.device);}
    }
    if(housekeeping){run('DELETE FROM push_attempts WHERE job IN (SELECT id FROM notification_jobs WHERE created<?)',now()-7*86400000);run('DELETE FROM notification_jobs WHERE created<?',now()-7*86400000);run('DELETE FROM notification_events WHERE created<?',now()-7*86400000);}
  }finally{busy=false;}}
  return {route,tick,providers,configured};
}


