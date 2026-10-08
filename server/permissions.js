export const memberPermissions = ['text', 'photo', 'video', 'file', 'voice', 'round', 'poll', 'invite', 'info', 'pin'];
export const adminPermissions = ['info', 'invite', 'remove', 'ban', 'delete', 'pin', 'poll', 'permissions', 'tags', 'admins'];
// Channels are broadcast media: only OWNER and ADMIN (with explicit grants) can publish.
// Subscribers never receive posting rights, regardless of chat.permissions or per-member overrides.
export const channelAdminPermissions = ['post', 'edit', 'delete', 'subscribers', 'info'];
export const channelPostKinds = ['text', 'photo', 'video', 'file', 'voice', 'round', 'poll'];
export const defaults = Object.fromEntries(memberPermissions.map(p => [p, !['info', 'pin'].includes(p)]));
function adminRules(member) {
  try { return JSON.parse(member.rules || '{}').admin || {}; } catch { return {}; }
}
// canPostToChannel = user is owner OR (user is admin AND admin.post === true)
export function canPostToChannel(member) {
  if (!member || member.role === 'banned') return false;
  if (member.role === 'owner') return true;
  return member.role === 'admin' && adminRules(member).post === true;
}
function channelAllowed(member, permission) {
  if (member.role !== 'admin') return false;
  const grants = adminRules(member);
  if (channelPostKinds.includes(permission)) return grants.post === true;
  switch (permission) {
    case 'edit': return grants.edit === true;
    case 'delete': return grants.delete === true;
    case 'pin': return grants.edit === true || grants.post === true;
    case 'info': return grants.info === true;
    // Legacy per-action grants stay honoured so existing channel admins keep their rights.
    case 'invite': case 'remove': case 'ban': case 'tags': return grants.subscribers === true || grants[permission] === true;
    default: return false; // 'permissions' and 'admins' stay with the owner
  }
}
export function allowed(member, chat, permission, now = Date.now()) {
  if (!member || member.role === 'banned') return false;
  if (member.role === 'owner') return true;
  if (chat?.kind === 'channel') return channelAllowed(member, permission);
  const rules = JSON.parse(member.rules || '{}');
  if (member.role === 'admin' && rules.admin?.[permission] === true) return true;
  if (!memberPermissions.includes(permission)) return false;
  if ((!rules.until || rules.until > now) && typeof rules.overrides?.[permission] === 'boolean') return rules.overrides[permission];
  return (JSON.parse(chat.permissions || '{}')[permission] ?? defaults[permission]) === true;
}
