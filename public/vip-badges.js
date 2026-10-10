// Shared allowlist: the server validates the same choices the client offers.
export const VIP_BADGES=Object.freeze([
 ['✦','Статус'],['💎','Бриллиант'],['👑','Корона'],['✨','Искры'],
 ['⚡','Молния'],['🔥','Огонь'],['🚀','Ракета'],['💚','Сердце']
]);
export const vipBadgeValue=value=>VIP_BADGES.some(([symbol])=>symbol===value)?value:'✦';
// The default choice is shown as the word VIP rather than a star.
export const vipBadgeText=value=>value==='✦'?'VIP':value;
