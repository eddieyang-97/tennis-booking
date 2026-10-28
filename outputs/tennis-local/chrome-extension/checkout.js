import {validateSlot,verifyBasket,sameSlot,basketEvidence} from './stage-rules.js';
import {londonDay,addDays,slotKey,slotCourts} from './core.js';
import {normalizeDiscount} from './discount.js';
import {normalizeSettings,failedCheckoutIdentity} from './booking-settings.js';
import {failureFor} from './failures.js';
export const PAYMENT_TEST_SLOT={venue:'victoria-park',date:'2026-10-17',court:2,start:'07:00',hours:1,totalGBP:'2.50'};
export function checkoutKey(slot,test=false,settings=null) {
 if(test){if(!sameSlot(slot,PAYMENT_TEST_SLOT))throw Error('Unauthorized payment test');if(slot.date<londonDay() || slot.date>addDays(londonDay(),7))throw Error('Payment test outside booking window');}
 else {validateSlot(slot,settings);if(!settings&&+slot.totalGBP>(slot.hours===2?14:7))throw Error('Checkout exceeds authorized price limit');}
 return slotKey(slot);
}
export function checkoutCandidate(results,settings=null) {
 for(const entry of results||[])for(const candidate of entry.candidates||[]) {
  const slot={...candidate,venue:entry.venue};
  try{checkoutKey(slot,false,settings);return slot;}catch{}
 }
 throw Error('No available candidate within authorized price limits');
}
export function basketTestKey(slot) {
 if(!['bethnal-green-gardens','st-johns-park','victoria-park'].includes(slot.venue)||slot.start!=='09:00'||slot.hours!==2||!/^\d+\.\d{2}$/.test(slot.totalGBP)||+slot.totalGBP<=0||+slot.totalGBP>14)throw Error('Invalid daytime basket test');
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
export function singleHourFallback(slot,basket,settings=null) {
 checkoutKey(slot,false,settings);
 if(slot.hours!==2||basket?.items?.length!==1)throw Error('Not a single-hour fallback');
 const item=basket.items[0],index=item.hour-Number(slot.start.slice(0,2));
 if(![0,1].includes(index)||item.court!==slotCourts(slot)[index])throw Error('Fallback is not an intended hour');
 const fallback={venue:slot.venue,date:slot.date,court:item.court,start:`${String(item.hour).padStart(2,'0')}:00`,hours:1,totalGBP:basket.totalGBP};
 checkoutKey(fallback,false,settings);verifyBasket(basket,fallback);return fallback;
}
export async function prepareCheckout(slot,deps,{test=false,adopt=false,basketOnly=false,allowPartial=false,discountCode='',settings=null,checkoutTestOnly=false}={}) {
 discountCode=normalizeDiscount(discountCode);
 if(discountCode&&(test||basketOnly))throw Error('Discount not supported in basket-only tests');
 if(basketOnly&&(test||adopt))throw Error('Daytime test cannot adopt or pay');
 const records=await deps.load(),existing=records.find(r=>r.key===slotKey(slot));
 // Never apply new popup preferences to an existing or legacy journal.
 settings=existing?(existing.settings||null):(settings?normalizeSettings(settings):null);
 let key=basketOnly?basketTestKey(slot):checkoutKey(slot,test,settings);
 const originalKey=key;
 let record=records.find(r=>r.key===key);
 if(record&&!!record.checkoutTestOnly!==checkoutTestOnly)throw Error('Another checkout requires reconciliation');
 if(record && (record.manualPaymentReportedAt || record.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record.phase)))throw Error('Payment requires receipt reconciliation; checkout preparation cannot reset it');
 if(records.some(r=>r.status==='confirmed' && r.slot.date===slot.date))throw Error('A booking for this date is already confirmed');
 if(records.some(r=>r.key!==key && r.status!=='confirmed'))throw Error('Another checkout requires reconciliation');
 const persist=async phase=>{
  record={...record,key,slot,test,...(settings?{settings}:{}),...(!record?.discountCode&&discountCode?{discountCode}:{}),...(basketOnly?{basketOnly:true}:{}),...(checkoutTestOnly?{checkoutTestOnly:true}:{}),phase,status:'pending',updatedAt:new Date().toISOString()};
  await deps.save([...records.filter(r=>r.key!==key&&r.key!==originalKey),record]);
 };
 const verifySelected=async basket=>{
  try{return verifyBasket(basket,slot);}catch(error){
   if(!allowPartial||test||basketOnly||record?.phase!=='selection-dispatched'||record.paymentDispatchedAt||Object.hasOwn(record,'reference'))throw error;
   let fallback;try{fallback=singleHourFallback(slot,basket,settings);}catch{throw error;}
   const fallbackFrom={key,slot,basketDiagnostic:basketEvidence(basket,slot),at:new Date().toISOString()};
   slot=fallback;key=checkoutKey(slot,false,settings);record={...record,fallbackFrom};await persist('selection-dispatched');return true;
  }
 };
 try {
 let basket=await deps.read();
 if(record) {
  // Never replay selection after worker interruption or a lost response.
  if(basket.empty)throw Error('Pending checkout basket is empty; inspect payment/booking status before retrying');
  await verifySelected(basket);
 } else if(adopt) {
  if(!test)throw Error('Only the authorized payment test may adopt an existing basket');
  verifyBasket(basket,slot);await persist('basket-adopted');
 } else {
  if(!basket.empty)throw Error('Existing basket items; checkout stopped without changes');
  // New journals opt into one-shot free completion. Never retrofit this on a
  // legacy pending record: its owner may already have submitted manually.
  record={...record,freeBookingAllowed:true};
  if(Number.isInteger(deps.tabId))record={...record,tabId:deps.tabId};
  await persist('selection-dispatched');
  try{const selected=await deps.select(slot);if(selected?.selectionDiagnostic)record={...record,selectionDiagnostic:selected.selectionDiagnostic};}catch(error){
   if(error.selectionDiagnostic)record={...record,selectionDiagnostic:error.selectionDiagnostic};
   record={...record,selectionFailure:failureFor(error)};
   // Retain the observed failure before a further read can hang or lose the
   // worker. This writes local evidence; it never repeats selection.
   await persist('selection-dispatched');
   basket=await deps.read();
   if(basket.empty)throw Object.assign(Error('Selection uncertain; pending checkout retained; no retry'),failureFor(error));
   await verifySelected(basket);
  }
  basket=await deps.read();await verifySelected(basket);
 }
 const {lastError,basketDiagnostic,...clean}=record||{};
 record={...clean,recoveryRequired:false,basketVerifiedAt:new Date().toISOString()};
 await persist('awaiting-payment');
 const tabId=await deps.retain();
 record={...record,tabId};await deps.save([...records.filter(r=>r.key!==key&&r.key!==originalKey),record]);
 await deps.notify(slot);
 return {status:checkoutTestOnly?'checkout-test-prepared':basketOnly?'basket-test-ready':'awaiting-payment',slot,tabId,basketVerified:true,...(record.fallbackFrom?{fallback:'single-hour',originalSlot:record.fallbackFrom.slot}:{}),...(basketOnly||checkoutTestOnly?{paymentBlocked:true}:{}),booked:false,paid:false,key};
 }catch(error){
  if(record?.status==='pending'){
   record={...record,recoveryRequired:true,lastError:error.message,...(error.basketDiagnostic?{basketDiagnostic:error.basketDiagnostic}:{}),updatedAt:new Date().toISOString()};
   await deps.save([...records.filter(r=>r.key!==key&&r.key!==originalKey),record]);
  }
  throw error;
 }
}
export function reconcileClearedSelection(records,basket,{unpaidTestConfirmed=false}={}) {
 const pending=records.filter(r=>r.status!=='confirmed');
 const testCleanup=pending.length===1&&pending[0].checkoutTestOnly===true&&unpaidTestConfirmed===true&&['selection-dispatched','awaiting-payment','discount-dispatched','checkout-test-opening','checkout-test-ready','test-cleanup-checking','test-cleanup-removing'].includes(pending[0].phase);
 if(pending.length!==1||pending[0].manualPaymentReportedAt||pending[0].paymentDispatchedAt||(!testCleanup&&(!['selection-dispatched','awaiting-payment','discount-dispatched'].includes(pending[0].phase)||Object.hasOwn(pending[0],'reference'))))throw Error('Only an unsubmitted selection can be reconciled. For a checkout test, confirm you did not pay; preserve payment journals');
 if(basket?.empty!==true||!Array.isArray(basket.items)||basket.items.length!==0)throw Error('Remove the partial selection from the site basket first; no items were removed automatically');
 const at=new Date().toISOString();
 const abandoned={...pending[0],status:'abandoned',phase:'selection-cleared',abandonedAt:at,abandonmentEvidence:{basis:testCleanup?'owner-attested-no-payment':'unsubmitted-selection-empty',at,key:pending[0].key,...(pending[0].reference?{reference:pending[0].reference}:{}),basketEmptyVerified:true,merchantPaymentState:'unknown',merchantCancellationState:'unknown'}};
 return {checkoutRecords:records.filter(r=>r!==pending[0]),abandoned};
}
export function confirmCheckout(record,receipt) {
 if(record?.freeBookingDispatchedAt&&(receipt?.freeBooking!==true||receipt.source!=='free-booking-receipt'||receipt.totalGBP!=='0.00'||receipt.bookingState!=='confirmed'))throw Error('A matching free booking receipt has not been verified');
 if(!record || receipt?.status!=='confirmed' || receipt.key!==record.key || !/^\d+$/.test(receipt.reference||'') || (record.reference && receipt.reference!==record.reference))throw Error('A matching paid receipt has not been verified');
 return {...record,status:'confirmed',phase:'receipt-verified',reference:receipt.reference,receiptSource:receipt.source||'booking-receipt',bookingState:receipt.bookingState||'confirmed',confirmedAt:new Date().toISOString()};
}
export function assertFailedCheckoutAttestation(records,{noPaymentConfirmed=false,attestationIdentity=''}={}) {
 const identity=failedCheckoutIdentity(records);
 if(noPaymentConfirmed!==true)throw Error('Confirm that you did not submit payment for this failed checkout');
 if(!identity||identity!==attestationIdentity)throw Error('Failed checkout changed or confirmation is stale; inspect the current journal');
 return records.find(r=>r.status!=='confirmed');
}
export function archiveFailedCheckout(records,basket,options={}) {
 const record=assertFailedCheckoutAttestation(records,options);
 if(basket?.empty!==true||!Array.isArray(basket.items)||basket.items.length!==0)throw Error('Basket is not verified empty; no items were removed automatically');
 const at=new Date().toISOString();
 return {checkoutRecords:records.filter(r=>r!==record),abandoned:{...record,status:'abandoned',abandonedAt:at,abandonmentEvidence:{basis:'owner-attested-failed-checkout-no-payment',previousStatus:record.status,at,key:record.key,checkoutOpenDispatchedAt:record.checkoutOpenDispatchedAt,basketEmptyVerified:true,merchantPaymentState:'unknown',merchantCancellationState:'unknown'}}};
}
