import {createHash, randomUUID} from 'node:crypto';

// Log only diagnostic metadata. Error messages can include SQL, secrets and input.
export function logFailure(event, error, requestId = randomUUID(), write = console.error) {
  const stack = String(error?.stack || '').split('\n').slice(1)
    .map(line => /(?:file:\/\/)?[^\s()]*\/((?:server|scripts)\/[\w.-]+\.js:\d+:\d+)/.exec(line)?.[1])
    .filter(Boolean).slice(0, 8);
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'UNEXPECTED_ERROR';
  write(JSON.stringify({level:'error',event,requestId,code,frames:stack,time:new Date().toISOString()}));
  return requestId;
}
export function health(db) {
  try {
    if (db.prepare('SELECT 1 AS ok').get()?.ok !== 1) throw new Error('Database probe failed');
    return {status:200,body:{ok:true,backend:'up',database:'up'}};
  } catch (error) {
    logFailure('health_database_failed', error);
    return {status:503,body:{ok:false,backend:'up',database:'unavailable'}};
  }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export function messageFingerprint(chat, body) {
  const payload={chat,kind:body.kind || 'text',body:String(body.body ?? '').trim().slice(0,4000),media:body.media || null,reply:body.reply || null,poll:body.poll || null};
  // Only present for encrypted messages, so fingerprints of plaintext requests are unchanged.
  if(body.e2e!=null)payload.e2e=typeof body.e2e==='string'?body.e2e:JSON.stringify(body.e2e);
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}
export function vipState(grants, clock) {
  const valid=grants.filter(g=>!g.revoked && g.starts<=clock && (g.expires===null || g.expires>clock));
  const status=valid.some(g=>g.expires===null)?'Lifetime':valid.some(g=>g.source==='gift'||g.source==='promo')?'Gifted':valid.length?'Active':!grants.length?'Free':grants.every(g=>g.revoked)?'Cancelled':'Expired';
  return {status,active:valid.length>0,renewal:valid.some(g=>g.expires===null)?null:valid.length?Math.max(...valid.map(g=>g.expires)):null};
}
