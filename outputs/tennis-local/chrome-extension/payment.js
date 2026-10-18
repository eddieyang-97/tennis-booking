import {checkoutKey,confirmCheckout} from './checkout.js';
import {recoveryIdentity} from './reconciliation.js';
import {payableSlot} from './discount.js';
import {verifyBasket} from './stage-rules.js';
import {waitPaymentState} from './page-read.js';
import {temporaryTabError} from './retry.js';
export async function openVerifiedCheckout(record,deps,{timeoutMs=15000,now=Date.now,delay}={}) {
 if(record.paymentDispatchedAt||record.manualPaymentReportedAt)throw Error('Payment requires reconciliation, not checkout opening');
 if(record.discountCode&&!record.discount)throw Error('Discount must be verified before checkout');
 const current=await deps.current();
 if(current.url!=='https://tennistowerhamlets.com/basket/pay/card'){
  if(current.url!=='https://tennistowerhamlets.com/basket')throw Error('Checkout tab changed');
  if(record.checkoutOpenDispatchedAt)throw Error('Checkout opening is unresolved; inspect the retained tab rather than repeating its click');
  const expected=await deps.read();verifyBasket(expected,record.slot,record.discount);
  record={...record,checkoutOpenDispatchedAt:new Date().toISOString()};await deps.save(record);
  try{await deps.command({kind:'payment-open',expected});}catch(error){if(!temporaryTabError(error)&&!/Checkout response unavailable/.test(error.message))throw error;}
 }
 const page=await waitPaymentState(deps.state,{timeoutMs,now,...(delay?{delay}:{}),accept:state=>{if(state.totalGBP!==payableSlot(record).totalGBP||!/^\d+$/.test(state.reference||''))throw Error('Checkout amount or reference not verified');return true;}});
 return {record,page};
}
// The journal is committed before any payment submission. An interrupted or
// unanswered submit is reconciled, never retried.
export async function payCheckout(record,deps) {
 if(record?.basketOnly||record?.checkoutTestOnly)throw Error('Unpaid test cannot submit payment; clear and reconcile its basket');
 if(!record || record.status==='confirmed')throw Error('No pending checkout');
 const persist=async phase=>{const at=new Date().toISOString();record={...record,phase,updatedAt:at,...(phase==='payment-dispatched'?{paymentDispatchedAt:record.paymentDispatchedAt||at}:{})};await deps.save(record);};
 const confirm=receipt=>{if(record.reference && receipt.reference!==record.reference)throw Error('Paid receipt reference differs from provisional booking');return confirmCheckout(record,receipt);};
 if(record.manualPaymentReportedAt || record.paymentDispatchedAt || record.phase==='payment-dispatched' || record.phase==='payment-uncertain') {
  recoveryIdentity(record);
  const receipt=await deps.receipt();return confirm(receipt);
 }
 if(checkoutKey(record.slot,record.test,record.settings) !== record.key)throw Error('Checkout identity changed');
 if(record.discountCode&&!record.discount)throw Error('Discount must be verified before payment');
 const amount=payableSlot(record).totalGBP;
 if(!['selection-dispatched','basket-adopted','awaiting-payment','checkout-opening','link-opening','authentication-required','card-filling','provisional-reference-renewed'].includes(record.phase))throw Error('Unknown checkout phase; inspect payment status before continuing');
 await deps.verifyBasket(record.slot);
 record={...record,basketVerifiedAt:new Date().toISOString()};
 await persist('checkout-opening');const opened=await deps.open();if(opened?.record)record=opened.record;
 let page=await deps.state();
 if(page.totalGBP!==amount || !/^\d+$/.test(page.reference||''))throw Error('Payment amount or provisional reference not verified');
 if(record.reference && record.reference!==page.reference) {
  // Only reached before any payment dispatch and after exact basket/price
  // verification. A normal reload can replace an unpaid provisional reference.
  record={...record,priorReferences:[...(record.priorReferences||[]),{reference:record.reference,replacedAt:new Date().toISOString()}].slice(-10),reference:page.reference};
  await persist('provisional-reference-renewed');
 }
 record={...record,reference:page.reference};await deps.save(record);
 if(deps.fillCard) {
  await persist('card-filling');await deps.fillCard();page=await deps.waitCardReady();
 } else if(!page.enabled) {
  await persist('link-opening');await deps.link();
  page=await deps.waitReady();
  if(page.authenticationRequired){await persist('authentication-required');return {status:'authentication-required',record,booked:false,paid:false};}
 }
 if(!page.enabled || page.totalGBP!==amount || page.reference!==record.reference)throw Error('Saved payment is not ready or checkout changed');
 await persist('payment-dispatched');
 try{await deps.submit(amount,record.reference);}catch{ /* Outcome must be reconciled, not resubmitted. */ }
 try {return confirm(await deps.receipt());}
 catch(error){await persist('payment-uncertain');throw Error('Payment outcome unresolved; no repeat charge: '+error.message);}
}
