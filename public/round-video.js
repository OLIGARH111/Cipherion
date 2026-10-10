// Video notes ("кружочки") the Telegram way: muted looping preview in the chat,
// tap opens a full-screen player with sound, a progress ring, seeking and speed.
import {icon} from './ui.js';

const clock=s=>{s=Math.max(0,Math.floor(s||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// MediaRecorder WebM files carry no duration; seeking far ahead makes the browser compute it.
const knownDuration=video=>new Promise(resolve=>{if(Number.isFinite(video.duration))return resolve(video.duration);let finished=false;const done=()=>{if(finished)return;finished=true;video.removeEventListener('durationchange',check);video.currentTime=0;resolve(video.duration);};const check=()=>{if(Number.isFinite(video.duration))done();};video.addEventListener('durationchange',check);try{video.currentTime=1e7;}catch{done();}setTimeout(done,3000);});
let viewer=null,canOpenNote=()=>true,bound=false;

const visible=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries){if(isIntersecting&&!calm()&&!viewer)target.play().catch(()=>{});else target.pause();}},{threshold:.6}):null;

function closeViewer(){
  if(!viewer)return;const {el,video,onKey}=viewer;viewer=null;video.pause();removeEventListener('keydown',onKey);el.classList.remove('open');
  setTimeout(()=>{el.remove();document.querySelectorAll('.round-note video').forEach(v=>{visible?.unobserve(v);visible?.observe(v);});},calm()?0:220);
}

export function openRoundViewer(source){
  closeViewer();
  const el=document.createElement('div');el.className='round-viewer';el.setAttribute('role','dialog');el.setAttribute('aria-label','Видео-кружок');
  el.innerHTML=`<div class="round-stage"><video playsinline preload="auto"></video><svg class="round-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" pathLength="100"></circle><circle class="round-progress" cx="50" cy="50" r="48" pathLength="100"></circle></svg><span class="round-state" aria-hidden="true"></span></div><div class="round-info"><span class="round-time">0:00</span><button type="button" class="chip round-speed" aria-label="Скорость воспроизведения">1×</button></div><button type="button" class="icon-button round-close" aria-label="Закрыть">${icon('close')}</button>`;
  document.body.append(el);document.querySelectorAll('.round-note video').forEach(v=>v.pause());
  const video=el.querySelector('video');video.src=source;const stage=el.querySelector('.round-stage'),ring=el.querySelector('.round-progress'),time=el.querySelector('.round-time'),speed=el.querySelector('.round-speed');
  const sync=()=>{const d=video.duration;ring.style.strokeDashoffset=String(100-(Number.isFinite(d)&&d>0?video.currentTime/d*100:0));time.textContent=Number.isFinite(d)?`${clock(video.currentTime)} / ${clock(d)}`:clock(video.currentTime);el.classList.toggle('paused',video.paused);};
  video.ontimeupdate=sync;video.onplay=sync;video.onpause=sync;video.onloadedmetadata=sync;video.onended=()=>closeViewer();
  // A tap near the rim seeks along the ring; a tap in the middle pauses or resumes.
  stage.onclick=e=>{e.stopPropagation();const r=stage.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,radius=Math.hypot(x,y)/(r.width/2);
    if(radius>.78&&Number.isFinite(video.duration)){const turn=(Math.atan2(y,x)+Math.PI/2+2*Math.PI)%(2*Math.PI)/(2*Math.PI);video.currentTime=turn*video.duration;video.play().catch(()=>{});return;}
    if(video.paused)video.play().catch(()=>{});else video.pause();};
  speed.onclick=e=>{e.stopPropagation();const next={1:1.5,1.5:2,2:1}[video.playbackRate]||1;video.playbackRate=next;speed.textContent=next+'×';};
  el.onclick=e=>{if(e.target===el||e.target.closest('.round-close'))closeViewer();};
  const onKey=e=>{if(e.key==='Escape')closeViewer();else if(e.key===' '){e.preventDefault();stage.click();}};addEventListener('keydown',onKey);
  viewer={el,video,onKey};requestAnimationFrame(()=>el.classList.add('open'));const start=()=>knownDuration(video).then(()=>{if(viewer?.video===video)video.play().catch(()=>sync());});if(video.readyState>=1)start();else video.addEventListener('loadedmetadata',start,{once:true});
}

export function initRoundVideos({canOpen=()=>true}={}){
  canOpenNote=canOpen;if(bound)return;bound=true;
  document.addEventListener('loadedmetadata',e=>{const v=e.target;if(!(v instanceof HTMLVideoElement)||!v.closest('.round-note'))return;if(v.dataset.measured)return;v.dataset.measured='1';const label=v.closest('.round-note').querySelector('.round-duration');knownDuration(v).then(d=>{if(label&&Number.isFinite(d))label.textContent=clock(d);visible?.observe(v);});},true);
  document.addEventListener('click',e=>{const note=e.target.closest?.('.round-note');if(!note||!canOpenNote())return;e.preventDefault();openRoundViewer(note.dataset.round);});
  document.addEventListener('keydown',e=>{const note=e.target.closest?.('.round-note');if(note&&(e.key==='Enter'||e.key===' ')&&canOpenNote()){e.preventDefault();openRoundViewer(note.dataset.round);}});
}
