// The AI tab in the look of the Cypher desktop app: the same emerald HUD, orb, home screen, chat and PC control.
// Answers come from the server's AI (/api/ai/chat) or, for «💻 Компьютер», from Cypher on a linked PC.
import {accountFetch,draftKey} from './account-context.js';
import {$,esc,api,upload,guard,toast,modal} from './ui.js';
import {createOrb} from './cypher-orb.js';
import {runOnPC,approveCypher,cypherComputers} from './cypher-link.js';

const ICONS={
  home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  chat:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pc:'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  memory:'<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  up:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  stop:'<rect width="14" height="14" x="5" y="5" rx="2"/>',
  clip:'<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  stopwatch:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
};
const svg=(name,size=18)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const NAV=[['home','Главная'],['chat','Чат'],['pc','Управление ПК'],['memory','Память'],['settings','Настройки']];
const STATUS={idle:'Ожидание',listening:'Слушаю',thinking:'Думаю',responding:'Отвечаю',executing:'Выполняю на ПК',error:'Ошибка',offline:'Не в сети'};
const greeting=h=>h>=5&&h<12?'Доброе утро':h>=12&&h<18?'Добрый день':h>=18&&h<23?'Добрый вечер':'Доброй ночи';
const QUICK=[['Браузер','открой браузер'],['YouTube','открой YouTube'],['Telegram','открой телеграм'],['Discord','открой дискорд'],['Spotify','открой спотифай'],['Steam','открой стим'],['Проводник','открой проводник'],['Загрузки','открой загрузки'],['Блокнот','открой блокнот'],['Калькулятор','открой калькулятор'],['Диспетчер задач','открой диспетчер задач'],['Параметры','открой параметры windows'],['Что на экране?','что сейчас на экране?'],['⏯ Пауза / Play','пауза'],['⏭ Следующий трек','следующий трек'],['Свернуть все окна','сверни все окна'],['Заблокировать ПК','заблокируй компьютер']];
const ring=(label,value,detail,pct)=>{const l=2*Math.PI*26,p=Math.max(0,Math.min(100,pct??0));return `<div class="cy-card holo holo-edge"><svg width="64" height="64" viewBox="0 0 64 64" class="cy-gauge"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(43,223,154,0.12)" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="#2bdf9a" stroke-width="5" stroke-linecap="round" stroke-dasharray="${l}" stroke-dashoffset="${l-l*p/100}" style="filter:drop-shadow(0 0 4px #2bdf9a)"/></svg><div class="cy-card-text"><div class="hud-label">${esc(label)}</div><div class="cy-card-value">${esc(value)}</div>${detail?`<div class="cy-card-detail">${esc(detail)}</div>`:''}</div></div>`;};

export async function cypherPage(state,save,openChat,{aiSettings,cypherDesktop}){
  const [config,history,links,memory]=await Promise.all([api('/ai/config'),api('/ai/history'),api('/cypher/links').then(d=>d.links).catch(()=>[]),api('/ai/memory').catch(()=>[])]);
  if(state.tab!=='ai')return;
  const persona=config.settings.assistant!=='cipherion',name=persona?'Cypher':'Cipherion AI';
  let view=sessionStorage.getItem('cypher-view')||'home',orb=null,status='idle',controller=null,recognition=null,attachment=null,pcTarget=links[0]?.id||'';
  const root=document.createElement('div');root.className='cy-app';$('.workspace').replaceChildren(root);document.querySelector('.shell')?.classList.add('ai-wide');
  root.innerHTML=`<header class="cy-top"><div class="cy-brand"><span class="cy-dot"></span><span class="cy-logo">Cypher</span><span class="cy-ver">web</span><span class="cy-status"><i></i><b>${STATUS.idle}</b></span></div><button class="btn cy-stop" type="button">${svg('stopwatch',16)} Остановить</button></header><div class="cy-body"><nav class="cy-nav">${NAV.map(([id,label])=>`<button type="button" data-cy-view="${id}" title="${label}">${svg(id)}<span>${label}</span></button>`).join('')}</nav><main class="cy-main grid-bg-wrap"><div class="cy-grid" aria-hidden="true"></div><div class="cy-view"></div></main></div>`;
  const q=s=>$(s,root),setStatus=next=>{status=next;q('.cy-status b').textContent=STATUS[next]||STATUS.idle;q('.cy-status').dataset.state=next;orb?.set(next==='executing'?'executing':next);const label=q('.cy-orb-label');if(label)label.textContent=(STATUS[next]||'').toUpperCase();};
  const stop=()=>{controller?.abort();recognition?.stop();window.speechSynthesis?.cancel();setStatus('idle');};
  q('.cy-stop').onclick=stop;window.addEventListener('account-change',stop,{once:true});
  const speak=text=>{if(!config.settings.speak||!window.speechSynthesis)return;const s=new SpeechSynthesisUtterance(text);s.voice=speechSynthesis.getVoices().find(v=>v.name===config.settings.voiceName)||null;s.lang='ru-RU';s.onstart=()=>setStatus('responding');s.onend=()=>setStatus('idle');speechSynthesis.speak(s);};
  const listen=input=>{const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){toast('Распознавание речи недоступно в этом браузере. Используйте диктовку клавиатуры.');return;}
    if(status==='listening'){recognition?.stop();return;}window.speechSynthesis?.cancel();recognition=new R();recognition.lang='ru-RU';recognition.interimResults=true;
    recognition.onstart=()=>setStatus('listening');recognition.onend=()=>{if(status==='listening')setStatus('idle');if(input.value.trim())input.form?.requestSubmit();};recognition.onerror=e=>{toast('Микрофон: '+e.error);setStatus('idle');};
    recognition.onresult=e=>input.value=[...e.results].map(r=>r[0].transcript).join(' ');recognition.start();};

  // ---- conversation -------------------------------------------------------------------------
  const messages=history.map(m=>({role:m.role,text:m.body}));
  const bubble=m=>`<article class="cy-msg ${m.role==='user'?'user':'assistant'}"><small>${m.role==='user'?esc(m.label||'Вы'):esc(m.label||name)}</small><div class="cy-msg-text">${esc(m.text)}</div></article>`;
  async function ask(text,context){
    if(!text||controller)return;
    if(view!=='chat'){view='chat';render();}
    const list=q('.cy-messages');const pc=context?.startsWith('pc:')?links.find(l=>'pc:'+l.id===context):null;
    messages.push({role:'user',text,label:pc?'Вы → 💻 '+pc.device:'Вы'});list.insertAdjacentHTML('beforeend',bubble(messages.at(-1)));
    const reply={role:'assistant',text:'',label:pc?'Cypher на компьютере':name};messages.push(reply);list.insertAdjacentHTML('beforeend',bubble(reply));
    const out=list.lastElementChild.querySelector('.cy-msg-text');list.scrollTop=list.scrollHeight;
    controller=new AbortController();setStatus(pc?'executing':'thinking');
    try{
      if(pc){reply.text=await runOnPC({link:pc.id,text,signal:controller.signal,status:t=>{out.textContent=t;}});out.textContent=reply.text;speak(reply.text);return;}
      if(context&&!confirm('Передать разрешённые сообщения выбранного чата AI-провайдеру для этого запроса?'))throw Object.assign(new Error('Запрос отменён'),{name:'AbortError'});
      const r=await accountFetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,chat:context||undefined,media:attachment?.id}),signal:controller.signal});
      if(!r.ok)throw new Error((await r.json()).error);const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
      while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let index;
        while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);const line=block.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;
          const d=JSON.parse(line.slice(5)),event=block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
          if(event==='delta'){if(status!=='responding')setStatus('responding');reply.text+=d.text;out.textContent=reply.text;list.scrollTop=list.scrollHeight;}
          if(event==='error')throw new Error(d.error);if(event==='done')done=true;
          if(event==='action'){const b=document.createElement('button');b.className='btn cy-action';b.textContent=d.action==='draft'?'Просмотреть черновик':d.action==='open_chat'?'Открыть чат':d.action==='calls'?'Показать звонки':'Открыть настройки';
            b.onclick=guard(async()=>{if(d.action==='open_chat')await openChat(d.chat);else if(d.action==='draft'){modal('Черновик — проверьте перед отправкой',`<textarea id="cy-draft" rows="6">${esc(d.text)}</textarea><button class="primary" id="cy-use-draft">Перенести в поле ввода</button>`);$('#cy-use-draft').onclick=guard(async()=>{const draft=$('#cy-draft').value;$('#modal').close();await openChat(d.chat);$('#draft').value=draft;sessionStorage.setItem(draftKey(d.chat),draft);});}else toast('Откройте «Настройки» в нижнем меню');});out.after(b);}}}
      if(!done)throw new Error('Соединение прервано. Повторите запрос.');attachment=null;speak(reply.text);
    }catch(error){reply.text=reply.text||'';const note=document.createElement('p');note.className='cy-note';note.textContent=error.name==='AbortError'?'Остановлено.':error.message;out.after(note);if(error.name!=='AbortError'){setStatus('error');setTimeout(()=>status==='error'&&setStatus('idle'),2500);}}
    finally{controller=null;if(status!=='responding'&&status!=='error')setStatus('idle');if(!window.speechSynthesis?.speaking&&status==='responding')setStatus('idle');}
  }

  // ---- views ---------------------------------------------------------------------------------
  const contextSelect=()=>`<select class="field cy-context" aria-label="Контекст"><option value="">Только вопрос, без чатов</option>${links.length?`<optgroup label="Cypher на компьютере — выполнить на ПК">${links.map(l=>`<option value="pc:${esc(l.id)}">💻 ${esc(l.device)}${l.online?'':' · не в сети'}</option>`).join('')}</optgroup>`:''}<optgroup label="Чаты (разрешённые в настройках AI)">${state.chats.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</optgroup></select>`;
  function homeView(){
    const now=new Date(),pc=links.find(l=>l.online)||links[0],limit=state.user?.vip?500:100,start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),today=history.filter(m=>m.role==='user'&&m.created>=start&&String(m.body).startsWith('💻')).length;
    return `<section class="cy-home"><div class="hud-label">${esc(now.toLocaleDateString('ru',{weekday:'long',day:'numeric',month:'long'}))}</div><h1 class="cy-hello">${greeting(now.getHours())}</h1><p class="cy-sub">${config.configured||links.length?'Все системы в норме. Чем могу помочь?':'AI пока не подключён на сервере. Подключите Cypher на ПК или попросите администратора.'}</p>
      <div class="cy-orb-wrap"><canvas class="cy-orb" aria-label="Cypher" role="img"></canvas><div class="cy-orb-label">${STATUS[status].toUpperCase()}</div></div>
      <form class="cy-ask holo holo-edge"><input name="text" autocomplete="off" placeholder="Спросите ${esc(name)}…" maxlength="8000"><button type="button" class="cy-icon-btn" data-mic title="Голос">${svg('mic')}</button><button class="cy-icon-btn cy-send" title="Отправить">${svg('up')}</button></form>
      <div class="cy-cards">${ring('Компьютер',pc?pc.device:'Не подключён',pc?(pc.online?'в сети':'не в сети'):'Настройки → подключить',pc?(pc.online?100:30):0)}${config.configured?ring('Модель',config.models[0]||'Подключена','сервер Cipherion',100):ring('Команды ПК',String(today),'сегодня',Math.min(100,today*10))}${ring('Память',String(memory.length),`из ${limit} записей`,memory.length/limit*100)}${ring('Режим',name,persona?'характер Cypher':'нейтральный',100)}</div></section>`;
  }
  function chatView(){
    return `<section class="cy-chat"><div class="cy-chat-head"><div><h2>Чат</h2><small>${esc(name)} помнит историю этого чата</small></div><div class="cy-row">${contextSelect()}<button type="button" class="btn" data-clear>Очистить</button></div></div>
      <div class="cy-messages" aria-live="polite">${messages.length?messages.map(bubble).join(''):`<div class="cy-empty"><canvas class="cy-orb cy-orb-small"></canvas><p>Начните разговор. ${esc(name)} запоминает историю этого чата.</p></div>`}</div>
      <form class="cy-composer holo holo-edge"><button type="button" class="cy-icon-btn" data-attach title="Файл">${svg('clip')}</button><textarea name="text" rows="1" maxlength="8000" placeholder="Напишите сообщение…"></textarea><button type="button" class="cy-icon-btn" data-mic title="Голос">${svg('mic')}</button><button class="cy-icon-btn cy-send" title="Отправить">${svg('up')}</button></form><small class="cy-file"></small></section>`;
  }
  function pcView(){
    if(!links.length)return `<section class="cy-page"><h1>Управление ПК</h1><p class="cy-sub">Подключите Cypher на компьютере, и управляйте им отсюда: программы, звук, музыка, окна.</p><div class="holo holo-edge cy-panel"><div class="hud-label">Как подключить</div><ol class="cy-steps"><li>Установите Cypher для Windows (Настройки → «Cypher для Windows»).</li><li>В Cypher нажмите «Войти через Cipherion» или вкладку «Cipherion» → «Подключить».</li><li>Нажмите кнопку ниже и введите код с экрана компьютера.</li></ol><button class="btn btn-primary" data-link-pc>Подключить по коду</button></div></section>`;
    const pc=links.find(l=>l.id===pcTarget)||links[0];
    return `<section class="cy-page"><div class="cy-chat-head"><div><h1>Управление ПК</h1><p class="cy-sub">Команды выполняет Cypher на компьютере. Опасные действия он сначала подтвердит.</p></div>${links.length>1?`<select class="field cy-pc-select">${links.map(l=>`<option value="${esc(l.id)}" ${l.id===pc.id?'selected':''}>💻 ${esc(l.device)}</option>`).join('')}</select>`:''}</div>
      <div class="holo holo-edge cy-panel"><div class="hud-label">${esc(pc.device)} · ${pc.online?'в сети':'не в сети'}</div><div class="cy-row"><button class="btn" data-cmd="выключи звук">🔇 Выключить звук</button><input type="range" min="0" max="100" step="5" value="50" class="cy-volume" aria-label="Громкость"><span class="cy-volume-value">50%</span></div></div>
      <div class="holo holo-edge cy-panel"><div class="hud-label">Быстрый запуск</div><div class="cy-chips">${QUICK.map(([label,cmd])=>`<button class="btn" data-cmd="${esc(cmd)}">${esc(label)}</button>`).join('')}</div></div>
      <form class="holo holo-edge cy-panel cy-launch"><div class="hud-label">Команда для компьютера</div><div class="cy-row"><input class="field" name="text" placeholder="телеграм, дискорд, фотошоп, загрузки, путь к exe… или любая просьба"><button class="btn btn-primary">Выполнить</button></div></form>
      <div class="holo holo-edge cy-panel"><div class="hud-label">Питание</div><div class="cy-row"><button class="btn" data-cmd="переведи компьютер в спящий режим">Сон</button><button class="btn" data-cmd="перезагрузи компьютер" data-danger>Перезагрузка</button><button class="btn" data-cmd="выключи компьютер" data-danger>Выключение</button></div></div>
      <div class="holo holo-edge cy-panel"><div class="hud-label">Ответы компьютера</div><div class="cy-log"><p class="cy-note">Здесь появятся ответы Cypher.</p></div></div></section>`;
  }
  function memoryView(){
    return `<section class="cy-page"><h1>Память</h1><p class="cy-sub">Долговременная память ${esc(name)}. Общая с Cypher на компьютере, если он подключён.</p>
      ${config.settings.memory?'':`<div class="holo holo-edge cy-panel"><p>Память AI выключена.</p><button class="btn btn-primary" data-enable-memory>Включить память</button></div>`}
      <form class="holo holo-edge cy-panel cy-mem-add"><div class="hud-label">Новая запись</div><div class="cy-row"><input class="field" name="text" maxlength="2000" placeholder="Например: день рождения мамы — 12 марта"><button class="btn btn-primary">Запомнить</button></div></form>
      <div class="holo holo-edge cy-panel"><input class="field cy-mem-search" placeholder="Поиск по памяти"><div class="cy-mem-list">${memory.length?'':'<p class="cy-note">Память пуста. Скажите «Сайфер, запомни, что…» или добавьте запись выше.</p>'}</div></div></section>`;
  }
  function settingsView(){
    return `<section class="cy-page"><h1>Настройки</h1><p class="cy-sub">Разрешения AI, характер ассистента, компьютеры и приложение для Windows.</p>
      <div class="holo holo-edge cy-panel"><div class="hud-label">Ассистент</div><p>Сейчас: <b>${esc(name)}</b>${config.configured?' · модель '+esc(config.models[0]||''):' · модель на сервере не подключена'}</p><button class="btn btn-primary" data-ai-settings>Разрешения, память и характер</button></div>
      <aside class="cypher-pc cy-legacy" hidden></aside><aside class="cypher-desktop cy-legacy" hidden></aside></section>`;
  }
  function drawMemory(filter=''){const box=q('.cy-mem-list');if(!box||!memory.length)return;const f=filter.toLowerCase();
    box.innerHTML=memory.filter(m=>m.body.toLowerCase().includes(f)).map(m=>`<div class="cy-mem-row"><span>${esc(m.body)}</span><button class="btn" data-forget="${esc(m.id)}">Забыть</button></div>`).join('')||'<p class="cy-note">Ничего не найдено.</p>';
    box.querySelectorAll('[data-forget]').forEach(b=>b.onclick=guard(async()=>{await api('/ai/memory','DELETE',{id:b.dataset.forget});memory.splice(memory.findIndex(m=>m.id===b.dataset.forget),1);drawMemory(q('.cy-mem-search')?.value||'');}));}

  async function command(text,danger){
    const pc=links.find(l=>l.id===pcTarget)||links[0];if(!pc||!text||controller)return;
    if(danger&&!confirm(`«${text}» на компьютере «${pc.device}»?`))return;
    const log=q('.cy-log');log.querySelector('.cy-note')?.remove();const row=document.createElement('div');row.className='cy-log-row';row.innerHTML=`<b>${esc(text)}</b><span>Отправлено…</span>`;log.prepend(row);
    controller=new AbortController();setStatus('executing');
    try{const reply=await runOnPC({link:pc.id,text:danger?text+'. Подтверждаю.':text,signal:controller.signal,status:t=>{row.querySelector('span').textContent=t;}});row.querySelector('span').textContent=reply;messages.push({role:'user',text,label:'Вы → 💻 '+pc.device},{role:'assistant',text:reply,label:'Cypher на компьютере'});}
    catch(error){row.querySelector('span').textContent=error.name==='AbortError'?'Остановлено.':error.message;row.classList.add('error');}
    finally{controller=null;setStatus('idle');}
  }

  function render(){
    orb?.stop();orb=null;sessionStorage.setItem('cypher-view',view);
    root.querySelectorAll('[data-cy-view]').forEach(b=>b.classList.toggle('active',b.dataset.cyView===view));
    const box=q('.cy-view');box.innerHTML=view==='chat'?chatView():view==='pc'?pcView():view==='memory'?memoryView():view==='settings'?settingsView():homeView();
    const canvas=q('.cy-orb');if(canvas){const small=canvas.classList.contains('cy-orb-small');orb=createOrb(canvas,{size:small?150:Math.min(400,Math.max(240,box.clientWidth-32))});orb.set(status);}
    const ask_=q('.cy-ask');if(ask_)ask_.onsubmit=guard(async e=>{e.preventDefault();const input=ask_.elements.text,text=input.value.trim();input.value='';await ask(text,'');});
    const composer=q('.cy-composer');if(composer){const area=composer.elements.text,context=q('.cy-context');
      if(pcTarget&&sessionStorage.getItem('cypher-context')?.startsWith('pc:'))context.value=sessionStorage.getItem('cypher-context');
      context.onchange=()=>{sessionStorage.setItem('cypher-context',context.value);area.placeholder=context.value.startsWith('pc:')?'Команда для компьютера: включи музыку, громкость 30…':'Напишите сообщение…';};context.onchange();
      area.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();composer.requestSubmit();}};area.oninput=()=>{area.style.height='auto';area.style.height=Math.min(area.scrollHeight,160)+'px';};
      composer.onsubmit=guard(async e=>{e.preventDefault();const text=area.value.trim();area.value='';area.oninput();await ask(text,context.value);});
      q('[data-attach]').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,application/pdf,text/plain';input.onchange=guard(async()=>{if(input.files[0]){attachment=await upload(input.files[0]);q('.cy-file').textContent='📎 '+attachment.name;}});input.click();};
      q('[data-clear]').onclick=guard(async()=>{if(!confirm('Очистить историю чата с '+name+'?'))return;await api('/ai/history','DELETE');messages.length=0;render();});
      const list=q('.cy-messages');list.scrollTop=list.scrollHeight;}
    root.querySelectorAll('[data-mic]').forEach(b=>b.onclick=()=>listen(b.closest('form').elements.text));
    root.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=guard(()=>command(b.dataset.cmd,b.hasAttribute('data-danger'))));
    const volume=q('.cy-volume');if(volume){volume.oninput=()=>q('.cy-volume-value').textContent=volume.value+'%';volume.onchange=guard(()=>command('громкость '+volume.value));}
    const launch=q('.cy-launch');if(launch)launch.onsubmit=guard(async e=>{e.preventDefault();const text=launch.elements.text.value.trim();launch.elements.text.value='';await command(text);});
    const select=q('.cy-pc-select');if(select)select.onchange=()=>{pcTarget=select.value;render();};
    const link=q('[data-link-pc]');if(link)link.onclick=guard(()=>approveCypher('',()=>location.reload()));
    const add=q('.cy-mem-add');if(add)add.onsubmit=guard(async e=>{e.preventDefault();const text=add.elements.text.value.trim();if(!text)return;await api('/ai/memory','POST',{body:text});add.elements.text.value='';memory.splice(0,memory.length,...await api('/ai/memory'));drawMemory();toast('Запомнил');});
    const search=q('.cy-mem-search');if(search){search.oninput=()=>drawMemory(search.value);drawMemory();}
    const enable=q('[data-enable-memory]');if(enable)enable.onclick=guard(async()=>{state.settings.ai={...(state.settings.ai||{}),memory:true};await save();config.settings.memory=true;render();});
    const prefs=q('[data-ai-settings]');if(prefs)prefs.onclick=guard(()=>aiSettings(state,save));
    if(view==='settings'){cypherComputers(q('.cypher-pc'),id=>{pcTarget=id;sessionStorage.setItem('cypher-context','pc:'+id);view='chat';render();});cypherDesktop(q('.cypher-desktop'));}
  }
  root.querySelectorAll('[data-cy-view]').forEach(b=>b.onclick=()=>{if(b.dataset.cyView===view)return;view=b.dataset.cyView;render();});
  render();setStatus(status);
}
