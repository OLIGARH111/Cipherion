// Small additions to messages:
//  • a quoted fragment of the message being answered (reply + quote);
//  • a voice waveform computed on the sender's device from the real recording;
//  • a read log, so the author of a group message can see who read it and when.
// In end-to-end encrypted chats the quote and the waveform travel inside the ciphertext instead.
export const WAVE=/^[a-v]{8,128}$/;
export function createMessageExtras({db,one,all,run,fail,now,privacy,isBot=()=>false}){
  for(const [column,type] of [['quote','TEXT'],['wave','TEXT']])
    if(!all('PRAGMA table_info(messages)').some(c=>c.name===column))db.exec(`ALTER TABLE messages ADD COLUMN ${column} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS read_log(chat_id TEXT NOT NULL,user_id TEXT NOT NULL,upto INTEGER NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS read_log_chat ON read_log(chat_id,user_id,upto);`);

  // Validates the quote and waveform of a new plaintext message.
  function accept(b,chatId,sealed){
    let quote=null,wave=null;
    if(b.quote!=null&&b.quote!==''){
      if(sealed)fail(400,'В зашифрованном чате цитата передаётся внутри шифротекста');
      if(!b.reply)fail(400,'Цитата нужна вместе с ответом');
      quote=String(b.quote).replace(/\s+/g,' ').trim().slice(0,1000);
      const original=one('SELECT body,e2e FROM messages WHERE id=? AND chat_id=?',String(b.reply),chatId);
      if(!original)fail(400,'Ответ недоступен');
      if(!original.e2e&&!String(original.body||'').replace(/\s+/g,' ').includes(quote))fail(400,'Цитата не найдена в исходном сообщении');
      if(!quote)quote=null;
    }
    if(b.wave!=null&&b.wave!==''){
      if(sealed)fail(400,'В зашифрованном чате волна передаётся внутри шифротекста');
      if(!['voice','round'].includes(b.kind)||!WAVE.test(String(b.wave)))fail(400,'Некорректная звуковая волна');
      wave=String(b.wave);
    }
    return {quote,wave};
  }
  // Called when a member's read mark moves forward.
  function logRead(chatId,userId,upto,previous){
    if(!(upto>previous))return;
    run('INSERT INTO read_log VALUES(?,?,?,?)',chatId,userId,upto,now());
  }
  function readers(m,viewer){
    const chat=one('SELECT * FROM chats WHERE id=?',m.chat_id);
    if(chat.kind!=='group')fail(400,'Список прочитавших доступен в группах');
    if(m.user_id!==viewer)fail(403,'Список прочитавших видит только автор сообщения');
    if(m.deleted)fail(404,'Сообщение удалено');
    const people=all("SELECT m.user_id,m.read_at,u.name,u.avatar,u.username FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.role!='banned' AND m.user_id!=?",m.chat_id,viewer).filter(p=>!isBot(p.user_id));
    const read=[],hidden=[];
    for(const p of people){
      if(!(p.read_at>=m.created))continue;
      if(!privacy.canRead(p.user_id,'group')){hidden.push(p.user_id);continue;}
      const at=one('SELECT MIN(at) n FROM read_log WHERE chat_id=? AND user_id=? AND upto>=?',m.chat_id,p.user_id,m.created)?.n||null;
      read.push({id:p.user_id,name:p.name,avatar:p.avatar,username:p.username,at});
    }
    read.sort((a,b)=>(b.at||0)-(a.at||0));
    return {read,total:people.length,hidden:hidden.length};
  }
  function sweep(){run('DELETE FROM read_log WHERE at<?',now()-60*86400_000);}
  return {accept,logRead,readers,sweep};
}
