// Spam protection for groups, set by admins:
//  • new members confirm they are human (a small arithmetic question) before they can write;
//  • links from ordinary members are blocked;
//  • messages with banned words are rejected, or their author is banned automatically.
// The link and word filters read message text on the server, so a group that uses them is not
// end-to-end encrypted (like a group with a bot). The membership check works with encryption.
import {randomBytes} from 'node:crypto';
const LINK=/(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:ru|com|net|org|io|me|su|рф|info|xyz|online|site|shop|top|app|dev|link|ly|gg|tv)\b(?:\/\S*)?|t\.me\/\S+/i;
export const hasLink=text=>LINK.test(String(text||''));
const fold=text=>String(text||'').toLowerCase().replace(/ё/g,'е');
export function matchesWord(text,words){
  const body=' '+fold(text).replace(/[^\p{L}\p{N}]+/gu,' ')+' ';
  return words.find(w=>{const word=fold(w).replace(/[^\p{L}\p{N}]+/gu,' ').trim();return word&&body.includes(' '+word+' ');})||null;
}
export function createAntispam({db,one,all,run,fail,now,emit,broadcast,audit,isBot=()=>false}){
  if(!all('PRAGMA table_info(chats)').some(c=>c.name==='guard'))db.exec("ALTER TABLE chats ADD COLUMN guard TEXT DEFAULT '{}'");
  db.exec('CREATE TABLE IF NOT EXISTS chat_verified(chat_id TEXT NOT NULL,user_id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(chat_id,user_id));');
  const challenges=new Map();
  function config(chat){
    let g={};try{g=JSON.parse(chat?.guard||'{}')||{};}catch{}
    return {verify:g.verify===true,links:g.links===true,words:Array.isArray(g.words)?g.words.map(String).filter(Boolean).slice(0,100):[],action:g.action==='ban'?'ban':'delete'};
  }
  const staff=member=>['owner','admin'].includes(member?.role);
  const verified=(chatId,userId)=>!!one('SELECT 1 FROM chat_verified WHERE chat_id=? AND user_id=?',chatId,userId);
  const needsVerify=(chat,member,userId)=>chat.kind==='group'&&config(chat).verify&&!staff(member)&&!isBot(userId)&&!verified(chat.id,userId);
  // Text filters need plaintext; the e2e module asks this before allowing encryption.
  function blocksEncryption(chat){const g=config(chat);return chat.kind==='group'&&(g.links||g.words.length>0)?'В группе включён фильтр ссылок или слов: сервер проверяет текст сообщений, поэтому сквозное шифрование выключено':null;}
  function check(chat,member,userId,text){
    if(chat.kind!=='group'||isBot(userId))return;
    if(needsVerify(chat,member,userId))throw Object.assign(new Error('Подтвердите, что вы не бот, чтобы писать в этой группе'),{status:403,needVerify:true});
    const g=config(chat);if(staff(member)||!text)return;
    if(g.links&&hasLink(text))fail(403,'В этой группе участникам нельзя отправлять ссылки');
    const word=g.words.length&&matchesWord(text,g.words);
    if(word){
      if(g.action==='ban'){
        run("UPDATE members SET role='banned',rules='{}' WHERE chat_id=? AND user_id=?",chat.id,userId);
        audit(chat.id,null,'autoban',userId);emit(userId,'refresh',{chat:chat.id});
        fail(403,'Сообщение содержит запрещённые слова. Вы заблокированы в этой группе.');
      }
      fail(403,'Сообщение содержит запрещённые в этой группе слова');
    }
  }
  function view(chat,member,userId){
    if(chat.kind!=='group')return {};
    const g=config(chat);
    return {needsVerify:needsVerify(chat,member,userId),...(staff(member)?{guard:g}:{guardActive:g.verify||g.links||g.words.length>0})};
  }
  async function route({path,req,b,user,json,membership,requirePermission}){
    const match=/^\/api\/chats\/([^/]+)\/(guard|verify)$/.exec(path);if(!match)return false;
    const [,chatId,action]=match;const {chat,member}=membership(chatId,user.id);
    if(chat.kind!=='group')fail(400,'Защита от спама доступна в группах');
    if(action==='guard'&&req.method==='PATCH'){
      requirePermission(chatId,user.id,'permissions');
      const before=config(chat),words=b.words===undefined?before.words:(Array.isArray(b.words)?b.words:String(b.words||'').split(/[,\n]/)).map(w=>String(w).trim().slice(0,40)).filter(Boolean).slice(0,100);
      const next={verify:b.verify===undefined?before.verify:b.verify===true,links:b.links===undefined?before.links:b.links===true,words,action:b.action===undefined?before.action:(b.action==='ban'?'ban':'delete')};
      // Members who are already here are trusted; only people who join later are asked.
      if(next.verify&&!before.verify)run("INSERT OR IGNORE INTO chat_verified SELECT chat_id,user_id,? FROM members WHERE chat_id=? AND role!='banned'",now(),chatId);
      run('UPDATE chats SET guard=? WHERE id=?',JSON.stringify(next),chatId);audit(chatId,user.id,'guard',[next.verify&&'verify',next.links&&'links',next.words.length&&'words:'+next.action].filter(Boolean).join(','));
      json(next);return true;
    }
    if(action==='verify'&&req.method==='GET'){
      if(!needsVerify(chat,member,user.id))return json({verified:true}),true;
      for(const [k,v] of challenges)if(v.expires<now())challenges.delete(k);
      const a=2+randomBytes(1)[0]%8,c=2+randomBytes(1)[0]%8,token=randomBytes(16).toString('hex');
      challenges.set(token,{chat:chatId,user:user.id,answer:a+c,expires:now()+5*60_000,tries:0});
      json({token,question:`Сколько будет ${a} + ${c}?`});return true;
    }
    if(action==='verify'&&req.method==='POST'){
      const ch=challenges.get(String(b.token||''));
      if(!ch||ch.chat!==chatId||ch.user!==user.id||ch.expires<now())fail(400,'Вопрос устарел. Запросите новый.');
      if(Number(b.answer)!==ch.answer){if(++ch.tries>=3)challenges.delete(String(b.token));fail(400,'Неверный ответ');}
      challenges.delete(String(b.token));run('INSERT OR IGNORE INTO chat_verified VALUES(?,?,?)',chatId,user.id,now());
      broadcast(chatId,'refresh',{chat:chatId});json({verified:true});return true;
    }
    fail(405,'Метод не поддерживается');
  }
  return {check,view,route,blocksEncryption,config};
}
