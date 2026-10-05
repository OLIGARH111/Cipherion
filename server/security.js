import {randomBytes,createHmac,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function encode(bytes){let bits='';for(const b of bytes)bits+=b.toString(2).padStart(8,'0');return bits.match(/.{1,5}/g).map(b=>alphabet[parseInt(b.padEnd(5,'0'),2)]).join('');}
function decode(text){const bits=[...text].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');return Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));}
export function totp(secret,time=Date.now()){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const h=createHmac('sha1',decode(secret)).update(counter).digest(),offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
export function createSecurity({db,one,all,run,fail,now,privacy,rate}){
  db.exec(`CREATE TABLE IF NOT EXISTS second_factor(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT,enabled INTEGER DEFAULT 0,pending TEXT,last_step INTEGER DEFAULT -1);
    CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT REFERENCES users(id),hash TEXT,PRIMARY KEY(user_id,hash));`);
  db.exec('CREATE TABLE IF NOT EXISTS security_approvals(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,expires INTEGER NOT NULL);');
  if(!all('PRAGMA table_info(second_factor)').some(c=>c.name==='pending_session'))db.exec('ALTER TABLE second_factor ADD COLUMN pending_session TEXT');
  function issueApproval(user){const token=randomBytes(32).toString('hex');run('DELETE FROM security_approvals WHERE expires<=? OR session_id=?',now(),user.session.id);run('INSERT INTO security_approvals VALUES(?,?,?,?)',digest(token),user.id,user.session.id,now()+300000);return token;}
  function authorization(user,b){if(user.password?.includes(':')){password(user,b.password);return;}if(!/^[a-f0-9]{64}$/.test(String(b.approvalToken||''))||!one('SELECT 1 FROM security_approvals WHERE token_hash=? AND user_id=? AND session_id=? AND expires>?',digest(b.approvalToken),user.id,user.session.id,now()))fail(403,'Подтвердите действие новым кодом из email');}
  function consumeApproval(b){if(b.approvalToken)run('DELETE FROM security_approvals WHERE token_hash=?',digest(b.approvalToken));}
  function password(user,value){if(!user.password||!user.password.includes(':'))fail(403,'Управление 2FA пока доступно только аккаунтам с паролем');const [salt,hash]=user.password.split(':');const actual=scryptSync(String(value||''),salt,64);if(!timingSafeEqual(actual,Buffer.from(hash,'hex')))fail(403,'Подтвердите текущий пароль');}
  function valid(secret,code,time=now()){return [-1,0,1].find(d=>totp(secret,time+d*30000)===String(code));}
  function verify(user,code){const factor=one('SELECT * FROM second_factor WHERE user_id=? AND enabled=1',user);if(!factor)return;rate('2fa:'+user,10,300000);const d=valid(factor.secret,code);if(d!==undefined){const step=Math.floor(now()/30000)+d;if(step<=factor.last_step)fail(401,'Код уже использован. Дождитесь следующего.');run('UPDATE second_factor SET last_step=? WHERE user_id=?',step,user);return;}if(run('DELETE FROM recovery_codes WHERE user_id=? AND hash=?',user,digest(code)).changes){privacy.event(user,'recovery_code_used');return;}fail(401,'Введите код двухэтапной аутентификации или резервный код');}
  async function route({path,req,b,user,json}){
    if(!path.startsWith('/api/security/2fa'))return false;
    if(path==='/api/security/2fa'&&req.method==='GET'){json({passwordRequired:!!user.password?.includes(':'),email:user.email_verified?user.email:null,enabled:!!one('SELECT enabled FROM second_factor WHERE user_id=?',user.id)?.enabled,recoveryRemaining:one('SELECT COUNT(*) n FROM recovery_codes WHERE user_id=?',user.id).n});return true;}
    rate('security:'+user.id,10,300000);authorization(user,b);
    if(path==='/api/security/2fa/setup'&&req.method==='POST'){if(one('SELECT enabled FROM second_factor WHERE user_id=?',user.id)?.enabled)fail(409,'2FA уже включена');const secret=encode(randomBytes(20));run('INSERT INTO second_factor(user_id,pending,pending_session) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending=excluded.pending,pending_session=excluded.pending_session',user.id,secret,user.session.id);json({secret,uri:`otpauth://totp/Cipherion:${encodeURIComponent(user.username||user.email||user.name)}?secret=${secret}&issuer=Cipherion`});return true;}
    if(path==='/api/security/2fa/confirm'&&req.method==='POST'){const factor=one('SELECT * FROM second_factor WHERE user_id=?',user.id);if(!user.password?.includes(':')&&factor?.pending_session!==user.session.id)fail(403,'Настройка начата в другой сессии');const at=now(),offset=factor?.pending?valid(factor.pending,b.code,at):undefined;if(offset===undefined)fail(400,'Неверный код');const codes=Array.from({length:10},()=>randomBytes(10).toString('hex'));db.exec('BEGIN');try{run('UPDATE second_factor SET secret=pending,pending=NULL,pending_session=NULL,enabled=1,last_step=? WHERE user_id=?',Math.floor(at/30000)+offset,user.id);run('DELETE FROM recovery_codes WHERE user_id=?',user.id);for(const c of codes)run('INSERT INTO recovery_codes VALUES(?,?)',user.id,digest(c));consumeApproval(b);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}privacy.event(user.id,'2fa_enabled');json({codes});return true;}
    if(path==='/api/security/2fa'&&req.method==='DELETE'){verify(user.id,b.code);run('DELETE FROM second_factor WHERE user_id=?',user.id);run('DELETE FROM recovery_codes WHERE user_id=?',user.id);consumeApproval(b);privacy.event(user.id,'2fa_disabled');json({ok:true});return true;}fail(404,'Не найдено');
  }
  return {verify,password,issueApproval,route};
}


