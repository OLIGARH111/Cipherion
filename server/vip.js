export function createVip({db,one,all,run,fail,now,id}){
  db.exec(`CREATE TABLE IF NOT EXISTS vip(user_id TEXT PRIMARY KEY REFERENCES users(id),active INTEGER DEFAULT 0,created INTEGER);
    CREATE TABLE IF NOT EXISTS cloud(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),title TEXT,body TEXT,media_id TEXT,created INTEGER);`);
  db.exec(`CREATE TABLE IF NOT EXISTS vip_grants(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),source TEXT NOT NULL,starts INTEGER NOT NULL,expires INTEGER,revoked INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vip_audit(id TEXT PRIMARY KEY,actor TEXT,action TEXT,target TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS vip_promos(code TEXT PRIMARY KEY,days INTEGER NOT NULL,remaining INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vip_redemptions(code TEXT,user_id TEXT,PRIMARY KEY(code,user_id));
    CREATE TABLE IF NOT EXISTS vip_migrations(name TEXT PRIMARY KEY);`);
  // Preserve pre-existing free VIP entitlements exactly once; future activation is privileged.
  if(!one("SELECT name FROM vip_migrations WHERE name='legacy-grants'")){db.exec("BEGIN; INSERT INTO vip_grants SELECT 'legacy-'||user_id,user_id,'legacy',created,NULL,0 FROM vip WHERE active=1; INSERT INTO vip_migrations VALUES('legacy-grants'); COMMIT;");}
  const active=u=>!!one('SELECT id FROM vip_grants WHERE user_id=? AND revoked=0 AND starts<=? AND (expires IS NULL OR expires>?)',u,(now||Date.now)(),(now||Date.now)());
  const admin=u=>(process.env.ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).includes(u);
  const audit=(actor,action,target)=>run('INSERT INTO vip_audit VALUES(?,?,?,?,?)',id(),actor,action,target,now());
  function grant(actor,target,days,source='gift'){if(!one('SELECT id FROM users WHERE id=?',target))fail(404,'Пользователь не найден');if(days!==null&&(!Number.isInteger(days)||days<1||days>36500))fail(400,'Срок: 1–36500 дней');const latest=one('SELECT MAX(expires) n FROM vip_grants WHERE user_id=? AND revoked=0',target)?.n||now();const expires=days===null?null:Math.max(now(),latest)+days*86400000;run('INSERT INTO vip_grants VALUES(?,?,?,?,?,0)',id(),target,source,now(),expires);audit(actor,'grant',target);return expires;}

  async function route({path,req,b,user,json}){
    if(path==='/api/vip'&&req.method==='GET'){const grants=all('SELECT source,starts,expires,revoked FROM vip_grants WHERE user_id=? ORDER BY starts DESC',user.id);const enabled=active(user.id),valid=grants.filter(g=>!g.revoked&&(!g.expires||g.expires>now()));json({active:enabled,status:enabled?(valid.some(g=>g.source==='gift'||g.source==='promo')?'VIP Gifted':'VIP Active'):grants.length?'VIP Expired':'Free',renewal:valid.some(g=>g.expires===null)?null:Math.max(0,...valid.map(g=>g.expires)),autoRenew:false,billingConfigured:false,admin:admin(user.id),grants,uploadMB:enabled?4096:2048,aiDaily:enabled?100:20});return true;}
    if(path==='/api/vip'&&req.method==='POST')fail(403,'VIP активируется после оплаты, подарка или выдачи администратором');
    if(path==='/api/vip/redeem'&&req.method==='POST'){const code=String(b.code||'').trim().toUpperCase();const promo=one('SELECT * FROM vip_promos WHERE code=? AND remaining>0',code);if(!promo||one('SELECT code FROM vip_redemptions WHERE code=? AND user_id=?',code,user.id))fail(400,'Промокод недоступен');db.exec('BEGIN');try{grant(user.id,user.id,promo.days,'promo');run('UPDATE vip_promos SET remaining=remaining-1 WHERE code=?',code);run('INSERT INTO vip_redemptions VALUES(?,?)',code,user.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json({ok:true});return true;}
    if(path.startsWith('/api/admin/vip')){if(!admin(user.id))fail(403,'Только администратор');
      if(path==='/api/admin/vip'&&req.method==='GET')json({grants:all('SELECT g.*,u.username FROM vip_grants g JOIN users u ON u.id=g.user_id ORDER BY starts DESC LIMIT 500'),audit:all('SELECT * FROM vip_audit ORDER BY created DESC LIMIT 100')});
      else if(path==='/api/admin/vip/grant'&&req.method==='POST')json({expires:grant(user.id,b.user,b.lifetime===true?null:Number(b.days))});
      else if(path==='/api/admin/vip/revoke'&&req.method==='POST'){run('UPDATE vip_grants SET revoked=1 WHERE user_id=?',b.user);audit(user.id,'revoke',b.user);json({ok:true});}
      else if(path==='/api/admin/vip/promo'&&req.method==='POST'){const code=String(b.code||'').trim().toUpperCase();if(!/^[A-Z0-9-]{6,40}$/.test(code)||!Number.isInteger(b.days)||b.days<1||b.days>36500||!Number.isInteger(b.uses)||b.uses<1||b.uses>10000)fail(400,'Проверьте код, срок и число использований');run('INSERT INTO vip_promos VALUES(?,?,?)',code,b.days,b.uses);audit(user.id,'promo',code);json({ok:true});}else fail(405,'Метод не поддерживается');return true;}
    if(path==='/api/cloud'){
      if(!active(user.id))fail(403,'Требуется действующая подписка VIP');
      if(req.method==='GET')json(all('SELECT c.*,m.name,m.type,m.size FROM cloud c LEFT JOIN media m ON m.id=c.media_id WHERE c.user_id=? ORDER BY c.created DESC LIMIT 500',user.id));
      else if(req.method==='POST'){if(b.media&&!one('SELECT id FROM media WHERE id=? AND user_id=?',b.media,user.id))fail(403,'Нет доступа к файлу');const body=String(b.body||'').slice(0,30000),title=String(b.title||'Заметка').slice(0,120);if(!body&&!b.media)fail(400,'Добавьте текст или файл');if(one('SELECT COUNT(*) n FROM cloud WHERE user_id=?',user.id).n>=500)fail(409,'Лимит: 500 записей');const key=id();run('INSERT INTO cloud VALUES(?,?,?,?,?,?)',key,user.id,title,body,b.media||null,now());json({id:key});}
      else if(req.method==='DELETE'){run('DELETE FROM cloud WHERE id=? AND user_id=?',b.id,user.id);json({ok:true});}else fail(405,'Метод не поддерживается');return true;
    }return false;
  }return{active,route};
}

