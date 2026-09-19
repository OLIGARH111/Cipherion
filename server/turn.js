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
