// "Защита контента": in a protected chat messages cannot be forwarded, copied or saved.
// Channels and groups: the owner switches it on; owner and admins keep full access to their own content.
// Private chats: either participant can switch it on, and it then applies to both of them.
const community=chat=>!['direct','saved'].includes(chat?.kind);

export function canShare(chat,member){
  if(!chat?.protect_content)return true;
  return community(chat)&&['owner','admin'].includes(member?.role);
}

export function createContentProtection({db,all,run,fail,membership,audit}){
  if(!all('PRAGMA table_info(chats)').some(c=>c.name==='protect_content'))db.exec('ALTER TABLE chats ADD COLUMN protect_content INTEGER NOT NULL DEFAULT 0');
  function route({path,req,b,user,json}){
    const match=/^\/api\/chats\/([^/]+)\/protection$/.exec(path);if(!match)return false;
    if(req.method!=='POST')fail(405,'Метод не поддерживается');
    const {chat,member}=membership(match[1],user.id);
    if(chat.kind==='saved')fail(400,'В «Избранном» защита не нужна');
    if(community(chat)&&member.role!=='owner')fail(403,'Только владелец управляет защитой контента');
    if(typeof b.enabled!=='boolean')fail(400,'Укажите enabled: true или false');
    run('UPDATE chats SET protect_content=? WHERE id=?',b.enabled?1:0,chat.id);
    audit(chat.id,user.id,b.enabled?'protect_on':'protect_off');
    json({ok:true,protect_content:b.enabled?1:0});return true;
  }
  return {route};
}
