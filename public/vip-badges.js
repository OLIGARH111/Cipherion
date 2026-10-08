// Shared allowlist: the server validates the same choices the client offers.
export const VIP_BADGES=Object.freeze([
 ['✦','Звезда'],['💎','Бриллиант'],['👑','Корона'],['✨','Искры'],
 ['⚡','Молния'],['🔥','Огонь'],['🚀','Ракета'],['💚','Сердце']
]);
export const vipBadgeValue=value=>VIP_BADGES.some(([symbol])=>symbol===value)?value:'✦';
