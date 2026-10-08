// Group and channel lifecycle: owner-only deletion, leaving, public channel discovery and joining.
// Permission rules for posting live in permissions.js; routes here never trust client-side hiding.
export function createCommunities({db,one,all,run,fail,now,id,rate,clean,membership,emit,family,liveCalls,endCall,chatView,audit}) {
  const subscribers=chatId=>one("SELECT COUNT(*) n FROM members WHERE chat_id=? AND role!='banned'",chatId).n;
  const card=(chat,userId)=>({id:chat.id,title:chat.title,avatar:chat.avatar||'',kind:chat.kind,public:!!chat.public,subscribers:subscribers(chat.id),joined:!!one("SELECT 1 x FROM members WHERE chat_id=? AND user_id=? AND role!='banned'",chat.id,userId)});
  // Removes the chat and everything that points at it. Tables are discovered from the schema so
  // modules added later (stories, polls, scheduled posts, family links...) are cleaned too, and an
  // unexpected foreign key aborts the whole transaction instead of leaving half a chat behind.
  function purge(chatId){
    const tables=all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(t=>t.name).filter(name=>!['chats','messages','schema_migrations'].includes(name));
    db.exec('BEGIN');
    try{
      for(const table of tables){
        const names=all(`PRAGMA table_info("${table}")`).map(c=>c.name);
        if(names.includes('message_id'))run(`DELETE FROM "${table}" WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)`,chatId);
        if(names.includes('chat_id'))run(`DELETE FROM "${table}" WHERE chat_id=?`,chatId);
        else if(names.includes('chat'))run(`DELETE FROM "${table}" WHERE chat=?`,chatId);
      }
      run('DELETE FROM messages WHERE chat_id=?',chatId);
      run('DELETE FROM chats WHERE id=?',chatId);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function removeFromCalls(chatId,userId){
    for(const call of liveCalls.values())if(call.chat===chatId&&call.participants.has(userId)){call.participants.delete(userId);if(call.participants.size<2)endCall(call,'ended');}
  }
  async function route({path,req,b,user,json,url}){
    if(path==='/api/channels/discover'&&req.method==='GET'){
      rate('discover:'+user.id,60);
      const q=clean(url.searchParams.get('q'),80).toLowerCase();
      return json(all("SELECT * FROM chats WHERE kind='channel' AND public=1 AND (?='' OR instr(lower(title),?)>0) ORDER BY created DESC LIMIT 30",q,q).map(chat=>card(chat,user.id))),true;
    }
    let match=/^\/api\/channels\/([^/]+)\/(preview|join)$/.exec(path);
    if(match){
      const chat=one("SELECT * FROM chats WHERE id=? AND kind='channel'",match[1]);
      const row=chat&&one('SELECT * FROM members WHERE chat_id=? AND user_id=?',chat.id,user.id);
      if(!chat||(!chat.public&&!row))fail(404,'Канал не найден');
      if(match[2]==='preview'&&req.method==='GET')return json(card(chat,user.id)),true;
      if(match[2]==='join'&&req.method==='POST'){
        rate('join:'+user.id,30);
        if(row?.role==='banned')fail(403,'Вы заблокированы в этом канале');
        if(row)return json(chatView(chat,user.id)),true;
        family.group(user.id,chat.id);
        run("INSERT INTO members(chat_id,user_id,role) VALUES(?,?,'member')",chat.id,user.id);
        audit(chat.id,user.id,'join',user.id);
        return json(chatView(chat,user.id),201),true;
      }
      fail(405,'Метод не поддерживается');
    }
    match=/^\/api\/chats\/([^/]+)$/.exec(path);
    if(match&&req.method==='DELETE'){
      const {chat,member}=membership(match[1],user.id);
      if(chat.kind==='direct')fail(400,'Личный чат нельзя удалить как группу или канал');
      // Server-side owner check: admins and subscribers get 403 even if they craft the request by hand.
      if(member.role!=='owner')fail(403,chat.kind==='channel'?'Удалить канал может только владелец':'Удалить группу может только владелец');
      rate('delete-chat:'+user.id,10);
      const people=all('SELECT user_id FROM members WHERE chat_id=?',chat.id).map(m=>m.user_id);
      for(const call of [...liveCalls.values()])if(call.chat===chat.id)endCall(call,'ended');
      purge(chat.id);
      for(const person of people)emit(person,'chat-deleted',{chat:chat.id,kind:chat.kind,title:chat.title,by:user.id});
      return json({ok:true}),true;
    }
    match=/^\/api\/chats\/([^/]+)\/leave$/.exec(path);
    if(match&&req.method==='POST'){
      const {chat,member}=membership(match[1],user.id);
      if(chat.kind==='direct')fail(400,'Из личного чата нельзя выйти');
      if(member.role==='owner')fail(400,chat.kind==='channel'?'Владелец не может покинуть канал. Передайте владение или удалите канал.':'Владелец не может покинуть группу. Передайте владение или удалите группу.');
      run('DELETE FROM members WHERE chat_id=? AND user_id=?',chat.id,user.id);
      run('DELETE FROM chat_mutes WHERE chat_id=? AND user_id=?',chat.id,user.id);
      removeFromCalls(chat.id,user.id);
      audit(chat.id,user.id,'leave',user.id);
      emit(user.id,'chat-removed',{chat:chat.id,kind:chat.kind,title:chat.title});
      return json({ok:true}),true;
    }
    return false;
  }
  return {route,purge,subscribers};
}
