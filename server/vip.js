export function createVip({db,one,all,run,fail,now,id}){
  db.exec(`CREATE TABLE IF NOT EXISTS vip(user_id TEXT PRIMARY KEY REFERENCES users(id),active INTEGER DEFAULT 0,created INTEGER);
    CREATE TABLE IF NOT EXISTS cloud(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),title TEXT,body TEXT,media_id TEXT,created INTEGER);`);
  const active=u=>!!one('SELECT active FROM vip WHERE user_id=?',u)?.active;
  async function route({path,req,b,user,json}){
    if(path==='/api/vip'&&req.method==='GET'){json({active:active(user.id),price:0,renewal:null,mode:'free',uploadMB:active(user.id)?100:50,aiDaily:active(user.id)?100:20});return true;}
    if(path==='/api/vip'&&req.method==='POST'){run('INSERT INTO vip VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active',user.id,b.active===false?0:1,now());json({active:active(user.id),price:0});return true;}
    if(path==='/api/cloud'){
      if(!active(user.id))fail(403,'Включите бесплатный VIP в настройках');
      if(req.method==='GET')json(all('SELECT c.*,m.name,m.type,m.size FROM cloud c LEFT JOIN media m ON m.id=c.media_id WHERE c.user_id=? ORDER BY c.created DESC LIMIT 500',user.id));
      else if(req.method==='POST'){if(b.media&&!one('SELECT id FROM media WHERE id=? AND user_id=?',b.media,user.id))fail(403,'Нет доступа к файлу');const body=String(b.body||'').slice(0,30000),title=String(b.title||'Заметка').slice(0,120);if(!body&&!b.media)fail(400,'Добавьте текст или файл');if(one('SELECT COUNT(*) n FROM cloud WHERE user_id=?',user.id).n>=500)fail(409,'Лимит: 500 записей');const key=id();run('INSERT INTO cloud VALUES(?,?,?,?,?,?)',key,user.id,title,body,b.media||null,now());json({id:key});}
      else if(req.method==='DELETE'){run('DELETE FROM cloud WHERE id=? AND user_id=?',b.id,user.id);json({ok:true});}else fail(405,'Метод не поддерживается');return true;
    }return false;
  }return{active,route};
}
