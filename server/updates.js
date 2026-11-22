// What's new: the official Cipherion account tells everyone about a release once — a message in each
// person's Cipherion chat and a set of stories — and posts seasonal event stories (shown in «События»).
const DAY=86400000;

export const RELEASES=[{
  id:'2026-11-profile-themes',
  highlight:'Обновление',
  days:7,
  message:`🎉 Обновление Cipherion

✨ Новый профиль
• Цвета профиля заполняют весь экран: с VIP — цвета вашего оформления, без VIP — цвета вашего фото.
• Потяните профиль вниз или нажмите на фото — оно раскроется на всю ширину, а его цвета растекутся по профилю.

🎨 Яркие темы
• 8 новых тем: Закат, Океан, Киберпанк, Северное сияние, Тропики, Галактика, Лава и Сакура — с цветным фоном и градиентными сообщениями.
• Повторяющиеся темы убраны, VIP-темы стали ярче.

🖌 Оформление профиля
• Теперь в «Изменить профиль». 8 новых фонов: Лаванда, Закат, Океан, Роза, Мята, Золото, Вишня и Небо.

🔒 Конфиденциальность
• Код-пароль и ключи доступа — в Настройки → Конфиденциальность.

🤖 AI
• Поле ввода закреплено внизу и больше не закрывает сообщения, кнопки стали круглыми.`,
  stories:[
    ['🎉 Обновление Cipherion\n\nНовый профиль, яркие темы и удобный AI. Листайте →','night'],
    ['✨ Новый профиль\n\nЦвета на весь экран. Потяните профиль вниз — фото раскроется во всю ширину','sunset'],
    ['🎨 8 ярких тем\n\nЗакат · Океан · Киберпанк · Северное сияние · Тропики · Галактика · Лава · Сакура\n\nНастройки → Оформление','ocean'],
    ['🖌 Оформление профиля\n\nТеперь в «Изменить профиль». Новые фоны: Лаванда, Роза, Мята, Золото и другие','night'],
    ['🔒 Код-пароль и ключи доступа\n\nТеперь в Настройки → Конфиденциальность','ocean'],
    ['🤖 AI\n\nПоле ввода всегда внизу и не закрывает сообщения','aurora']
  ]
}];

// Seasonal events: stories that live until the event ends (Moscow time) and open from «События».
export const EVENTS=[{
  id:'halloween-2026',
  highlight:'Хэллоуин',
  emoji:'🎃',
  text:'Темы, призрачные сообщения, игра и стикеры — до 30 ноября',
  until:Date.UTC(2026,10,30,21,0),
  stories:[
    ['🎃 Хэллоуин в Cipherion\n\nДо 30 ноября включительно','sunset'],
    ['🌙 Темы «Ночь тыкв» и «Зелье»\n\nТуман и летучие мыши. Настройки → 🎃 Хэллоуин','night'],
    ['👻 Призрачные сообщения\n\nНажмите 👻 у поля ввода — сообщение исчезнет через минуту после прочтения','night'],
    ['🍬 «Сладость или гадость»\n\nМини-игра в личных чатах и группах — в меню 📎','sunset'],
    ['🦇 Жуткие стикеры\n\nНабор «Хэллоуин» уже в вашей панели стикеров','night']
  ]
},{
  // Opens on 1 December (Moscow time): `from` holds the stories back until then.
  id:'newyear-2026',
  highlight:'Новый год',
  emoji:'🎄',
  text:'Снег, новогодние темы, стикеры и ваши итоги 2026 года — до 14 января',
  from:Date.UTC(2026,10,30,21,0),
  until:Date.UTC(2027,0,14,21,0),
  stories:[
    ['🎄 Новый год в Cipherion\n\nС 1 декабря по 14 января','night'],
    ['✨ Ваши итоги 2026\n\nСколько сообщений, с кем больше всего общались и кто вы в этом году. Баннер над списком чатов','aurora'],
    ['❄️ Снег и гирлянда\n\nТемы «Зимняя ночь» и «Ёлка». Настройки → 🎄 Новый год','ocean'],
    ['⛄ Стикеры «Новый год»\n\nСнеговик, ёлка, подарок, салют и мандаринка — уже в вашей панели стикеров','night'],
    ['🎆 Обратный отсчёт\n\nБаннер считает дни до Нового года, а в полночь — салют','sunset']
  ]
}];

export function createUpdates({db,one,all,run,now,id,official}){
  db.exec('CREATE TABLE IF NOT EXISTS official_releases(id TEXT PRIMARY KEY,created INTEGER NOT NULL)');
  const design=gradient=>JSON.stringify({background:'#153d32',color:'#ffffff',font:'sans-serif',size:24,position:'center',muted:false,start:0,duration:7,gradient,textStyle:'plain'});
  function postStories(list,highlight,expires){
    const at=now(),ids=[];
    list.forEach(([caption,gradient],i)=>{const key=id();ids.push(key);
      run("INSERT INTO stories(id,user_id,media_id,kind,caption,design,created,expires,audience,targets,replies,highlight,deleted) VALUES(?,?,NULL,'text',?,?,?,?,'everyone','[]',0,?,0)",key,official.botId,caption,design(gradient),at+i,expires,highlight);});
    return ids;
  }
  // Marked before sending, so a crash halfway never sends the same release twice.
  const claim=key=>{if(one('SELECT id FROM official_releases WHERE id=?',key))return false;run('INSERT INTO official_releases(id,created) VALUES(?,?)',key,now());return true;};
  function publish(){
    const result={releases:[],events:[]};
    for(const r of RELEASES){if(!claim(r.id))continue;postStories(r.stories,r.highlight,now()+r.days*DAY);const sent=official.announce(r.message);result.releases.push({id:r.id,sent});}
    for(const e of EVENTS){if(e.until<=now()||(e.from&&e.from>now())||!claim(e.id))continue;postStories(e.stories,e.highlight,e.until);result.events.push(e.id);}
    return result;
  }
  // The running event, for the «События» card: its stories, newest event first.
  function currentEvent(){
    const e=EVENTS.find(x=>x.until>now()&&!(x.from>now())&&one('SELECT id FROM official_releases WHERE id=?',x.id));
    if(!e)return null;
    return {id:e.id,title:e.highlight,emoji:e.emoji,text:e.text,until:e.until,author:official.botId,stories:all("SELECT id FROM stories WHERE user_id=? AND highlight=? AND deleted=0 AND expires>? ORDER BY created",official.botId,e.highlight,now()).map(r=>r.id)};
  }
  return {publish,currentEvent};
}
