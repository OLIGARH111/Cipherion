import {$,esc,icon,button,avatar,api,modal,guard,toast} from './ui.js';

// Keep audio independent of video readiness, and retry playback as tracks arrive.
export function bindRemoteMedia(tile, stream){
  const video=tile.querySelector('video'),audio=document.createElement('audio');
  audio.autoplay=true;tile.append(audio);video.muted=true;video.playsInline=true;
  const audioStream=new MediaStream(),videoStream=new MediaStream();
  const watched=new Map();let disposed=false,attempt=0,retry=null;
  function showRetry(){
    if(disposed||retry)return;
    retry=document.createElement('button');retry.className='secondary';
    retry.textContent='Включить звук и видео';retry.onclick=play;tile.append(retry);
  }
  async function play(){
    if(disposed)return;
    const ticket=++attempt;
    const elements=[audio,video].filter(el=>el.srcObject?.getTracks().some(t=>t.readyState!=='ended'));
    const results=await Promise.allSettled(elements.map(el=>{try{return el.play();}catch(error){return Promise.reject(error);}}));
    if(disposed||ticket!==attempt)return;
    if(results.some(r=>r.status==='rejected'))showRetry();
    else{retry?.remove();retry=null;}
  }
  function sync(){
    if(disposed)return;
    const tracks=stream.getTracks().filter(t=>t.readyState!=='ended');
    for(const [track,cleanup]of watched)if(!tracks.includes(track)){cleanup();watched.delete(track);}
    for(const track of tracks)if(!watched.has(track)){
      track.addEventListener('unmute',play);track.addEventListener('ended',sync);
      watched.set(track,()=>{track.removeEventListener('unmute',play);track.removeEventListener('ended',sync);});
    }
    for(const [element,target,kind]of [[audio,audioStream,'audio'],[video,videoStream,'video']]){
      for(const track of target.getTracks())if(!tracks.includes(track))target.removeTrack(track);
      for(const track of tracks)if(track.kind===kind&&!target.getTracks().includes(track))target.addTrack(track);
      if(target.getTracks().length){if(element.srcObject!==target)element.srcObject=target;}
      else if(element.srcObject){element.pause();element.srcObject=null;}
    }
    if(!tracks.length){dispose();tile.remove();return;}
    play();
  }
  function dispose(){
    if(disposed)return;disposed=true;attempt++;
    stream.removeEventListener('addtrack',sync);stream.removeEventListener('removetrack',sync);
    for(const cleanup of watched.values())cleanup();watched.clear();
    for(const element of [audio,video]){element.removeEventListener('loadedmetadata',play);element.pause();element.srcObject=null;}
    retry?.remove();audio.remove();
  }
  stream.addEventListener('addtrack',sync);stream.addEventListener('removetrack',sync);
  audio.addEventListener('loadedmetadata',play);video.addEventListener('loadedmetadata',play);
  sync();return{sync,dispose};
}

export function createCalls(state,iceServers){
  let signalQueue=Promise.resolve(),generation=0,starting=false,confirming=false;
  let current=null,local=null,screen=null,peers=new Map(),timer=null,incoming=null,started=0,minimized=false;
  const root=$('#call-root');
  const action=(name,data={})=>api('/call-action','POST',{id:current?.id,action:name,...data});
  const nameOf=id=>state.chats.find(c=>c.id===current?.chat)?.members.find(m=>m.user_id===id)?.name || 'Участник';
  async function media(video){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Для звонков нужен HTTPS и доступ к микрофону');return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:video?{width:{ideal:960},height:{ideal:540},facingMode:'user'}:false});}
  function stop(){generation++;starting=false;clearInterval(timer);local?.getTracks().forEach(t=>t.stop());screen?.getTracks().forEach(t=>t.stop());for(const p of peers.values()){clearTimeout(p.deadline);clearTimeout(p.disconnect);p.pc.close();}peers.clear();current=null;local=null;screen=null;incoming=null;root.querySelectorAll('[data-remote]').forEach(el=>el.rtcMedia?.dispose());root.innerHTML='';minimized=false;}
  function status(text){const el=$('#call-state');if(el)el.textContent=text;}
  function render(){
    root.innerHTML=`<section class="call-overlay ${minimized?'minimized':''}"><header class="call-head"><div><h3>${esc(state.chats.find(c=>c.id===current.chat)?.title||current.name)}</h3><p class="call-state" id="call-state">Соединение…</p></div><div class="row"><small id="call-timer">00:00</small>${button('back','Свернуть / развернуть','id="minimize-call"')}</div></header><div class="video-grid" id="video-grid"><div class="video-tile" id="local-tile"><video id="local-video" autoplay playsinline muted></video><label>Вы</label></div></div><div class="call-controls">${button('mic','Выключить / включить микрофон','id="toggle-mic"')}${button('video','Выключить / включить камеру','id="toggle-camera"')}${button('video','Переключить переднюю / заднюю камеру','id="flip-camera"')}${button('screen','Демонстрация экрана','id="share-screen"')}<button class="secondary" id="call-check">Проверить связь</button>${button('settings','Устройства звонка','id="call-devices"')}${button('phone','Завершить звонок','id="hangup" class="icon-button hangup"')}</div></section>`;
    $('#hangup').classList.add('hangup');$('#local-video').srcObject=local;
    $('#minimize-call').onclick=()=>{minimized=!minimized;$('.call-overlay').classList.toggle('minimized',minimized);};
    $('#toggle-mic').onclick=()=>{local.getAudioTracks().forEach(t=>t.enabled=!t.enabled);$('#toggle-mic').classList.toggle('off',!local.getAudioTracks()[0]?.enabled);};
    $('#toggle-camera').onclick=guard(async()=>{const track=local.getVideoTracks()[0];if(track){track.enabled=!track.enabled;$('#toggle-camera').classList.toggle('off',!track.enabled);}else{const stream=await navigator.mediaDevices.getUserMedia({video:true});const track=stream.getVideoTracks()[0];local.addTrack(track);for(const p of peers.values())p.pc.addTrack(track,local);$('#local-video').srcObject=local;$('#toggle-camera').classList.remove('off');}});
    $('#flip-camera').onclick=guard(async()=>{const old=local.getVideoTracks()[0];if(!old)throw new Error('Сначала включите камеру');const facing=old.getSettings().facingMode==='environment'?'user':'environment';const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing}},audio:false});const track=stream.getVideoTracks()[0];try{for(const p of peers.values()){const sender=p.pc.getSenders().find(s=>s.track===old);if(sender)await sender.replaceTrack(track);}local.removeTrack(old);old.stop();local.addTrack(track);$('#local-video').srcObject=local;}catch(e){track.stop();throw e;}});
    $('#call-check').onclick=guard(checkConnection);$('#share-screen').onclick=guard(toggleScreen);$('#call-devices').onclick=guard(devices);$('#hangup').onclick=guard(async()=>{try{await action('leave');}finally{stop();}});
    $('#toggle-camera').classList.toggle('off',!local.getVideoTracks().length);
    started=Date.now();clearInterval(timer);timer=setInterval(()=>{if(!current)return;const seconds=Math.floor((Date.now()-started)/1000);if($('#call-timer'))$('#call-timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;},1000);
    
  }
  function peer(remote){
    if(peers.has(remote))return peers.get(remote);
    const pc=new RTCPeerConnection({iceServers,iceTransportPolicy:current?.relayOnly?'relay':'all'});const p={pc,polite:state.user.id.localeCompare(remote)>0,makingOffer:false,ignoreOffer:false,candidates:[],screenSender:null,restarts:0,isSettingRemoteAnswerPending:false};peers.set(remote,p);
    const expire=()=>{if(!current||pc.connectionState==='closed')return;toast('Не удалось установить соединение. Проверьте интернет и повторите звонок.');action('leave').catch(()=>{});stop();};
    p.deadline=setTimeout(expire,35000);
    const diagnostic=async()=>{const stats=await pc.getStats();let pair;stats.forEach(v=>{if(v.type==='transport'&&v.selectedCandidatePairId)pair=stats.get(v.selectedCandidatePairId);});if(pair){const a=stats.get(pair.localCandidateId),b=stats.get(pair.remoteCandidateId);console.info('Cipherion RTC',{state:pc.connectionState,ice:pc.iceConnectionState,localType:a?.candidateType,remoteType:b?.candidateType,protocol:a?.protocol});}};
    pc.onicecandidateerror=e=>console.warn('Cipherion ICE',{code:e.errorCode});
    pc.onicecandidate=({candidate})=>{if(candidate&&current)action('signal',{target:remote,signal:{candidate}}).catch(()=>status('Сигнальная связь прервана. Переподключение…'));};
    pc.ontrack=({track,streams})=>{
      if(pc.connectionState==='closed'||!current)return;
      const stream=streams[0] || (p.streamless ||= new MediaStream());
      if(!stream.getTracks().includes(track))stream.addTrack(track);
      const key='remote-'+remote+'-'+stream.id;let tile=document.getElementById(key);
      if(!tile){
        tile=document.createElement('div');tile.className='video-tile';tile.id=key;tile.dataset.remote=remote;
        tile.innerHTML=`<video autoplay playsinline muted></video><label>${esc(nameOf(remote))}</label>`;
        $('#video-grid')?.append(tile);tile.rtcMedia=bindRemoteMedia(tile,stream);
        tile.ondblclick=()=>tile.requestFullscreen?.();
      }else tile.rtcMedia.sync();
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected'){clearTimeout(p.deadline);clearTimeout(p.disconnect);p.restarts=0;status([...peers.values()].every(p=>p.pc.connectionState==='connected')?'Подключено':'Соединение…');diagnostic().catch(()=>{});}
      else if(['failed','disconnected'].includes(pc.connectionState)){status('Восстанавливаем соединение…');if(p.restarts++<2)pc.restartIce();clearTimeout(p.disconnect);p.disconnect=setTimeout(expire,20000);}
    };
    pc.onnegotiationneeded=async()=>{try{p.makingOffer=true;await pc.setLocalDescription();await action('signal',{target:remote,signal:{description:pc.localDescription}});}catch(error){p.lastError=error.message;toast(error.message);}finally{p.makingOffer=false;}};
    for(const track of local.getTracks())pc.addTrack(track,local);
    if(screen)p.screenSender=pc.addTrack(screen.getVideoTracks()[0],screen);
    return p;
  }
  async function signal(data){if(!current||data.call!==current.id)return;try{const p=peer(data.from),pc=p.pc;const {description,candidate}=data.signal;
    if(description){const ready=!p.makingOffer&&(pc.signalingState==='stable'||p.isSettingRemoteAnswerPending);const collision=description.type==='offer'&&!ready;p.ignoreOffer=!p.polite&&collision;if(p.ignoreOffer)return;p.isSettingRemoteAnswerPending=description.type==='answer';try{await pc.setRemoteDescription(description);}finally{p.isSettingRemoteAnswerPending=false;}for(const c of p.candidates)await pc.addIceCandidate(c);p.candidates=[];if(description.type==='offer'){await pc.setLocalDescription();await action('signal',{target:data.from,signal:{description:pc.localDescription}});}}
    else if(candidate){if(p.ignoreOffer)return;if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(e=>{if(!p.ignoreOffer)throw e;});else p.candidates.push(candidate);}
  }catch(error){const p=peers.get(data.from);if(p)p.lastError=error.message;toast('Не удалось согласовать соединение: '+error.message);}}
  async function event(data){
    if(['ended','declined','missed','removed'].includes(data.state)){if(current?.id===data.id || incoming?.id===data.id){stop();toast(data.state==='missed'?'Пропущенный звонок':data.state==='declined'?'Звонок отклонён':'Звонок завершён');}return;}
    if(data.state==='ringing'&&data.caller!==state.user.id&&!current&&!incoming){incoming=data;root.innerHTML=`<section class="incoming"><span class="eyebrow">ВХОДЯЩИЙ ${data.video?'ВИДЕО':'АУДИО'}ЗВОНОК</span><h3>${esc(data.name)}</h3><p class="muted">Хочет поговорить с вами</p><div class="row"><button class="primary" id="accept-call">${icon('phone')}Принять</button><button class="secondary danger" id="reject-call">Отклонить</button></div></section>`;$('#accept-call').onclick=guard(async()=>{if(starting)return;starting=true;const ticket=generation;let acquired;try{iceServers=(await api('/rtc-config')).iceServers;acquired=await media(data.video);if(ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return;}local=acquired;current=data;incoming=null;render();await action('join');for(const remote of data.participants)if(remote!==state.user.id)peer(remote);}catch(error){acquired?.getTracks().forEach(t=>t.stop());stop();throw error;}finally{starting=false;}});$('#reject-call').onclick=guard(async()=>{await api('/call-action','POST',{id:data.id,action:'reject'});incoming=null;root.innerHTML='';});navigator.vibrate?.([150,80,150]);return;}
    if(current?.id===data.id){current={...current,...data};for(const remote of data.participants)if(remote!==state.user.id)peer(remote);for(const [remote,p]of peers)if(!data.participants.includes(remote)){clearTimeout(p.deadline);clearTimeout(p.disconnect);p.pc.close();peers.delete(remote);document.querySelectorAll(`[data-remote="${remote}"]`).forEach(el=>{el.rtcMedia?.dispose();el.remove();});}if(data.sharing)status(data.sharing===state.user.id?'Вы демонстрируете экран':nameOf(data.sharing)+' демонстрирует экран');else status(peers.size>0&&[...peers.values()].every(p=>p.pc.connectionState==='connected')?'Подключено':data.participants.length>1?'Соединение…':'Звоним…');}
  }
  async function checkConnection(){
    if(!current)return;
    const callId=current.id;
    const dialog=modal('Проверка связи','<p id="rtc-check">Проверяем передачу звука и видео…</p><button class="primary" id="rtc-play">Включить звук и видео</button><p class="note">Если связи нет, пришлите снимок этой проверки с обоих устройств.</p>');
    $('#rtc-play').onclick=async()=>{
      const elements=[...root.querySelectorAll('[data-remote] audio,[data-remote] video')].filter(el=>el.srcObject);
      const results=await Promise.allSettled(elements.map(el=>el.play()));
      toast(!elements.length?'Дорожки собеседника пока не получены':results.some(r=>r.status==='rejected')?'Браузер не запустил воспроизведение. Проверьте разрешения сайта.':'Воспроизведение запущено');
    };
    const kinds={audio:'Звук',video:'Видео'};
    const describe=track=>!track?'нет':track.readyState==='ended'?'завершена':!track.enabled?'выключена':track.muted?'нет данных':'работает';
    const take=async pc=>{const totals={};(await pc.getStats()).forEach(r=>{const kind=r.kind||r.mediaType;if(!kinds[kind]||r.isRemote)return;if(r.type==='inbound-rtp'||r.type==='outbound-rtp'){const key=(r.type==='inbound-rtp'?'in':'out')+kind;const t=totals[key]||={bytes:0,frames:0};t.bytes+=Number(r.bytesReceived??r.bytesSent??0);t.frames+=Number(r.framesDecoded??0);}});return totals;};
    const snapshot=[...peers].map(([id,p])=>({id,p}));
    await Promise.all(snapshot.map(async x=>{try{x.before=await take(x.p.pc);}catch{x.before={};}}));
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(current?.id!==callId||!dialog.open)return;
    const lines=['Проверка звонка · версия 2',...['audio','video'].map(kind=>kinds[kind]+' у вас: '+describe(local?.getTracks().find(t=>t.kind===kind)))];
    for(const x of snapshot){
      const pc=x.p.pc;let after;try{after=await take(pc);}catch{lines.push('Соединение уже закрыто');continue;}
      lines.push('',nameOf(x.id), 'Соединение: '+pc.connectionState+' / '+pc.iceConnectionState, 'Согласование: '+pc.signalingState);
      for(const kind of ['audio','video']){
        const incoming=after['in'+kind],outgoing=after['out'+kind];
        const delta=key=>Math.max(0,(after[key]?.bytes||0)-(x.before[key]?.bytes||0));
        lines.push(kinds[kind]+': отправлено '+delta('out'+kind)+' Б / получено '+delta('in'+kind)+' Б за 2 с');
        if(kind==='video')lines.push('Раскодировано кадров: '+(incoming?.frames||0));
        const receivers=pc.getReceivers().map(r=>r.track).filter(t=>t.kind===kind);
        lines.push('Дорожка собеседника: '+(receivers.map(describe).join(', ')||'нет'));
        if(!incoming&&!outgoing)lines.push('Обмен ещё не начался');
      }
      for(const el of root.querySelectorAll('[data-remote]'))if(el.dataset.remote===x.id){
        for(const media of el.querySelectorAll('audio,video'))if(media.srcObject)lines.push((media.tagName==='AUDIO'?'Динамик':'Экран')+': '+(media.paused?'пауза':'воспроизведение')+'; готовность '+media.readyState);
      }
      if(x.p.lastError)lines.push('Ошибка: '+x.p.lastError);
    }
    if(!snapshot.length)lines.push('Собеседник ещё не подключён');
    const target=$('#rtc-check');if(target){target.style.whiteSpace='pre-wrap';target.style.fontSize='13px';target.textContent=lines.join('\n');}
  }
  async function toggleScreen(){
    if(screen){await action('share',{enabled:false});for(const p of peers.values())if(p.screenSender){p.pc.removeTrack(p.screenSender);p.screenSender=null;}screen.getTracks().forEach(t=>t.stop());screen=null;$('#share-screen')?.classList.remove('off');status('Демонстрация завершена');return;}
    if(!navigator.mediaDevices.getDisplayMedia)throw new Error('Этот браузер не поддерживает демонстрацию экрана');
    const display=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:false});try{await action('share',{enabled:true});}catch(error){display.getTracks().forEach(t=>t.stop());throw error;}
    screen=display;for(const p of peers.values())p.screenSender=p.pc.addTrack(display.getVideoTracks()[0],display);display.getVideoTracks()[0].onended=()=>{if(screen)guard(toggleScreen)();};$('#share-screen')?.classList.add('off');status('Вы демонстрируете экран');
  }
  async function devices(){const devices=await navigator.mediaDevices.enumerateDevices();const options=kind=>devices.filter(d=>d.kind===kind).map(d=>`<option value="${esc(d.deviceId)}">${esc(d.label||'Устройство')}</option>`).join('');modal('Устройства звонка',`<label class="field">Микрофон<select id="audio-device">${options('audioinput')}</select></label><label class="field">Камера<select id="video-device">${options('videoinput')}</select></label><label class="field">Вывод звука<select id="output-device">${options('audiooutput')}</select></label><button class="primary" id="apply-devices">Применить</button><p class="note">На телефоне динамик и Bluetooth могут переключаться системными средствами. Выбор аудиовыхода поддерживается не во всех браузерах.</p>`);$('#apply-devices').onclick=guard(async()=>{const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:$('#audio-device').value}},video:local.getVideoTracks().length?{deviceId:{exact:$('#video-device').value}}:false});for(const track of stream.getTracks()){const old=local.getTracks().find(t=>t.kind===track.kind);for(const p of peers.values()){const sender=p.pc.getSenders().find(s=>s.track===old);if(sender)await sender.replaceTrack(track);}if(old){local.removeTrack(old);old.stop();}local.addTrack(track);}$('#local-video').srcObject=local;const output=$('#output-device').value;for(const video of root.querySelectorAll('video,audio'))if(!video.muted&&video.setSinkId&&output)await video.setSinkId(output);$('#modal').close();});}
  return{event,signal:data=>{signalQueue=signalQueue.then(()=>signal(data)).catch(e=>toast(e.message));return signalQueue;},reconnect:async()=>{const active=await api('/calls/active');if(current){if(!active.some(c=>c.id===current.id)){stop();return;}for(const p of peers.values())p.pc.restartIce();}else for(const c of active)if(c.state==='ringing')await event(c);},start:async(chat,video)=>{if(current||incoming||starting||confirming)return;if(!chat)throw new Error('Чат недоступен');confirming=true;const peer=chat.members?.find(m=>m.user_id!==state.user.id),group=chat.kind!=='direct';const confirmed=await new Promise(resolve=>{const dialog=modal(group?'Начать звонок в «'+chat.title+'»?':(video?'Видеозвонок: ':'Позвонить: ')+chat.title+'?',`<div class="call-confirm">${avatar(chat.title,chat.avatar||peer?.avatar,'large')}<p>${group?'Участники группы смогут присоединиться к звонку.':'Вы действительно хотите начать '+(video?'видеозвонок':'аудиозвонок')+' пользователю '+esc(chat.title)+'?'}</p><div class="row"><button class="secondary" id="cancel-dial">Отмена</button><button class="primary" id="confirm-dial">${icon(video?'video':'phone')}${group?'Начать звонок':'Позвонить'}</button></div></div>`);let settled=false;function finish(value){if(settled)return;settled=true;dialog.removeEventListener('close',cancel);dialog.close();resolve(value);}const cancel=()=>finish(false);dialog.addEventListener('close',cancel,{once:true});$('#cancel-dial').onclick=cancel;$('#confirm-dial').onclick=()=>finish(true);});confirming=false;if(!confirmed||current||incoming||starting)return;starting=true;try{const config=await api('/rtc-config');iceServers=config.iceServers;local=await media(video);current=await api('/calls','POST',{chat:chat.id,video});render();status('Звоним…');if(!config.relayConfigured)toast('Прямые звонки включены. Для сложных сетей администратору нужен TURN.');}catch(error){stop();throw error;}finally{starting=false;}}};
}




