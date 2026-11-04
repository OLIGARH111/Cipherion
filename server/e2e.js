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
// History transfer. Each account has one symmetric "history key" that only its devices hold.
// A device that can open a message wraps that message's content key with the history key and
// uploads the result (a grant). A new device that receives the history key — from another device
// over QR, or from a password-protected backup — opens old messages through those grants. The
// server stores grants and the encrypted backup but never the history key itself.
const HISTORY_ID=/^[a-f0-9]{32}$/;
export function parseBackup(raw){
  const b=raw&&typeof raw==='object'?raw:null;
  if(!b||b.v!==1||bytes(b.salt)!==16||bytes(b.iv)!==12||bytes(b.ct)!==48||!Number.isInteger(b.iter)||b.iter<100_000||b.iter>5_000_000)throw Object.assign(new Error('Некорректная резервная копия ключей'),{status:400});
  return {v:1,salt:b.salt,iv:b.iv,ct:b.ct,iter:b.iter};
}
// A history key wrapped for another device's one-time ECDH key.
export function parseTransfer(raw){
  const t=raw&&typeof raw==='object'?raw:null;
  if(!t||!HISTORY_ID.test(String(t.keyId))||!point(t.eph)||bytes(t.iv)!==12||bytes(t.ct)!==48)throw Object.assign(new Error('Некорректные данные переноса ключей'),{status:400});
  return {keyId:t.keyId,eph:t.eph,iv:t.iv,ct:t.ct};
}
export const validPoint=point;
export function createE2E({db,one,all,run,fail,now,id,membership,family,isBot=()=>false,unavailableExtra=()=>null}) {
  if(!all('PRAGMA table_info(messages)').some(c=>c.name==='e2e'))db.exec('ALTER TABLE messages ADD COLUMN e2e TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS e2e_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT,ecdh TEXT NOT NULL,ecdsa TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,ecdh));
    CREATE INDEX IF NOT EXISTS e2e_devices_owner ON e2e_devices(user_id);
    CREATE TABLE IF NOT EXISTS e2e_history(user_id TEXT PRIMARY KEY REFERENCES users(id),key_id TEXT NOT NULL,backup TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS e2e_grants(user_id TEXT NOT NULL,message_id TEXT NOT NULL,key_id TEXT NOT NULL,iv TEXT NOT NULL,k TEXT NOT NULL,PRIMARY KEY(user_id,message_id));
    CREATE TABLE IF NOT EXISTS e2e_transfers(code TEXT PRIMARY KEY,user_id TEXT NOT NULL,pub TEXT NOT NULL,payload TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  const history=user=>one('SELECT key_id,backup,updated FROM e2e_history WHERE user_id=?',user);
  const historyView=user=>{const h=history(user);return h?{keyId:h.key_id,backup:h.backup?JSON.parse(h.backup):null,updated:h.updated}:{keyId:null,backup:null};};
  // Grants of one viewer for a page of messages, in one query per 400 ids.
  function grants(viewer,ids){
    const map=new Map();const h=history(viewer);if(!h)return map;
    for(let i=0;i<ids.length;i+=400){const part=ids.slice(i,i+400);for(const g of all(`SELECT message_id,iv,k FROM e2e_grants WHERE user_id=? AND key_id=? AND message_id IN (${part.map(()=>'?').join(',')})`,viewer,h.key_id,...part))map.set(g.message_id,{key:h.key_id,iv:g.iv,k:g.k});}
    return map;
  }
  const CODE='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const transferCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>CODE[b%CODE.length]).join('');
  const live=`session_id IN (SELECT id FROM sessions WHERE expires>?)`;
  const members=chat=>all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat).map(m=>m.user_id);
  // Why a chat cannot use end-to-end encryption, or null when it can.
  function unavailable(chat){
    if(!e2eKinds.includes(chat.kind))return 'Каналы не поддерживают сквозное шифрование';
    if(members(chat.id).some(u=>isBot(u)))return 'В чате есть бот: боты читают сообщения на сервере, поэтому сквозное шифрование выключено';
    if(members(chat.id).some(u=>family.child(u)))return 'В чатах с детскими аккаунтами действует семейный фильтр, поэтому сообщения не шифруются сквозным образом';
    return unavailableExtra(chat);
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
    if(path==='/api/e2e/history'&&req.method==='GET')return json(historyView(user.id));
    // The first device of an account creates the history key; later devices get the same one.
    if(path==='/api/e2e/history'&&req.method==='POST'){
      if(!HISTORY_ID.test(String(b.keyId)))fail(400,'Некорректный ключ истории');
      if(b.reset===true){
        // All devices with the key are lost: start a new key. Old grants become useless.
        run('DELETE FROM e2e_grants WHERE user_id=?',user.id);
        run('INSERT INTO e2e_history VALUES(?,?,NULL,?,?) ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id,backup=NULL,updated=excluded.updated',user.id,b.keyId,now(),now());
      }else if(!history(user.id)){
        // Old messages live on the devices that were signed in first. Only the oldest live device starts
        // the key on its own, so it can prepare its history; another device may start it only on request.
        const mine=one('SELECT created FROM e2e_devices WHERE id=? AND user_id=?',String(b.device||''),user.id);if(!mine)fail(400,'Устройство шифрования не зарегистрировано');
        if(b.force!==true&&one(`SELECT 1 FROM e2e_devices WHERE user_id=? AND id!=? AND created<? AND ${live}`,user.id,b.device,mine.created,now()))return json({...historyView(user.id),older:true});
        run('INSERT OR IGNORE INTO e2e_history VALUES(?,?,NULL,?,?)',user.id,b.keyId,now(),now());
      }
      return json(historyView(user.id));
    }
    if(path==='/api/e2e/history/backup'&&['PUT','DELETE'].includes(req.method)){
      const h=history(user.id);if(!h)fail(409,'Ключ истории ещё не создан');
      if(req.method==='DELETE'){run('UPDATE e2e_history SET backup=NULL,updated=? WHERE user_id=?',now(),user.id);return json(historyView(user.id));}
      if(b.keyId!==h.key_id)fail(409,'Ключ истории изменился. Обновите страницу.');
      run('UPDATE e2e_history SET backup=?,updated=? WHERE user_id=?',JSON.stringify(parseBackup(b.backup)),now(),user.id);
      return json(historyView(user.id));
    }
    if(path==='/api/e2e/grants'&&req.method==='POST'){
      const h=history(user.id);if(!h||b.keyId!==h.key_id)fail(409,'Ключ истории изменился');
      const items=(Array.isArray(b.items)?b.items:[]).slice(0,500).filter(g=>g&&typeof g.m==='string'&&g.m.length<=100&&bytes(g.iv)===12&&bytes(g.k)===48);
      if(!items.length)return json({saved:0});
      const ids=[...new Set(items.map(g=>g.m))],allowed=new Set();
      for(let i=0;i<ids.length;i+=400){const part=ids.slice(i,i+400);for(const r of all(`SELECT m.id FROM messages m JOIN members p ON p.chat_id=m.chat_id AND p.user_id=? AND p.role!='banned' WHERE m.e2e IS NOT NULL AND m.deleted=0 AND m.id IN (${part.map(()=>'?').join(',')})`,user.id,...part))allowed.add(r.id);}
      let saved=0;
      for(const g of items)if(allowed.has(g.m)){run('INSERT INTO e2e_grants VALUES(?,?,?,?,?) ON CONFLICT(user_id,message_id) DO UPDATE SET key_id=excluded.key_id,iv=excluded.iv,k=excluded.k WHERE e2e_grants.key_id!=excluded.key_id',user.id,g.m,h.key_id,g.iv,g.k);saved++;}
      return json({saved});
    }
    // Device-to-device transfer for an account that is already signed in on the new device.
    if(path==='/api/e2e/transfer'&&req.method==='POST'){
      if(!point(b.pub))fail(400,'Некорректный ключ устройства');
      run('DELETE FROM e2e_transfers WHERE expires<?',now());
      if(one('SELECT COUNT(*) n FROM e2e_transfers WHERE user_id=?',user.id).n>=5)fail(429,'Слишком много запросов переноса. Подождите несколько минут.');
      const code=transferCode();run('INSERT INTO e2e_transfers VALUES(?,?,?,NULL,?,?)',code,user.id,b.pub,now(),now()+10*60_000);
      return json({code,expires:now()+10*60_000});
    }
    const transfer=/^\/api\/e2e\/transfer\/([A-Z0-9]{8})$/.exec(path);
    if(transfer){
      const row=one('SELECT * FROM e2e_transfers WHERE code=? AND user_id=? AND expires>?',transfer[1],user.id,now());
      if(!row)fail(404,'Код переноса не найден или устарел');
      if(req.method==='GET')return json({pub:row.pub,ready:!!row.payload,payload:row.payload?JSON.parse(row.payload):null});
      if(req.method==='PUT'){if(row.payload)fail(409,'Ключи уже переданы');run('UPDATE e2e_transfers SET payload=? WHERE code=?',JSON.stringify(parseTransfer(b.payload)),row.code);return json({ok:true});}
      if(req.method==='DELETE'){run('DELETE FROM e2e_transfers WHERE code=?',row.code);return json({ok:true});}
    }
    const device=/^\/api\/e2e\/devices\/([a-f0-9-]{36})$/.exec(path);
    if(device&&req.method==='GET'){
      // Retired devices stay resolvable: old messages must still verify.
      const d=one('SELECT id,user_id,ecdh,ecdsa FROM e2e_devices WHERE id=?',device[1]);if(!d)fail(404,'Устройство не найдено');
      return json({id:d.id,user:d.user_id,ecdh:d.ecdh,ecdsa:d.ecdsa});
    }
    return false;
  }
  return {route,accept,unavailable,grants,history:historyView};
}
