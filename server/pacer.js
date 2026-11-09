// Background jobs poll the database. With a remote database (Turso) every query is network
// traffic that the hosting provider meters, even when nobody uses the app. So jobs run at full
// speed only while people are active (a change in the last couple of minutes) and slow down
// when the app is idle. Time-based work (scheduled messages, retries, expiry) still runs, just
// less often. Uses the real clock, not the app's `now`, because it paces real timers.
export function createPacer({activeFor=120_000,clock=()=>performance.now()}={}){
  let last=-Infinity;
  const timers=[];
  return {
    nudge(){last=clock();},
    active(){return clock()-last<activeFor;},
    // Checks every `fast` ms; runs `job` on each check while active, otherwise once per `slow` ms.
    every(fast,slow,job){
      let ran=-Infinity;
      const check=()=>{
        if(!(clock()-last<activeFor)&&clock()-ran<slow)return;
        ran=clock();
        try{const result=job();if(result?.catch)result.catch(()=>{});}catch{}
      };
      const timer=setInterval(check,fast);timer.unref?.();timers.push(timer);
      return check;
    },
    stop(){for(const t of timers)clearInterval(t);}
  };
}
// Runs `job` at most once per `period` ms (for rare housekeeping such as deleting old rows).
export function throttle(period,job,clock=()=>performance.now()){
  let ran=-Infinity;
  return (...args)=>{if(clock()-ran<period)return;ran=clock();return job(...args);};
}
