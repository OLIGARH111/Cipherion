// Cypher for Windows ↔ Cipherion.
//
// Linking: the desktop app asks for a short code (start), the person approves it here while signed in
// (approve), and the app collects a desktop token with a separate secret (poll), the same idea as QR login:
// a photo of the code cannot be used to take over the link. The desktop token only opens /api/cypher/*,
// never the person's messenger session.
//
// What a linked Cypher gets:
//  • a personal bot «Cypher · ПК» owned by the person, with a chat between them: the remote control for
//    the PC. Chats with bots are not end-to-end encrypted, the desktop app reads them through the bot API;
//  • notifications about new messages: sender, chat and kind. The text only for messages that are not
//    end-to-end encrypted — the server cannot read encrypted ones and does not pretend to;
//  • the person's AI memory (the same records as in the messenger's AI section), for two-way sync.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const digest=text=>createHash('sha256').update(String(text)).digest('hex');
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL=10*60*1000;
export const CYPHER_BOT_NAME='Cypher · ПК';
const TOKEN=/^cyl_[A-Za-z0-9_-]{43}$/;
const KIND_LABEL={photo:'Фото',video:'Видео',file:'Файл',voice:'Голосовое сообщение',round:'Видеосообщение',audio:'Аудио',poll:'Опрос',sticker:'Стикер',gif:'GIF'};
const WELCOME=device=>`Готово, сэр. Это ваш пульт Cypher на компьютере «${device}».

Пишите сюда, как в чат с Cypher на ПК, например:
• включи музыку / следующий трек / громкость 30
• открой YouTube, найди котиков
• что на экране?
• агент, подготовь компьютер к работе

Команды выполняет Cypher на этом компьютере, пока он включён и запущен. Перед опасными действиями он сначала спросит подтверждение. Писать сюда можете только вы — сообщения других людей Cypher не выполняет.`;

export function createCypherLink({db,one,all,run,fail,now,id,clean,rate,family,bots,post,vip}){
  db.exec(`CREATE TABLE IF NOT EXISTS cypher_link_requests(secret_hash TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,device TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,user_id TEXT,decision TEXT);
    CREATE TABLE IF NOT EXISTS cypher_links(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,device TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER DEFAULT 0,remote INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS cypher_links_user ON cypher_links(user_id);
    CREATE TABLE IF NOT EXISTS cypher_bots(user_id TEXT PRIMARY KEY REFERENCES users(id),bot_id TEXT NOT NULL,chat_id TEXT NOT NULL);`);

  const code=()=>{const raw=Array.from(randomBytes(8),b=>CODE_ALPHABET[b%CODE_ALPHABET.length]).join('');return raw.slice(0,4)+'-'+raw.slice(4);};
  const normalCode=value=>{const raw=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return raw.length===8?raw.slice(0,4)+'-'+raw.slice(4):'';};
  const sweep=()=>run('DELETE FROM cypher_link_requests WHERE expires<?',now());
  const linkView=l=>({id:l.id,device:l.device,created:l.created,lastSeen:l.last_seen||null,remote:!!l.remote});

  // The person's own bot and the chat with it; created once, reused by every linked PC.
  function ensureBot(userId){
    const known=one('SELECT * FROM cypher_bots WHERE user_id=?',userId);
    if(known&&bots.ownedBy(userId,known.bot_id)&&one('SELECT 1 FROM members WHERE chat_id=? AND user_id=?',known.chat_id,userId))return known;
    let username;for(let i=0;i<8&&!username;i++){const candidate='cypher_'+randomBytes(5).toString('hex')+'bot';if(!one('SELECT 1 FROM users WHERE username=?',candidate))username=candidate;}
    if(!username)fail(503,'Не удалось создать бота, попробуйте ещё раз');
    const botId=bots.createOwned(userId,{username,name:CYPHER_BOT_NAME,description:'Пульт Cypher на вашем компьютере. Пишите команды — Cypher выполнит их на ПК.'});
    const chatId=id();
    db.exec('BEGIN');try{
      run("INSERT INTO chats(id,kind,title,permissions,created) VALUES(?,'direct','',?,?)",chatId,'{}',now());
      run("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'member')",chatId,userId);
      run("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'member')",chatId,botId);
      run('INSERT INTO cypher_bots(user_id,bot_id,chat_id) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET bot_id=excluded.bot_id,chat_id=excluded.chat_id',userId,botId,chatId);
      db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return one('SELECT * FROM cypher_bots WHERE user_id=?',userId);
  }

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
    const own=one('SELECT bot_id FROM cypher_bots WHERE user_id=?',userId)?.bot_id||'';
    return all(`SELECT m.id,m.chat_id,m.kind,m.body,m.e2e,m.created,u.name sender,u.username sender_username,c.kind chat_kind,c.title
      FROM messages m JOIN members me ON me.chat_id=m.chat_id AND me.user_id=? AND me.role!='banned'
      JOIN chats c ON c.id=m.chat_id JOIN users u ON u.id=m.user_id
      WHERE m.created>? AND m.user_id!=? AND m.user_id!=? AND m.deleted=0 AND m.created>me.read_at AND c.kind IN ('direct','group')
      AND NOT EXISTS(SELECT 1 FROM chat_mutes x WHERE x.user_id=? AND x.chat_id=m.chat_id AND (x.until_at=-1 OR x.until_at>?))
      ORDER BY m.created LIMIT ?`,userId,after,userId,own,userId,now(),limit).map(m=>{
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
      const pair=ensureBot(person.id),botToken=bots.issueToken(pair.bot_id),bot=one('SELECT id,username,name FROM users WHERE id=?',pair.bot_id);
      const token='cyl_'+randomBytes(32).toString('base64url'),linkId=id();
      // Only the newest PC holds the remote control: issuing a bot token cut off the previous one.
      run('UPDATE cypher_links SET remote=0 WHERE user_id=?',person.id);
      run('INSERT INTO cypher_links(id,user_id,token_hash,device,created,last_seen,remote) VALUES(?,?,?,?,?,?,1)',linkId,person.id,digest(token),request.device,now(),now());
      try{post({chat:one('SELECT * FROM chats WHERE id=?',pair.chat_id),botId:pair.bot_id,text:WELCOME(request.device),reply:null,topic:null});}catch{}
      json({status:'approved',token,link:linkId,user:person,bot:{...bot,token:botToken,chat:pair.chat_id}});return true;
    }

    // --- Desktop side: linked Cypher ----------------------------------------------------------
    if(path==='/api/cypher/me'&&req.method==='GET'){
      const {link,user:person}=desktop(req);const pair=one('SELECT * FROM cypher_bots WHERE user_id=?',person.id);
      json({user:person,link:linkView(link),bot:pair?{id:pair.bot_id,chat:pair.chat_id,...one('SELECT username,name FROM users WHERE id=?',pair.bot_id)}:null});return true;
    }
    if(path==='/api/cypher/unlink'&&req.method==='POST'){
      const {link}=desktop(req);run('DELETE FROM cypher_links WHERE id=?',link.id);
      const pair=one('SELECT * FROM cypher_bots WHERE user_id=?',link.user_id);if(link.remote&&pair)bots.issueToken(pair.bot_id);
      json({ok:true});return true;
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
      const pair=one('SELECT * FROM cypher_bots WHERE user_id=?',user.id);
      json({links:all('SELECT * FROM cypher_links WHERE user_id=? ORDER BY created DESC',user.id).map(linkView),chat:pair?.chat_id||null});return true;
    }
    if(path==='/api/cypher/links'&&req.method==='DELETE'){
      const link=one('SELECT * FROM cypher_links WHERE id=? AND user_id=?',String(b.id||''),user.id);if(!link)fail(404,'Компьютер не найден');
      run('DELETE FROM cypher_links WHERE id=?',link.id);
      const pair=one('SELECT * FROM cypher_bots WHERE user_id=?',user.id);if(link.remote&&pair)bots.issueToken(pair.bot_id);
      json({ok:true});return true;
    }
    fail(404,'Не найдено');
  }
  return {route};
}
