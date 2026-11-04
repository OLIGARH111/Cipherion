// Passwordless sign-in:
//  • QR login: a new device shows a QR code, a phone that is already signed in scans it
//    and approves. The QR carries only a short approval code; the new device polls with
//    a separate secret, so a photo of the screen cannot be used to take over the session.
//  • Passkeys (WebAuthn / Face ID / Touch ID / Windows Hello). Signatures are verified
//    here with node:crypto; the private key never leaves the authenticator.
import {parseTransfer,validPoint} from './e2e.js';
import {createHash,createPublicKey,randomBytes,verify as verifySignature,timingSafeEqual} from 'node:crypto';

const sha256=data=>createHash('sha256').update(data).digest();
const b64url=buffer=>Buffer.from(buffer).toString('base64url');
const fromB64url=text=>{if(typeof text!=='string'||!/^[A-Za-z0-9_-]*={0,2}$/.test(text)||text.length>20000)throw Object.assign(new Error('Некорректные данные ключа'),{status:400});return Buffer.from(text,'base64url');};
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Minimal CBOR decoder: enough for WebAuthn attestation objects and COSE keys.
export function decodeCBOR(buffer){
  let offset=0;
  const need=n=>{if(offset+n>buffer.length)throw new Error('CBOR: unexpected end');};
  function length(info){
    if(info<24)return info;
    if(info===24){need(1);return buffer[offset++];}
    if(info===25){need(2);const v=buffer.readUInt16BE(offset);offset+=2;return v;}
    if(info===26){need(4);const v=buffer.readUInt32BE(offset);offset+=4;return v;}
    if(info===27){need(8);const v=Number(buffer.readBigUInt64BE(offset));offset+=8;return v;}
    throw new Error('CBOR: unsupported length');
  }
  function item(depth=0){
    if(depth>16)throw new Error('CBOR: too deep');
    need(1);const head=buffer[offset++],major=head>>5,info=head&31;
    if(major===7){if(info===20)return false;if(info===21)return true;if(info===22||info===23)return null;throw new Error('CBOR: unsupported simple value');}
    const n=length(info);
    switch(major){
      case 0:return n;
      case 1:return -1-n;
      case 2:{need(n);const v=buffer.subarray(offset,offset+n);offset+=n;return v;}
      case 3:{need(n);const v=buffer.toString('utf8',offset,offset+n);offset+=n;return v;}
      case 4:{const list=[];for(let i=0;i<n;i++)list.push(item(depth+1));return list;}
      case 5:{const map=new Map();for(let i=0;i<n;i++){const k=item(depth+1);map.set(k,item(depth+1));}return map;}
      case 6:return item(depth+1);
    }
    throw new Error('CBOR: unsupported type');
  }
  const value=item();return {value,used:offset};
}

// Parses authenticator data: rpIdHash, flags, counter and (on registration) the credential.
export function parseAuthData(data){
  if(data.length<37)throw Object.assign(new Error('Некорректные данные аутентификатора'),{status:400});
  const out={rpIdHash:data.subarray(0,32),flags:data[32],counter:data.readUInt32BE(33)};
  out.userPresent=!!(out.flags&1);out.userVerified=!!(out.flags&4);
  if(out.flags&64){
    let o=37+16;const idLength=data.readUInt16BE(o);o+=2;
    out.credentialId=data.subarray(o,o+idLength);o+=idLength;
    const {value}=decodeCBOR(data.subarray(o));out.coseKey=value;
  }
  return out;
}
// COSE public key → node KeyObject and the algorithm it signs with.
export function coseToKey(cose){
  if(!(cose instanceof Map))throw Object.assign(new Error('Некорректный ключ'),{status:400});
  const kty=cose.get(1),alg=cose.get(3);
  if(kty===2&&cose.get(-1)===1&&(alg===-7||alg===undefined))return {alg:-7,key:createPublicKey({key:{kty:'EC',crv:'P-256',x:b64url(cose.get(-2)),y:b64url(cose.get(-3))},format:'jwk'})};
  if(kty===3&&(alg===-257||alg===undefined))return {alg:-257,key:createPublicKey({key:{kty:'RSA',n:b64url(cose.get(-1)),e:b64url(cose.get(-2))},format:'jwk'})};
  if(kty===1&&cose.get(-1)===6)return {alg:-8,key:createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:b64url(cose.get(-2))},format:'jwk'})};
  throw Object.assign(new Error('Этот тип ключа не поддерживается'),{status:400});
}
export function checkSignature(alg,spki,data,signature){
  const key=createPublicKey({key:Buffer.from(spki,'base64'),format:'der',type:'spki'});
  return verifySignature(alg===-8?null:'sha256',data,key,signature);
}

export function createDeviceLogin({db,one,all,run,fail,now,id,rate,accounts,publicUser,privacy,family}){
  db.exec(`CREATE TABLE IF NOT EXISTS qr_logins(secret TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,agent TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL,approved_by TEXT,used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),public_key TEXT NOT NULL,alg INTEGER NOT NULL,counter INTEGER DEFAULT 0,name TEXT,transports TEXT DEFAULT '[]',created INTEGER NOT NULL,last_used INTEGER);
    CREATE INDEX IF NOT EXISTS passkeys_owner ON passkeys(user_id);
    CREATE TABLE IF NOT EXISTS webauthn_challenges(challenge TEXT PRIMARY KEY,user_id TEXT,purpose TEXT NOT NULL,expires INTEGER NOT NULL);`);
  // The new device's one-time public key and the history key wrapped for it (see e2e.js).
  for(const column of ['pub','history'])if(!all('PRAGMA table_info(qr_logins)').some(c=>c.name===column))db.exec(`ALTER TABLE qr_logins ADD COLUMN ${column} TEXT`);
  const digest=text=>createHash('sha256').update(String(text)).digest('hex');
  const code=()=>Array.from(randomBytes(8),b=>CODE_ALPHABET[b%CODE_ALPHABET.length]).join('');
  const normalizeCode=text=>String(text||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  const relyingParty=origin=>new URL(origin).hostname;

  function challenge(purpose,userId=null){
    run('DELETE FROM webauthn_challenges WHERE expires<?',now());
    const value=b64url(randomBytes(32));run('INSERT INTO webauthn_challenges VALUES(?,?,?,?)',value,userId,purpose,now()+5*60_000);return value;
  }
  function takeChallenge(value,purpose,userId=null){
    const row=one('SELECT * FROM webauthn_challenges WHERE challenge=? AND purpose=? AND expires>?',String(value||''),purpose,now());
    if(!row||(userId&&row.user_id!==userId))fail(400,'Запрос устарел. Повторите попытку.');
    run('DELETE FROM webauthn_challenges WHERE challenge=?',row.challenge);return row;
  }
  function clientData(raw,type,purpose,origin,userId){
    let data;try{data=JSON.parse(fromB64url(raw).toString('utf8'));}catch{fail(400,'Некорректный ответ ключа');}
    if(data.type!==type)fail(400,'Некорректный тип операции');
    if(data.origin!==origin)fail(400,'Ключ создан для другого сайта');
    takeChallenge(data.challenge,purpose,userId);
    return data;
  }
  const passkeyList=userId=>all('SELECT id,name,created,last_used FROM passkeys WHERE user_id=? ORDER BY created',userId);

  async function route({path,req,res,b,user,json,origin,url}){
    // ---------- QR login ----------
    if(path==='/api/qr-login'&&req.method==='POST'){
      rate('qr-login:'+req.socket.remoteAddress,20,600_000);
      run('DELETE FROM qr_logins WHERE expires<?',now()-60_000);
      const secret=randomBytes(32).toString('hex'),value=code(),pub=validPoint(b.pub)?b.pub:null;
      run('INSERT INTO qr_logins(secret,code,agent,created,expires,pub) VALUES(?,?,?,?,?,?)',digest(secret),value,String(req.headers['user-agent']||'').slice(0,200),now(),now()+3*60_000,pub);
      // The key travels inside the QR picture too, so the approving phone does not have to trust the server's copy.
      json({secret,code:value,link:`${origin}/#qr-login=${value}${pub?'&k='+Buffer.from(pub,'base64').toString('base64url'):''}`,expires:now()+3*60_000});return true;
    }
    if(path==='/api/qr-login/status'&&req.method==='POST'){
      rate('qr-status:'+req.socket.remoteAddress,200,600_000);
      const row=one('SELECT * FROM qr_logins WHERE secret=?',digest(b.secret));
      if(!row||row.used)fail(404,'Код недействителен');
      if(row.expires<now())return json({state:'expired'}),true;
      if(!row.approved_by)return json({state:'pending'}),true;
      const changed=run('UPDATE qr_logins SET used=1 WHERE secret=? AND used=0',row.secret);if(!changed.changes)fail(409,'Код уже использован');
      const account=one('SELECT * FROM users WHERE id=?',row.approved_by);if(!account)fail(404,'Аккаунт не найден');
      accounts.create(req,res,account);privacy.event(account.id,'qr_login');
      json({state:'approved',user:publicUser(account,account.id),settings:JSON.parse(account.settings),history:row.history?JSON.parse(row.history):null});return true;
    }
    if(path==='/api/qr-login/info'&&req.method==='GET'){
      if(!user)fail(401,'Войдите в аккаунт');rate('qr-approve:'+user.id,30,600_000);
      const row=one('SELECT code,agent,created,expires,pub FROM qr_logins WHERE code=? AND used=0 AND approved_by IS NULL AND expires>?',normalizeCode(url.searchParams.get('code')),now());
      if(!row)fail(404,'Код не найден или устарел. Обновите QR-код на новом устройстве.');
      json(row);return true;
    }
    if(path==='/api/qr-login/approve'&&req.method==='POST'){
      if(!user)fail(401,'Войдите в аккаунт');rate('qr-approve:'+user.id,30,600_000);
      if(family.child(user.id))fail(403,'Новые устройства детского аккаунта подключает родитель');
      const history=b.history?JSON.stringify(parseTransfer(b.history)):null;
      const changed=run('UPDATE qr_logins SET approved_by=?,history=? WHERE code=? AND used=0 AND approved_by IS NULL AND expires>?',user.id,history,normalizeCode(b.code),now());
      if(!changed.changes)fail(404,'Код не найден или устарел. Обновите QR-код на новом устройстве.');
      privacy.event(user.id,'qr_login_approved');json({ok:true});return true;
    }
    // ---------- Passkeys ----------
    if(path==='/api/passkeys/login/options'&&req.method==='POST'){
      rate('passkey-login:'+req.socket.remoteAddress,30,600_000);
      json({challenge:challenge('login'),rpId:relyingParty(origin),timeout:120000,userVerification:'required'});return true;
    }
    if(path==='/api/passkeys/login'&&req.method==='POST'){
      rate('passkey-login:'+req.socket.remoteAddress,30,600_000);
      const credential=one('SELECT * FROM passkeys WHERE id=?',String(b.id||''));
      clientData(b.clientDataJSON,'webauthn.get','login',origin);
      if(!credential)fail(401,'Ключ доступа не найден. Возможно, он был удалён.');
      const authData=fromB64url(b.authenticatorData),parsed=parseAuthData(authData);
      if(!timingSafeEqual(parsed.rpIdHash,sha256(relyingParty(origin))))fail(400,'Ключ создан для другого сайта');
      if(!parsed.userPresent||!parsed.userVerified)fail(400,'Подтвердите вход биометрией или PIN-кодом');
      if(b.userHandle&&fromB64url(b.userHandle).toString('utf8')!==credential.user_id)fail(401,'Ключ принадлежит другому аккаунту');
      const signed=Buffer.concat([authData,sha256(fromB64url(b.clientDataJSON))]);
      if(!checkSignature(credential.alg,credential.public_key,signed,fromB64url(b.signature)))fail(401,'Подпись ключа не прошла проверку');
      if(parsed.counter&&credential.counter&&parsed.counter<=credential.counter)fail(401,'Ключ похож на копию. Вход отклонён.');
      const account=one('SELECT * FROM users WHERE id=?',credential.user_id);if(!account)fail(401,'Аккаунт не найден');
      run('UPDATE passkeys SET counter=?,last_used=? WHERE id=?',parsed.counter,now(),credential.id);
      accounts.create(req,res,account);privacy.event(account.id,'passkey_login');
      json({user:publicUser(account,account.id),settings:JSON.parse(account.settings)});return true;
    }
    if(!path.startsWith('/api/passkeys'))return false;
    if(!user)fail(401,'Войдите в аккаунт');
    if(path==='/api/passkeys'&&req.method==='GET'){json(passkeyList(user.id));return true;}
    if(path==='/api/passkeys'&&req.method==='DELETE'){run('DELETE FROM passkeys WHERE id=? AND user_id=?',String(b.id||''),user.id);privacy.event(user.id,'passkey_removed');json(passkeyList(user.id));return true;}
    if(path==='/api/passkeys/register/options'&&req.method==='POST'){
      rate('passkey-register:'+user.id,10,600_000);
      if(all('SELECT id FROM passkeys WHERE user_id=?',user.id).length>=10)fail(400,'Можно добавить до 10 ключей доступа');
      json({challenge:challenge('register',user.id),rp:{name:'Cipherion',id:relyingParty(origin)},user:{id:b64url(Buffer.from(user.id)),name:user.username||user.email||user.name,displayName:user.name},
        pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-8},{type:'public-key',alg:-257}],timeout:120000,attestation:'none',
        authenticatorSelection:{residentKey:'required',requireResidentKey:true,userVerification:'required'},
        excludeCredentials:all('SELECT id FROM passkeys WHERE user_id=?',user.id).map(k=>({type:'public-key',id:k.id}))});return true;
    }
    if(path==='/api/passkeys/register'&&req.method==='POST'){
      clientData(b.clientDataJSON,'webauthn.create','register',origin,user.id);
      let attestation;try{attestation=decodeCBOR(fromB64url(b.attestationObject)).value;}catch{fail(400,'Некорректный ответ ключа');}
      const authData=attestation?.get?.('authData');if(!authData)fail(400,'Некорректный ответ ключа');
      const parsed=parseAuthData(authData);
      if(!timingSafeEqual(parsed.rpIdHash,sha256(relyingParty(origin))))fail(400,'Ключ создан для другого сайта');
      if(!parsed.userPresent||!parsed.userVerified)fail(400,'Подтвердите создание ключа биометрией или PIN-кодом');
      if(!parsed.credentialId||b64url(parsed.credentialId)!==b.id)fail(400,'Идентификатор ключа не совпадает');
      const {alg,key}=coseToKey(parsed.coseKey);
      const transports=Array.isArray(b.transports)?b.transports.filter(t=>/^[a-z-]{2,20}$/.test(t)).slice(0,6):[];
      const name=String(b.name||'Ключ доступа').trim().slice(0,60)||'Ключ доступа';
      run('INSERT INTO passkeys(id,user_id,public_key,alg,counter,name,transports,created) VALUES(?,?,?,?,?,?,?,?)',b.id,user.id,key.export({type:'spki',format:'der'}).toString('base64'),alg,parsed.counter,name,JSON.stringify(transports),now());
      privacy.event(user.id,'passkey_added');json(passkeyList(user.id),201);return true;
    }
    fail(404,'Не найдено');
  }
  return {route};
}
