import {NAMES,eligible,londonDay,addDays,slotCourts,slotKey} from './core.js';
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
 return slotKey(slot);
}
export function basketEvidence(basket,slot) {
 const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max?value:null;
 const price=value=>typeof value==='string'&&/^\d{1,4}\.\d{2}$/.test(value)?value:null;
 const items=Array.isArray(basket?.items)?basket.items:[];
 return {expectedItems:slot.hours,actualItems:items.length,empty:basket?.empty===true,expectedTotalGBP:price(slot.totalGBP),actualTotalGBP:price(basket?.totalGBP),...(basket?.subtotalGBP?{subtotalGBP:price(basket.subtotalGBP),discountGBP:price(basket.discountGBP),discountApplied:basket.discountApplied===true}:{}),expectedSlots:slotCourts(slot).map((court,i)=>({court,date:slot.date,hour:Number(slot.start.slice(0,2))+i,venue:NAMES[slot.venue]})),actualSlots:items.slice(0,10).map(item=>({venue:Object.values(NAMES).includes(item.venue)?item.venue:null,court:integer(item.court,1,4),day:integer(item.day,1,31),month:integer(item.month,1,12),hour:integer(item.hour,0,23),priceGBP:price(item.priceGBP)})),truncated:items.length>10};
}
export function verifyBasket(basket,slot,discount=null) {
 const courts=slotCourts(slot);
 const fail=message=>{throw Object.assign(Error(message),{basketDiagnostic:basketEvidence(basket,slot)});};
 if(basket.empty || basket.items.length!==slot.hours)fail(`Unexpected basket item count: expected ${slot.hours}, observed ${basket.items.length}`);
 for(let i=0;i<slot.hours;i++) {
  const hour=Number(slot.start.slice(0,2))+i;
  const item=basket.items.find(x=>x.hour===hour);
  if(!item || item.court!==courts[i] || item.venue!==NAMES[slot.venue] || item.day!==Number(slot.date.slice(8)) || item.month!==Number(slot.date.slice(5,7)))fail('Basket date/time/court/venue mismatch');
 }
 if(basket.totalGBP!==(discount?.totalGBP||slot.totalGBP) || basket.items.reduce((s,x)=>s+Math.round(+x.priceGBP*100),0)!==Math.round(+slot.totalGBP*100))fail('Basket price mismatch');
 if(discount && (basket.discountApplied!==true||basket.subtotalGBP!==slot.totalGBP||basket.subtotalGBP!==discount.subtotalGBP||basket.discountGBP!==discount.discountGBP||Math.round(+slot.totalGBP*100)-Math.round(+discount.discountGBP*100)!==Math.round(+basket.totalGBP*100)||Number(basket.totalGBP)<=0))fail('Basket discount mismatch');
 if(!basket.paymentBoundary)fail('Known prepayment boundary missing');
 return true;
}
