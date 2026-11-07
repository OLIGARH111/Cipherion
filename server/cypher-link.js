// Cypher for Windows ↔ Cipherion.
//
// Linking: the desktop app asks for a short code (start), the person approves it here while signed in
// (approve), and the app collects a desktop token with a separate secret (poll), the same idea as QR login:
// a photo of the code cannot be used to take over the link. The desktop token only opens /api/cypher/*,
// never the person's messenger session.
//
// What a linked Cypher gets:
//  • commands from the AI section: the person picks «Компьютер …» as the context, the text waits in
//    cypher_remote until that PC takes it (long polling), and the PC's answer comes back into the AI history;
//  • notifications about new messages: sender, chat and kind. The text only for messages that are not
//    end-to-end encrypted — the server cannot read encrypted ones and does not pretend to;
//  • the person's AI memory (the same records as in the messenger's AI section), for two-way sync.
//
// 1.0.7 used a personal bot «Cypher · ПК» for the remote; those bots and their chats are removed on start.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const digest=text=>createHash('sha256').update(String(text)).digest('hex');
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL=10*60*1000;
const TOKEN=/^cyl_[A-Za-z0-9_-]{43}$/;
const KIND_LABEL={photo:'Фото',video:'Видео',file:'Файл',voice:'Голосовое сообщение',round:'Видеосообщение',audio:'Аудио',poll:'Опрос',sticker:'Стикер',gif:'GIF'};
const REMOTE_TTL=10*60*1000;

export function createCypherLink({db,one,all,run,fail,now,id,clean,rate,family,bots,vip,broadcast=()=>{}}){
  db.exec(`CREATE TABLE IF NOT EXISTS cypher_link_requests(secret_hash TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,device TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,user_id TEXT,decision TEXT);
    CREATE TABLE IF NOT EXISTS cypher_links(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,device TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER DEFAULT 0,remote INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS cypher_links_user ON cypher_links(user_id);
    CREATE TABLE IF NOT EXISTS cypher_remote(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,link_id TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,picked INTEGER DEFAULT 0,reply TEXT,replied INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS cypher_remote_link ON cypher_remote(link_id,picked);`);

  // 1.0.7 personal remote bots: delete the bots and their chats for everyone. Called once every module has
  // created its tables, with the same order of deletes as removing a community (foreign keys are on).
  function purgeLegacyBots(){
    if(!one("SELECT name FROM sqlite_master WHERE type='table' AND name='cypher_bots'"))return 0;
    const has=table=>!!one("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table);
    const pairs=all('SELECT * FROM cypher_bots');
    for(const pair of pairs){
      const chat=pair.chat_id,members=all('SELECT user_id FROM members WHERE chat_id=?',chat);
      db.exec('BEGIN IMMEDIATE');try{
        if(has('push_attempts')&&has('notification_jobs'))run('DELETE FROM push_attempts WHERE job IN (SELECT id FROM notification_jobs WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?))',chat);
        if(has('notification_jobs'))run('DELETE FROM notification_jobs WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)',chat);
        for(const table of ['votes','reactions','message_stickers','message_requests','poll_attempts','poll_comments','story_replies'])if(has(table))run(`DELETE FROM ${table} WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)`,chat);
        for(const table of ['message_events','notification_events','scheduled','poll_schedule','chat_mutes','audit','calls','drafts'])if(has(table))run(`DELETE FROM ${table} WHERE chat_id=?`,chat);
        if(has('bot_callbacks'))run('DELETE FROM bot_callbacks WHERE bot_id=?',pair.bot_id);
        run('DELETE FROM messages WHERE chat_id=?',chat);run('DELETE FROM members WHERE chat_id=?',chat);run('DELETE FROM chats WHERE id=?',chat);
        if(bots.ownedBy(pair.user_id,pair.bot_id))bots.removeBot(pair.bot_id);
        run('DELETE FROM cypher_bots WHERE user_id=?',pair.user_id);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      for(const m of members)broadcast(chat,'refresh',{chat,user:m.user_id});
    }
    db.exec('DROP TABLE cypher_bots');return pairs.length;
  }
  const pickers=new Map(),resultWaiters=new Map();
  const wakeAll=(map,key)=>{for(const resolve of map.get(key)||[])resolve();map.delete(key);};
  const wait=(map,key,seconds)=>new Promise(resolve=>{const set=map.get(key)||new Set();set.add(resolve);map.set(key,set);setTimeout(()=>{set.delete(resolve);resolve();},seconds*1000).unref?.();});

  const code=()=>{const raw=Array.from(randomBytes(8),b=>CODE_ALPHABET[b%CODE_ALPHABET.length]).join('');return raw.slice(0,4)+'-'+raw.slice(4);};
  const normalCode=value=>{const raw=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return raw.length===8?raw.slice(0,4)+'-'+raw.slice(4):'';};
  const sweep=()=>run('DELETE FROM cypher_link_requests WHERE expires<?',now());
  const linkView=l=>({id:l.id,device:l.device,created:l.created,lastSeen:l.last_seen||null,online:now()-(l.last_seen||0)<90_000});

  function desktop(req){
    const header=String(req.headers.authorization||''),token=header.startsWith('Bearer ')?header.slice(7).trim():'';
    if(!TOKEN.test(token)){rate('cypher-auth:'+req.socket.remoteAddress,30);fail(401,'Cypher не подключён к Cipherion');}
    const link=one('SELECT * FROM cypher_links WHERE token_hash=?',digest(token));
    if(!link||!timingSafeEqual(Buffer.from(link.token_hash),Buffer.from(digest(token)))){rate('cypher-auth:'+req.socket.remoteAddress,30);fail(401,'Подключение Cypher отозвано. Подключите компьютер заново.');}
    const user=one('SELECT id,username,name FROM users WHERE id=?',link.user_id);if(!user||!user.username)fail(401,'Аккаунт Cipherion удалён');
    rate('cypher:'+link.id,240);
    if(now()-(link.last_seen||0)>60_000)run('UPDATE cypher_links SET last_seen=? WHERE id=?',now(),link.id);
    return {link,user};
  }

  // New messages for the person, newest last. The text only when the server can read it.
  function notifications(userId,after,limit){
    return all(`SELECT m.id,m.chat_id,m.kind,m.body,m.e2e,m.created,u.name sender,u.username sender_username,c.kind chat_kind,c.title
      FROM messages m JOIN members me ON me.chat_id=m.chat_id AND me.user_id=? AND me.role!='banned'
      JOIN chats c ON c.id=m.chat_id JOIN users u ON u.id=m.user_id
      WHERE m.created>? AND m.user_id!=? AND m.deleted=0 AND m.created>me.read_at AND c.kind IN ('direct','group')
      AND NOT EXISTS(SELECT 1 FROM chat_mutes x WHERE x.user_id=? AND x.chat_id=m.chat_id AND (x.until_at=-1 OR x.until_at>?))
      ORDER BY m.created LIMIT ?`,userId,after,userId,userId,now(),limit).map(m=>{
      const encrypted=!!m.e2e,text=encrypted?null:m.kind==='text'?String(m.body||'').slice(0,500):null;
      return {id:m.id,chat:m.chat_id,chatKind:m.chat_kind,chatTitle:m.chat_kind==='direct'?m.sender:(m.title||'Группа'),sender:m.sender,senderUsername:m.sender_username,
        kind:m.kind,label:m.kind==='text'?(encrypted?'Зашифрованное сообщение':'Сообщение'):(KIND_LABEL[m.kind]||'Сообщение'),text,encrypted,date:m.created};
    });
  }

  async function route({path,req,b,user,json,url,origin}){
    if(!path.startsWith('/api/cypher/'))return false;

    // --- Desktop side: linking --------------------------------------------------------------
    if(path==='/api/cypher/link/start'&&req.method==='POST'){
      rate('cypher-link:'+req.socket.remoteAddress,10,600_000);sweep();
      const device=clean(b.device,60).replace(/[\r\n]/g,' ')||'Компьютер',secret=randomBytes(32).toString('base64url');let value='';
      for(let i=0;i<5&&!value;i++){const c=code();if(!one('SELECT 1 FROM cypher_link_requests WHERE code=?',c))value=c;}
      if(!value)fail(503,'Попробуйте ещё раз');
      const expires=now()+CODE_TTL;
      run('INSERT INTO cypher_link_requests(secret_hash,code,device,created,expires) VALUES(?,?,?,?,?)',digest(secret),value,device,now(),expires);
      json({code:value,secret,expires,url:origin.replace(/\/$/,'')+'/#cypher-link='+value.replace('-','')},201);return true;
    }
    if(path==='/api/cypher/link/poll'&&req.method==='POST'){
      rate('cypher-poll:'+req.socket.remoteAddress,120);
      const request=one('SELECT * FROM cypher_link_requests WHERE secret_hash=?',digest(String(b.secret||'')));
      if(!request)fail(404,'Код подключения не найден. Получите новый код в Cypher.');
      if(request.expires<now()){run('DELETE FROM cypher_link_requests WHERE secret_hash=?',request.secret_hash);fail(410,'Код подключения устарел. Получите новый код в Cypher.');}
      if(!request.decision){json({status:'pending',expires:request.expires});return true;}
      run('DELETE FROM cypher_link_requests WHERE secret_hash=?',request.secret_hash);
      if(request.decision!=='approved'){json({status:'declined'});return true;}
      const person=one('SELECT id,username,name FROM users WHERE id=?',request.user_id);if(!person?.username)fail(410,'Аккаунт недоступен');
      const token='cyl_'+randomBytes(32).toString('base64url'),linkId=id();
      run('INSERT INTO cypher_links(id,user_id,token_hash,device,created,last_seen) VALUES(?,?,?,?,?,?)',linkId,person.id,digest(token),request.device,now(),now());
      json({status:'approved',token,link:linkId,user:person});return true;
    }

    // --- Desktop side: linked Cypher ----------------------------------------------------------
    if(path==='/api/cypher/me'&&req.method==='GET'){
      const {link,user:person}=desktop(req);json({user:person,link:linkView(link)});return true;
    }
    if(path==='/api/cypher/unlink'&&req.method==='POST'){
      const {link}=desktop(req);run('DELETE FROM cypher_links WHERE id=?',link.id);run('DELETE FROM cypher_remote WHERE link_id=? AND replied=0',link.id);json({ok:true});return true;
    }
    // Commands from the AI section for this PC: long polling, each command is handed out once.
    if(path==='/api/cypher/remote/next'&&req.method==='GET'){
      const {link}=desktop(req);const timeout=Math.min(25,Math.max(0,Number(url.searchParams.get('timeout'))||0));
      const take=()=>{const rows=all('SELECT id,text,created FROM cypher_remote WHERE link_id=? AND picked=0 AND created>? ORDER BY created LIMIT 5',link.id,now()-REMOTE_TTL);for(const r of rows)run('UPDATE cypher_remote SET picked=? WHERE id=?',now(),r.id);return rows;};
      let items=take();if(!items.length&&timeout){await wait(pickers,link.id,timeout);items=take();}
      json({items});return true;
    }
    if(path==='/api/cypher/remote/reply'&&req.method==='POST'){
      const {link}=desktop(req);const item=one('SELECT * FROM cypher_remote WHERE id=? AND link_id=?',String(b.id||''),link.id);if(!item)fail(404,'Команда не найдена');
      if(item.replied)fail(409,'Ответ уже отправлен');
      const text=clean(b.text,8000)||'Готово.';
      run('UPDATE cypher_remote SET reply=?,replied=? WHERE id=?',text,now(),item.id);
      run('INSERT INTO ai_history(id,user_id,role,body,created) VALUES(?,?,?,?,?)',id(),item.user_id,'assistant',text,now());
      wakeAll(resultWaiters,item.id);json({ok:true});return true;
    }
    if(path==='/api/cypher/notifications'&&req.method==='GET'){
      const {user:person}=desktop(req);
      const after=Math.max(Number(url.searchParams.get('after'))||0,now()-24*3600_000),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||20));
      json({now:now(),items:notifications(person.id,after,limit)});return true;
    }
    if(path==='/api/cypher/memory'){
      const {user:person}=desktop(req);
      if(req.method==='GET'){json(all('SELECT id,body,created FROM ai_memory WHERE user_id=? ORDER BY created',person.id));return true;}
      if(req.method==='POST'){
        const text=String(b.body||'').replace(/\s+/g,' ').trim().slice(0,2000);if(!text)fail(400,'Пустая запись');
        if(b.id){if(!one('SELECT 1 FROM ai_memory WHERE id=? AND user_id=?',String(b.id),person.id))fail(404,'Запись не найдена');run('UPDATE ai_memory SET body=? WHERE id=? AND user_id=?',text,String(b.id),person.id);json({id:String(b.id),body:text});return true;}
        if(one('SELECT COUNT(*) n FROM ai_memory WHERE user_id=?',person.id).n>=(vip.active(person.id)?500:100))fail(409,'Память AI в Cipherion заполнена');
        const memoryId=id();run('INSERT INTO ai_memory(id,user_id,body,created) VALUES(?,?,?,?)',memoryId,person.id,text,now());json({id:memoryId,body:text},201);return true;
      }
      if(req.method==='DELETE'){run('DELETE FROM ai_memory WHERE id=? AND user_id=?',String(b.id||''),person.id);json({ok:true});return true;}
      fail(405,'Метод не поддерживается');
    }

    // --- Person side (signed in to Cipherion) --------------------------------------------------
    if(!user)fail(401,'Войдите в аккаунт');
    if(path==='/api/cypher/link/info'&&req.method==='GET'){
      const request=one('SELECT device,expires,decision FROM cypher_link_requests WHERE code=?',normalCode(url.searchParams.get('code')));
      if(!request||request.expires<now()||request.decision)fail(404,'Код не найден или устарел. Получите новый код в Cypher.');
      json({device:request.device,expires:request.expires});return true;
    }
    if(path==='/api/cypher/link/approve'&&req.method==='POST'){
      rate('cypher-approve:'+user.id,20,600_000);
      if(bots.isBot(user.id))fail(403,'Бот не может подключать Cypher');
      if(family.child(user.id))fail(403,'Для детских аккаунтов подключение Cypher недоступно');
      const value=normalCode(b.code);const request=value&&one('SELECT * FROM cypher_link_requests WHERE code=?',value);
      if(!request||request.expires<now()||request.decision)fail(404,'Код не найден или устарел. Получите новый код в Cypher.');
      run('UPDATE cypher_link_requests SET user_id=?,decision=? WHERE secret_hash=?',user.id,b.approve===false?'declined':'approved',request.secret_hash);
      json({ok:true,device:request.device});return true;
    }
    if(path==='/api/cypher/links'&&req.method==='GET'){
      json({links:all('SELECT * FROM cypher_links WHERE user_id=? ORDER BY created DESC',user.id).map(linkView)});return true;
    }
    if(path==='/api/cypher/links'&&req.method==='DELETE'){
      const link=one('SELECT * FROM cypher_links WHERE id=? AND user_id=?',String(b.id||''),user.id);if(!link)fail(404,'Компьютер не найден');
      run('DELETE FROM cypher_links WHERE id=?',link.id);run('DELETE FROM cypher_remote WHERE link_id=? AND replied=0',link.id);
      json({ok:true});return true;
    }
    // The AI section sends a command to one of the person's linked PCs.
    if(path==='/api/cypher/remote'&&req.method==='POST'){
      rate('cypher-remote:'+user.id,30);
      const link=one('SELECT * FROM cypher_links WHERE id=? AND user_id=?',String(b.link||''),user.id);if(!link)fail(404,'Компьютер не найден. Подключите Cypher заново.');
      const text=clean(b.text,4000);if(!text)fail(400,'Пустая команда');
      run('DELETE FROM cypher_remote WHERE created<?',now()-24*3600_000);
      const itemId=id();run('INSERT INTO cypher_remote(id,user_id,link_id,text,created) VALUES(?,?,?,?,?)',itemId,user.id,link.id,text,now());
      run('INSERT INTO ai_history(id,user_id,role,body,created) VALUES(?,?,?,?,?)',id(),user.id,'user','💻 '+link.device+': '+text,now());
      wakeAll(pickers,link.id);json({id:itemId,device:link.device,online:linkView(link).online},201);return true;
    }
    if(path==='/api/cypher/remote/result'&&req.method==='GET'){
      const itemId=String(url.searchParams.get('id')||''),timeout=Math.min(25,Math.max(0,Number(url.searchParams.get('timeout'))||0));
      let item=one('SELECT * FROM cypher_remote WHERE id=? AND user_id=?',itemId,user.id);if(!item)fail(404,'Команда не найдена');
      if(!item.replied&&timeout){await wait(resultWaiters,item.id,timeout);item=one('SELECT * FROM cypher_remote WHERE id=?',item.id);}
      if(item.replied){json({status:'done',reply:item.reply});return true;}
      if(!item.picked&&now()-item.created>REMOTE_TTL){json({status:'expired',error:'Компьютер не забрал команду за 10 минут. Включён ли он и запущен ли Cypher?'});return true;}
      const link=one('SELECT * FROM cypher_links WHERE id=?',item.link_id);
      json({status:item.picked?'running':'waiting',online:!!link&&linkView(link).online});return true;
    }
    fail(404,'Не найдено');
  }
  return {route,purgeLegacyBots};
}
