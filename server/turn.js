import { createHmac } from 'node:crypto';

// Coturn TURN REST credentials expire; the shared secret never leaves the server.
export function rtcConfiguration(userId, env = process.env, time = Date.now()) {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = (env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length && env.TURN_SHARED_SECRET) {
    if (urls.some(u => !/^turns?:[^\s]+$/.test(u))) throw new Error('Invalid TURN_URLS');
    const username = `${Math.floor(time / 1000) + 3600}:${userId}`;
    iceServers.push({ urls, username, credential: createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64') });
  } else if (env.ICE_SERVERS) {
    const configured = JSON.parse(env.ICE_SERVERS);
    if (!Array.isArray(configured)) throw new Error('ICE_SERVERS must be an array');
    iceServers.push(...configured);
  }
  return { iceServers, relayConfigured: iceServers.some(s => [s.urls].flat().some(u => /^turns?:/.test(u))), expiresAt: time + 3600000 };
}

// Managed TURN (Cloudflare Realtime / Metered): short-lived credentials fetched server-side, so mobile
// networks behind carrier-grade NAT get a relay without running Coturn. Cached until shortly before expiry.
let managedCache = null;
export function managedTurnConfigured(env = process.env) {
  return !!((env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) || (env.METERED_TURN_DOMAIN && env.METERED_TURN_API_KEY));
}
async function managedIceServers(env, request, time) {
  if (managedCache && managedCache.expires > time && managedCache.env === env) return managedCache.servers;
  let servers = [];
  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
    const r = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_TURN_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
    const data = await r.json();
    servers = [data.iceServers].flat().filter(Boolean);
  } else if (env.METERED_TURN_DOMAIN && env.METERED_TURN_API_KEY) {
    if (!/^[a-z0-9.-]+$/i.test(env.METERED_TURN_DOMAIN)) throw new Error('Invalid METERED_TURN_DOMAIN');
    const r = await request(`https://${env.METERED_TURN_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_TURN_API_KEY)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Metered TURN ' + r.status);
    servers = [await r.json()].flat().filter(Boolean);
  }
  servers = servers.filter(s => s && s.urls && [s.urls].flat().every(u => /^(stun|turns?):[^\s]+$/.test(u)));
  managedCache = { env, servers, expires: time + 6 * 3600000 };
  return servers;
}

export async function rtcConfigurationAsync(userId, env = process.env, time = Date.now(), request = fetch) {
  const config = rtcConfiguration(userId, env, time);
  if (!config.relayConfigured && managedTurnConfigured(env)) {
    try { config.iceServers.push(...await managedIceServers(env, request, time)); }
    catch (error) { console.error(JSON.stringify({ event: 'turn_credentials_failed', message: error.message })); }
    config.relayConfigured = config.iceServers.some(s => [s.urls].flat().some(u => /^turns?:/.test(u)));
  }
  return config;
}
