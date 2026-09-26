import {randomBytes} from 'node:crypto';
export function createPromos({db,one,all,run,fail,now,id,rate,grant,admin,audit}) {
  db.exec(`CREATE TABLE IF NOT EXISTS promo_rules(code TEXT PRIMARY KEY REFERENCES vip_promos(code),name TEXT,starts INTEGER,ends INTEGER,enabled INTEGER DEFAULT 1,allowed TEXT DEFAULT '[]',description TEXT,reward TEXT DEFAULT 'vip',lifetime INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS promo_receipts(id TEXT PRIMARY KEY,code TEXT,user_id TEXT,created INTEGER,expires INTEGER);`);
  function rules(code){return one('SELECT * FROM promo_rules WHERE code=?',code)||{enabled:1,starts:0,ends:null,allowed:'[]',lifetime:0};}
  async function route({path,req,b,user,json}) {
    if(path==='/api/vip/redeem'&&req.method==='POST') {
      rate('promo:'+user.id,8,900000);const code=String(b.code||'').trim().toUpperCase();
      const p=one('SELECT * FROM vip_promos WHERE code=?',code),r=rules(code);
      if(!p||p.remaining<1||!r.enabled||r.starts>now()||r.ends&&r.ends<=now()||JSON.parse(r.allowed).length&&!JSON.parse(r.allowed).includes(user.id)||one('SELECT code FROM vip_redemptions WHERE code=? AND user_id=?',code,user.id))fail(400,'Промокод недоступен или уже использован');
      db.exec('BEGIN IMMEDIATE');try{const expires=grant(user.id,user.id,r.lifetime?null:p.days,'promo');run('UPDATE vip_promos SET remaining=remaining-1 WHERE code=?',code);run('INSERT INTO vip_redemptions VALUES(?,?)',code,user.id);run('INSERT INTO promo_receipts VALUES(?,?,?,?,?)',id(),code,user.id,now(),expires);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json({ok:true});return true;
    }
    if(path!=='/api/admin/vip/promo'&&path!=='/api/admin/vip/promos')return false;
    if(!admin(user.id))fail(403,'Только администратор');
    if(req.method==='GET'){json(all('SELECT * FROM vip_promos ORDER BY code').map(p=>({...p,...rules(p.code),allowed:JSON.parse(rules(p.code).allowed),redemptions:all('SELECT r.user_id,u.username,x.created FROM vip_redemptions r JOIN users u ON u.id=r.user_id LEFT JOIN promo_receipts x ON x.code=r.code AND x.user_id=r.user_id WHERE r.code=?',p.code)})));return true;}
    const code=String(b.code|| (req.method==='POST'?randomBytes(12).toString('hex'):'')).trim().toUpperCase();
    if(!/^[A-Z0-9-]{4,40}$/.test(code))fail(400,'Код: 4–40 латинских букв, цифр или дефисов');
    const old=one('SELECT * FROM vip_promos WHERE code=?',code);
    if(req.method==='DELETE'){if(!old)fail(404,'Код не найден');db.exec('BEGIN');try{run('DELETE FROM promo_rules WHERE code=?',code);run('DELETE FROM vip_promos WHERE code=?',code);audit(user.id,'promo_delete',code);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json({ok:true});return true;}
    if(!['POST','PATCH'].includes(req.method))fail(405,'Метод не поддерживается');
    if(req.method==='POST'&&old)fail(409,'Код уже существует');if(req.method==='PATCH'&&!old)fail(404,'Код не найден');
    const prev=rules(code),r={...prev,...b},days=Number(b.days??old?.days??30),uses=Number(b.uses??old?.remaining??1);
    const starts=Number(r.starts||0),ends=r.ends?Number(r.ends):null,allowed=b.allowed??JSON.parse(prev.allowed);
    if(!Number.isInteger(days)||days<1||days>36500||!Number.isInteger(uses)||uses<0||uses>10000||!Number.isFinite(starts)||ends!==null&&(!Number.isFinite(ends)||ends<=starts)||!Array.isArray(allowed)||allowed.length>200||allowed.some(u=>!one('SELECT id FROM users WHERE id=?',String(u))))fail(400,'Проверьте срок, число активаций и список аккаунтов');
    if(r.reward&&r.reward!=='vip')fail(400,'Поддерживается награда VIP');
    db.exec('BEGIN');try{run('INSERT INTO vip_promos VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET days=excluded.days,remaining=excluded.remaining',code,days,uses);run('INSERT INTO promo_rules VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,starts=excluded.starts,ends=excluded.ends,enabled=excluded.enabled,allowed=excluded.allowed,description=excluded.description,lifetime=excluded.lifetime',code,String(r.name||code).slice(0,80),starts,ends,r.enabled===false||r.enabled===0?0:1,JSON.stringify([...new Set(allowed)]),String(r.description||'').slice(0,500),'vip',r.lifetime?1:0);audit(user.id,'promo_'+req.method.toLowerCase(),code);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json({code});return true;
  }
  return {route};
}
