// The Cypher orb, as in the desktop app (Cypher's three.js orb redrawn on a 2D canvas so the page loads no
// third-party scripts): 1800 points on a sphere with a travelling wave, a glowing core and three orbit rings.
// It turns on its own; it can be dragged and keeps spinning with inertia after release.
const STATES={
  idle:{color:[43,223,154],energy:0.04,speed:0.25,brightness:0.85},
  listening:{color:[190,255,120],energy:0.1,speed:0.6,brightness:1},
  thinking:{color:[60,200,170],energy:0.09,speed:1.4,brightness:1.05},
  executing:{color:[120,170,255],energy:0.12,speed:1.8,brightness:1.1},
  responding:{color:[155,247,207],energy:0.16,speed:1,brightness:1.25},
  error:{color:[255,84,97],energy:0.07,speed:0.5,brightness:0.95},
  offline:{color:[115,128,148],energy:0.015,speed:0.08,brightness:0.45},
};
const COUNT=1800,FOCAL=1/Math.tan(20*Math.PI/180),CAMERA=4.2;
const RINGS=[{r:1.32,alpha:0.35,dash:true,rx:Math.PI/2.4,ry:0,spin:0.5},{r:1.48,alpha:0.18,dash:false,rx:0,ry:Math.PI/3,spin:-0.25},{r:1.62,alpha:0.28,dash:true,rx:-Math.PI/3.2,ry:0,spin:0.35}];

function sphere(){
  const golden=Math.PI*(3-Math.sqrt(5)),points=new Float32Array(COUNT*4);
  for(let i=0;i<COUNT;i++){const y=1-i/(COUNT-1)*2,r=Math.sqrt(1-y*y),a=golden*i;points.set([Math.cos(a)*r,y,Math.sin(a)*r,Math.random()],i*4);}
  return points;
}
function sprite(){
  const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d'),grad=g.createRadialGradient(16,16,0,16,16,16);
  grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(0.45,'rgba(255,255,255,0.55)');grad.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grad;g.fillRect(0,0,32,32);return c;
}
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

export function createOrb(canvas,{size=320}={}){
  const ctx=canvas.getContext('2d'),points=sphere(),dot=sprite(),tinted=document.createElement('canvas');tinted.width=tinted.height=32;const tctx=tinted.getContext('2d');
  let state='idle',current={...STATES.idle,color:[...STATES.idle.color]},yaw=0,pitch=0,dragVX=0,dragVY=0,dragging=false,last=performance.now(),time=0,raf=0,visible=true,lastTint='';
  const ringAngles=RINGS.map(()=>0);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  function resize(px){size=px;canvas.width=canvas.height=Math.round(px*dpr);canvas.style.width=canvas.style.height=px+'px';}
  resize(size);
  function tint(color){const key=color.map(Math.round).join(',');if(key===lastTint)return;lastTint=key;tctx.clearRect(0,0,32,32);tctx.globalCompositeOperation='source-over';tctx.drawImage(dot,0,0);tctx.globalCompositeOperation='source-in';tctx.fillStyle=`rgb(${key})`;tctx.fillRect(0,0,32,32);}
  function frame(now){
    raf=requestAnimationFrame(frame);if(!visible||!canvas.isConnected)return;
    const dt=Math.min((now-last)/1000,0.05);last=now;const target=STATES[state]||STATES.idle,k=1-Math.pow(0.02,dt);
    current.energy+=(target.energy-current.energy)*k;current.brightness+=(target.brightness-current.brightness)*k;current.speed+=(target.speed-current.speed)*k;
    for(let i=0;i<3;i++)current.color[i]+=(target.color[i]-current.color[i])*k;
    const speed=current.speed;time+=dt*(0.6+speed);
    if(!dragging){yaw+=dt*speed*0.35+dragVX*dt;dragVX*=Math.pow(0.15,dt);pitch+=dragVY*dt;dragVY*=Math.pow(0.15,dt);pitch*=Math.pow(0.6,dt);}
    const tilt=pitch+Math.sin(time*0.15)*0.15;
    RINGS.forEach((ring,i)=>ringAngles[i]+=dt*speed*ring.spin);
    const W=canvas.width,half=W/2,scale=half*0.9,ctxColor=current.color.map(v=>Math.min(255,v*current.brightness));
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,W);ctx.globalCompositeOperation='lighter';
    const project=(x,y,z)=>{const d=CAMERA-z;return [half+x*FOCAL/d*scale,half-y*FOCAL/d*scale,d];};
    // Orbit rings (behind and in front, drawn faintly with additive light).
    const cy=Math.cos(yaw*0.35),sy=Math.sin(yaw*0.35);
    RINGS.forEach((ring,i)=>{
      const cx=Math.cos(ring.rx),sx=Math.sin(ring.rx),cr=Math.cos(ring.ry),sr=Math.sin(ring.ry),cz=Math.cos(ringAngles[i]),sz=Math.sin(ringAngles[i]);
      ctx.beginPath();ctx.strokeStyle=`rgba(${ctxColor.join(',')},${ring.alpha})`;ctx.lineWidth=1.2*dpr;ctx.setLineDash(ring.dash?[0.18*scale/2.6,0.09*scale/2.6]:[]);
      for(let s=0;s<=160;s++){const a=s/160*Math.PI*2;let x=Math.cos(a)*ring.r,y=Math.sin(a)*ring.r,z=0;
        [x,y]=[x*cz-y*sz,x*sz+y*cz];[y,z]=[y*cx-z*sx,y*sx+z*cx];[x,z]=[x*cr+z*sr,-x*sr+z*cr];[x,z]=[x*cy+z*sy,-x*sy+z*cy];
        const [px,py]=project(x,y,z);s?ctx.lineTo(px,py):ctx.moveTo(px,py);}
      ctx.stroke();
    });
    ctx.setLineDash([]);
    // Glowing core: bright rim, soft centre that pulses.
    const pulse=1+Math.sin(time*2.4)*0.25*speed,coreScale=1+Math.sin(time*1.6)*0.015*(1+speed),cr=0.78*coreScale*FOCAL/CAMERA*scale*1.05;
    const core=ctx.createRadialGradient(half,half,0,half,half,cr);const c=ctxColor.join(',');
    core.addColorStop(0,`rgba(${c},${0.09*pulse})`);core.addColorStop(0.62,`rgba(${c},0.05)`);core.addColorStop(0.9,`rgba(${c},0.32)`);core.addColorStop(0.98,`rgba(${c},0.5)`);core.addColorStop(1,`rgba(${c},0)`);
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(half,half,cr,0,Math.PI*2);ctx.fill();
    // Particles with the travelling wave.
    tint(ctxColor);
    const cyw=Math.cos(yaw),syw=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt),energy=current.energy,base=5*dpr*(scale/(W/2))*0.55;
    for(let i=0;i<COUNT;i++){
      const o=i*4;let x=points[o],y=points[o+1],z=points[o+2];const seed=points[o+3];
      const wave=Math.sin(y*6+time*2.1+seed*6.2831)*0.5+Math.sin(x*5-time*1.7)*0.3+Math.sin(z*7+time*1.3)*0.2,m=1+wave*energy;
      let rx=x*cyw+z*syw,rz=-x*syw+z*cyw,ry=y*ct-rz*st;rz=y*st+rz*ct;
      const nz=rz;rx*=m;ry*=m;rz*=m;const [px,py,d]=project(rx,ry,rz);
      const alpha=0.35+0.65*smooth(-1.2,1,nz),s=base*(0.6+seed*0.8)*(3/d)*2.2;
      ctx.globalAlpha=alpha;ctx.drawImage(tinted,px-s/2,py-s/2,s,s);
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  }
  // Drag to turn; release keeps the spin with inertia.
  let px=0,py=0,pt=0;
  canvas.style.touchAction='none';canvas.style.cursor='grab';
  canvas.addEventListener('pointerdown',e=>{dragging=true;px=e.clientX;py=e.clientY;pt=performance.now();dragVX=dragVY=0;canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;const now=performance.now(),dt=Math.max(0.008,(now-pt)/1000),dx=(e.clientX-px)/size*3,dy=(e.clientY-py)/size*3;yaw+=dx;pitch=Math.max(-1.2,Math.min(1.2,pitch+dy));dragVX=dragVX*0.5+dx/dt*0.5;dragVY=dragVY*0.5+dy/dt*0.5;px=e.clientX;py=e.clientY;pt=now;});
  const release=()=>{if(!dragging)return;dragging=false;canvas.style.cursor='grab';dragVX=Math.max(-12,Math.min(12,dragVX));dragVY=Math.max(-6,Math.min(6,dragVY));};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  const onVisibility=()=>{visible=document.visibilityState==='visible';last=performance.now();};document.addEventListener('visibilitychange',onVisibility);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){frame(performance.now());cancelAnimationFrame(raf);}else raf=requestAnimationFrame(frame);
  return {set(next){if(STATES[next])state=next;},resize,stop(){cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',onVisibility);}};
}
