// Counts the bytes the server sends, per calendar month (UTC) and per kind of request, so the owner
// can see how much of the hosting bandwidth limit is used. It counts response bodies plus a fixed
// estimate for headers; the hosting dashboard (which also counts TLS overhead) remains authoritative.
// Hosting providers count decimal gigabytes (10^9 bytes), so the limit uses them too.
const HEADER_ESTIMATE=300;
const HOUR=60*60*1000;

export function category(path){
  if(path==='/api/events')return 'events';
  if(path.startsWith('/api/media/'))return 'media';
  if(/^\/api\/stickers\/[^/]+\/file$/.test(path))return 'stickers';
  if(path.startsWith('/api/'))return 'api';
  return 'app';
}
export const monthKey=time=>new Date(time).toISOString().slice(0,7);

export function createTraffic({db,run,all,now,limitGB=Number(process.env.TRAFFIC_LIMIT_GB)||5}){
  db.exec('CREATE TABLE IF NOT EXISTS traffic_usage(month TEXT NOT NULL,category TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(month,category))');
  const pending=new Map();
  const add=(name,bytes,requests=0)=>{const key=monthKey(now())+'|'+name,p=pending.get(key)||{bytes:0,requests:0};p.bytes+=bytes;p.requests+=requests;pending.set(key,p);};
  // Wraps write/end so long-lived streams (live events) are counted as they go, not only at the end.
  function track(res,path){
    const name=category(path),write=res.write,end=res.end;
    const count=chunk=>{if(chunk&&typeof chunk!=='function')add(name,typeof chunk==='string'?Buffer.byteLength(chunk):chunk.length);};
    res.write=function(chunk,...rest){count(chunk);return write.call(this,chunk,...rest);};
    res.end=function(chunk,...rest){count(chunk);return end.call(this,chunk,...rest);};
    add(name,HEADER_ESTIMATE,1);
  }
  // At most one database write per category per minute: the database may be a metered remote service.
  let flushed=0;
  function flush(force=false){
    if(!pending.size||!force&&now()-flushed<60_000)return;
    flushed=now();
    const rows=[...pending];pending.clear();
    for(const [key,{bytes,requests}] of rows){const [month,name]=key.split('|');
      run('INSERT INTO traffic_usage(month,category,bytes,requests) VALUES(?,?,?,?) ON CONFLICT(month,category) DO UPDATE SET bytes=bytes+excluded.bytes,requests=requests+excluded.requests',month,name,bytes,requests);}
  }
  function report(){
    flush(true);
    const time=now(),month=monthKey(time),date=new Date(time);
    const start=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1),end=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1);
    const categories=all('SELECT category,bytes,requests FROM traffic_usage WHERE month=? ORDER BY bytes DESC',month);
    const bytes=categories.reduce((s,c)=>s+c.bytes,0),limit=limitGB*1e9;
    // Projection needs a few hours of data to mean anything.
    const elapsed=time-start,projected=elapsed>6*HOUR?Math.round(bytes*(end-start)/elapsed):null;
    const perDay=elapsed>0?bytes/(elapsed/86400000):0,remaining=Math.max(0,limit-bytes);
    return {month,bytes,limit,percent:Math.round(bytes/limit*1000)/10,projected,
      runsOutAt:perDay>0&&projected!==null&&projected>limit?Math.round(time+remaining/perDay*86400000):null,
      resetsAt:end,categories,history:all('SELECT month,SUM(bytes) bytes FROM traffic_usage GROUP BY month ORDER BY month DESC LIMIT 6')};
  }
  return {track,flush,report};
}
