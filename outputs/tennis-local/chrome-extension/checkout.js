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
export function basketTestKey(slot) {
 if(!['bethnal-green-gardens','victoria-park'].includes(slot.venue)||slot.start!=='09:00'||slot.hours!==2||!/^\d+\.\d{2}$/.test(slot.totalGBP)||+slot.totalGBP<=0||+slot.totalGBP>14)throw Error('Invalid daytime basket test');
 addDays(slot.date,0);
 if(slot.date<londonDay()||slot.date>addDays(londonDay(),7))throw Error('Basket test outside booking window');
 return slotKey(slot);
}
export async function recoverPreparationTab(record,tabs,create) {
 try{return await tabs.get(record.tabId);}catch(error){
  if(!/No tab with id/i.test(error.message))throw error;
  if(!['selection-dispatched','awaiting-payment'].includes(record.phase)||record.paymentDispatchedAt||Object.hasOwn(record,'reference'))throw Error('Checkout tab closed after payment preparation; verify payment instead of reopening');
  // Reopen only the read-only basket. The durable intent still prevents
  // selection replay, even when this replacement basket is empty or partial.
  return create();
 }
}
export async function prepareCheckout(slot,deps,{test=false,adopt=false,basketOnly=false}={}) {
 if(basketOnly&&(test||adopt))throw Error('Daytime test cannot adopt or pay');
 const key=basketOnly?basketTestKey(slot):checkoutKey(slot,test),records=await deps.load();
 let record=records.find(r=>r.key===key);
 if(record && (record.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record.phase)))throw Error('Payment requires receipt reconciliation; checkout preparation cannot reset it');
 if(records.some(r=>r.status==='confirmed' && r.slot.date===slot.date))throw Error('A booking for this date is already confirmed');
 if(records.some(r=>r.key!==key && r.status!=='confirmed'))throw Error('Another checkout requires reconciliation');
 const persist=async phase=>{
  record={...record,key,slot,test,...(basketOnly?{basketOnly:true}:{}),phase,status:'pending',updatedAt:new Date().toISOString()};
  await deps.save([...records.filter(r=>r.key!==key),record]);
 };
 try {
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
  if(Number.isInteger(deps.tabId))record={...record,tabId:deps.tabId};
  await persist('selection-dispatched');
  try{const selected=await deps.select(slot);if(selected?.selectionDiagnostic)record={...record,selectionDiagnostic:selected.selectionDiagnostic};}catch(error){
   if(error.selectionDiagnostic)record={...record,selectionDiagnostic:error.selectionDiagnostic};
   basket=await deps.read();
   if(basket.empty)throw Error('Selection uncertain; pending checkout retained; no retry');
   verifyBasket(basket,slot);
  }
  basket=await deps.read();verifyBasket(basket,slot);
 }
 const {lastError,basketDiagnostic,...clean}=record||{};
 record={...clean,recoveryRequired:false,basketVerifiedAt:new Date().toISOString()};
 await persist('awaiting-payment');
 const tabId=await deps.retain();
 record={...record,tabId};await deps.save([...records.filter(r=>r.key!==key),record]);
 await deps.notify(slot);
 return {status:basketOnly?'basket-test-ready':'awaiting-payment',slot,tabId,basketVerified:true,...(basketOnly?{paymentBlocked:true}:{}),booked:false,paid:false,key};
 }catch(error){
  if(record?.status==='pending'){
   record={...record,recoveryRequired:true,lastError:error.message,...(error.basketDiagnostic?{basketDiagnostic:error.basketDiagnostic}:{}),updatedAt:new Date().toISOString()};
   await deps.save([...records.filter(r=>r.key!==key),record]);
  }
  throw error;
 }
}
export function reconcileClearedSelection(records,basket) {
 const pending=records.filter(r=>r.status!=='confirmed');
 if(pending.length!==1||!['selection-dispatched','awaiting-payment'].includes(pending[0].phase)||pending[0].paymentDispatchedAt||Object.hasOwn(pending[0],'reference'))throw Error('Only an unsubmitted selection can be reconciled; preserve payment journals');
 if(basket?.empty!==true||!Array.isArray(basket.items)||basket.items.length!==0)throw Error('Remove the partial selection from the site basket first; no items were removed automatically');
 const abandoned={...pending[0],status:'abandoned',phase:'selection-cleared',abandonedAt:new Date().toISOString()};
 return {checkoutRecords:records.filter(r=>r!==pending[0]),abandoned};
}
export function confirmCheckout(record,receipt) {
 if(!record || receipt?.status!=='confirmed' || receipt.key!==record.key || !/^\d+$/.test(receipt.reference||'') || (record.reference && receipt.reference!==record.reference))throw Error('A matching paid receipt has not been verified');
 return {...record,status:'confirmed',phase:'receipt-verified',reference:receipt.reference,receiptSource:receipt.source||'booking-receipt',bookingState:receipt.bookingState||'confirmed',confirmedAt:new Date().toISOString()};
}
