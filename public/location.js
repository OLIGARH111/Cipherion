// Location messages: a single point or live sharing for 15 minutes, 1 hour or 8 hours.
// In encrypted chats the coordinates are sealed like text, so the server never sees them.
// The card draws no third-party map: a map service is contacted only when the person
// taps «Открыть в картах».
import {$,esc,icon,api,modal,guard,toast} from './ui.js';
import {seal} from './e2e.js';

const live=new Map();// message id → {watch, until, last}
const LIVE={900:'15 минут',3600:'1 час',28800:'8 часов'};

export function parseLocation(m){try{const p=JSON.parse(m.body||'');return Number.isFinite(p.lat)&&Number.isFinite(p.lng)?p:null;}catch{return null;}}
const minutesLeft=until=>Math.max(0,Math.ceil((until-Date.now())/60000));
function left(until){const m=minutesLeft(until);return m>=60?`ещё ${Math.floor(m/60)} ч ${m%60?m%60+' мин':''}`.trim():`ещё ${m} мин`;}

export function locationCard(m,me){
  const p=parseLocation(m);
  if(!p)return `<div class="location-card unavailable">${icon('location')}<span>${m.e2eState&&m.e2eState!=='ok'?esc(m.body):'Геопозиция недоступна'}</span></div>`;
  const active=m.live_until&&m.live_until>Date.now(),q=`${p.lat},${p.lng}`;
  const coords=`${Math.abs(p.lat).toFixed(5)}° ${p.lat>=0?'с. ш.':'ю. ш.'}, ${Math.abs(p.lng).toFixed(5)}° ${p.lng>=0?'в. д.':'з. д.'}`;
  return `<div class="location-card${active?' live':''}"><div class="location-map" aria-hidden="true"><svg viewBox="0 0 240 120" preserveAspectRatio="xMidYMid slice"><defs><pattern id="grid-${esc(m.id)}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="currentColor" stroke-opacity=".14"/></pattern></defs><rect width="240" height="120" fill="url(#grid-${esc(m.id)})"/><path d="M-10 84C40 70 70 96 120 78S200 40 250 52" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="7" stroke-linecap="round"/><path d="M60-10C70 30 52 70 76 130" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="5"/></svg><span class="location-pin">${icon('location')}</span>${active?'<span class="location-pulse"></span>':''}</div><div class="location-info"><b>${active?'Геопозиция в реальном времени':m.live_until?'Трансляция завершена':'Геопозиция'}</b><small>${esc(coords)}${p.acc?` · ±${p.acc} м`:''}</small>${active?`<small class="location-left">${esc(left(m.live_until))}</small>`:''}<div class="location-actions"><a class="chip" href="https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=16&l=map" target="_blank" rel="noopener noreferrer">Яндекс Карты</a><a class="chip" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a><a class="chip" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">Google</a>${active&&m.user_id===me?`<button type="button" class="chip danger" data-stop-live="${esc(m.id)}">Остановить</button>`:''}</div></div></div>`;
}
export function bindLocations(root){
  root.querySelectorAll('[data-stop-live]').forEach(b=>b.onclick=guard(()=>stopLive(b.dataset.stopLive)));
}

function position(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('Этот браузер не умеет определять геопозицию'));
    navigator.geolocation.getCurrentPosition(p=>resolve(p),e=>reject(new Error(e.code===1?'Разрешите доступ к геопозиции в настройках браузера':'Не удалось определить геопозицию')),{enableHighAccuracy:true,timeout:20000,maximumAge:10000});
  });
}
const point=p=>({lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6),acc:Math.round(p.coords.accuracy||0)});
async function payload(user,chat,body){const envelope=await seal(user,chat,body);return envelope?{e2e:envelope}:{body};}

export function locationDialog(state,after){
  modal('Геопозиция',`<p class="note">Координаты отправляются только в этот чат. В зашифрованных чатах они шифруются на вашем устройстве. Трансляция работает, пока Cipherion открыт.</p><div class="stack"><button class="primary" id="send-point">${icon('location')} Отправить текущую геопозицию</button><p class="group-caption">Делиться в реальном времени</p>${Object.entries(LIVE).map(([s,l])=>`<button class="secondary" data-live="${s}">${esc(l)}</button>`).join('')}</div>`);
  const send=async seconds=>{
    const chat=state.chat;if(!chat)return;
    const here=point(await position()),body=JSON.stringify(here);
    const m=await api(`/chats/${chat}/messages`,'POST',{kind:'location',...await payload(state.user.id,chat,body),...(seconds?{live:seconds}:{}),...(state.topic&&state.topic!=='general'?{topic:state.topic}:{}),clientMessageId:crypto.randomUUID().replaceAll('-','')});
    $('#modal').close();if(seconds)startLive(state.user.id,chat,m.id,Date.now()+seconds*1000);
    await after?.();
  };
  $('#send-point').onclick=guard(()=>send(0));
  document.querySelectorAll('[data-live]').forEach(b=>b.onclick=guard(()=>send(Number(b.dataset.live))));
}
function startLive(user,chat,id,until){
  if(!navigator.geolocation)return;
  const session={until,last:0,lastPoint:null};
  session.watch=navigator.geolocation.watchPosition(async p=>{
    if(Date.now()>=until){stopLive(id,false);return;}
    const next=point(p),moved=!session.lastPoint||Math.hypot(next.lat-session.lastPoint.lat,next.lng-session.lastPoint.lng)>0.00015;
    if(Date.now()-session.last<(moved?10000:60000))return;
    session.last=Date.now();session.lastPoint=next;
    try{await api('/messages/'+id,'PATCH',await payload(user,chat,JSON.stringify(next)));}catch(error){if(error.status===400||error.status===403)stopLive(id,false);}
  },()=>{},{enableHighAccuracy:true,maximumAge:5000});
  session.timer=setTimeout(()=>stopLive(id,false),until-Date.now());
  live.set(id,session);toast('Трансляция геопозиции запущена');
}
export async function stopLive(id,notify=true){
  const session=live.get(id);if(session){navigator.geolocation.clearWatch(session.watch);clearTimeout(session.timer);live.delete(id);}
  if(notify){await api('/messages/'+id,'PATCH',{stop:true});toast('Трансляция остановлена');}
}
