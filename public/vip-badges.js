// Quick choices for the VIP badge next to the name. Any single emoji or any
// sticker / custom emoji (:ce[id]) is also allowed; the server checks access to stickers.
export const VIP_BADGES=Object.freeze([
 ['✦','Статус'],['💎','Бриллиант'],['👑','Корона'],['✨','Искры'],
 ['⚡','Молния'],['🔥','Огонь'],['🚀','Ракета'],['💚','Сердце']
]);
const customBadge=/^:(?:ce|ae)\[[a-zA-Z0-9-]{1,80}\]$/;
const emojiBadge=/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Emoji_Component}|‍|️|⃣)+$/u;
export const isCustomBadge=value=>customBadge.test(String(value||''));
export const isBadge=value=>{const v=String(value||'');return VIP_BADGES.some(([symbol])=>symbol===v)||customBadge.test(v)||(emojiBadge.test(v)&&!/^[\d#*]+$/.test(v)&&[...v].length<=10);};
export const vipBadgeValue=value=>isBadge(value)?value:'✦';
// The default choice is shown as the word VIP rather than a star.
export const vipBadgeText=value=>value==='✦'?'VIP':value;
