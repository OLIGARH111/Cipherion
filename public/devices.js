// "Устройства": readable names for sessions instead of raw User-Agent strings.
import {$,esc,icon,api,modal,guard,toast} from './ui.js';

const version=(ua,re)=>(ua.match(re)||[])[1]||'';
export function describeAgent(agent=''){
  const ua=String(agent);
  let browser='Браузер',v='';
  for(const [name,re] of [['Яндекс Браузер',/YaBrowser\/(\d+)/],['Edge',/Edg(?:A|iOS)?\/(\d+)/],['Opera',/(?:OPR|OPT)\/(\d+)/],['Samsung Internet',/SamsungBrowser\/(\d+)/],['Firefox',/(?:Firefox|FxiOS)\/(\d+)/],['Chrome',/(?:Chrome|CriOS)\/(\d+)/],['Safari',/Version\/(\d+(?:\.\d+)?).*Safari/]])if(re.test(ua)){browser=name;v=version(ua,re);break;}
  let os='',type='desktop',model='Компьютер';
  if(/iPad/.test(ua)||(/Macintosh/.test(ua)&&/Mobile\//.test(ua))){type='tablet';model='iPad';os='iPadOS '+version(ua,/OS (\d+(?:_\d+)?)/).replace('_','.');}
  else if(/iPhone|iPod/.test(ua)){type='mobile';model='iPhone';os='iOS '+version(ua,/OS (\d+(?:_\d+)?)/).replace('_','.');}
  else if(/Android/.test(ua)){const mobile=/Mobile/.test(ua);type=mobile?'mobile':'tablet';const name=version(ua,/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build|\))/i).trim();model=name&&!/^K$/.test(name)?name:(mobile?'Android-смартфон':'Android-планшет');os='Android '+version(ua,/Android (\d+(?:\.\d+)?)/);}
  else if(/Windows/.test(ua)){model='Компьютер Windows';os='Windows'+(/Windows NT 10/.test(ua)?' 10/11':/Windows NT 6\.3/.test(ua)?' 8.1':/Windows NT 6\.1/.test(ua)?' 7':'');}
  else if(/CrOS/.test(ua)){model='Chromebook';os='ChromeOS';}
  else if(/Macintosh|Mac OS X/.test(ua)){model='Mac';os='macOS';}
  else if(/Linux/.test(ua)){model='Компьютер Linux';os='Linux';}
  if(!ua.trim())return {type:'desktop',model:'Неизвестное устройство',app:'',os:''};
  if(/node|curl|bot/i.test(ua)&&browser==='Браузер')return {type:'desktop',model:'Другое приложение',app:ua.slice(0,60),os:''};
  return {type,model,os:os.trim(),app:`${browser}${v?' '+v.split('.')[0]:''}`};
}

const day=t=>new Date(t).toDateString();
export function activityText(t,now=Date.now()){
  const diff=Math.max(0,now-t),min=Math.floor(diff/60000);
  if(min<2)return 'в сети';if(min<60)return `${min} мин. назад`;
  const time=new Date(t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
  if(day(t)===day(now))return 'сегодня в '+time;if(day(t)===day(now-86400000))return 'вчера в '+time;
  return new Date(t).toLocaleDateString('ru',{day:'numeric',month:'long',...(new Date(t).getFullYear()!==new Date(now).getFullYear()?{year:'numeric'}:{})});
}
const colors={mobile:'#2b9a5a',tablet:'#d9730d',desktop:'#2f7de1'};
const row=(s,current)=>{const d=describeAgent(s.agent),seen=current?'в сети':activityText(s.active);return `<div class="device-row" data-device="${esc(s.id)}"><span class="device-icon" style="--c:${colors[d.type]}">${icon(d.type==='desktop'?'screen':d.type)}</span><div><b>${esc(d.model)}</b><small>${esc([d.app,d.os].filter(Boolean).join(' · ')||'Cipherion')}</small><small class="${seen==='в сети'?'online':''}">${current?'Это устройство · в сети':seen==='в сети'?'в сети':'Активность: '+esc(seen)}</small><small>Вход: ${esc(new Date(s.created).toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'}))}</small></div>${current?'':`<button class="chip" data-end-session="${esc(s.id)}">Завершить</button>`}</div>`;};

export async function devicesPage(){
  const sessions=await api('/sessions');const current=sessions.find(s=>s.current),others=sessions.filter(s=>!s.current).sort((a,b)=>b.active-a.active);
  modal('Устройства',`<div class="tg-page"><p class="group-caption">Это устройство</p><div class="settings-group">${current?row(current,true):''}${others.length?'<button class="tg-danger" id="end-others">Завершить все другие сеансы</button>':''}</div><p class="tg-hint">Выход на других устройствах сохранит только этот сеанс.</p>${others.length?`<p class="group-caption">Активные сеансы (${others.length})</p><div class="settings-group">${others.map(s=>row(s,false)).join('')}</div><p class="tg-hint">Не узнаёте устройство? Завершите его сеанс и смените пароль.</p>`:'<p class="tg-hint">Других активных сеансов нет — аккаунт открыт только здесь.</p>'}</div>`);
  document.querySelectorAll('[data-end-session]').forEach(btn=>btn.onclick=guard(async()=>{const name=btn.closest('.device-row').querySelector('b').textContent;if(!confirm(`Завершить сеанс на устройстве «${name}»?`))return;await api('/sessions','DELETE',{id:btn.dataset.endSession});toast('Сеанс завершён');await devicesPage();}));
  const all=$('#end-others');if(all)all.onclick=guard(async()=>{if(!confirm('Завершить все сеансы, кроме этого устройства?'))return;await api('/sessions','DELETE',{id:'all'});toast('Другие сеансы завершены');await devicesPage();});
}
