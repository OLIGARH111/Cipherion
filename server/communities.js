// Use the existing memberships, permissions and SSE transport.
export function createCommunities({db,one,all,run,fail,now,id,membership,family,chatView,emit,liveCalls,endCall}) {
 if(!all('PRAGMA table_info(chats)').some(c=>c.name==='invite_key'))db.exec('ALTER TABLE chats ADD COLUMN invite_key TEXT');
 if(!all('PRAGMA table_info(chats)').some(c=>c.name==='reactions_enabled'))db.exec('ALTER TABLE chats ADD COLUMN reactions_enabled INTEGER NOT NULL DEFAULT 1');
 run("UPDATE members SET role='subscriber' WHERE role='member' AND chat_id IN (SELECT id FROM chats WHERE kind='channel')");
 async function route({path,req,b,user,json}) {
  const match=/^\/api\/communities\/([^/]+)(?:\/(join|leave|invite))?$/.exec(path);if(!match)return false;
  const chat=one("SELECT * FROM chats WHERE id=? AND kind NOT IN ('direct','saved')",match[1]);if(!chat)fail(404,'Сообщество не найдено');
  const member=one('SELECT * FROM members WHERE chat_id=? AND user_id=?',chat.id,user.id),action=match[2];
  if(action==='join'&&req.method==='POST') {
   if(member?.role==='banned')fail(403,'Доступ закрыт');
   if(!member&&(!chat.invite_key||b.invite!==chat.invite_key))fail(403,'Нужна действующая ссылка приглашения');
   family.group(user.id,chat.id);
   if(!member)run('INSERT INTO members(chat_id,user_id,role) VALUES(?,?,?)',chat.id,user.id,chat.kind==='channel'?'subscriber':'member');
   for(const m of all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat.id))emit(m.user_id,'refresh',{chat:chat.id});
   json(chatView(chat,user.id));return true;
  }
  if(!action&&req.method==='GET') {
   if(member?.role==='banned')fail(403,'Доступ закрыт');
   // Preview discloses no posts or subscriber identities. Possession of the invite is required.
   const invite=new URL(req.url,'http://localhost').searchParams.get('invite');
   if(!member&&(!chat.invite_key||invite!==chat.invite_key))fail(403,'Нужна ссылка приглашения');
   json({id:chat.id,title:chat.title,kind:chat.kind,subscribed:!!member,count:one("SELECT COUNT(*) n FROM members WHERE chat_id=? AND role!='banned'",chat.id).n});return true;
  }
  membership(chat.id,user.id);family.chatAccess(chat.id,user.id);
  if(action==='invite'&&req.method==='POST') {
   if(member.role!=='owner')fail(403,'Только владелец');
   const key=chat.invite_key||id();run('UPDATE chats SET invite_key=? WHERE id=?',key,chat.id);json({invite:key});return true;
  }
  if(action==='leave'&&req.method==='POST') {
   if(member.role==='owner')fail(409,'Передайте владение или удалите сообщество');
   run('DELETE FROM members WHERE chat_id=? AND user_id=?',chat.id,user.id);emit(user.id,'chat-deleted',{chat:chat.id});
   for(const m of all('SELECT user_id FROM members WHERE chat_id=?',chat.id))emit(m.user_id,'refresh',{chat:chat.id});
   json({ok:true});return true;
  }
  if(!action&&req.method==='DELETE') {
   if(member.role!=='owner')fail(403,'Удалить сообщество может только владелец');
   const recipients=all('SELECT user_id FROM members WHERE chat_id=?',chat.id);
   db.exec('BEGIN IMMEDIATE');try {
    run('DELETE FROM push_attempts WHERE job IN (SELECT id FROM notification_jobs WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?) OR message_id IN (SELECT id FROM notification_events WHERE chat_id=?))',chat.id,chat.id);
    run('DELETE FROM notification_jobs WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?) OR message_id IN (SELECT id FROM notification_events WHERE chat_id=?)',chat.id,chat.id);
    for(const table of ['votes','reactions','message_stickers','message_requests','poll_attempts','poll_comments','story_replies'])run(`DELETE FROM ${table} WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?)`,chat.id);
    for(const table of ['message_events','notification_events','scheduled','poll_schedule','chat_mutes','audit','calls','drafts'])run(`DELETE FROM ${table} WHERE chat_id=?`,chat.id);
    run('DELETE FROM family_groups WHERE chat=?',chat.id);
    run('DELETE FROM messages WHERE chat_id=?',chat.id);run('DELETE FROM members WHERE chat_id=?',chat.id);run('DELETE FROM chats WHERE id=?',chat.id);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   for(const call of liveCalls.values())if(call.chat===chat.id){for(const r of recipients)emit(r.user_id,'call',{id:call.id,state:'ended'});liveCalls.delete(call.id);}
   for(const r of recipients)emit(r.user_id,'chat-deleted',{chat:chat.id});
   json({ok:true});return true;
  }
  fail(405,'Метод не поддерживается');
 }
 return {route};
}
