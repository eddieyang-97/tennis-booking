import {verifyBasket} from './stage-rules.js';
export function normalizeDiscount(value='') {
 if(typeof value!=='string')throw Error('Discount code must be text');
 const code=value.trim();
 if(code&&!/^[A-Za-z0-9_-]{1,10}$/.test(code))throw Error('Discount code must be at most 10 letters, numbers, hyphens or underscores');
 return code;
}
const pence=value=>{if(typeof value!=='string'||!/^\d+\.\d{2}$/.test(value))throw Error('Invalid discount amount');return Math.round(Number(value)*100);};
const observationTimeout=()=>Object.assign(Error('Discount not verified before deadline; no payment and no code retry'),{reasonCode:'DISCOUNT_OBSERVATION_TIMEOUT'});
export function verifiedDiscount(basket,slot) {
 verifyBasket({...basket,totalGBP:slot.totalGBP},slot);
 const gross=pence(slot.totalGBP),off=pence(basket.discountGBP),net=pence(basket.totalGBP);
 if(basket.discountApplied!==true||basket.subtotalGBP!==slot.totalGBP||off<=0||net<=0||gross-off!==net)throw Error('Discount not verified; no payment');
 return {subtotalGBP:slot.totalGBP,discountGBP:basket.discountGBP,totalGBP:basket.totalGBP};
}
export function payableSlot(record) {
 if(!record.discount)return record.slot;
 const d=record.discount;
 if(!normalizeDiscount(record.discountCode)||!Number.isFinite(Date.parse(record.discountDispatchedAt))||d.subtotalGBP!==record.slot.totalGBP||pence(d.discountGBP)<=0||pence(d.totalGBP)<=0||pence(d.subtotalGBP)-pence(d.discountGBP)!==pence(d.totalGBP))throw Error('Discount journal is not verified');
 return {...record.slot,totalGBP:d.totalGBP};
}
export async function ensureDiscount(record,deps,{timeoutMs=15000,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 const code=normalizeDiscount(record.discountCode);
 if(!code){if(record.discount)throw Error('Unexpected discount journal');return record;}
 if(record.discount){payableSlot(record);return record;}
 if(record.paymentDispatchedAt||Object.hasOwn(record,'reference')||record.test||record.basketOnly)throw Error('Discount cannot change an existing payment or test');
 if(!['awaiting-payment','discount-dispatched'].includes(record.phase))throw Error('Discount requires a verified basket');
 if(!record.discountDispatchedAt){
  const basket=await deps.read();verifyBasket(basket,record.slot);
  if(basket.discountApplied||Number(basket.discountGBP||0)!==0)throw Error('Existing discount; inspect before applying another code');
  record={...record,phase:'discount-dispatched',discountDispatchedAt:new Date().toISOString()};await deps.save(record);
  try{await deps.apply(code,basket);}catch{/* Read and reconcile, never dispatch the code again. */}
 }
 const deadline=now()+timeoutMs;let discount;
 while(now()<deadline){
  const basket=await deps.read(Math.max(1,deadline-now()));
  // The adapter may await setup, logging or cleanup after computing its own
  // remaining budget. Never accept evidence outside this caller's deadline.
  if(now()>=deadline)throw observationTimeout();
  verifyBasket({...basket,totalGBP:record.slot.totalGBP},record.slot);
  if(basket.discountApplied||Number(basket.discountGBP||0)!==0){discount=verifiedDiscount(basket,record.slot);break;}
  await delay(Math.min(500,Math.max(0,deadline-now())));
 }
 if(!discount)throw observationTimeout();
 record={...record,discount,phase:'awaiting-payment',discountVerifiedAt:new Date().toISOString()};await deps.save(record);return record;
}
