// End-to-end encryption: a public key directory for devices and validation of
// encrypted message envelopes. The server never sees private keys or plaintext;
// it only stores what clients encrypted and hands out public keys.
export const e2eKinds=['direct','saved','group'];
const B64=/^[A-Za-z0-9+/]+={0,2}$/;
const bytes=value=>typeof value==='string'&&B64.test(value)?Buffer.from(value,'base64').length:-1;
const point=value=>bytes(value)===65&&Buffer.from(value,'base64')[0]===4;
const DEVICE=/^[a-f0-9-]{36}$/;
export function parseEnvelope(raw){
  const text=typeof raw==='string'?raw:JSON.stringify(raw);
  if(text.length>400_000)throw Object.assign(new Error('Зашифрованное сообщение слишком большое'),{status:413});
  let e;try{e=JSON.parse(text);}catch{e=null;}
  const bad=()=>{throw Object.assign(new Error('Некорректное зашифрованное сообщение'),{status:400});};
  if(!e||typeof e!=='object'||Array.isArray(e)||e.v!==1)bad();
  if(!DEVICE.test(String(e.from))||!point(e.eph)||bytes(e.iv)!==12||bytes(e.ct)<16||bytes(e.sig)!==64)bad();
  if(!Array.isArray(e.keys)||!e.keys.length||e.keys.length>600)bad();
  const seen=new Set();
  for(const k of e.keys){if(!k||!DEVICE.test(String(k.d))||seen.has(k.d)||bytes(k.iv)!==12||bytes(k.k)!==48)bad();seen.add(k.d);}
  const clean={v:1,from:e.from,eph:e.eph,iv:e.iv,ct:e.ct,keys:e.keys.map(k=>({d:k.d,iv:k.iv,k:k.k})),sig:e.sig};
  return {envelope:clean,text:JSON.stringify(clean)};
}
export function createE2E({db,one,all,run,fail,now,id,membership,family,isBot=()=>false}) {
  if(!all('PRAGMA table_info(messages)').some(c=>c.name==='e2e'))db.exec('ALTER TABLE messages ADD COLUMN e2e TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS e2e_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT,ecdh TEXT NOT NULL,ecdsa TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,ecdh));
    CREATE INDEX IF NOT EXISTS e2e_devices_owner ON e2e_devices(user_id);`);
  const live=`session_id IN (SELECT id FROM sessions WHERE expires>?)`;
  const members=chat=>all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat).map(m=>m.user_id);
  // Why a chat cannot use end-to-end encryption, or null when it can.
  function unavailable(chat){
    if(!e2eKinds.includes(chat.kind))return 'Каналы не поддерживают сквозное шифрование';
    if(members(chat.id).some(u=>isBot(u)))return 'В чате есть бот: боты читают сообщения на сервере, поэтому сквозное шифрование выключено';
    if(members(chat.id).some(u=>family.child(u)))return 'В чатах с детскими аккаунтами действует семейный фильтр, поэтому сообщения не шифруются сквозным образом';
    return null;
  }
  // Validates an envelope for a chat: the sending device must belong to the author.
  function accept(chat,user,raw){
    const reason=unavailable(chat);if(reason)fail(403,reason);
    const {envelope,text}=parseEnvelope(raw);
    if(!one('SELECT id FROM e2e_devices WHERE id=? AND user_id=?',envelope.from,user))fail(400,'Устройство шифрования не зарегистрировано');
    return text;
  }
  async function route({path,req,b,user,url,json}){
    if(path==='/api/e2e/devices'&&req.method==='POST'){
      if(!point(b.ecdh)||!point(b.ecdsa))fail(400,'Некорректные ключи устройства');
      const existing=one('SELECT * FROM e2e_devices WHERE user_id=? AND ecdh=?',user.id,b.ecdh);
      if(existing){if(existing.ecdsa!==b.ecdsa)fail(409,'Ключ уже зарегистрирован с другой подписью');run('UPDATE e2e_devices SET session_id=? WHERE id=?',user.session.id,existing.id);return json({id:existing.id});}
      if(one(`SELECT COUNT(*) n FROM e2e_devices WHERE user_id=? AND ${live}`,user.id,now()).n>=20)fail(429,'Слишком много устройств шифрования. Завершите старые сеансы.');
      const deviceId=id();run('INSERT INTO e2e_devices(id,user_id,session_id,ecdh,ecdsa,created) VALUES(?,?,?,?,?,?)',deviceId,user.id,user.session.id,b.ecdh,b.ecdsa,now());
      return json({id:deviceId},201);
    }
    if(path==='/api/e2e/keys'&&req.method==='GET'){
      const chatId=String(url.searchParams.get('chat')||'');const {chat}=membership(chatId,user.id);
      const reason=unavailable(chat);if(reason)return json({enabled:false,reason,devices:[]});
      const users=members(chatId);
      const devices=all(`SELECT id,user_id,ecdh,ecdsa FROM e2e_devices WHERE user_id IN (${users.map(()=>'?').join(',')}) AND ${live} ORDER BY user_id,created`,...users,now());
      return json({enabled:true,devices:devices.map(d=>({id:d.id,user:d.user_id,ecdh:d.ecdh,ecdsa:d.ecdsa})),users});
    }
    const device=/^\/api\/e2e\/devices\/([a-f0-9-]{36})$/.exec(path);
    if(device&&req.method==='GET'){
      // Retired devices stay resolvable: old messages must still verify.
      const d=one('SELECT id,user_id,ecdh,ecdsa FROM e2e_devices WHERE id=?',device[1]);if(!d)fail(404,'Устройство не найдено');
      return json({id:d.id,user:d.user_id,ecdh:d.ecdh,ecdsa:d.ecdsa});
    }
    return false;
  }
  return {route,accept,unavailable};
}
