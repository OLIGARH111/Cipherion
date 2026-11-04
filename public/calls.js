import {closeCallNotification} from './notifications.js';
import {nativeCallEnded} from './native-bridge.js';
import {$,esc,icon,button,avatar,api,modal,guard,toast} from './ui.js';

// Keep mute/camera state when selecting a new device. Retain the old tracks until
// every peer has accepted the replacement, so a rejected change is recoverable.
export async function replaceCallTracks(local,peers,replacement){
  const tracks=replacement.getTracks(),changes=[];
  const pairs=tracks.map(track=>({track,old:local.getTracks().find(t=>t.kind===track.kind)}));
  try{
    for(const {track,old} of pairs){
      if(old)track.enabled=old.enabled;
      for(const p of peers.values()){
        const sender=p.pc.getSenders().find(s=>s.track===old);
        if(sender){await sender.replaceTrack(track);changes.push({sender,old});}
      }
    }
  }catch(error){
    await Promise.allSettled(changes.map(({sender,old})=>sender.replaceTrack(old)));
    tracks.forEach(t=>t.stop());throw error;
  }
  for(const {track,old} of pairs){if(old){local.removeTrack(old);old.stop();}local.addTrack(track);}
}

// Keep audio independent of video readiness, and retry playback as tracks arrive.
export function bindRemoteMedia(tile, stream, debug=()=>{}, context=()=>null){
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
    if(results.some(r=>r.status==='rejected')){for(const r of results)if(r.status==='rejected')debug('audio.play',r.reason?.name);showRetry();}
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
  // Voice level for the avatar ring while the other person has no video.
  let analyser=null,source=null,samples=null,analysedTrack=null;
  function level(){
    try{
      const track=audioStream.getAudioTracks().find(t=>t.readyState==='live'),ctx=context();
      if(!track||!ctx)return 0;
      if(analysedTrack!==track){source?.disconnect();analyser=ctx.createAnalyser();analyser.fftSize=512;samples=new Uint8Array(analyser.fftSize);source=ctx.createMediaStreamSource(new MediaStream([track]));source.connect(analyser);analysedTrack=track;}
      analyser.getByteTimeDomainData(samples);let sum=0;for(const v of samples){const x=(v-128)/128;sum+=x*x;}
      return Math.min(1,Math.sqrt(sum/samples.length)*4);
    }catch{return 0;}
  }
  function dispose(){
    if(disposed)return;disposed=true;attempt++;source?.disconnect();source=null;analyser=null;
    stream.removeEventListener('addtrack',sync);stream.removeEventListener('removetrack',sync);
    for(const cleanup of watched.values())cleanup();watched.clear();
    for(const element of [audio,video]){element.removeEventListener('loadedmetadata',play);element.pause();element.srcObject=null;}
    retry?.remove();audio.remove();
  }
  stream.addEventListener('addtrack',sync);stream.addEventListener('removetrack',sync);
  audio.addEventListener('loadedmetadata',play);video.addEventListener('loadedmetadata',play);
  sync();return{sync,dispose,level};
}

export function createCalls(state,iceServers){
  const debug=(event,data)=>{if(state.rtcDebug===true)console.debug('Cipherion RTC',event,data);};
  let audioContext;
  function unlockAudio(){try{const AC=window.AudioContext||window.webkitAudioContext;if(AC){audioContext ||= new AC();void audioContext.resume().catch(e=>debug('audio unlock',e.name));}for(const el of root.querySelectorAll('audio'))void el.play().catch(e=>debug('audio.play',e.name));}catch(e){debug('audio unlock',e.name);}}
  let signalQueue=Promise.resolve(),generation=0,starting=false,confirming=false;
  let facing='user',current=null,local=null,screen=null,peers=new Map(),timer=null,incoming=null,started=0,minimized=false;
  const root=$('#call-root');
  const action=(name,data={})=>api('/call-action','POST',{id:current?.id,action:name,...data});
  const nameOf=id=>state.chats.find(c=>c.id===current?.chat)?.members.find(m=>m.user_id===id)?.name || 'Участник';
  async function media(video){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Для звонков нужен HTTPS и доступ к микрофону');const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:video?{width:{ideal:960},height:{ideal:540},facingMode:'user'}:false}).catch(e=>{debug('microphone permission',e.name);throw e;});const tracks=stream.getAudioTracks();debug('microphone permission','granted');debug('local audio tracks',tracks.map(t=>({enabled:t.enabled,muted:t.muted,state:t.readyState})));if(!tracks.some(t=>t.readyState==='live')){stream.getTracks().forEach(t=>t.stop());throw new Error('Микрофон не передаёт звук. Проверьте разрешение и повторите звонок.');}return stream;}
  function stop(){closeCallNotification(current?.id||incoming?.id).catch(()=>{});nativeCallEnded(current?.id||incoming?.id);generation++;starting=false;clearInterval(timer);local?.getTracks().forEach(t=>t.stop());screen?.getTracks().forEach(t=>t.stop());for(const p of peers.values())closePeer(p);peers.clear();audioContext?.close().catch(()=>{});audioContext=null;current=null;local=null;screen=null;incoming=null;facing='user';root.querySelectorAll('[data-remote]').forEach(el=>el.rtcMedia?.dispose());root.innerHTML='';minimized=false;}
  function closePeer(p){clearTimeout(p.deadline);clearTimeout(p.disconnect);clearTimeout(p.attachTimer);clearInterval(p.statsTimer);clearInterval(p.watchdog);p.pc.close();}
  function status(text){const el=$('#call-state');if(el)el.textContent=text;}
  const chatOf=()=>state.chats.find(c=>c.id===current?.chat);
  const memberOf=id=>chatOf()?.members?.find(m=>m.user_id===id);
  const cameraOn=()=>!!local?.getVideoTracks().some(t=>t.enabled&&t.readyState==='live');
  // Who we show while nobody has joined yet: the other person in a direct chat, the group otherwise.
  function waitingFace(){const chat=chatOf();if(chat?.kind==='direct'){const m=chat.members?.find(x=>x.user_id!==state.user.id);return {name:m?.name||chat.title,avatar:m?.avatar||chat.avatar};}return {name:chat?.title||current.name||'Звонок',avatar:chat?.avatar};}
  function voiceFace(name,media){return `<div class="call-face"><div class="call-voice"><i></i><i></i>${avatar(name,media,'large')}</div><b>${esc(name)}</b></div>`;}
  function controlButton(id,name,label,extra=''){return `<button type="button" class="call-btn ${extra}" id="${id}" aria-label="${esc(label)}"><span>${icon(name)}</span><small>${esc(label)}</small></button>`;}
  function render(){
    const face=waitingFace();
    root.innerHTML=`<section class="call-overlay tg-call ${minimized?'minimized':''}">
      <div class="call-stage" id="video-grid"><div class="call-wait" id="call-wait">${voiceFace(face.name,face.avatar)}</div></div>
      <header class="call-head"><button type="button" class="call-round" id="minimize-call" aria-label="Свернуть / развернуть">${icon('down')}</button><div class="call-title"><h3>${esc(chatOf()?.title||current.name||face.name)}</h3><p><span class="call-state" id="call-state">Соединение…</span> · <span id="call-timer">00:00</span></p></div></header>
      <div class="call-self" id="local-tile" hidden><video id="local-video" class="mirror" autoplay playsinline muted></video><button type="button" class="call-flip" id="flip-camera" aria-label="Переключить камеру">${icon('flip')}</button></div>
      <div class="call-controls">${controlButton('toggle-camera','video','Камера')}${controlButton('toggle-mic','mic','Микрофон')}${controlButton('hangup','phone','Завершить','hangup')}</div>
    </section>`;
    $('#local-video').srcObject=local;
    $('#minimize-call').onclick=e=>{e.stopPropagation();minimized=!minimized;$('.call-overlay').classList.toggle('minimized',minimized);};
    $('.call-overlay').onclick=e=>{if(minimized&&!e.target.closest('#hangup')){minimized=false;$('.call-overlay').classList.remove('minimized');}};
    $('#toggle-mic').onclick=()=>{local.getAudioTracks().forEach(t=>t.enabled=!t.enabled);controls();};
    $('#toggle-camera').onclick=guard(async()=>{const track=local.getVideoTracks()[0];if(track)track.enabled=!track.enabled;else{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:960},height:{ideal:540},facingMode:facing}});const track=stream.getVideoTracks()[0];local.addTrack(track);for(const p of peers.values())if(p.attached)p.pc.addTrack(track,local);$('#local-video').srcObject=local;}tellCamera();controls();});
    $('#flip-camera').onclick=guard(async e=>{e.stopPropagation();const old=local.getVideoTracks()[0];if(!old)throw new Error('Сначала включите камеру');const next=facing==='user'?'environment':'user';const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:960},height:{ideal:540},facingMode:{exact:next}},audio:false}).catch(()=>navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:next}},audio:false}));const track=stream.getVideoTracks()[0];track.enabled=old.enabled;try{for(const p of peers.values()){const sender=p.pc.getSenders().find(s=>s.track===old);if(sender)await sender.replaceTrack(track);}local.removeTrack(old);old.stop();local.addTrack(track);facing=track.getSettings().facingMode||next;$('#local-video').srcObject=local;controls();}catch(error){track.stop();throw error;}});
    $('#hangup').onclick=guard(async e=>{e.stopPropagation();try{await action('leave');}finally{stop();}});
    draggable($('#local-tile'));controls();
    started=Date.now();clearInterval(timer);timer=setInterval(()=>{if(!current)return;const seconds=Math.floor((Date.now()-started)/1000);if($('#call-timer'))$('#call-timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;refreshTiles();},500);
  }
  // Buttons and the small self-view follow the real track state.
  function controls(){
    const mic=!!local?.getAudioTracks()[0]?.enabled,camera=cameraOn(),micButton=$('#toggle-mic'),cameraButton=$('#toggle-camera');if(!micButton)return;
    micButton.classList.toggle('off',!mic);micButton.querySelector('span').innerHTML=icon(mic?'mic':'micoff');
    cameraButton.classList.toggle('on',camera);cameraButton.querySelector('span').innerHTML=icon(camera?'video':'videooff');
    const self=$('#local-tile');self.hidden=!camera;$('#local-video').classList.toggle('mirror',facing==='user');
    $('.call-overlay')?.classList.toggle('self-video',camera);
  }
  function tellCamera(){const on=cameraOn();for(const p of peers.values())if(p.attached)p.send({camera:on}).catch(()=>{});}
  // A remote tile shows the picture only while frames really arrive; otherwise the avatar with a voice ring.
  function refreshTiles(){
    const tiles=[...root.querySelectorAll('[data-remote]')];
    for(const tile of tiles){
      const video=tile.querySelector('video'),track=video?.srcObject?.getVideoTracks?.().find(t=>t.readyState==='live');
      const p=peers.get(tile.dataset.remote),live=!!track&&!track.muted&&p?.remoteCamera!==false&&video.videoWidth>0;
      tile.classList.toggle('has-video',live);
      const level=tile.rtcMedia?.level?.()||0,prev=Number(tile.dataset.level||0),next=Math.max(level,prev*.6);
      tile.dataset.level=next;tile.style.setProperty('--voice',next.toFixed(3));
    }
    const wait=$('#call-wait');if(wait)wait.hidden=tiles.length>0;
    // Name and status sit under the avatar; once the other person shows video they move up next to the arrow.
    $('.call-overlay')?.classList.toggle('head-top',tiles.length>1||tiles.some(t=>t.classList.contains('has-video')));
    $('#video-grid')?.setAttribute('data-count',String(Math.min(tiles.length,4)));
  }
  // The self-view can be dragged and sticks to the nearest corner, like in Telegram.
  function draggable(el){
    let start=null;
    el.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;start={x:e.clientX,y:e.clientY,rect:el.getBoundingClientRect()};el.setPointerCapture(e.pointerId);el.classList.add('dragging');});
    el.addEventListener('pointermove',e=>{if(!start)return;el.style.transform=`translate(${e.clientX-start.x}px,${e.clientY-start.y}px)`;});
    const end=e=>{if(!start)return;const r=el.getBoundingClientRect(),box=el.parentElement.getBoundingClientRect();const right=r.left+r.width/2>box.left+box.width/2,bottom=r.top+r.height/2>box.top+box.height/2;el.classList.toggle('at-left',!right);el.classList.toggle('at-bottom',bottom);el.style.transform='';el.classList.remove('dragging');start=null;};
    el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  }
  function peer(remote){
    if(peers.has(remote))return peers.get(remote);
    const pc=new RTCPeerConnection({iceServers,iceTransportPolicy:current?.relayOnly?'relay':'all',bundlePolicy:'max-bundle',rtcpMuxPolicy:'require',iceCandidatePoolSize:2});const p={pc,polite:state.user.id.localeCompare(remote)>0,makingOffer:false,ignoreOffer:false,candidates:[],screenSender:null,restarts:0,isSettingRemoteAnswerPending:false,outbox:Promise.resolve(),attached:false,silent:0,lastInbound:0};peers.set(remote,p);
    // Signals for one peer leave strictly in order: a candidate must never overtake its description on a slow mobile link.
    p.send=signal=>(p.outbox=p.outbox.catch(()=>{}).then(()=>current?action('signal',{target:remote,signal}):null));
    // Only the impolite side sends the first offer. Simultaneous offers (glare) forced a rollback on slow networks,
    // and some mobile browsers then answered recvonly, so only one person could be heard.
    p.attach=()=>{if(p.attached||!local)return;p.attached=true;clearTimeout(p.attachTimer);for(const track of local.getTracks())pc.addTrack(track,local);if(screen)p.screenSender=pc.addTrack(screen.getVideoTracks()[0],screen);p.send({camera:cameraOn()}).catch(()=>{});};
    // Ask for ICE restart from one side only, so both peers never race each other with fresh offers.
    p.restart=()=>{if(p.restarts++>=3||pc.signalingState==='closed')return;if(!p.polite)pc.restartIce();else p.send({restart:true}).catch(()=>{});};
    const expire=()=>{if(!current||pc.connectionState==='closed')return;toast('Не удалось установить соединение. Проверьте интернет и повторите звонок.');action('leave').catch(()=>{});stop();};
    p.deadline=setTimeout(expire,35000);
    const diagnostic=async()=>{if(!state.rtcDebug)return;const audioSection=description=>{const sections=String(description?.sdp||'').split(/(?=^m=)/m),section=sections.find(s=>s.startsWith('m=audio '));return {present:!!section,direction:section?.match(/^a=(sendrecv|sendonly|recvonly|inactive)/m)?.[1]||'sendrecv'};};debug('audio SDP',{local:audioSection(pc.localDescription),remote:audioSection(pc.remoteDescription)});const stats=await pc.getStats();let pair;stats.forEach(v=>{if(v.type==='transport'&&v.selectedCandidatePairId)pair=stats.get(v.selectedCandidatePairId);});debug('transport',{signaling:pc.signalingState,ice:pc.iceConnectionState,connection:pc.connectionState,localType:stats.get(pair?.localCandidateId)?.candidateType,remoteType:stats.get(pair?.remoteCandidateId)?.candidateType});debug('audio sender/receiver',{senders:pc.getSenders().filter(s=>s.track?.kind==='audio').map(s=>({enabled:s.track.enabled,state:s.track.readyState})),receivers:pc.getReceivers().filter(s=>s.track?.kind==='audio').map(s=>({enabled:s.track.enabled,muted:s.track.muted,state:s.track.readyState}))});stats.forEach(v=>{if((v.kind==='audio'||v.mediaType==='audio')&&['outbound-rtp','inbound-rtp','media-source'].includes(v.type))debug(v.type,{packetsSent:v.packetsSent,packetsReceived:v.packetsReceived,bytesSent:v.bytesSent,bytesReceived:v.bytesReceived,audioLevel:v.audioLevel});});};
    if(state.rtcDebug)p.statsTimer=setInterval(()=>diagnostic().catch(()=>{}),5000);
    pc.onsignalingstatechange=()=>debug('signalingState',pc.signalingState);
    pc.oniceconnectionstatechange=()=>debug('iceConnectionState',pc.iceConnectionState);
    pc.onicecandidateerror=e=>debug('ICE error',{code:e.errorCode});
    pc.onicecandidate=({candidate})=>{if(candidate&&current)p.send({candidate}).catch(()=>status('Сигнальная связь прервана. Переподключение…'));};
    pc.ontrack=({track,streams})=>{
      if(pc.connectionState==='closed'||!current)return;
      debug('remote track',{kind:track.kind,enabled:track.enabled,muted:track.muted,state:track.readyState});
      const stream=streams[0] || (p.streamless ||= new MediaStream());
      if(!stream.getTracks().includes(track))stream.addTrack(track);
      const key='remote-'+remote+'-'+stream.id;let tile=document.getElementById(key);
      if(!tile){
        tile=document.createElement('div');tile.className='video-tile';tile.id=key;tile.dataset.remote=remote;
        tile.innerHTML=`<video autoplay playsinline muted></video>${voiceFace(nameOf(remote),memberOf(remote)?.avatar)}<label>${esc(nameOf(remote))}</label>`;
        $('#video-grid')?.append(tile);tile.rtcMedia=bindRemoteMedia(tile,stream,debug,()=>audioContext);refreshTiles();
      }else tile.rtcMedia.sync();
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected'){clearTimeout(p.deadline);clearTimeout(p.disconnect);status([...peers.values()].every(p=>p.pc.connectionState==='connected')?'Подключено':'Соединение…');diagnostic().catch(()=>{});}
      else if(pc.connectionState==='failed'){status('Восстанавливаем соединение…');p.restart();clearTimeout(p.disconnect);p.disconnect=setTimeout(expire,25000);}
      else if(pc.connectionState==='disconnected'){status('Восстанавливаем соединение…');clearTimeout(p.disconnect);p.disconnect=setTimeout(()=>{if(pc.connectionState!=='connected'){p.restart();p.disconnect=setTimeout(expire,25000);}},4000);}
    };
    pc.onnegotiationneeded=async()=>{try{p.makingOffer=true;await pc.setLocalDescription();await p.send({description:pc.localDescription});}catch(error){p.lastError=error.message;toast(error.message);}finally{p.makingOffer=false;}};
    // Mobile carriers sometimes keep ICE "connected" while incoming audio stalls. Watch real inbound bytes and
    // renegotiate the route when the other person goes silent at the transport level.
    p.watchdog=setInterval(async()=>{
      if(pc.connectionState!=='connected')return;
      let bytes=0;try{(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&(r.kind||r.mediaType)==='audio')bytes+=Number(r.bytesReceived||0);});}catch{return;}
      if(bytes>p.lastInbound){p.lastInbound=bytes;p.silent=0;p.restarts=0;return;}
      if(++p.silent===3){debug('inbound audio stalled',{bytes});status('Нет звука от собеседника. Переподключаем…');p.restart();}
      else if(p.silent>=8)p.silent=0;
    },2500);
    if(!p.polite)p.attach();else p.attachTimer=setTimeout(()=>{if(!p.attached&&!pc.remoteDescription)p.attach();},6000);
    return p;
  }
  async function signal(data){if(!current||data.call!==current.id)return;try{const p=peer(data.from),pc=p.pc;const {description,candidate,restart,camera}=data.signal;
    if(typeof camera==='boolean'){p.remoteCamera=camera;refreshTiles();return;}
    if(restart){if(!p.polite&&pc.signalingState!=='closed'){debug('remote asked ICE restart');pc.restartIce();}return;}
    if(description){const ready=!p.makingOffer&&(pc.signalingState==='stable'||p.isSettingRemoteAnswerPending);const collision=description.type==='offer'&&!ready;p.ignoreOffer=!p.polite&&collision;if(p.ignoreOffer)return;p.isSettingRemoteAnswerPending=description.type==='answer';try{await pc.setRemoteDescription(description);}finally{p.isSettingRemoteAnswerPending=false;}if(description.type==='offer'&&!p.attached)p.attach();for(const c of p.candidates)await pc.addIceCandidate(c).catch(e=>debug('late candidate',e.name));p.candidates=[];if(description.type==='offer'){await pc.setLocalDescription();await p.send({description:pc.localDescription});}}
    else if(candidate){if(p.ignoreOffer)return;if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(e=>debug('candidate rejected',e.name));else p.candidates.push(candidate);}
  }catch(error){const p=peers.get(data.from);if(p)p.lastError=error.message;toast('Не удалось согласовать соединение: '+error.message);}}
  async function accept(data){if(starting)return;unlockAudio();starting=true;const ticket=generation;let acquired;try{acquired=await media(data.video);iceServers=(await api('/rtc-config')).iceServers;if(ticket!==generation){acquired.getTracks().forEach(t=>t.stop());return;}local=acquired;current=data;incoming=null;closeCallNotification(data.id).catch(()=>{});render();await action('join');for(const remote of data.participants)if(remote!==state.user.id)peer(remote);}catch(error){acquired?.getTracks().forEach(t=>t.stop());stop();throw error;}finally{starting=false;}}
  async function reject(data){await api('/call-action','POST',{id:data.id,action:'reject'});incoming=null;root.innerHTML='';closeCallNotification(data.id).catch(()=>{});nativeCallEnded(data.id);}
  // Answer/decline/hang up pressed on the iPhone system call screen (CallKit).
  async function answer(id){if(current?.id===id)return;const call=(await api('/calls/active')).find(c=>c.id===id);if(!call){nativeCallEnded(id);throw new Error('Этот звонок уже завершён');}if(incoming?.id!==id)await event(call);if(incoming?.id===id)await accept(incoming);}
  function setMuted(id,muted){if(current?.id!==id||!local)return;local.getAudioTracks().forEach(t=>t.enabled=!muted);if($('#toggle-mic'))controls();}
  async function hangup(id){if(current?.id===id){try{await action('leave');}finally{stop();}}else if(incoming?.id===id)await reject(incoming);else await api('/call-action','POST',{id,action:'reject'}).catch(()=>{});}
  async function event(data){
    if(data.state!=='ringing')closeCallNotification(data.id).catch(()=>{});
    if(data.state==='active'&&incoming?.id===data.id&&data.participants.includes(state.user.id)){stop();return;}
    if(['ended','declined','missed','removed'].includes(data.state)){if(current?.id===data.id || incoming?.id===data.id){stop();toast(data.state==='missed'?'Пропущенный звонок':data.state==='declined'?'Звонок отклонён':'Звонок завершён');}return;}
    if(data.state==='ringing'&&data.caller!==state.user.id&&!current&&!incoming){incoming=data;root.innerHTML=`<section class="incoming"><span class="eyebrow">ВХОДЯЩИЙ ${data.video?'ВИДЕО':'АУДИО'}ЗВОНОК</span><h3>${esc(data.name)}</h3><p class="muted">Хочет поговорить с вами</p><div class="row"><button class="primary" id="accept-call">${icon('phone')}Принять</button><button class="secondary danger" id="reject-call">Отклонить</button></div></section>`;$('#accept-call').onclick=guard(()=>accept(data));$('#reject-call').onclick=guard(()=>reject(data));navigator.vibrate?.([150,80,150]);return;}
    if(current?.id===data.id){current={...current,...data};for(const remote of data.participants)if(remote!==state.user.id)peer(remote);for(const [remote,p]of peers)if(!data.participants.includes(remote)){closePeer(p);peers.delete(remote);document.querySelectorAll(`[data-remote="${remote}"]`).forEach(el=>{el.rtcMedia?.dispose();el.remove();});}if(data.sharing)status(data.sharing===state.user.id?'Вы демонстрируете экран':nameOf(data.sharing)+' демонстрирует экран');else status(peers.size>0&&[...peers.values()].every(p=>p.pc.connectionState==='connected')?'Подключено':data.participants.length>1?'Соединение…':'Звоним…');}
  }
  return{dispose:stop,busy:()=>!!(current||starting),event,answer,hangup,setMuted,signal:data=>{signalQueue=signalQueue.then(()=>signal(data)).catch(e=>toast(e.message));return signalQueue;},reconnect:async()=>{const active=await api('/calls/active');if(current){if(!active.some(c=>c.id===current.id)){stop();return;}for(const p of peers.values()){p.restarts=0;p.restart();}}else for(const c of active)if(c.state==='ringing')await event(c);},start:async(chat,video)=>{if(current||incoming||starting||confirming)return;if(!chat)throw new Error('Чат недоступен');confirming=true;const peer=chat.members?.find(m=>m.user_id!==state.user.id),group=chat.kind!=='direct';const confirmed=await new Promise(resolve=>{const dialog=modal(group?'Начать звонок в «'+chat.title+'»?':(video?'Видеозвонок: ':'Позвонить: ')+chat.title+'?',`<div class="call-confirm">${avatar(chat.title,chat.avatar||peer?.avatar,'large')}<p>${group?'Участники группы смогут присоединиться к звонку.':'Вы действительно хотите начать '+(video?'видеозвонок':'аудиозвонок')+' пользователю '+esc(chat.title)+'?'}</p><div class="row"><button class="secondary" id="cancel-dial">Отмена</button><button class="primary" id="confirm-dial">${icon(video?'video':'phone')}${group?'Начать звонок':'Позвонить'}</button></div></div>`);let settled=false;function finish(value){if(settled)return;settled=true;dialog.removeEventListener('close',cancel);dialog.close();resolve(value);}const cancel=()=>finish(false);dialog.addEventListener('close',cancel,{once:true});$('#cancel-dial').onclick=cancel;$('#confirm-dial').onclick=()=>{unlockAudio();finish(true);};});confirming=false;if(!confirmed||current||incoming||starting)return;starting=true;try{local=await media(video);const config=await api('/rtc-config');iceServers=config.iceServers;current=await api('/calls','POST',{chat:chat.id,video});render();status('Звоним…');if(!config.relayConfigured)toast('Прямые звонки включены. Для сложных сетей администратору нужен TURN.');}catch(error){stop();throw error;}finally{starting=false;}}};
}





