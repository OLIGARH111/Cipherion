import {canShare} from './content-protection.js';
export function createPolls({db,one,all,run,fail,now,id,rate,membership,requirePermission,family,privacy,broadcast,emit}) {
  db.exec(`CREATE TABLE IF NOT EXISTS poll_attempts(message_id TEXT,user_id TEXT,started INTEGER,submitted INTEGER,PRIMARY KEY(message_id,user_id));
    CREATE TABLE IF NOT EXISTS poll_schedule(id TEXT PRIMARY KEY,chat_id TEXT,user_id TEXT,question TEXT,poll TEXT,due INTEGER,status TEXT);
    CREATE TABLE IF NOT EXISTS poll_comments(id TEXT PRIMARY KEY,message_id TEXT,user_id TEXT,body TEXT,created INTEGER);`);
  // A checklist is a poll whose options are tasks: anyone allowed marks a task done or adds one.
  function checklist(p,chat){
    const items=(Array.isArray(p.options)?p.options:[]).map(v=>String(v).trim().slice(0,150)).filter(Boolean);
    if(items.length<1||items.length>50)fail(400,'В чек-листе должно быть от 1 до 50 пунктов');
    return {checklist:true,options:items,description:String(p.description||'').slice(0,1000),multiple:true,anonymous:false,quiz:false,correct:null,explanation:'',points:1,timer:0,ends:null,closed:false,change:true,results:'always',showCount:false,showPercent:false,shuffle:false,comments:false,notify:!!p.notify,forward:p.forward!==false,newMembers:true,othersAdd:p.othersAdd!==false,othersCheck:p.othersCheck!==false,eligible:all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat).map(m=>m.user_id)};
  }
  function normalize(input,chat) {
    if(input?.checklist)return checklist(input,chat);
    const p=input||{},options=(Array.isArray(p.options)?p.options:[]).map(v=>String(v).trim().slice(0,150));
    if(options.length<2||options.length>20||options.some(v=>!v)||new Set(options).size!==options.length)fail(400,'Нужно 2–20 разных вариантов');
    const ends=p.ends?Number(p.ends):null,timer=Number(p.timer||0),points=Number(p.points||1);
    if(ends!==null&&(!Number.isFinite(ends)||ends<=now())||!Number.isInteger(timer)||timer<0||timer>3600||!Number.isInteger(points)||points<1||points>100)fail(400,'Проверьте срок, таймер и баллы');
    if(p.quiz&&(!Number.isInteger(p.correct)||p.correct<0||p.correct>=options.length))fail(400,'Выберите правильный ответ');
    return {options,description:String(p.description||'').slice(0,1000),multiple:p.quiz?false:!!p.multiple,anonymous:p.anonymous!==false,quiz:!!p.quiz,correct:p.quiz?p.correct:null,explanation:String(p.explanation||'').slice(0,1000),points,timer,ends,closed:false,change:p.quiz?false:p.change!==false,results:['always','voted','closed'].includes(p.results)?p.results:'always',showCount:p.showCount!==false,showPercent:p.showPercent!==false,shuffle:!!p.shuffle,comments:!!p.comments,notify:!!p.notify,forward:p.forward!==false,newMembers:p.newMembers!==false,eligible:all("SELECT user_id FROM members WHERE chat_id=? AND role!='banned'",chat).map(m=>m.user_id)};
  }
  const closed=p=>p.closed||!!(p.ends&&p.ends<=now());
  function project(row,viewer,details=false) {
    const p=JSON.parse(row.poll),mine=all('SELECT choice FROM votes WHERE message_id=? AND user_id=?',row.id,viewer).map(v=>v.choice);
    const visible=(p.results||'always')==='always'||p.results==='voted'&&mine.length>0||closed(p);
    const out={...p,closed:closed(p),mine,counts:visible?all('SELECT choice,COUNT(*) n FROM votes WHERE message_id=? GROUP BY choice',row.id):[],total:visible&&p.showCount!==false?one('SELECT COUNT(DISTINCT user_id) n FROM votes WHERE message_id=?',row.id).n:null,resultsVisible:visible};
    delete out.eligible;delete out.correct;delete out.explanation;
    if(p.quiz&&(closed(p)||mine.length>0)){out.correct=p.correct;out.explanation=p.explanation;out.score=mine.includes(p.correct)?p.points:0;}
    if(p.checklist){out.done=all('SELECT v.choice,u.id,u.name FROM votes v JOIN users u ON u.id=v.user_id WHERE v.message_id=? ORDER BY v.choice',row.id).map(v=>({item:v.choice,by:v.id,name:v.name}));out.counts=[];out.total=null;}
    const attempt=one('SELECT * FROM poll_attempts WHERE message_id=? AND user_id=?',row.id,viewer);out.deadline=attempt&&p.timer?attempt.started+p.timer*1000:null;
    if(details&&!p.anonymous&&visible)out.voters=all('SELECT v.choice,u.* FROM votes v JOIN users u ON u.id=v.user_id WHERE message_id=?',row.id).map(v=>({choice:v.choice,user:privacy.project(v,viewer),...(p.quiz&&closed(p)?{score:v.choice===p.correct?p.points:0}:{})}));
    return out;
  }
  function authorize(chat,user){const c=requirePermission(chat,user,'poll').chat;family.assertUse(user);family.chatAccess(chat,user);if(c.kind==='direct')for(const m of all('SELECT user_id FROM members WHERE chat_id=?',chat))if(m.user_id!==user)privacy.assertContact(user,m.user_id,'messages');}
  function vote(m,user,choices){const p=JSON.parse(m.poll);if(p.checklist)fail(400,'Отмечайте пункты чек-листа');if(m.deleted||closed(p))fail(400,'Опрос завершён');family.chatAccess(m.chat_id,user);if(p.newMembers===false&&!p.eligible.includes(user))fail(403,'Опрос доступен участникам на момент публикации');
    const old=all('SELECT choice FROM votes WHERE message_id=? AND user_id=?',m.id,user);if(old.length&&(p.change===false||p.quiz))fail(409,'Ответ уже принят');
    if(p.timer){const a=one('SELECT * FROM poll_attempts WHERE message_id=? AND user_id=?',m.id,user);if(!a)fail(409,'Сначала запустите таймер');if(a.started+p.timer*1000<=now())fail(400,'Время ответа истекло');}
    const selected=[...new Set(Array.isArray(choices)?choices:[])];if(!selected.length||!p.multiple&&selected.length>1||selected.some(c=>!Number.isInteger(c)||c<0||c>=p.options.length))fail(400,'Выберите ответ');
    db.exec('BEGIN');try{run('DELETE FROM votes WHERE message_id=? AND user_id=?',m.id,user);for(const c of selected)run('INSERT INTO votes VALUES(?,?,?)',m.id,user,c);run('INSERT INTO poll_attempts VALUES(?,?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET submitted=excluded.submitted',m.id,user,now(),now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    if(p.notify)emit(m.user_id,'poll',{message:m.id,chat:m.chat_id});
  }
  async function route({path,req,b,user,json,url}){
    if(path==='/api/polls/scheduled'){
      if(req.method==='GET'){json(all('SELECT * FROM poll_schedule WHERE user_id=? ORDER BY due DESC LIMIT 100',user.id));return true;}
      if(req.method==='DELETE'){run("UPDATE poll_schedule SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'",b.id,user.id);json({ok:true});return true;}
      if(req.method!=='POST')fail(405,'Метод не поддерживается');rate('poll-create:'+user.id,20);authorize(b.chat,user.id);const p=normalize(b.poll,b.chat),question=String(b.question||'').trim().slice(0,300),due=Number(b.due);if(!question||!Number.isFinite(due)||due<now()+1000||due>now()+30*86400000||p.ends&&p.ends<=due)fail(400,'Проверьте вопрос и дату публикации');family.content(b.chat,question+' '+JSON.stringify(p),false);const key=id();run("INSERT INTO poll_schedule VALUES(?,?,?,?,?,?,'pending')",key,b.chat,user.id,question,JSON.stringify(p),due);json({id:key});return true;
    }
    const match=/^\/api\/polls\/([^/]+)(?:\/(start|close|comments|forward|check|items))?$/.exec(path);if(!match)return false;
    const m=one("SELECT * FROM messages WHERE id=? AND deleted=0 AND kind='poll'",match[1]);if(!m)fail(404,'Опрос не найден');const {member}=membership(m.chat_id,user.id);family.chatAccess(m.chat_id,user.id);const p=JSON.parse(m.poll),action=match[2];
    if(!action&&req.method==='GET'){json(project(m,user.id,true));return true;}
    if(['check','items'].includes(action)&&req.method==='POST'){
      if(!p.checklist)fail(400,'Это не чек-лист');family.chatAccess(m.chat_id,user.id);
      const author=m.user_id===user.id,staff=['owner','admin'].includes(member.role);
      if(action==='check'){
        if(!author&&!staff&&p.othersCheck===false)fail(403,'Отмечать пункты может только автор');
        const item=Number(b.item);if(!Number.isInteger(item)||item<0||item>=p.options.length)fail(400,'Пункт не найден');
        if(b.done)run('INSERT OR IGNORE INTO votes VALUES(?,?,?)',m.id,user.id,item);else run('DELETE FROM votes WHERE message_id=? AND choice=?',m.id,item);
        if(p.notify&&!author&&b.done)emit(m.user_id,'poll',{message:m.id,chat:m.chat_id});
      }else{
        if(!author&&!staff&&p.othersAdd===false)fail(403,'Добавлять пункты может только автор');
        requirePermission(m.chat_id,user.id,'text');rate('checklist-add:'+user.id,30);
        // A checklist in an encrypted chat takes items encrypted with its own message key.
        const text=p.sealed?String(b.text||''):String(b.text||'').trim().slice(0,150);if(!text)fail(400,'Введите пункт');
        if(p.sealed&&!/^e1:[A-Za-z0-9+/=]{16}\.[A-Za-z0-9+/=]{24,800}$/.test(text))fail(400,'Пункт зашифрованного чек-листа должен быть зашифрован');
        if(p.options.length>=50)fail(400,'В чек-листе уже 50 пунктов');
        if(!p.sealed)family.content(m.chat_id,text,false);p.options.push(text);run('UPDATE messages SET poll=? WHERE id=?',JSON.stringify(p),m.id);
      }
      broadcast(m.chat_id,'message',{chat:m.chat_id,id:m.id});json(project(m.id?one('SELECT * FROM messages WHERE id=?',m.id):m,user.id));return true;
    }
    if(action==='start'&&req.method==='POST'){if(closed(p))fail(400,'Опрос завершён');run('INSERT OR IGNORE INTO poll_attempts VALUES(?,?,?,NULL)',m.id,user.id,now());json(project(m,user.id));return true;}
    if(action==='close'&&req.method==='POST'){if(m.user_id!==user.id&&!['owner','admin'].includes(member.role))fail(403,'Только автор или администратор');p.closed=true;run('UPDATE messages SET poll=? WHERE id=?',JSON.stringify(p),m.id);broadcast(m.chat_id,'message',{chat:m.chat_id,id:m.id});json({ok:true});return true;}
    if(action==='comments'){if(!p.comments)fail(403,'Комментарии выключены');if(req.method==='GET')json(all('SELECT c.*,u.name FROM poll_comments c JOIN users u ON u.id=c.user_id WHERE message_id=? ORDER BY created LIMIT 100',m.id));else if(req.method==='POST'){requirePermission(m.chat_id,user.id,'text');rate('poll-comment:'+user.id,20);const body=String(b.body||'').trim().slice(0,1000);if(!body)fail(400,'Введите комментарий');family.content(m.chat_id,body,false);run('INSERT INTO poll_comments VALUES(?,?,?,?,?)',id(),m.id,user.id,body,now());json({ok:true});}else fail(405,'Метод не поддерживается');return true;}
    if(action==='forward'&&req.method==='POST'){if(!canShare(one('SELECT * FROM chats WHERE id=?',m.chat_id),member))fail(403,'В этом чате включена защита контента: пересылка запрещена');if(p.forward===false)fail(403,'Пересылка запрещена автором');if(p.sealed)fail(400,'Зашифрованный опрос нельзя переслать');authorize(b.chat,user.id);const copy=normalize({...p,ends:null},b.chat);family.content(b.chat,m.body+' '+JSON.stringify(copy),false);const key=id();run("INSERT INTO messages(id,chat_id,user_id,kind,body,poll,created) VALUES(?,?,?,'poll',?,?,?)",key,b.chat,user.id,m.body,JSON.stringify(copy),now());broadcast(b.chat,'message',{chat:b.chat,id:key});json({id:key});return true;}
    fail(405,'Метод не поддерживается');
  }
  function tick(){for(const s of all("SELECT * FROM poll_schedule WHERE status='pending' AND due<=? LIMIT 20",now()))try{authorize(s.chat_id,s.user_id);family.content(s.chat_id,s.question+' '+s.poll,false);const p=JSON.parse(s.poll);if(p.ends&&p.ends<=now())throw Error('Expired');const key=id();db.exec('BEGIN');try{run("INSERT INTO messages(id,chat_id,user_id,kind,body,poll,created) VALUES(?,?,?,'poll',?,?,?)",key,s.chat_id,s.user_id,s.question,s.poll,now());run("UPDATE poll_schedule SET status='sent' WHERE id=?",s.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}broadcast(s.chat_id,'message',{chat:s.chat_id,id:key});}catch{run("UPDATE poll_schedule SET status='failed' WHERE id=?",s.id);}}
  return {normalize,project,vote,route,tick};
}
