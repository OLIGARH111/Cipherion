// Video notes ("кружочки") the Telegram way: a muted preview frame in the chat; a tap
// grows the note right inside the conversation and plays it with sound, a progress
// ring, seeking along the rim and pause on a second tap.
const clock=s=>{s=Math.max(0,Math.floor(s||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// MediaRecorder WebM files carry no duration; seeking far ahead makes the browser compute it.
const knownDuration=video=>new Promise(resolve=>{if(Number.isFinite(video.duration))return resolve(video.duration);let finished=false;const done=()=>{if(finished)return;finished=true;video.removeEventListener('durationchange',check);try{video.currentTime=.001;}catch{}resolve(video.duration);};const check=()=>{if(Number.isFinite(video.duration))done();};video.addEventListener('durationchange',check);try{video.currentTime=1e7;}catch{done();}setTimeout(done,3000);});
const ringHTML='<svg class="round-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48.5" pathLength="100"></circle><circle class="round-progress" cx="50" cy="50" r="48.5" pathLength="100"></circle></svg><span class="round-state" aria-hidden="true"></span>';
let active=null,canOpenNote=()=>true,bound=false;

// Muted previews loop while on screen (when the browser allows autoplay); the playing note is left alone.
const visible=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries){if(active?.video===target)continue;if(isIntersecting&&!calm())target.play().catch(()=>{});else target.pause();}},{threshold:.6}):null;

function sync(){
  if(!active)return;const {note,video}=active,d=video.duration,ring=note.querySelector('.round-progress'),label=note.querySelector('.round-duration');
  if(ring)ring.style.strokeDashoffset=String(100-(Number.isFinite(d)&&d>0?video.currentTime/d*100:0));
  if(label)label.textContent=Number.isFinite(d)?clock(d-video.currentTime):clock(video.currentTime);
  note.classList.toggle('paused',video.paused);
}

export function stopRoundNote(){
  if(!active)return;const {note,video}=active;active=null;
  video.pause();video.muted=true;video.loop=true;video.playbackRate=1;video.ontimeupdate=video.onplay=video.onpause=video.onended=null;
  note.classList.remove('playing','paused');note.setAttribute('aria-label','Воспроизвести видео-кружок');
  const label=note.querySelector('.round-duration');if(label&&Number.isFinite(video.duration))label.textContent=clock(video.duration);
  try{video.currentTime=.001;}catch{}visible?.unobserve(video);visible?.observe(video);
}

function playNote(note){
  const video=note.querySelector('video');if(!video)return;stopRoundNote();
  if(!note.querySelector('.round-ring'))note.insertAdjacentHTML('beforeend',ringHTML);
  active={note,video,source:note.dataset.round};
  video.pause();video.loop=false;video.muted=false;
  video.ontimeupdate=sync;video.onplay=sync;video.onpause=sync;video.onended=()=>stopRoundNote();
  note.classList.add('playing');note.setAttribute('aria-label','Пауза');
  try{video.currentTime=0;}catch{}
  video.play().catch(()=>{video.muted=true;video.play().catch(()=>sync());});sync();
  // Keep the grown note in view while it expands.
  setTimeout(()=>note.scrollIntoView?.({block:'nearest',behavior:calm()?'auto':'smooth'}),calm()?0:260);
}

// A tap near the rim seeks along the ring; a tap in the middle pauses or resumes.
function tapActive(e){
  const {note,video}=active,r=note.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,radius=Math.hypot(x,y)/(r.width/2);
  if(e.clientX&&radius>.8&&Number.isFinite(video.duration)){const turn=(Math.atan2(y,x)+Math.PI/2+2*Math.PI)%(2*Math.PI)/(2*Math.PI);video.currentTime=turn*video.duration;video.play().catch(()=>{});return;}
  if(video.paused)video.play().catch(()=>{});else video.pause();
}

function toggle(note,e){if(active?.note===note)tapActive(e);else playNote(note);}

// The message list is re-rendered on new messages: carry the playing <video> into the fresh note.
function adopt(){
  if(!active||active.note.isConnected)return;
  const fresh=[...document.querySelectorAll('.round-note')].find(n=>n.dataset.round===active.source);
  if(!fresh){stopRoundNote();return;}
  const old=fresh.querySelector('video');visible?.unobserve(old);old.replaceWith(active.video);
  if(!fresh.querySelector('.round-ring'))fresh.insertAdjacentHTML('beforeend',ringHTML);
  fresh.classList.add('playing');active.note=fresh;sync();
}

export function initRoundVideos({canOpen=()=>true}={}){
  canOpenNote=canOpen;if(bound)return;bound=true;
  document.addEventListener('loadedmetadata',e=>{const v=e.target;if(!(v instanceof HTMLVideoElement)||!v.closest('.round-note'))return;if(v.dataset.measured)return;v.dataset.measured='1';const label=v.closest('.round-note').querySelector('.round-duration');knownDuration(v).then(d=>{if(label&&Number.isFinite(d)&&active?.video!==v)label.textContent=clock(d);visible?.observe(v);});},true);
  document.addEventListener('error',e=>{const v=e.target;if(v instanceof HTMLVideoElement&&v.closest('.round-note'))v.closest('.round-note').classList.add('broken');},true);
  document.addEventListener('click',e=>{const note=e.target.closest?.('.round-note');if(!note||!canOpenNote())return;e.preventDefault();e.stopPropagation();toggle(note,e);},true);
  document.addEventListener('keydown',e=>{const note=e.target.closest?.('.round-note');if(note&&(e.key==='Enter'||e.key===' ')&&canOpenNote()){e.preventDefault();toggle(note,{});}else if(e.key==='Escape'&&active)stopRoundNote();});
  new MutationObserver(adopt).observe(document.body,{childList:true,subtree:true});
}
