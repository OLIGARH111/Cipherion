export const privacyFields=['email','phone','phoneDiscovery','activity','avatar','bio','birthday','status','links','forward','calls','p2p','groups','messages'];
export function createPrivacy({db,one,all,run,fail,now,id,emit,vipInfo=()=>({})}) {
  db.exec(`CREATE TABLE IF NOT EXISTS privacy_rules(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,revision INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS contacts(user_id TEXT REFERENCES users(id),target TEXT REFERENCES users(id),PRIMARY KEY(user_id,target));
    CREATE TABLE IF NOT EXISTS security_events(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),action TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS private_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT DEFAULT '',birthday TEXT DEFAULT '',public_avatar TEXT DEFAULT '');`);
  const defaults=()=>({rules:Object.fromEntries(privacyFields.map(k=>[k,{audience:['email','phone','birthday'].includes(k)?'nobody':'everyone',allow:[],deny:[]}])),readDirect:true,readGroup:true});
  function get(u){const row=one('SELECT * FROM privacy_rules WHERE user_id=?',u);const saved=JSON.parse(row?.data||'{}');return {...defaults(),...saved,rules:{...defaults().rules,...saved.rules},revision:row?.revision||0};}
  function blocked(a,b){return !!one('SELECT user_id FROM blocks WHERE (user_id=? AND target=?) OR (user_id=? AND target=?)',a,b,b,a);}
  function permits(owner,viewer,field){if(owner===viewer)return true;if(!viewer||blocked(owner,viewer))return false;const r=get(owner).rules[field];if(!r)return false;if(r.deny.includes(viewer))return false;if(r.allow.includes(viewer))return true;return r.audience==='everyone'||r.audience==='contacts'&&!!one('SELECT target FROM contacts WHERE user_id=? AND target=?',owner,viewer);}
  function event(u,action){run('INSERT INTO security_events VALUES(?,?,?,?)',id(),u,action,now());emit?.(u,'security',{action});}
  function project(u,viewer,online=false){if(!u)return null;const p=one('SELECT * FROM private_profiles WHERE user_id=?',u.id)||{};return {...vipInfo(u.id),id:u.id,username:u.username,name:u.name,bio:permits(u.id,viewer,'bio')?u.bio:'',avatar:permits(u.id,viewer,'avatar')?u.avatar:p.public_avatar||'',online:permits(u.id,viewer,'activity')?online:false,...(permits(u.id,viewer,'phone')?{phone:p.phone||''}:{}),...(permits(u.id,viewer,'birthday')?{birthday:p.birthday||''}:{})};}
  function profile(p,owner,viewer){const v={...p};for(const key of ['description','links','status','emoji','cover','videoAvatar','backgroundImage','gallery','patternEmoji'])if(!permits(owner,viewer,key==='description'?'bio':key==='emoji'?'status':['cover','videoAvatar','backgroundImage','gallery','patternEmoji'].includes(key)?'avatar':key))delete v[key];return v;}
  function assertContact(sender,target,field){if(!permits(target,sender,field))fail(403,'Действие запрещено настройками конфиденциальности');}
  function canRead(u,kind){const p=get(u);return kind==='direct'?p.readDirect:p.readGroup;}
  async function route({path,req,b,user,json}){
    if(path==='/api/privacy'){
      if(req.method==='GET'){json(get(user.id));return true;}
      if(req.method!=='PATCH')fail(405,'Метод не поддерживается');
      const current=get(user.id);if(b.revision!==current.revision)fail(409,'Настройки изменены на другом устройстве. Откройте их заново.');
      const next=defaults();for(const key of privacyFields){const r=b.rules?.[key]||current.rules[key];if(!['everyone','contacts','nobody'].includes(r.audience))fail(400,'Неизвестное правило');for(const k of ['allow','deny'])if(!Array.isArray(r[k])||r[k].length>200||r[k].some(v=>typeof v!=='string'||!one('SELECT id FROM users WHERE id=?',v)))fail(400,'Неизвестный пользователь в исключениях');next.rules[key]={audience:r.audience,allow:[...new Set(r.allow)],deny:[...new Set(r.deny)]};}
      for(const key of ['readDirect','readGroup']){if(b[key]!==undefined&&typeof b[key]!=='boolean')fail(400,'Ожидается переключатель');next[key]=b[key]??current[key];}
      run('INSERT INTO privacy_rules VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=privacy_rules.revision+1',user.id,JSON.stringify(next));event(user.id,'privacy_updated');emit?.(user.id,'settings',{});json(get(user.id));return true;
    }
    if(path==='/api/contacts'){
      if(req.method==='GET')json(all('SELECT u.* FROM users u JOIN contacts c ON c.target=u.id WHERE c.user_id=?',user.id).map(u=>project(u,user.id)));
      else if(['POST','DELETE'].includes(req.method)){if(!one('SELECT id FROM users WHERE id=?',b.target)||b.target===user.id)fail(400,'Выберите пользователя');if(req.method==='POST')run('INSERT OR IGNORE INTO contacts VALUES(?,?)',user.id,b.target);else run('DELETE FROM contacts WHERE user_id=? AND target=?',user.id,b.target);json({ok:true});}else fail(405,'Метод не поддерживается');return true;
    }
    if(path==='/api/security/events'&&req.method==='GET'){json(all('SELECT action,created FROM security_events WHERE user_id=? ORDER BY created DESC LIMIT 100',user.id));return true;}
    if(path==='/api/privacy/profile'&&req.method==='PATCH'){
      const p=one('SELECT * FROM private_profiles WHERE user_id=?',user.id)||{};const phone=String(b.phone??p.phone??'').trim(),birthday=String(b.birthday??p.birthday??''),avatar=String(b.public_avatar??p.public_avatar??'');
      if(phone&&!/^\+\d{7,15}$/.test(phone)||birthday&&!/^\d{4}-\d{2}-\d{2}$/.test(birthday))fail(400,'Проверьте номер и дату');if(avatar&&!one("SELECT id FROM media WHERE id=? AND user_id=? AND type IN ('image/png','image/jpeg','image/webp')",avatar,user.id))fail(400,'Недопустимый аватар');
      if(birthday&&(!Number.isFinite(Date.parse(birthday))||new Date(birthday).toISOString().slice(0,10)!==birthday||Date.parse(birthday)>now()))fail(400,'Проверьте дату рождения');const child=one('SELECT birth FROM children WHERE user_id=? AND independent=0',user.id);if(child&&birthday&&birthday!==child.birth)fail(403,'Дата рождения ребёнка задаётся при регистрации');
      if(phone!==p.phone)run('UPDATE profile_details SET phone_verified=0 WHERE user_id=?',user.id);
      run('INSERT INTO private_profiles VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,birthday=excluded.birthday,public_avatar=excluded.public_avatar',user.id,phone,birthday,avatar);event(user.id,'private_profile_updated');json({ok:true});return true;
    }
    return false;
  }
  return {get,permits,project,profile,blocked,assertContact,canRead,event,route};
}


