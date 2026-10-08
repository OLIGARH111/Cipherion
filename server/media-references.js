// Deliberately conservative: retain objects referenced in JSON and deleted messages
// too, so forwarding, archives and restores can never break another attachment.
export function mediaReferenced(db,id){
 const one=(s,...p)=>db.prepare(s).get(...p);
 const checks=[['messages','media_id'],['users','avatar'],['chats','avatar'],['stories','media_id'],['cloud','media_id'],['private_profiles','public_avatar']];
 for(const [table,column]of checks){if(!one("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table))continue;if(db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column)&&one(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`,id))return true;}
 for(const [table,column]of [['users','settings'],['profiles','data'],['profile_presets','data']])if(one("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table)&&one(`SELECT 1 FROM ${table} WHERE instr(${column},?)>0 LIMIT 1`,id))return true;
 return false;
}
