import {NAMES,eligible,addDays,slotKey} from './core.js';
import {sameSlot} from './stage-rules.js';
import {PAYMENT_TEST_SLOT} from './checkout.js';
import {payableSlot} from './discount.js';
import {authorizeSettingsSlot} from './booking-settings.js';

// Recovery is independent of the current booking window: old charges still
// need reconciliation. This function never authorises a new submission.
export function recoveryIdentity(record) {
 const s=record?.slot;
 if(!s || !NAMES[s.venue] || ![1,2,3,4].includes(s.court) || ![1,2].includes(s.hours) || !/^\d+\.\d{2}$/.test(s.totalGBP)||+s.totalGBP<=0)throw Error('Invalid recovery identity');
 addDays(s.date,0);
 payableSlot(record);
 if(record.test ? !sameSlot(s,PAYMENT_TEST_SLOT) : record.settings?false:(!eligible(s.date)||!['20:00','21:00'].includes(s.start)||+s.totalGBP>(s.hours===2?14:7)))throw Error('Invalid recovery slot');
 if(!record.test&&record.settings)authorizeSettingsSlot(s,record.settings);
 const free=!!record.freeBookingDispatchedAt;
 if(free&&(record.freeBookingAllowed!==true||payableSlot(record).totalGBP!=='0.00'||!Number.isFinite(Date.parse(record.freeBookingDispatchedAt))||record.freeBookingDispatchedAt!==record.paymentDispatchedAt))throw Error('Invalid free booking dispatch identity');
 if(record.key!==slotKey(s) || ((!free||record.reference!==undefined)&&!/^\d+$/.test(record.reference||'')))throw Error('Invalid recovery reference or key');
 const dispatched=Number.isFinite(Date.parse(record.paymentDispatchedAt)),manual=Number.isFinite(Date.parse(record.manualPaymentReportedAt));
 if((record.paymentDispatchedAt&&!dispatched)||(record.manualPaymentReportedAt&&!manual)||(!dispatched&&!manual))throw Error('No durable payment dispatch or manual-payment report; inspect manually');
 return record;
}
export function reportManualPayment(record,value) {
 if(record?.freeBookingDispatchedAt||record?.discount?.totalGBP==='0.00')throw Error('Free booking requires booking receipt review, not a manual payment report');
 if(!record||record.status!=='pending'||record.test||record.basketOnly||record.paymentDispatchedAt)throw Error('Choose the pending normal checkout; submitted payments use Verify paid receipt');
 if(typeof value!=='string'||!/^\d{1,20}$/.test(value.trim().replace(/^PT/,'')))throw Error('Enter the booking reference from your manual payment confirmation');
 const reference=value.trim().replace(/^PT/,'');
 if(record.reference&&record.reference!==reference)throw Error('Reference differs from the pending checkout; inspect before changing it');
 const reported={...record,reference,manualPaymentReportedAt:record.manualPaymentReportedAt||new Date().toISOString(),phase:'manual-payment-reported',updatedAt:new Date().toISOString()};
 recoveryIdentity(reported);return reported;
}

export async function reconcilePaid(record,deps) {
 recoveryIdentity(record);
 // A stale tab must not block account history, and must never be navigated
 // away from a bank challenge merely to obtain a receipt.
 let receipt;
 try {receipt=await deps.currentReceipt();}
 catch {await deps.step?.('receipt-source',{reasonCode:'RECEIPT_UNAVAILABLE'});}
 if(record.freeBookingDispatchedAt){
  if(receipt?.status==='confirmed'&&receipt.freeBooking===true&&receipt.source==='free-booking-receipt'&&receipt.totalGBP==='0.00'&&receipt.bookingState==='confirmed'&&receipt.key===record.key&&/^\d+$/.test(receipt.reference||'')&&(!record.reference||receipt.reference===record.reference))return receipt;
  throw Object.assign(Error('Free booking outcome unresolved; inspect booking confirmation; no repeat submission'),{reasonCode:receipt?.status==='conflicting'?'RECEIPT_CONFLICT':'FREE_BOOKING_UNRESOLVED'});
 }
 if(receipt?.status==='conflicting'&&receipt.key===record.key&&receipt.reference===record.reference)throw Object.assign(Error('Conflicting paid receipt evidence; preserve the payment hold'),{reasonCode:'RECEIPT_CONFLICT'});
 if(receipt?.status==='confirmed'&&receipt.key===record.key&&receipt.reference===record.reference)return receipt;
 await deps.step?.('receipt-source',{reasonCode:receipt?.reference&&receipt.reference!==record.reference?'RECEIPT_UNRELATED':receipt?'RECEIPT_NOT_CONFIRMED':'RECEIPT_ABSENT'});
 const account=await deps.accountReceipt();
 if(account?.status!=='confirmed'||account.key!==record.key||account.reference!==record.reference)throw Object.assign(Error('Account receipt identity mismatch; preserve the payment hold'),{reasonCode:'RECEIPT_CONFLICT'});
 return account;
}
