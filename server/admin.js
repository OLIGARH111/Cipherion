export function createAdmin({db,one,run,fail,now}) {
  db.exec('CREATE TABLE IF NOT EXISTS site_administrators(user_id TEXT PRIMARY KEY REFERENCES users(id),created INTEGER); CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS site_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),user_id TEXT,created INTEGER NOT NULL);');
  // Bind only the existing account at migration time. Never grant by a mutable
  // username, legacy claim code or environment allowlist on subsequent requests.
  // A missing account deliberately leaves access disabled until manual repair.
  run("INSERT OR IGNORE INTO site_owner(singleton,user_id,created) VALUES(1,(SELECT id FROM users WHERE username='serafim_mironov'),?)",now());
  function isAdmin(userId) {
    return !!one('SELECT u.id FROM site_owner o JOIN users u ON u.id=o.user_id WHERE o.singleton=1 AND u.id=?',userId);
  }
  async function route({path,req,user,json}) {
    if(path!=='/api/admin/access')return false;
    if(req.method==='GET'){json({admin:isAdmin(user.id),claimAvailable:false});return true;}
    if(!isAdmin(user.id))fail(403,'Только владелец');
    if(req.method!=='POST')fail(405,'Метод не поддерживается');
    json({admin:true,claimAvailable:false});return true;
  }
  return {isAdmin,route};
}
