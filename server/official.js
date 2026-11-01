// Official Cipherion account: a system bot that cannot sign in and sends
// service notices and update announcements. Also keeps the list of verified accounts.
import {memberPermissions} from './permissions.js';

export const OFFICIAL_NAME='Cipherion';
export const OFFICIAL_USERNAME='cipherion';
const WELCOME='Добро пожаловать в Cipherion! 👋\n\nЭто официальный аккаунт мессенджера. Здесь будут появляться системные уведомления и новости об обновлениях. Отвечать в этот чат не нужно.';

export function createOfficial({db,one,all,run,fail,now,id,broadcast,isAdmin}) {
  db.exec(`CREATE TABLE IF NOT EXISTS official_account(singleton INTEGER PRIMARY KEY CHECK(singleton=1),user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS official_chats(user_id TEXT PRIMARY KEY REFERENCES users(id),chat_id TEXT NOT NULL REFERENCES chats(id));
    CREATE TABLE IF NOT EXISTS verified_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),created INTEGER NOT NULL);`);
  let botId=one('SELECT user_id FROM official_account WHERE singleton=1')?.user_id;
  if(!botId||!one('SELECT id FROM users WHERE id=?',botId)){
    botId=id();
    // The empty password can never match a login attempt, so nobody can sign in as the bot.
    // Older databases require a username, so pick a free one instead of leaving it empty.
    const taken=name=>!!one('SELECT id FROM users WHERE username=?',name);
    let username=[OFFICIAL_USERNAME,'cipherion_official','cipherion_bot'].find(name=>!taken(name));
    while(!username||taken(username))username='cipherion_'+id().replace(/[^a-z0-9]/gi,'').toLowerCase().slice(0,12);
    run('INSERT INTO users(id,username,name,password,bio,created) VALUES(?,?,?,?,?,?)',botId,username,OFFICIAL_NAME,'','Официальный аккаунт Cipherion: системные уведомления и обновления',now());
    run('INSERT INTO official_account(singleton,user_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET user_id=excluded.user_id',botId);
  }
  run('INSERT OR IGNORE INTO verified_accounts VALUES(?,?)',botId,now());
  // The site owner is verified as well.
  run('INSERT OR IGNORE INTO verified_accounts SELECT user_id,? FROM site_owner WHERE singleton=1 AND user_id IS NOT NULL',now());

  const isBot=userId=>userId===botId;
  const isVerified=userId=>!!userId&&!!one('SELECT user_id FROM verified_accounts WHERE user_id=?',userId);
  const isOfficialChat=chatId=>!!one('SELECT chat_id FROM official_chats WHERE chat_id=?',chatId);
  const readOnly=JSON.stringify({overrides:Object.fromEntries(memberPermissions.map(p=>[p,false]))});

  function post(chatId,text,at=now()){
    const messageId=id();
    run("INSERT INTO messages(id,chat_id,user_id,kind,body,created) VALUES(?,?,?,'text',?,?)",messageId,chatId,botId,String(text).slice(0,4000),at);
    broadcast(chatId,'message',{chat:chatId,id:messageId});
    return messageId;
  }
  // Every account gets its own read-only chat with the bot, created on first use.
  function ensure(userId){
    if(isBot(userId))return null;
    const existing=one('SELECT o.chat_id FROM official_chats o JOIN chats c ON c.id=o.chat_id WHERE o.user_id=?',userId);
    if(existing)return existing.chat_id;
    // Dated at sign-up, so the welcome never jumps above the user's newer chats.
    const at=Number(one('SELECT created FROM users WHERE id=?',userId)?.created)||now();
    const chatId=id();
    db.exec('BEGIN');
    try{
      run("INSERT INTO chats(id,kind,title,permissions,created) VALUES(?,'direct','',?,?)",chatId,'{}',at);
      run("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')",chatId,botId);
      run("INSERT INTO members(chat_id,user_id,role,rules) VALUES(?,?,'member',?)",chatId,userId,readOnly);
      run('INSERT INTO official_chats(user_id,chat_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id',userId,chatId);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    post(chatId,WELCOME,at);
    return chatId;
  }
  // Sends a notice to one account, or an announcement to everyone.
  function notify(userId,text){const chatId=ensure(userId);if(chatId)post(chatId,text);}
  function announce(text){let sent=0;for(const u of all('SELECT id FROM users WHERE id!=?',botId)){notify(u.id,text);sent++;}return sent;}

  async function route({path,req,b,user,json}){
    if(path==='/api/admin/announce'&&req.method==='POST'){
      if(!isAdmin(user.id))fail(403,'Только владелец');
      const text=String(b.text||'').trim();if(!text||text.length>4000)fail(400,'Текст: от 1 до 4000 символов');
      json({ok:true,sent:announce(text)});return true;
    }
    if(path==='/api/admin/verify'&&['POST','DELETE'].includes(req.method)){
      if(!isAdmin(user.id))fail(403,'Только владелец');
      const target=String(b.user||'');if(!one('SELECT id FROM users WHERE id=?',target))fail(400,'Пользователь не найден');
      if(req.method==='POST')run('INSERT OR IGNORE INTO verified_accounts VALUES(?,?)',target,now());
      else{if(isBot(target))fail(400,'Официальный аккаунт всегда подтверждён');run('DELETE FROM verified_accounts WHERE user_id=?',target);}
      json({ok:true,verified:req.method==='POST'});return true;
    }
    return false;
  }
  return {botId,isBot,isVerified,isOfficialChat,ensure,notify,announce,route};
}
