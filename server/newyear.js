// New Year season: the decoration window and «Итоги года» — a personal year in numbers.
// Everything here is counted from what the server already stores (who wrote when, message kinds,
// reactions, calls, stories). Encrypted text is never read: words and emoji inside messages stay private.

const MSK=3*3600_000,DAY=86400_000;

// Season window in Moscow time: 1 December – 14 January inclusive.
// NEWYEAR=on|off overrides it (for testing on a staging server).
export function newYearSeason(time=Date.now(),env=process.env){
  if(env.NEWYEAR==='on')return true;
  if(env.NEWYEAR==='off')return false;
  const d=new Date(time+MSK),month=d.getUTCMonth(),day=d.getUTCDate();
  return month===11||(month===0&&day<=14);
}

// The year «Итоги» are about: in January it is the year that has just ended.
export function reviewYear(time=Date.now()){
  const d=new Date(time+MSK);
  return d.getUTCMonth()===0&&d.getUTCDate()<=14?d.getUTCFullYear()-1:d.getUTCFullYear();
}

// The next 1 January 00:00 in Moscow time, for the countdown.
export function nextNewYear(time=Date.now()){
  const year=new Date(time+MSK).getUTCFullYear()+1;
  return Date.UTC(year,0,1)-MSK;
}

export const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
export const WEEKDAYS=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

// A character for the year, picked from the shares of what the person sends.
export function persona(s){
  const total=s.messages||0,share=n=>total?n/total:0;
  if(total<10)return {id:'newcomer',emoji:'🌱',title:'Новичок года',text:'Всё самое интересное только начинается'};
  if(share(s.kinds.voice)>=.25)return {id:'voice',emoji:'🎙️',title:'Голос года',text:'Зачем печатать, если можно сказать'};
  if(share(s.kinds.media)>=.3)return {id:'photo',emoji:'📸',title:'Фотограф года',text:'Каждый момент — в кадре'};
  if(share(s.kinds.sticker)>=.25)return {id:'sticker',emoji:'🎨',title:'Стикероман',text:'Стикер скажет больше тысячи слов'};
  if(s.peakHour!==null&&(s.peakHour>=23||s.peakHour<5))return {id:'owl',emoji:'🦉',title:'Ночная сова',text:'Лучшие разговоры случаются после полуночи'};
  if(s.peakHour!==null&&s.peakHour>=5&&s.peakHour<9)return {id:'lark',emoji:'🐦',title:'Ранняя пташка',text:'Пишете раньше, чем все проснутся'};
  if(share(s.groupMessages)>=.5)return {id:'crowd',emoji:'🎉',title:'Душа компании',text:'В группах без вас не обходится'};
  if(s.streak>=14)return {id:'steady',emoji:'🔥',title:'На связи всегда',text:'Ни дня без сообщения'};
  return {id:'friend',emoji:'💬',title:'Верный собеседник',text:'Всегда найдёте, что сказать'};
}

// Longest run of consecutive days in a sorted list of day numbers.
export function longestStreak(days){
  let best=0,run=0,prev=null;
  for(const d of days){run=prev!==null&&d===prev+1?run+1:1;if(run>best)best=run;prev=d;}
  return best;
}

export function createNewYear({db,one,all,now,profile,isBot,isOfficialChat,ttl=10*60_000}){
  db.exec('CREATE INDEX IF NOT EXISTS messages_user_created ON messages(user_id,created)');
  const cache=new Map();let ranks=null;

  const range=year=>[Date.UTC(year,0,1)-MSK,Date.UTC(year+1,0,1)-MSK];
  const local=t=>new Date(t+MSK);

  // Messages per person this year, sorted, for «больше, чем N% пользователей». Shared by everyone, kept for ttl.
  function rankTable(year,[from,to]){
    if(ranks&&ranks.year===year&&ranks.at>now()-ttl)return ranks.list;
    const list=all('SELECT user_id,COUNT(*) n FROM messages WHERE created>=? AND created<? GROUP BY user_id',from,to).filter(r=>!isBot(r.user_id)).map(r=>r.n).sort((a,b)=>a-b);
    ranks={year,at:now(),list};return list;
  }
  function percentile(list,n){
    if(!n||list.length<5)return null;
    let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if(list[mid]<n)lo=mid+1;else hi=mid;}
    return Math.min(99,Math.round(lo/list.length*100));
  }

  function compute(user,year){
    const [from,to]=range(year);
    const rows=all('SELECT m.chat_id,m.kind,m.created,c.kind chat_kind FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.user_id=? AND m.created>=? AND m.created<?',user.id,from,to);
    const kinds={text:0,media:0,voice:0,sticker:0,file:0,other:0},months=Array(12).fill(0),weekdays=Array(7).fill(0),hours=Array(24).fill(0),days=new Set(),chats=new Map();
    let groupMessages=0,first=null;
    for(const r of rows){
      const k=r.kind==='photo'||r.kind==='video'?'media':r.kind==='voice'||r.kind==='round'?'voice':r.kind==='sticker'?'sticker':r.kind==='file'?'file':r.kind==='text'||!r.kind?'text':'other';
      kinds[k]++;
      const d=local(r.created);months[d.getUTCMonth()]++;weekdays[d.getUTCDay()]++;hours[d.getUTCHours()]++;days.add(Math.floor((r.created+MSK)/DAY));
      if(['group','channel'].includes(r.chat_kind))groupMessages++;
      if(r.chat_kind!=='saved'&&!isOfficialChat(r.chat_id))chats.set(r.chat_id,(chats.get(r.chat_id)||0)+1);
      if(first===null||r.created<first)first=r.created;
    }
    const peak=list=>{let best=-1,at=null;list.forEach((n,i)=>{if(n>best&&n>0){best=n;at=i;}});return at;};
    const total=rows.length;

    // Closest people: direct chats with the most messages from both sides this year.
    const people=all(`SELECT m.chat_id,COUNT(*) n,SUM(m.user_id=?) mine FROM messages m JOIN members me ON me.chat_id=m.chat_id AND me.user_id=? JOIN chats c ON c.id=m.chat_id AND c.kind='direct'
      WHERE m.created>=? AND m.created<? GROUP BY m.chat_id ORDER BY n DESC LIMIT 6`,user.id,user.id,from,to)
      .map(r=>{const other=one('SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.user_id!=?',r.chat_id,user.id);return other&&!isBot(other.id)?{chat:r.chat_id,messages:r.n,mine:r.mine,user:profile(other,user.id)}:null;})
      .filter(Boolean).slice(0,3);

    // Reactions: the year of a reaction is the year of the message it sits on.
    const given=all('SELECT r.emoji,COUNT(*) n FROM reactions r JOIN messages m ON m.id=r.message_id WHERE r.user_id=? AND r.emoji!=\'\' AND m.created>=? AND m.created<? GROUP BY r.emoji ORDER BY n DESC',user.id,from,to);
    const received=one('SELECT COUNT(*) n FROM reactions r JOIN messages m ON m.id=r.message_id WHERE m.user_id=? AND r.user_id!=? AND r.emoji!=\'\' AND m.created>=? AND m.created<?',user.id,user.id,from,to).n;

    const calls=one(`SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN ended>created THEN MIN(ended-created,6*3600000) ELSE 0 END),0) ms FROM calls
      WHERE created>=? AND created<? AND (user_id=? OR chat_id IN (SELECT chat_id FROM members WHERE user_id=?)) AND COALESCE(status,'') NOT IN ('missed','declined','ringing')`,from,to,user.id,user.id);
    const stories=one('SELECT COUNT(*) n FROM stories WHERE user_id=? AND created>=? AND created<?',user.id,from,to).n;

    const sticker=one(`SELECT s.id,s.label,s.emoji,s.source,COUNT(*) n FROM messages m JOIN stickers s ON s.id=m.body
      WHERE m.user_id=? AND m.kind='sticker' AND m.created>=? AND m.created<? GROUP BY s.id ORDER BY n DESC LIMIT 1`,user.id,from,to);

    const stats={messages:total,kinds,groupMessages,activeDays:days.size,streak:longestStreak([...days].sort((a,b)=>a-b)),
      peakHour:peak(hours),peakWeekday:peak(weekdays),peakMonth:peak(months),months};
    return {
      year,generated:now(),...stats,
      peakMonthName:stats.peakMonth===null?null:MONTHS[stats.peakMonth],
      peakWeekdayName:stats.peakWeekday===null?null:WEEKDAYS[stats.peakWeekday],
      chats:chats.size,first,
      joined:user.created>=from&&user.created<to?user.created:null,
      people,
      reactions:{given:given.reduce((s,r)=>s+r.n,0),received,top:given.slice(0,3).map(r=>({emoji:r.emoji,count:r.n}))},
      calls:{count:calls.n,minutes:Math.round(calls.ms/60000)},
      stories,
      sticker:sticker?{label:sticker.label||'',emoji:sticker.emoji||'',count:sticker.n,source:String(sticker.source||'').startsWith('/stickers')?sticker.source:null}:null,
      percentile:percentile(rankTable(year,[from,to]),total),
      persona:persona(stats)
    };
  }

  // One person's «Итоги»; recomputed at most every ttl.
  function review(user,year=reviewYear(now())){
    const key=user.id+':'+year,hit=cache.get(key);
    if(hit&&hit.at>now()-ttl)return hit.value;
    const value=compute(user,year);
    cache.set(key,{at:now(),value});
    if(cache.size>5000)cache.delete(cache.keys().next().value);
    return value;
  }

  return {season:()=>newYearSeason(now()),year:()=>reviewYear(now()),countdown:()=>nextNewYear(now()),review};
}
