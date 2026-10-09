import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
// Password recovery without email: a one-time recovery key shown to the user once.
// Only a salted scrypt hash is stored; using the key rotates it and ends every session.
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const format=key=>key.match(/.{4}/g).join('-');
export const normalizeKey=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const hashPassword=password=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');};
function matches(stored,value){
  const [salt,hash]=String(stored||'dummy:'+'0'.repeat(128)).split(':');
  const attempt=scryptSync(value,salt,64),expected=Buffer.from(hash||'','hex');
  return expected.length===attempt.length&&timingSafeEqual(attempt,expected);
}
export function createRecovery({db,one,run,fail,now,rate,accounts,publicUser,security,streams}) {
  db.exec('CREATE TABLE IF NOT EXISTS recovery_keys(user_id TEXT PRIMARY KEY REFERENCES users(id),hash TEXT NOT NULL,created INTEGER NOT NULL);');
  function issue(userId){
    const bytes=randomBytes(20),key=[...bytes].map(b=>alphabet[b%alphabet.length]).join('');
    run('INSERT INTO recovery_keys VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash,created=excluded.created',userId,hashPassword(key),now());
    return format(key);
  }
  const validPassword=password=>typeof password==='string'&&password.length>=10&&password.length<=256;
  function endSessions(userId){
    run('DELETE FROM push_account_devices WHERE session_id IN (SELECT id FROM sessions WHERE user_id=?)',userId);
    run('DELETE FROM sessions WHERE user_id=?',userId);
    for(const stream of streams.get(userId)||[])stream.end();
    streams.delete(userId);
  }
  async function route({path,req,res,b,user,json}){
    if(path==='/api/auth/password-reset'&&req.method==='POST'){
      rate('reset:'+req.socket.remoteAddress,10,900_000);
      const username=String(b.username??'').trim().toLowerCase(),key=normalizeKey(b.key);
      rate('reset-account:'+createHash('sha256').update(username).digest('hex'),5,900_000);
      if(!validPassword(b.password))fail(400,'Новый пароль: от 10 до 256 символов');
      const account=one('SELECT * FROM users WHERE username=?',username),stored=account&&one('SELECT hash FROM recovery_keys WHERE user_id=?',account.id);
      // Hash even for unknown users so timing does not reveal which usernames exist.
      const ok=matches(stored?.hash,key);
      if(!account||!stored||!ok)fail(401,'Неверный username или ключ восстановления');
      security.verify(account.id,b.code);
      accounts.assertCapacity(req,account.id);
      run('UPDATE users SET password=? WHERE id=?',hashPassword(b.password),account.id);
      endSessions(account.id);
      const recoveryKey=issue(account.id);
      const fresh=one('SELECT * FROM users WHERE id=?',account.id);
      accounts.create(req,res,fresh);
      json({user:publicUser(fresh,fresh.id),settings:JSON.parse(fresh.settings),recoveryKey});return true;
    }
    if(path!=='/api/recovery-key'&&path!=='/api/password')return false;
    if(!user)fail(401,'Войдите в аккаунт');
    const passwordAccount=!!user.password?.includes(':');
    if(path==='/api/recovery-key'&&req.method==='GET'){json({passwordAccount,created:one('SELECT created FROM recovery_keys WHERE user_id=?',user.id)?.created||null});return true;}
    if(!passwordAccount)fail(400,'У аккаунта нет пароля: вход выполняется по email');
    rate('password-confirm:'+user.id,10,900_000);
    security.password(user,b.password);
    if(path==='/api/recovery-key'&&req.method==='POST'){json({recoveryKey:issue(user.id)});return true;}
    if(path==='/api/password'&&req.method==='POST'){
      if(!validPassword(b.newPassword))fail(400,'Новый пароль: от 10 до 256 символов');
      run('UPDATE users SET password=? WHERE id=?',hashPassword(b.newPassword),user.id);
      run('DELETE FROM push_account_devices WHERE session_id IN (SELECT id FROM sessions WHERE user_id=? AND id!=?)',user.id,user.session.id);
      run('DELETE FROM sessions WHERE user_id=? AND id!=?',user.id,user.session.id);
      for(const stream of streams.get(user.id)||[])if(stream.sessionId!==user.session.id){stream.end();streams.get(user.id).delete(stream);}
      json({ok:true});return true;
    }
    fail(405,'Метод не поддерживается');
  }
  return {route,issue};
}
