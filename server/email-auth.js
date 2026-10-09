import {createMailer} from './mail.js';
import {randomInt,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
export const normalizeEmail=value=>String(value||'').trim().normalize('NFKC').toLowerCase();
export function createEmailAuth({db,one,all,run,fail,now,id,rate,accounts,publicUser,security,emit,env=process.env}) {
 const columns=all('PRAGMA table_info(users)');for(const [name,type]of [['email','TEXT'],['normalized_email','TEXT'],['email_verified','INTEGER DEFAULT 0']])if(!columns.some(c=>c.name===name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email ON users(normalized_email) WHERE normalized_email IS NOT NULL;
 CREATE TABLE IF NOT EXISTS email_challenges(id TEXT PRIMARY KEY,purpose TEXT NOT NULL,user_id TEXT,email TEXT NOT NULL,payload TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS email_challenges_email ON email_challenges(email,created);
 CREATE TABLE IF NOT EXISTS email_cooldowns(email TEXT PRIMARY KEY,last_sent INTEGER NOT NULL);`);
 const enabled=env.EMAIL_AUTH_ENABLED==='1',mailer=createMailer({env});
 const ready=()=>enabled&&mailer.ready()&&String(env.EMAIL_CODE_SECRET||'').length>=32;
 // Databases created before email signup still require a username; give such accounts a generated one instead of migrating live data.
 const usernameRequired=!!columns.find(c=>c.name==='username')?.notnull;
 const generatedUsername=()=>{for(;;){const name='user_'+randomBytes(5).toString('hex');if(!one('SELECT id FROM users WHERE username=?',name))return name;}};
 const hash=(cid,code)=>createHmac('sha256',env.EMAIL_CODE_SECRET).update(cid+':'+code).digest();
 const neutral='Если аккаунт с таким адресом существует, мы отправили инструкции.';
 function validateEmail(value){const email=normalizeEmail(value);if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Проверьте электронную почту');return email;}

 async function issue(req,b,user){
  if(!ready())fail(503,'Вход по email ещё не настроен. Используйте вход по username для существующего аккаунта.');
  const purpose=b.purpose;
  if(purpose==='security'&&(!user?.email_verified||!user?.session))fail(403,'Сначала подтвердите email в профиле');
  const email=validateEmail(purpose==='security'?user.email:b.email);
  if(!['register','login','recovery','change','security'].includes(purpose))fail(400,'Некорректное действие');
  if(purpose==='change'&&!user)fail(401,'Войдите в аккаунт');
  rate('email-ip:'+req.socket.remoteAddress,15,3600000);rate('email:'+email,8,3600000);
  const existing=one('SELECT * FROM users WHERE normalized_email=? AND email_verified=1',email);
  const firstName=String(b.firstName||'').trim(),lastName=String(b.lastName||'').trim();
  if(purpose==='register'&&(!firstName||!lastName||firstName.length>80||lastName.length>80))fail(400,'Укажите имя и фамилию (до 80 символов)');
  const cid=id(),code=String(randomInt(0,1000000)).padStart(6,'0'),at=now();
  const target=['change','security'].includes(purpose)?user.id:purpose==='register'?null:existing?.id||null;
  db.exec('BEGIN IMMEDIATE');try {
   if((one('SELECT last_sent FROM email_cooldowns WHERE email=?',email)?.last_sent??-Infinity)>at-60000)fail(429,'Повторный код можно запросить через 60 секунд');
   run('INSERT INTO email_cooldowns VALUES(?,?) ON CONFLICT(email) DO UPDATE SET last_sent=excluded.last_sent',email,at);
   run('UPDATE email_challenges SET used=? WHERE email=? AND purpose=? AND used IS NULL',at,email,purpose);
   run('INSERT INTO email_challenges(id,purpose,user_id,email,payload,code_hash,expires,created) VALUES(?,?,?,?,?,?,?,?)',cid,purpose,target,email,JSON.stringify({firstName,lastName,...(purpose==='security'?{sessionId:user.session.id}:{}),blocked:purpose==='register'&&!!existing||purpose==='change'&&!!existing&&existing.id!==user.id}),hash(cid,code).toString('hex'),at+600000,at);
   run('DELETE FROM email_challenges WHERE created<?',at-86400000);run('DELETE FROM email_cooldowns WHERE last_sent<?',at-86400000);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  try {if(purpose==='register'||purpose==='change'||existing)await mailer.send({email,code,purpose,challengeId:cid});}catch(e){run('UPDATE email_challenges SET used=? WHERE id=?',now(),cid);throw e;}
  return {challengeId:cid,email:email.slice(0,1)+'•••••@'+email.split('@')[1],retryAfter:60,message:neutral};
 }
 async function route({path,req,res,b,user,json}) {
  if(path==='/api/auth/config'&&req.method==='GET'){json({email:ready(),passwordless:ready(),passwordRegistration:!ready()});return true;}
  if(path==='/api/auth/email/start'&&req.method==='POST'){json(await issue(req,b,user));return true;}
  if(path!=='/api/auth/email/confirm'||req.method!=='POST')return false;
  if(!ready())fail(503,'Подтверждение email пока недоступно');rate('email-confirm:'+req.socket.remoteAddress,30,600000);
  const r=one('SELECT * FROM email_challenges WHERE id=?',String(b.challengeId));
  if(!r||r.used!==null||r.expires<=now()||r.attempts>=5)fail(400,'Код истёк или уже использован. Запросите новый.');
  if(['change','security'].includes(r.purpose)&&r.user_id!==user?.id)fail(403,'Нет доступа к подтверждению');
  run('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?',r.id);
  if(!/^\d{6}$/.test(String(b.code))||!timingSafeEqual(Buffer.from(r.code_hash,'hex'),hash(r.id,String(b.code))))fail(400,'Неверный код');
  const payload=JSON.parse(r.payload);if(r.purpose==='security'&&payload.sessionId!==user?.session?.id)fail(403,'Подтверждение относится к другой сессии');if(payload.blocked)fail(409,'Не удалось завершить действие. Попробуйте вход или восстановление доступа.');
  let approvalToken;let account=r.user_id?one('SELECT * FROM users WHERE id=?',r.user_id):null;
  if(r.purpose!=='register'&&!account)fail(400,'Не удалось подтвердить код');
  if(account&&!['change','security'].includes(r.purpose))security.verify(account.id,b.secondFactor);
  if(!['change','security'].includes(r.purpose))accounts.assertCapacity(req,account?.id);
  db.exec('BEGIN IMMEDIATE');try {
   if(!run('UPDATE email_challenges SET used=? WHERE id=? AND used IS NULL AND expires>?',now(),r.id,now()).changes)fail(400,'Код уже использован');
   if(r.purpose==='register'){
    if(one('SELECT id FROM users WHERE normalized_email=?',r.email))fail(409,'Не удалось создать аккаунт. Используйте вход.');
    const uid=id();run('INSERT INTO users(id,username,name,password,email,normalized_email,email_verified,created) VALUES(?,?,?,?,?, ?,1,?)',uid,usernameRequired?generatedUsername():null,payload.firstName,'',r.email,r.email,now());run('INSERT INTO profile_details(user_id,surname,email,email_verified) VALUES(?,?,?,1)',uid,payload.lastName,r.email);account=one('SELECT * FROM users WHERE id=?',uid);
   }else if(r.purpose==='change'){
    if(one('SELECT id FROM users WHERE normalized_email=? AND id!=?',r.email,user.id))fail(409,'Этот адрес недоступен');
    run('UPDATE users SET email=?,normalized_email=?,email_verified=1 WHERE id=?',r.email,r.email,user.id);run('INSERT INTO profile_details(user_id,email,email_verified) VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,email_verified=1',user.id,r.email);
   }
   if(r.purpose==='security')approvalToken=security.issueApproval(user);
   if(!['change','security'].includes(r.purpose))accounts.create(req,res,account);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(r.purpose==='security'){json({approvalToken});}else if(r.purpose==='change'){emit(user.id,'settings',{});json({ok:true});}else json({user:publicUser(account,account.id),settings:JSON.parse(account.settings)});
  return true;
 }
 return {route,enabled,ready};
}
