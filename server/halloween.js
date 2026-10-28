// Halloween season: ghost messages and the «Сладость или гадость» mini-game.
// Ghost messages vanish GHOST_SECONDS after someone other than the author reads them.
export const GHOST_SECONDS=60;

// Season window in Moscow time: 1 – 30 November inclusive.
// HALLOWEEN=on|off overrides it (for testing on a staging server).
export function halloweenSeason(time=Date.now(),env=process.env){
  if(env.HALLOWEEN==='on')return true;
  if(env.HALLOWEEN==='off')return false;
  const d=new Date(time+3*3600_000),month=d.getUTCMonth(),day=d.getUTCDate();
  return month===10&&day>=1&&day<=30;
}

export const OUTCOMES={
  treat:[['🍬','Конфета!'],['🍫','Шоколадка!'],['🍭','Леденец!'],['🧁','Капкейк!'],['🍪','Печенька!'],['🍯','Бочонок мёда!']],
  trick:[['👻','Бу! Призрак!'],['🕷️','Паук на плече!'],['🦇','Налетели летучие мыши!'],['💀','Скелет в шкафу!'],['🧟','Зомби у двери!'],['🎃','Тыква укусила!']]
};

export function createHalloween({db,one,all,run,fail,now,broadcast,rate,random=Math.random}){
  const columns=all('PRAGMA table_info(messages)').map(c=>c.name);
  if(!columns.includes('ghost'))db.exec('ALTER TABLE messages ADD COLUMN ghost INTEGER DEFAULT 0');
  if(!columns.includes('ghost_until'))db.exec('ALTER TABLE messages ADD COLUMN ghost_until INTEGER');
  if(!columns.includes('game'))db.exec('ALTER TABLE messages ADD COLUMN game TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS messages_ghost_due ON messages(ghost_until) WHERE ghost_until IS NOT NULL');

  // Validates the ghost flag of a new message; returns 1 for a ghost message, 0 otherwise.
  function ghostFlag(chat,sender,b,kind){
    if(b.ghost!==true)return 0;
    if(['channel','saved'].includes(chat.kind))fail(400,'Призрачные сообщения недоступны в каналах и Избранном');
    if(['poll','treat'].includes(kind))fail(400,'Это сообщение не может быть призрачным');
    if(chat.kind==='direct')for(const m of all("SELECT u.settings FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.user_id!=?",chat.id,sender)){
      let settings={};try{settings=JSON.parse(m.settings||'{}');}catch{}
      if(settings.ghostMessages===false)fail(403,'Собеседник не принимает призрачные сообщения');
    }
    return 1;
  }

  // Someone read the chat up to `last`: start the timer on ghost messages written by others.
  function read(chatId,reader,last){
    const due=now()+GHOST_SECONDS*1000;
    for(const r of all('SELECT id FROM messages WHERE chat_id=? AND ghost=1 AND ghost_until IS NULL AND deleted=0 AND user_id!=? AND created<=?',chatId,reader,last)){
      run('UPDATE messages SET ghost_until=? WHERE id=? AND ghost_until IS NULL',due,r.id);
      broadcast(chatId,'message',{chat:chatId,id:r.id});
    }
  }

  // Removes ghost messages whose time is up. Called on a timer.
  function sweep(){
    for(const r of all('SELECT id,chat_id FROM messages WHERE ghost_until IS NOT NULL AND ghost_until<=? AND deleted=0 LIMIT 200',now())){
      run("UPDATE messages SET deleted=1,body='',transcript=NULL,e2e=NULL WHERE id=?",r.id);
      broadcast(r.chat_id,'message',{chat:r.chat_id,id:r.id});
    }
  }

  // A member other than the author picks «treat» or «trick»; the outcome is random and final.
  function play(m,user,choice){
    if(m.kind!=='treat'||m.deleted)fail(400,'Игра недоступна');
    if(!['treat','trick'].includes(choice))fail(400,'Выберите «Сладость» или «Гадость»');
    if(m.user_id===user.id)fail(400,'Дождитесь, пока сыграет собеседник');
    rate('treat:'+user.id,30);
    const list=OUTCOMES[random()<.5?'treat':'trick'],[emoji,text]=list[Math.floor(random()*list.length)%list.length];
    const kind=OUTCOMES.treat.some(([e])=>e===emoji)?'treat':'trick';
    const game={result:{choice,kind,emoji,text,by:user.id,name:user.name,at:now()}};
    const changed=run("UPDATE messages SET game=? WHERE id=? AND (game IS NULL OR json_extract(game,'$.result') IS NULL)",JSON.stringify(game),m.id);
    if(!changed?.changes)fail(409,'В эту игру уже сыграли');
    return game;
  }

  const project=row=>{if(!row.game)return null;try{return JSON.parse(row.game);}catch{return null;}};
  return {ghostFlag,read,sweep,play,project,season:()=>halloweenSeason(now())};
}
