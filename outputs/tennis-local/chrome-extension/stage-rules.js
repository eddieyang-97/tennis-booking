import {NAMES,eligible,londonDay,addDays} from './core.js';
// Chrome storage can return object keys in a different order. Authorization
// compares every field and its type, never the object's serialized key order.
export function sameSlot(slot,expected) {
 return slot!==null && typeof slot==='object' && !Array.isArray(slot) &&
  Object.keys(slot).length===Object.keys(expected).length &&
  Object.keys(expected).every(key=>Object.hasOwn(slot,key) && slot[key]===expected[key]);
}
export function validateSlot(slot) {
 if(!NAMES[slot.venue] || ![1,2,3,4].includes(slot.court) || ![1,2].includes(slot.hours))throw Error('Invalid court identity');
 if(slot.date<londonDay() || slot.date>addDays(londonDay(),7))throw Error('Outside booking window');
 if(!eligible(slot.date)||!['20:00','21:00'].includes(slot.start))throw Error('Outside recurring preferences');
 if(!/^\d+\.\d{2}$/.test(slot.totalGBP)||+slot.totalGBP<=0)throw Error('Invalid price');
 return JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]);
}
export function verifyBasket(basket,slot) {
 if(basket.empty || basket.items.length!==slot.hours)throw Error('Unexpected basket item count');
 for(let i=0;i<slot.hours;i++) {
  const hour=Number(slot.start.slice(0,2))+i;
  const item=basket.items.find(x=>x.hour===hour);
  if(!item || item.court!==slot.court || item.venue!==NAMES[slot.venue] || item.day!==Number(slot.date.slice(8)) || item.month!==Number(slot.date.slice(5,7)))throw Error('Basket date/time/court/venue mismatch');
 }
 if(basket.totalGBP!==slot.totalGBP || basket.items.reduce((s,x)=>s+Math.round(+x.priceGBP*100),0)!==Math.round(+slot.totalGBP*100))throw Error('Basket price mismatch');
 if(!basket.paymentBoundary)throw Error('Known prepayment boundary missing');
 return true;
}
