export const memberPermissions = ['text', 'photo', 'video', 'file', 'voice', 'round', 'poll', 'invite', 'info', 'pin'];
export const adminPermissions = ['info', 'invite', 'remove', 'ban', 'delete', 'pin', 'poll', 'permissions', 'tags', 'admins'];
export const defaults = Object.fromEntries(memberPermissions.map(p => [p, !['info', 'pin'].includes(p)]));
export function allowed(member, chat, permission, now = Date.now()) {
  if (!member || member.role === 'banned') return false;
  if (member.role === 'owner') return true;
  const rules = JSON.parse(member.rules || '{}');
  if (member.role === 'admin' && rules.admin?.[permission] === true) return true;
  if (!memberPermissions.includes(permission)) return false;
  if ((!rules.until || rules.until > now) && typeof rules.overrides?.[permission] === 'boolean') return rules.overrides[permission];
  return (JSON.parse(chat.permissions || '{}')[permission] ?? defaults[permission]) === true;
}
