// Chat features layered on the messages table:
//  • @mentions with notifications and a "next mention" queue per member;
//  • auto-delete timers per chat (day / week / month), swept with the ghost-message timer;
//  • slow mode for groups: one message per N seconds for ordinary members;
//  • forum topics in groups;
//  • comments under channel posts.
export const TTL_CHOICES=[0,86400,604800,2592000];
export const SLOW_CHOICES=[0,10,30,60,300,900,3600];
const GENERAL='general';

export function createChatFeatures({db,one,all,run,fail,now,id,clean,membership,requirePermission,family,emit,broadcast,audit,allowed}){
  const add=(table,column,type)=>{if(!all(`PRAGMA table_info(${table})`).some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);};
  add('chats','ttl','INTEGER DEFAULT 0');add('chats','slow_mode','INTEGER DEFAULT 0');add('chats','forum','INTEGER DEFAULT 0');add('chats','comments','INTEGER DEFAULT 1');
  add('messages','topic_id','TEXT');add('messages','expires_at','INTEGER');add('messages','live_until','INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS messages_expiry ON messages(expires_at) WHERE expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS messages_topic ON messages(chat_id,topic_id,created);
    CREATE TABLE IF NOT EXISTS mentions(message_id TEXT NOT NULL,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,seen INTEGER DEFAULT 0,PRIMARY KEY(message_id,user_id));
    CREATE INDEX IF NOT EXISTS mentions_unseen ON mentions(user_id,chat_id,seen);
    CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id),title TEXT NOT NULL,icon TEXT DEFAULT '',created INTEGER NOT NULL,created_by TEXT,closed INTEGER DEFAULT 0,deleted INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS topics_chat ON topics(chat_id);
    CREATE TABLE IF NOT EXISTS post_comments(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,reply_id TEXT,created INTEGER NOT NULL,deleted INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS post_comments_message ON post_comments(message_id,created);`);

  const isStaff=member=>['owner','admin'].includes(member?.role);
  const activeMembers=chat=>all("SELECT m.user_id,u.username FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.role!='banned'",chat);

  // Validates the extras of a new message and returns what to store with it.
  function prepare(chat,member,userId,b,plainBody){
    if(chat.slow_mode>0&&chat.kind==='group'&&!isStaff(member)){
      const last=one('SELECT MAX(created) n FROM messages WHERE chat_id=? AND user_id=?',chat.id,userId)?.n||0;
      const wait=Math.ceil((last+chat.slow_mode*1000-now())/1000);
      if(wait>0)throw Object.assign(new Error(`Медленный режим: следующее сообщение можно отправить через ${wait} с`),{status:429,retryAfter:wait,slowMode:true});
    }
    let topic=null;
    if(chat.forum&&b.topic&&b.topic!==GENERAL){
      const t=one('SELECT * FROM topics WHERE id=? AND chat_id=? AND deleted=0',String(b.topic),chat.id);
      if(!t)fail(400,'Тема не найдена');
      if(t.closed&&!isStaff(member))fail(403,'Тема закрыта');
      topic=t.id;
    }
    const people=activeMembers(chat.id),wanted=new Set();
    if(Array.isArray(b.mentions))for(const uid of b.mentions.slice(0,50))wanted.add(String(uid));
    // Plain text can also be scanned on the server, which covers bots and old clients.
    for(const m of String(plainBody||'').matchAll(/(^|[^\w@])@([a-zA-Z0-9_]{3,32})/g)){const p=people.find(x=>x.username===m[2].toLowerCase());if(p)wanted.add(p.user_id);}
    const mentions=[...wanted].filter(uid=>uid!==userId&&people.some(p=>p.user_id===uid));
    return {topic,mentions,expires:chat.ttl>0?chat.ttl*1000:null};
  }
  function deliver(messageId,chat,sender,info){
    for(const uid of info.mentions){
      run('INSERT OR IGNORE INTO mentions VALUES(?,?,?,?,0)',messageId,chat.id,uid,now());
      emit(uid,'mention',{chat:chat.id,message:messageId,from:sender.name,title:chat.title||''});
    }
  }
  // Rows of a topic only; no topic parameter keeps the whole history (old clients, search, export).
  function topicFilter(chat,topic){
    if(!topic)return ['',[]];
    if(topic===GENERAL)return [' AND topic_id IS NULL',[]];
    return [' AND topic_id=?',[String(topic)]];
  }
  function commentCounts(ids){
    const counts=new Map();
    for(let i=0;i<ids.length;i+=400){const part=ids.slice(i,i+400);for(const r of all(`SELECT message_id,COUNT(*) n FROM post_comments WHERE deleted=0 AND message_id IN (${part.map(()=>'?').join(',')}) GROUP BY message_id`,...part))counts.set(r.message_id,r.n);}
    return counts;
  }
  function mentionCount(chatId,userId){return one('SELECT COUNT(*) n FROM mentions m JOIN messages x ON x.id=m.message_id WHERE m.chat_id=? AND m.user_id=? AND m.seen=0 AND x.deleted=0',chatId,userId).n;}
  function slowWait(chat,member,userId){
    if(!(chat.slow_mode>0)||chat.kind!=='group'||isStaff(member))return 0;
    const last=one('SELECT MAX(created) n FROM messages WHERE chat_id=? AND user_id=?',chat.id,userId)?.n||0;
    return Math.max(0,last+chat.slow_mode*1000-now());
  }
  function topicView(t,viewer){
    const last=one('SELECT id,user_id,kind,body,e2e,created FROM messages WHERE chat_id=? AND topic_id IS ? AND deleted=0 ORDER BY created DESC LIMIT 1',t.chat_id,t.id===GENERAL?null:t.id);
    const count=one('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND topic_id IS ? AND deleted=0',t.chat_id,t.id===GENERAL?null:t.id).n;
    const read=one('SELECT read_at FROM members WHERE chat_id=? AND user_id=?',t.chat_id,viewer)?.read_at||0;
    const unread=one('SELECT COUNT(*) n FROM messages WHERE chat_id=? AND topic_id IS ? AND deleted=0 AND user_id!=? AND created>?',t.chat_id,t.id===GENERAL?null:t.id,viewer,read).n;
    return {id:t.id,title:t.title,icon:t.icon||'',closed:!!t.closed,created:t.created,count,unread,last:last?{id:last.id,user_id:last.user_id,author:one('SELECT name FROM users WHERE id=?',last.user_id)?.name||'',kind:last.kind,body:last.e2e?'':String(last.body||'').slice(0,200),encrypted:!!last.e2e,created:last.created}:null};
  }
  function sweep(){
    for(const r of all('SELECT id,chat_id FROM messages WHERE expires_at IS NOT NULL AND expires_at<=? AND deleted=0 LIMIT 200',now())){
      run("UPDATE messages SET deleted=1,body='',transcript=NULL,e2e=NULL,poll=NULL WHERE id=?",r.id);
      run('UPDATE post_comments SET deleted=1 WHERE message_id=?',r.id);
      broadcast(r.chat_id,'message',{chat:r.chat_id,id:r.id});
    }
  }

  async function route({path,req,b,user,json}){
    const chatRoute=/^\/api\/chats\/([^/]+)\/(features|mentions|topics)$/.exec(path);
    if(chatRoute){
      const [,chatId,action]=chatRoute;const {chat,member}=membership(chatId,user.id);family.chatAccess(chatId,user.id);
      if(action==='features'&&req.method==='PATCH'){
        const changes=[];
        if(b.ttl!==undefined){
          const ttl=Number(b.ttl);if(!TTL_CHOICES.includes(ttl))fail(400,'Выберите срок автоудаления');
          if(!['direct','saved'].includes(chat.kind))requirePermission(chatId,user.id,'info');
          run('UPDATE chats SET ttl=? WHERE id=?',ttl,chatId);changes.push('ttl:'+ttl);
        }
        if(b.slowMode!==undefined){
          const slow=Number(b.slowMode);if(!SLOW_CHOICES.includes(slow))fail(400,'Выберите интервал медленного режима');
          if(chat.kind!=='group')fail(400,'Медленный режим доступен в группах');
          requirePermission(chatId,user.id,'permissions');run('UPDATE chats SET slow_mode=? WHERE id=?',slow,chatId);changes.push('slow:'+slow);
        }
        if(b.forum!==undefined){
          if(chat.kind!=='group')fail(400,'Темы доступны в группах');
          requirePermission(chatId,user.id,'info');run('UPDATE chats SET forum=? WHERE id=?',b.forum===true?1:0,chatId);changes.push('forum:'+(b.forum===true?1:0));
        }
        if(b.comments!==undefined){
          if(chat.kind!=='channel')fail(400,'Комментарии доступны в каналах');
          if(member.role!=='owner')fail(403,'Только владелец канала');
          run('UPDATE chats SET comments=? WHERE id=?',b.comments===true?1:0,chatId);changes.push('comments:'+(b.comments===true?1:0));
        }
        if(!changes.length)fail(400,'Нет изменений');
        audit(chatId,user.id,'features',changes.join(','));
        json({ok:true,...one('SELECT ttl,slow_mode,forum,comments FROM chats WHERE id=?',chatId)});return true;
      }
      if(action==='mentions'&&req.method==='GET'){
        json(all('SELECT m.message_id id,x.created,x.topic_id topic FROM mentions m JOIN messages x ON x.id=m.message_id WHERE m.chat_id=? AND m.user_id=? AND m.seen=0 AND x.deleted=0 ORDER BY x.created',chatId,user.id));return true;
      }
      if(action==='mentions'&&req.method==='POST'){
        if(b.all)run('UPDATE mentions SET seen=1 WHERE chat_id=? AND user_id=?',chatId,user.id);
        else run('UPDATE mentions SET seen=1 WHERE chat_id=? AND user_id=? AND message_id=?',chatId,user.id,String(b.message||''));
        json({ok:true,left:mentionCount(chatId,user.id)});return true;
      }
      if(action==='topics'&&req.method==='GET'){
        if(!chat.forum)fail(400,'В этой группе темы выключены');
        const list=[{id:GENERAL,chat_id:chatId,title:'Общее',icon:'💬',created:chat.created,closed:0},...all('SELECT * FROM topics WHERE chat_id=? AND deleted=0 ORDER BY created',chatId)].map(t=>topicView(t,user.id));
        list.sort((a,b)=>a.id===GENERAL?-1:b.id===GENERAL?1:(b.last?.created||b.created)-(a.last?.created||a.created));
        json(list);return true;
      }
      if(action==='topics'&&req.method==='POST'){
        if(!chat.forum)fail(400,'В этой группе темы выключены');
        if(!allowed(member,chat,'text'))fail(403,'Недостаточно прав');
        const title=clean(b.title,80);if(!title)fail(400,'Введите название темы');
        if(one('SELECT COUNT(*) n FROM topics WHERE chat_id=? AND deleted=0',chatId).n>=200)fail(400,'В группе уже 200 тем');
        family.content(chatId,title,false);
        const topicId=id();run('INSERT INTO topics(id,chat_id,title,icon,created,created_by) VALUES(?,?,?,?,?,?)',topicId,chatId,title,clean(b.icon,16),now(),user.id);
        broadcast(chatId,'topics',{chat:chatId});json(topicView(one('SELECT * FROM topics WHERE id=?',topicId),user.id),201);return true;
      }
      fail(405,'Метод не поддерживается');
    }
    const topicRoute=/^\/api\/topics\/([^/]+)$/.exec(path);
    if(topicRoute){
      const t=one('SELECT * FROM topics WHERE id=? AND deleted=0',topicRoute[1]);if(!t)fail(404,'Тема не найдена');
      const {member}=membership(t.chat_id,user.id);
      if(!isStaff(member)&&t.created_by!==user.id)fail(403,'Тему изменяют автор и администраторы');
      if(req.method==='PATCH'){
        const title=b.title===undefined?t.title:clean(b.title,80);if(!title)fail(400,'Введите название темы');
        const closed=b.closed===undefined?t.closed:(b.closed?1:0);if(b.closed!==undefined&&!isStaff(member))fail(403,'Закрывают темы администраторы');
        run('UPDATE topics SET title=?,icon=?,closed=? WHERE id=?',title,b.icon===undefined?t.icon:clean(b.icon,16),closed,t.id);
      }else if(req.method==='DELETE'){
        if(!isStaff(member))fail(403,'Удаляют темы администраторы');
        run('UPDATE topics SET deleted=1 WHERE id=?',t.id);run("UPDATE messages SET deleted=1,body='',e2e=NULL,transcript=NULL WHERE topic_id=?",t.id);
      }else fail(405,'Метод не поддерживается');
      broadcast(t.chat_id,'topics',{chat:t.chat_id});json({ok:true});return true;
    }
    const commentRoute=/^\/api\/messages\/([^/]+)\/comments$/.exec(path);
    if(commentRoute){
      const post=one('SELECT * FROM messages WHERE id=? AND deleted=0',commentRoute[1]);if(!post)fail(404,'Публикация не найдена');
      const {chat,member}=membership(post.chat_id,user.id);family.chatAccess(post.chat_id,user.id);
      if(chat.kind!=='channel')fail(400,'Комментарии есть только у публикаций каналов');
      if(!chat.comments)fail(403,'Комментарии в этом канале выключены');
      if(req.method==='GET'){
        json(all('SELECT c.id,c.user_id,c.body,c.reply_id,c.created,u.name,u.username,u.avatar FROM post_comments c JOIN users u ON u.id=c.user_id WHERE c.message_id=? AND c.deleted=0 ORDER BY c.created LIMIT 500',post.id).map(c=>({...c,mine:c.user_id===user.id,canDelete:c.user_id===user.id||isStaff(member)})));return true;
      }
      if(req.method==='POST'){
        let rules={};try{rules=JSON.parse(member.rules||'{}');}catch{}
        if(rules.overrides?.text===false&&(!rules.until||rules.until>now()))fail(403,'Вам ограничили отправку сообщений');
        const text=clean(b.body,2000);if(!text)fail(400,'Введите комментарий');
        if(b.reply&&!one('SELECT id FROM post_comments WHERE id=? AND message_id=?',String(b.reply),post.id))fail(400,'Комментарий не найден');
        family.content(post.chat_id,text,false);
        const commentId=id();run('INSERT INTO post_comments(id,message_id,chat_id,user_id,body,reply_id,created) VALUES(?,?,?,?,?,?,?)',commentId,post.id,post.chat_id,user.id,text,b.reply||null,now());
        if(post.user_id!==user.id)emit(post.user_id,'comment',{chat:post.chat_id,message:post.id,from:user.name});
        broadcast(post.chat_id,'message',{chat:post.chat_id,id:post.id});
        json({id:commentId},201);return true;
      }
      fail(405,'Метод не поддерживается');
    }
    const deleteComment=/^\/api\/comments\/([^/]+)$/.exec(path);
    if(deleteComment&&req.method==='DELETE'){
      const c=one('SELECT * FROM post_comments WHERE id=? AND deleted=0',deleteComment[1]);if(!c)fail(404,'Комментарий не найден');
      const {member}=membership(c.chat_id,user.id);if(c.user_id!==user.id&&!isStaff(member))fail(403,'Недостаточно прав');
      run('UPDATE post_comments SET deleted=1 WHERE id=?',c.id);broadcast(c.chat_id,'message',{chat:c.chat_id,id:c.message_id});json({ok:true});return true;
    }
    return false;
  }
  return {prepare,deliver,topicFilter,commentCounts,mentionCount,slowWait,sweep,route,GENERAL};
}
