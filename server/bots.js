// Bot platform. A bot is an ordinary account without a password, owned by a person.
// It talks to Cipherion through a token-authenticated HTTP API modelled on familiar
// bot APIs: /api/bot/<token>/<method>, with updates delivered by long polling
// (getUpdates) or pushed to a webhook. Chats with a bot are not end-to-end encrypted,
// because the bot has to read the messages it is sent.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {safeFetch,checkURL} from './safe-fetch.js';

const digest=text=>createHash('sha256').update(String(text)).digest('hex');
// Inline keyboard under a bot message: rows of buttons that either send callback_data back to
// the bot (callback_query update) or open a link.
export function parseMarkup(raw){
  if(raw===undefined||raw===null||raw==='')return null;
  let value=raw;if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=null;}}
  const bad=message=>{throw Object.assign(new Error('reply_markup: '+message),{status:400});};
  if(!value||typeof value!=='object'||!Array.isArray(value.inline_keyboard))bad('ожидается {inline_keyboard:[[...]]}');
  const rows=value.inline_keyboard;if(rows.length>8)bad('не больше 8 рядов');
  const out=rows.map(row=>{
    if(!Array.isArray(row)||!row.length||row.length>8)bad('в ряду от 1 до 8 кнопок');
    return row.map(b=>{
      const text=String(b?.text??'').trim().slice(0,64);if(!text)bad('у кнопки нет текста');
      if(typeof b.url==='string'){let url;try{url=new URL(b.url);}catch{bad('некорректная ссылка');}if(!['https:','http:'].includes(url.protocol)||b.url.length>512)bad('ссылка должна начинаться с https://');return {text,url:url.href};}
      if(typeof b.callback_data==='string'){if(!b.callback_data||Buffer.byteLength(b.callback_data)>64)bad('callback_data: от 1 до 64 байт');return {text,callback_data:b.callback_data};}
      bad('кнопке нужен url или callback_data');
    });
  });
  return out.length?{inline_keyboard:out}:null;
}
export const BOT_USERNAME=/^[a-z0-9_]{2,28}bot$/;

export function createBots({db,one,all,run,fail,now,id,clean,rate,family,privacy,post,edit,remove,broadcast,fetcher=safeFetch,logFailure=()=>{}}){
  db.exec(`CREATE TABLE IF NOT EXISTS bots(user_id TEXT PRIMARY KEY REFERENCES users(id),owner_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT UNIQUE NOT NULL,description TEXT DEFAULT '',webhook TEXT DEFAULT '',secret TEXT DEFAULT '',created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bot_updates(id INTEGER PRIMARY KEY AUTOINCREMENT,bot_id TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,attempts INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS bot_updates_queue ON bot_updates(bot_id,id);
    CREATE TABLE IF NOT EXISTS bot_callbacks(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,user_id TEXT NOT NULL,message_id TEXT NOT NULL,created INTEGER NOT NULL,answered INTEGER DEFAULT 0);`);
  if(!all('PRAGMA table_info(messages)').some(c=>c.name==='markup'))db.exec('ALTER TABLE messages ADD COLUMN markup TEXT');
  // A person pressed a button and waits a few seconds for answerCallbackQuery.
  const answers=new Map();
  const ids=new Set(all('SELECT user_id FROM bots').map(r=>r.user_id));
  const isBot=userId=>ids.has(userId);
  const waiters=new Map();
  const wake=botId=>{for(const resolve of waiters.get(botId)||[])resolve();waiters.delete(botId);};

  function issueToken(botId){const token=botId.slice(0,8)+':'+randomBytes(24).toString('base64url');run('UPDATE bots SET token_hash=? WHERE user_id=?',digest(token),botId);return token;}
  function botByToken(token){
    if(!/^[a-f0-9]{8}:[A-Za-z0-9_-]{32}$/.test(String(token)))return null;
    const row=one('SELECT b.*,u.username,u.name FROM bots b JOIN users u ON u.id=b.user_id WHERE b.token_hash=?',digest(token));
    return row&&timingSafeEqual(Buffer.from(row.token_hash),Buffer.from(digest(token)))?row:null;
  }
  const view=row=>({id:row.user_id,username:row.username,name:row.name,description:row.description||'',webhook:row.webhook||'',created:row.created});
  const ownBot=(owner,botId)=>{const row=one('SELECT b.*,u.username,u.name FROM bots b JOIN users u ON u.id=b.user_id WHERE b.user_id=? AND b.owner_id=?',botId,owner);if(!row)fail(404,'Бот не найден');return row;};

  function chatPayload(chat){return {id:chat.id,type:chat.kind==='direct'?'private':chat.kind,title:chat.kind==='direct'?undefined:chat.title};}
  function messagePayload(m){
    const chat=one('SELECT * FROM chats WHERE id=?',m.chat_id),from=one('SELECT id,username,name FROM users WHERE id=?',m.user_id);
    return {message_id:m.id,date:Math.floor(m.created/1000),chat:chatPayload(chat),from:{id:from.id,username:from.username,name:from.name,is_bot:isBot(from.id)},
      text:m.e2e?'':String(m.body||''),kind:m.kind,...(m.markup?{reply_markup:JSON.parse(m.markup)}:{}),...(m.reply_id?{reply_to_message_id:m.reply_id}:{}),...(m.media_id?{media:{id:m.media_id}}:{}),...(m.topic_id?{topic_id:m.topic_id}:{})};
  }
  // A person wrote in a chat with bots: queue an update for each of them.
  function notify(m){
    if(!m||m.deleted)return;
    for(const r of all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",m.chat_id)){
      if(!isBot(r.user_id)||r.user_id===m.user_id)continue;
      run('INSERT INTO bot_updates(bot_id,payload,created) VALUES(?,?,?)',r.user_id,JSON.stringify({message:messagePayload(m)}),now());
      wake(r.user_id);
    }
  }
  function memberChat(bot,chatId){
    const chat=one('SELECT * FROM chats WHERE id=?',String(chatId||''));
    const member=chat&&one("SELECT * FROM members WHERE chat_id=? AND user_id=? AND role!='banned'",chat.id,bot.user_id);
    if(!member)fail(403,'Бот не состоит в этом чате');return {chat,member};
  }
  const updatesFor=(botId,offset,limit)=>all('SELECT id,payload FROM bot_updates WHERE bot_id=? AND id>=? ORDER BY id LIMIT ?',botId,offset,limit).map(r=>({update_id:r.id,...JSON.parse(r.payload)}));

  async function api(bot,method,b){
    rate('bot:'+bot.user_id,120);
    switch(method){
      case 'getMe':return {id:bot.user_id,username:bot.username,name:bot.name,is_bot:true};
      case 'getUpdates':{
        if(bot.webhook)fail(409,'Включён вебхук: удалите его через deleteWebhook, чтобы получать обновления запросами');
        const offset=Number(b.offset)||0,limit=Math.min(100,Math.max(1,Number(b.limit)||100)),timeout=Math.min(25,Math.max(0,Number(b.timeout)||0));
        if(offset)run('DELETE FROM bot_updates WHERE bot_id=? AND id<?',bot.user_id,offset);
        let list=updatesFor(bot.user_id,offset,limit);
        if(!list.length&&timeout){
          await new Promise(resolve=>{const set=waiters.get(bot.user_id)||new Set();set.add(resolve);waiters.set(bot.user_id,set);setTimeout(()=>{set.delete(resolve);resolve();},timeout*1000).unref?.();});
          list=updatesFor(bot.user_id,offset,limit);
        }
        return list;
      }
      case 'sendMessage':{
        const {chat}=memberChat(bot,b.chat_id);const text=clean(b.text,4000);if(!text)fail(400,'Пустое сообщение');
        return messagePayload(await post({chat,botId:bot.user_id,text,reply:b.reply_to_message_id?String(b.reply_to_message_id):null,topic:b.topic_id?String(b.topic_id):null,markup:parseMarkup(b.reply_markup)}));
      }
      case 'editMessageText':{
        const m=one('SELECT * FROM messages WHERE id=? AND user_id=? AND deleted=0',String(b.message_id||''),bot.user_id);if(!m)fail(404,'Сообщение не найдено');
        const text=clean(b.text,4000);if(!text)fail(400,'Пустое сообщение');
        edit(m,text,b.reply_markup===undefined?undefined:parseMarkup(b.reply_markup));return messagePayload(one('SELECT * FROM messages WHERE id=?',m.id));
      }
      case 'editMessageReplyMarkup':{
        const m=one('SELECT * FROM messages WHERE id=? AND user_id=? AND deleted=0',String(b.message_id||''),bot.user_id);if(!m)fail(404,'Сообщение не найдено');
        edit(m,undefined,parseMarkup(b.reply_markup));return messagePayload(one('SELECT * FROM messages WHERE id=?',m.id));
      }
      case 'answerCallbackQuery':{
        const q=one('SELECT * FROM bot_callbacks WHERE id=? AND bot_id=?',String(b.callback_query_id||''),bot.user_id);if(!q)fail(400,'Запрос кнопки не найден');
        if(q.answered)fail(400,'На нажатие уже ответили');
        run('UPDATE bot_callbacks SET answered=1 WHERE id=?',q.id);
        let url=null;if(b.url){try{const u=new URL(String(b.url));if(['https:','http:'].includes(u.protocol))url=u.href;}catch{}}
        answers.get(q.id)?.({text:clean(b.text,200),show_alert:b.show_alert===true||b.show_alert==='true',...(url?{url}:{})});answers.delete(q.id);
        return true;
      }
      case 'deleteMessage':{
        const m=one('SELECT * FROM messages WHERE id=? AND deleted=0',String(b.message_id||''));if(!m)fail(404,'Сообщение не найдено');
        const {member}=memberChat(bot,m.chat_id);if(m.user_id!==bot.user_id&&!['owner','admin'].includes(member.role))fail(403,'Бот может удалять только свои сообщения');
        remove(m);return true;
      }
      case 'sendChatAction':{const {chat}=memberChat(bot,b.chat_id);broadcast(chat.id,'typing',{chat:chat.id,user:bot.user_id,name:bot.name});return true;}
      case 'getChat':{const {chat}=memberChat(bot,b.chat_id);return {...chatPayload(chat),members:one("SELECT COUNT(*) n FROM members WHERE chat_id=? AND role!='banned'",chat.id).n};}
      case 'setWebhook':{
        const url=String(b.url||'');
        if(url&&(!checkURL(url)||!url.startsWith('https://')))fail(400,'Вебхук должен быть публичным адресом https://');
        const secret=b.secret_token===undefined?bot.secret:String(b.secret_token).slice(0,128);
        if(secret&&!/^[A-Za-z0-9_-]{1,128}$/.test(secret))fail(400,'secret_token: латинские буквы, цифры, _ и -');
        run('UPDATE bots SET webhook=?,secret=? WHERE user_id=?',url,secret||'',bot.user_id);return true;
      }
      case 'deleteWebhook':{run("UPDATE bots SET webhook='' WHERE user_id=?",bot.user_id);if(b.drop_pending_updates)run('DELETE FROM bot_updates WHERE bot_id=?',bot.user_id);return true;}
      case 'getWebhookInfo':{const q=one('SELECT COUNT(*) n,MAX(attempts) a FROM bot_updates WHERE bot_id=?',bot.user_id);return {url:bot.webhook||'',pending_update_count:q.n,last_error_attempts:q.a||0};}
    }
    fail(404,'Неизвестный метод');
  }

  let busy=false;
  async function tick(){
    if(busy)return;busy=true;
    try{
      run('DELETE FROM bot_updates WHERE created<?',now()-86400_000);
      for(const bot of all("SELECT user_id,webhook,secret FROM bots WHERE webhook!=''")){
        for(const u of all('SELECT * FROM bot_updates WHERE bot_id=? AND next_at<=? ORDER BY id LIMIT 20',bot.user_id,now())){
          let ok=false;
          try{const r=await fetcher(bot.webhook,{method:'POST',maxBytes:64*1024,timeout:8000,redirects:0,headers:{'Content-Type':'application/json',...(bot.secret?{'X-Cipherion-Bot-Secret':bot.secret}:{})},body:JSON.stringify({update_id:u.id,...JSON.parse(u.payload)})});ok=r.status>=200&&r.status<300;}catch{}
          if(ok){run('DELETE FROM bot_updates WHERE id=?',u.id);continue;}
          run('UPDATE bot_updates SET attempts=attempts+1,next_at=? WHERE id=?',now()+Math.min(600_000,2000*2**Math.min(u.attempts,8)),u.id);break;
        }
      }
    }catch(error){logFailure('bot_webhook_failed',error);}finally{busy=false;}
  }

  async function route({path,req,b,user,json,url}){
    const bot=/^\/api\/bot\/([^/]+)\/([A-Za-z]+)$/.exec(path);
    if(bot){
      const row=botByToken(decodeURIComponent(bot[1]));
      const reply=(value,status=200)=>json(status===200?{ok:true,result:value}:{ok:false,error_code:status,description:value},status);
      if(!row){rate('bot-auth:'+req.socket.remoteAddress,30);reply('Неверный токен бота',401);return true;}
      const params={...Object.fromEntries(url.searchParams),...b};
      try{reply(await api(row,bot[2],params));}catch(error){if(!error.status)throw error;reply(error.message,error.status);}
      return true;
    }
    if(!path.startsWith('/api/bots'))return false;
    if(!user)fail(401,'Войдите в аккаунт');
    if(path==='/api/bots'&&req.method==='GET'){json(all('SELECT b.*,u.username,u.name FROM bots b JOIN users u ON u.id=b.user_id WHERE b.owner_id=? ORDER BY b.created',user.id).map(view));return true;}
    if(path==='/api/bots'&&req.method==='POST'){
      if(family.child(user.id))fail(403,'Детские аккаунты не могут создавать ботов');
      if(isBot(user.id))fail(403,'Бот не может создавать ботов');
      rate('bot-create:'+user.id,10,3600_000);
      if(one('SELECT COUNT(*) n FROM bots WHERE owner_id=?',user.id).n>=20)fail(400,'Можно создать до 20 ботов');
      const username=String(b.username||'').trim().toLowerCase().replace(/^@/,''),name=clean(b.name,64);
      if(!BOT_USERNAME.test(username))fail(400,'Username бота: 5–32 латинские буквы, цифры или _, в конце «bot»');
      if(!name)fail(400,'Введите имя бота');
      if(one('SELECT id FROM users WHERE username=?',username))fail(409,'Этот username уже занят');
      const botId=id();
      db.exec('BEGIN');try{
        run("INSERT INTO users(id,username,name,password,bio,created) VALUES(?,?,?,'bot:!',?,?)",botId,username,name,clean(b.description,500),now());
        run('INSERT INTO bots(user_id,owner_id,token_hash,description,created) VALUES(?,?,?,?,?)',botId,user.id,digest(randomBytes(16)),clean(b.description,500),now());
        db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      ids.add(botId);privacy.event(user.id,'bot_created');
      json({bot:view(ownBot(user.id,botId)),token:issueToken(botId)},201);return true;
    }
    const match=/^\/api\/bots\/([^/]+)(\/token)?$/.exec(path);if(!match)fail(404,'Не найдено');
    const row=ownBot(user.id,match[1]);
    if(match[2]&&req.method==='POST'){json({token:issueToken(row.user_id)});return true;}
    if(!match[2]&&req.method==='PATCH'){
      const name=b.name===undefined?row.name:clean(b.name,64);if(!name)fail(400,'Введите имя бота');
      const description=b.description===undefined?row.description:clean(b.description,500);
      if(b.webhook!==undefined&&b.webhook&&(!checkURL(b.webhook)||!String(b.webhook).startsWith('https://')))fail(400,'Вебхук должен быть публичным адресом https://');
      run('UPDATE users SET name=?,bio=? WHERE id=?',name,description,row.user_id);
      run('UPDATE bots SET description=?,webhook=? WHERE user_id=?',description,b.webhook===undefined?row.webhook:String(b.webhook||''),row.user_id);
      json(view(ownBot(user.id,row.user_id)));return true;
    }
    if(!match[2]&&req.method==='DELETE'){
      db.exec('BEGIN');try{
        for(const m of all('SELECT chat_id FROM members WHERE user_id=?',row.user_id))broadcast(m.chat_id,'refresh',{chat:m.chat_id});
        run('DELETE FROM members WHERE user_id=?',row.user_id);run('DELETE FROM bot_updates WHERE bot_id=?',row.user_id);
        run('DELETE FROM sessions WHERE user_id=?',row.user_id);
        run("UPDATE users SET username=NULL,name='Удалённый бот',bio='' WHERE id=?",row.user_id);
        run('DELETE FROM bots WHERE user_id=?',row.user_id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      ids.delete(row.user_id);json({ok:true});return true;
    }
    fail(405,'Метод не поддерживается');
  }
  // A person pressed a callback button under a bot's message.
  async function press(m,user,data){
    if(!isBot(m.user_id)||m.deleted)fail(400,'Кнопка недоступна');
    const markup=m.markup?JSON.parse(m.markup):null;
    if(!markup?.inline_keyboard.some(row=>row.some(b=>b.callback_data===data)))fail(400,'Кнопка устарела');
    rate('bot-press:'+user.id,30);
    const queryId=randomBytes(12).toString('hex'),from=one('SELECT id,username,name FROM users WHERE id=?',user.id);
    run('DELETE FROM bot_callbacks WHERE created<?',now()-3600_000);
    run('INSERT INTO bot_callbacks(id,bot_id,user_id,message_id,created) VALUES(?,?,?,?,?)',queryId,m.user_id,user.id,m.id,now());
    run('INSERT INTO bot_updates(bot_id,payload,created) VALUES(?,?,?)',m.user_id,JSON.stringify({callback_query:{id:queryId,from:{id:from.id,username:from.username,name:from.name,is_bot:false},message:messagePayload(m),chat_instance:m.chat_id,data}}),now());
    wake(m.user_id);
    return new Promise(resolve=>{answers.set(queryId,resolve);setTimeout(()=>{if(answers.get(queryId)===resolve){answers.delete(queryId);resolve({});}},8000).unref?.();});
  }
  return {route,notify,isBot,tick,press};
}
