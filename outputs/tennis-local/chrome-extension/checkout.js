import {validateSlot,verifyBasket,sameSlot} from './stage-rules.js';
import {londonDay,addDays,slotKey} from './core.js';
export const PAYMENT_TEST_SLOT={venue:'victoria-park',date:'2026-10-17',court:2,start:'07:00',hours:1,totalGBP:'2.50'};
export function checkoutKey(slot,test=false) {
 if(test){if(!sameSlot(slot,PAYMENT_TEST_SLOT))throw Error('Unauthorized payment test');if(slot.date<londonDay() || slot.date>addDays(londonDay(),7))throw Error('Payment test outside booking window');}
 else {validateSlot(slot);if(+slot.totalGBP>(slot.hours===2?14:7))throw Error('Checkout exceeds authorized price limit');}
 return slotKey(slot);
}
export function checkoutCandidate(results) {
 for(const entry of results||[])for(const candidate of entry.candidates||[]) {
  const slot={...candidate,venue:entry.venue};
  try{checkoutKey(slot);return slot;}catch{}
 }
 throw Error('No available candidate within authorized price limits');
}
export async function prepareCheckout(slot,deps,{test=false,adopt=false}={}) {
 const key=checkoutKey(slot,test),records=await deps.load();
 let record=records.find(r=>r.key===key);
 if(record && (record.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record.phase)))throw Error('Payment requires receipt reconciliation; checkout preparation cannot reset it');
 if(records.some(r=>r.status==='confirmed' && r.slot.date===slot.date))throw Error('A booking for this date is already confirmed');
 if(records.some(r=>r.key!==key && r.status!=='confirmed'))throw Error('Another checkout requires reconciliation');
 const persist=async phase=>{
  record={...record,key,slot,test,phase,status:'pending',updatedAt:new Date().toISOString()};
  await deps.save([...records.filter(r=>r.key!==key),record]);
 };
 let basket=await deps.read();
 if(record) {
  // Never replay selection after worker interruption or a lost response.
  if(basket.empty)throw Error('Pending checkout basket is empty; inspect payment/booking status before retrying');
  verifyBasket(basket,slot);
 } else if(adopt) {
  if(!test)throw Error('Only the authorized payment test may adopt an existing basket');
  verifyBasket(basket,slot);await persist('basket-adopted');
 } else {
  if(!basket.empty)throw Error('Existing basket items; checkout stopped without changes');
  await persist('selection-dispatched');
  try{await deps.select(slot);}catch(error){
   basket=await deps.read();
   if(basket.empty)throw Error('Selection uncertain; pending checkout retained; no retry');
   verifyBasket(basket,slot);
  }
  basket=await deps.read();verifyBasket(basket,slot);
 }
 record={...record,basketVerifiedAt:new Date().toISOString()};
 await persist('awaiting-payment');
 const tabId=await deps.retain();
 record={...record,tabId};await deps.save([...records.filter(r=>r.key!==key),record]);
 await deps.notify(slot);
 return {status:'awaiting-payment',slot,tabId,basketVerified:true,booked:false,paid:false,key};
}
export function confirmCheckout(record,receipt) {
 if(!record || receipt?.status!=='confirmed' || receipt.key!==record.key || !/^\d+$/.test(receipt.reference||'') || (record.reference && receipt.reference!==record.reference))throw Error('A matching paid receipt has not been verified');
 return {...record,status:'confirmed',phase:'receipt-verified',reference:receipt.reference,receiptSource:receipt.source||'booking-receipt',bookingState:receipt.bookingState||'confirmed',confirmedAt:new Date().toISOString()};
}
