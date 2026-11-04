// Telegram-style chat tools: Saved Messages, per-user history clearing and
// chat removal, cloud drafts and global search across the user's chats.
export function createChatTools({db,one,all,run,fail,now,id,clean,membership,family,emit,broadcast,projectMessage}) {
  const columns=all('PRAGMA table_info(members)');
  for(const [name,type] of [['cleared_at','INTEGER DEFAULT 0'],['hidden','INTEGER DEFAULT 0']])
    if(!columns.some(c=>c.name===name))db.exec(`ALTER TABLE members ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS drafts(user_id TEXT NOT NULL REFERENCES users(id),chat_id TEXT NOT NULL REFERENCES chats(id),body TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,chat_id));`);

  const savedChat=user=>one("SELECT c.* FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.kind='saved' AND m.user_id=?",user);
  function ensureSaved(user){
    const existing=savedChat(user);
    if(existing){run('UPDATE members SET hidden=0 WHERE chat_id=? AND user_id=?',existing.id,user);return existing;}
    const chatId=id();
    db.exec('BEGIN');
    try{run("INSERT INTO chats(id,kind,title,permissions,created) VALUES(?,'saved','Избранное','{}',?)",chatId,now());run("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'owner')",chatId,user);db.exec('COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
    return one('SELECT * FROM chats WHERE id=?',chatId);
  }
  // A hidden chat reappears as soon as a message newer than its clearing point arrives.
  const visible=(chat,member)=>!member.hidden||!!one('SELECT 1 FROM messages WHERE chat_id=? AND created>?',chat,member.cleared_at||0);
  const clearedAt=(chat,user)=>one('SELECT cleared_at FROM members WHERE chat_id=? AND user_id=?',chat,user)?.cleared_at||0;
  const draft=(user,chat)=>one('SELECT body,updated FROM drafts WHERE user_id=? AND chat_id=?',user,chat)||null;

  function clear(chat,users,hide){
    const at=Math.max(now(),(one('SELECT MAX(created) n FROM messages WHERE chat_id=?',chat.id)?.n||0));
    for(const user of users){
      run('UPDATE members SET cleared_at=?,read_at=MAX(read_at,?),hidden=? WHERE chat_id=? AND user_id=?',at,at,hide?1:0,chat.id,user);
      if(hide)run('DELETE FROM drafts WHERE user_id=? AND chat_id=?',user,chat.id);
      emit(user,'chat-cleared',{chat:chat.id,clearedAt:at,hidden:!!hide});
    }
    return at;
  }

  const lowerVariants=q=>{const lower=q.toLowerCase();return [...new Set([lower,q,lower.charAt(0).toUpperCase()+lower.slice(1),q.toUpperCase()])];};
  function search(user,q,type,before){
    const variants=lowerVariants(q);
    const textMatch=`(${variants.map(()=>'instr(m.body,?)>0').join(' OR ')}${type==='media'?' OR '+variants.map(()=>'instr(f.name,?)>0').join(' OR '):''})`;
    const kinds=type==='media'?"AND m.kind IN ('photo','video','round')":type==='links'?"AND (instr(m.body,'http://')>0 OR instr(m.body,'https://')>0 OR instr(m.body,'www.')>0)":"AND m.kind NOT IN ('sticker')";
    const params=[user,before,...variants,...(type==='media'?variants:[])];
    const rows=all(`SELECT m.* FROM messages m JOIN members p ON p.chat_id=m.chat_id LEFT JOIN media f ON f.id=m.media_id
      WHERE p.user_id=? AND p.role!='banned' AND m.deleted=0 AND m.created>p.cleared_at AND m.created<? ${kinds} ${q?'AND '+textMatch:''}
      ORDER BY m.created DESC LIMIT 40`,...(q?params:params.slice(0,2)));
    return rows.flatMap(row=>{try{family.chatAccess(row.chat_id,user);return [projectMessage(row,user)];}catch{return [];}});
  }

  async function route({path,req,b,user,json,url}){
    if(path==='/api/chats/saved'&&req.method==='POST'){json(ensureSaved(user.id),201);return true;}
    if(path==='/api/search'&&req.method==='GET'){
      const q=clean(url.searchParams.get('q'),100),type=['messages','media','links'].includes(url.searchParams.get('type'))?url.searchParams.get('type'):'messages';
      const before=url.searchParams.has('before')?Number(url.searchParams.get('before')):Number.MAX_SAFE_INTEGER;
      if(!Number.isSafeInteger(before)||before<0)fail(400,'Некорректный курсор');
      if(!q&&type==='messages'){json([]);return true;}
      json(search(user.id,q,type,before));return true;
    }
    const match=/^\/api\/chats\/([^/]+)\/(clear|hide|draft)$/.exec(path);
    if(!match)return false;
    const {chat,member}=membership(match[1],user.id),action=match[2];
    if(action==='draft'&&req.method==='PUT'){
      // Drafts encrypted with the account's history key (e2d1:…) are opaque here and longer than the text.
      const raw=String(b.body??'').trim(),sealed=/^e2d1:[a-f0-9]{32}:[A-Za-z0-9+/=]{16}:[A-Za-z0-9+/=]{24,22000}$/.test(raw);
      const body=sealed?raw:clean(b.body,4000);
      if(body)run('INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET body=excluded.body,updated=excluded.updated',user.id,chat.id,body,now());
      else run('DELETE FROM drafts WHERE user_id=? AND chat_id=?',user.id,chat.id);
      emit(user.id,'draft',{chat:chat.id,body,updated:now()});json({ok:true});return true;
    }
    if(req.method!=='POST')fail(405,'Метод не поддерживается');
    if(action==='clear'||action==='hide'){
      // Groups and channels keep their history for others; "for everyone" is only offered in private chats.
      const both=b.forEveryone===true;
      if(both&&chat.kind!=='direct')fail(400,'Удалить для всех можно только в личном чате');
      if(action==='hide'&&!['direct','saved'].includes(chat.kind))fail(400,'Покиньте группу или канал вместо удаления');
      const users=both?all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat.id).map(m=>m.user_id):[member.user_id];
      json({ok:true,clearedAt:clear(chat,users,action==='hide')});return true;
    }
    return false;
  }
  return {route,ensureSaved,visible,clearedAt,draft};
}
