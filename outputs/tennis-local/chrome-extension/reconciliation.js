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
 if(record.key!==slotKey(s) || !/^\d+$/.test(record.reference||''))throw Error('Invalid recovery reference or key');
 if(!record.paymentDispatchedAt || !Number.isFinite(Date.parse(record.paymentDispatchedAt)))throw Error('No durable payment dispatch evidence; inspect manually');
 return record;
}

export async function reconcilePaid(record,deps) {
 recoveryIdentity(record);
 // A stale tab must not block account history, and must never be navigated
 // away from a bank challenge merely to obtain a receipt.
 try {
  const receipt=await deps.currentReceipt();
  if(receipt?.status==='confirmed') {
   if(receipt.key!==record.key||receipt.reference!==record.reference)throw Error('Receipt identity mismatch');
   return receipt;
  }
 } catch { /* Account evidence must independently match the durable identity. */ }
 return deps.accountReceipt();
}
