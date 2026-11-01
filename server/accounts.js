import {createHash,randomBytes} from 'node:crypto';
export function createAccounts({one,all,run,now,fail,clean,publicUser,privacy,streams,env=process.env}) {
 const digest=raw=>createHash('sha256').update(raw).digest('hex');
 const cookieName=id=>'session_'+id.replaceAll('-','');
 const cookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
 function sessions(req){const values=cookies(req),result=new Map();for(const [name,raw]of Object.entries(values)){if(!/^(session|session_[a-f0-9]{32})$/.test(name)||!/^[a-f0-9]{64}$/.test(raw||''))continue;const session=one('SELECT * FROM sessions WHERE id=? AND expires>?',digest(raw),now());if(session&&one('SELECT id FROM users WHERE id=?',session.user_id))result.set(session.user_id,{...session,raw});}return result;}
 function authenticate(req){const desired=req.headers['x-cipherion-account']||new URL(req.url,'http://localhost').searchParams.get('account');const available=sessions(req);let session;if(desired)session=available.get(desired);else {const raw=cookies(req).session;if(raw)session=[...available.values()].find(s=>s.id===digest(raw));}
  if(!session)return null;
  // "Last seen" is shown to the minute, so a write every 30 s is enough; most requests stay read-only.
  if(now()-(session.active||0)>30000)run('UPDATE sessions SET active=? WHERE id=?',now(),session.id);return {...one('SELECT * FROM users WHERE id=?',session.user_id),session:{...session,raw:undefined}};
 }
 const cookie=(name,token,max=2592000)=>`${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${max}${env.COOKIE_SECURE==='1'?'; Secure':''}`;
 function assertCapacity(req,userId){const list=sessions(req);if(list.size>=3&&!list.has(userId))fail(409,'На этом устройстве можно добавить до 3 аккаунтов');}
 function create(req,res,account){assertCapacity(req,account.id);const token=randomBytes(32).toString('hex'),at=now();run('INSERT INTO sessions VALUES(?,?,?,?,?,?)',digest(token),account.id,clean(req.headers['user-agent'],200),at,at,at+30*86400000);
  const values=[cookie('session',token),cookie(cookieName(account.id),token)];for(const [uid,s]of sessions(req))if(uid!==account.id)values.push(cookie(cookieName(uid),s.raw,Math.max(1,Math.floor((s.expires-at)/1000))));res.setHeader('Set-Cookie',values);privacy.event(account.id,'new_session');
 }
 function logout(req,res,user){const raw=cookies(req).session;const values=[cookie(cookieName(user.id),'',0)];if(raw&&digest(raw)===user.session.id)values.push(cookie('session','',0));res.setHeader('Set-Cookie',values);}
 function list(req){return [...sessions(req).keys()].map(uid=>{const u=one('SELECT * FROM users WHERE id=?',uid);return {user:publicUser(u,uid),unread:one("SELECT COUNT(*) n FROM messages m JOIN members p ON p.chat_id=m.chat_id WHERE p.user_id=? AND p.role!='banned' AND m.user_id!=? AND m.deleted=0 AND m.created>p.read_at",uid,uid).n};});}
 return {authenticate,create,logout,list,assertCapacity};
}
