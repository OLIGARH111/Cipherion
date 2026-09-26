import {createHash,timingSafeEqual} from 'node:crypto';
export function createAdmin({db,one,run,fail,now,rate}) {
  db.exec('CREATE TABLE IF NOT EXISTS site_administrators(user_id TEXT PRIMARY KEY REFERENCES users(id),created INTEGER);');
  function isAdmin(user){return (process.env.ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(user)||!!one('SELECT user_id FROM site_administrators WHERE user_id=?',user);}
  async function route({path,req,b,user,json}) {
    if(path!=='/api/admin/access')return false;
    if(req.method==='GET'){json({admin:isAdmin(user.id),claimAvailable:!!process.env.ADMIN_CLAIM_HASH&&!one('SELECT user_id FROM site_administrators LIMIT 1')});return true;}
    if(req.method!=='POST')fail(405,'Метод не поддерживается');rate('admin-claim:'+user.id,5,3600000);
    const expected=process.env.ADMIN_CLAIM_HASH||'',hash=createHash('sha256').update(String(b.code||'')).digest('hex');
    if(!/^[a-f0-9]{64}$/.test(expected)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(hash,'hex'))||user.username!==(process.env.ADMIN_CLAIM_USERNAME||'').trim().toLowerCase()||one('SELECT user_id FROM site_administrators LIMIT 1'))fail(403,'Код подключения недействителен');
    run('INSERT INTO site_administrators VALUES(?,?)',user.id,now());json({admin:true});return true;
  }
  return {isAdmin,route};
}
