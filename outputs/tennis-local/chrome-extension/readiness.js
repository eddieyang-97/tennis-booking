import {pendingArmBlocker,unreferencedCheckoutTest,failedCheckoutIdentity} from './booking-settings.js';
import {releaseAt} from './core.js';
// Presentation hints only: worker guards still authorize every action using
// current durable state and merchant evidence. Rendering never sends a mutation.
export function recoveryPresentation(status={}) {
 const pending=(status.checkoutRecords||[]).filter(r=>r.status!=='confirmed'),r=pending[0],unique=pending.length===1;
 const has=field=>!!r&&Object.hasOwn(r,field);
 const held=['paymentDispatchedAt','manualPaymentReportedAt','freeBookingDispatchedAt','cardFillDispatchedAt','cardFillRecoveryRequired'].some(has)||['payment-dispatched','payment-uncertain','manual-payment-reported','free-booking-dispatched','card-filling'].includes(r?.phase);
 const known=unique&&r.status==='pending';
 const test=known&&r.checkoutTestOnly===true,normal=known&&!r.checkoutTestOnly&&!r.basketOnly&&!r.test;
 const early=['selection-dispatched','awaiting-payment','discount-dispatched'].includes(r?.phase);
 const testPhase=['selection-dispatched','awaiting-payment','discount-dispatched','checkout-test-opening','checkout-test-ready','test-cleanup-checking','test-cleanup-removing'].includes(r?.phase);
 const legacy=!!status.basketTest&&status.basketTest.status!=='cleared';
 const candidates=status.result?.status==='complete'&&status.result.results?.some(entry=>entry.candidates?.length>0);
 const freeReview=r?.discount?.totalGBP==='0.00'&&(r.freeBookingAllowed!==true||has('reference')||has('checkoutOpenDispatchedAt')||!r.slot||(Object.hasOwn(r.slot,'courts')&&(!Array.isArray(r.slot.courts)||r.slot.courts.some(court=>court!==r.slot.court))));
 const paused=!!status.job||!!status.running;
 const testFallback=test&&!held&&testPhase;
 const actions={
  assessRecovery:pending.length>0,
  verifyPayment:unique&&['paymentDispatchedAt','manualPaymentReportedAt','freeBookingDispatchedAt'].some(field=>typeof r[field]==='string'&&Number.isFinite(Date.parse(r[field]))),
  reconcileManualPayment:unique&&r.status==='pending'&&!r.checkoutTestOnly&&!r.test&&!r.basketOnly&&!has('paymentDispatchedAt')&&!has('freeBookingDispatchedAt')&&r.discount?.totalGBP!=='0.00',
  resetUnpaidTest:test&&!held&&testPhase,
  reconcileSelection:known&&!held&&((early&&!has('reference'))||testFallback),
  unpaidTestConfirmed:testFallback&&(!early||has('reference')||has('checkoutOpenDispatchedAt')),
  reconcileBasket:legacy,
  resume:!!status.result?.retainedTabId,
  reset:!!status.running,
  prepareCheckout:!paused&&!legacy&&((!pending.length&&!!candidates)||(normal&&!held&&early&&!has('reference')&&!r.discount&&!has('discountDispatchedAt'))),
  payCheckout:!paused&&!legacy&&normal&&!held&&!freeReview&&['selection-dispatched','basket-adopted','awaiting-payment','discount-dispatched','checkout-opening','link-opening','authentication-required','provisional-reference-renewed'].includes(r.phase)
 };
 const help=pending.length>1?'Multiple unresolved checkouts need review. Assess recovery and download the log; do not start another checkout.':r?.freeBookingDispatchedAt?'Free completion was submitted. Inspect its confirmation and verify the booking outcome; never submit it again.':held?'A submission or card-fill intent may already exist. Inspect the retained page and verify the outcome; do not repeat booking or payment.':test?'This is an unfinished unpaid test. Clear only its verified test items, or reconcile an already empty basket using the applicable controls below.':r?'Inspect the pending checkout shown above. Reconciliation checks evidence; it does not cancel a merchant booking.':legacy?'A legacy basket test still needs an empty-basket check. Its journal is preserved until verification.':'No unresolved checkout.';
 return {actions,help,showRecovery:pending.length>0||legacy,paused,testAvailable:!paused&&!legacy&&(!pending.length||test&&!held&&testPhase),manualHelp:paused?'Manual booking is paused while a run is armed or an availability check is interrupted.':!actions.prepareCheckout&&!actions.payCheckout?'No automatic continuation is offered for this state. Use recovery, or check availability before preparing a new checkout.':pending.length?'Continue only the saved checkout shown above. These controls can book a court or submit payment.':'Check availability first. Preparing checkout selects courts; continuing can book or pay.'};
}
export function releasePreview(day,now=Date.now()) {
 try{const when=releaseAt(day);return when<=now?'This date has already released. Use Check availability now.':`Scheduled release: ${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(when))} London. No court is selected until then.`;}catch{return 'Choose a valid playing date.';}
}
export function readiness(status,now=Date.now()) {
 const failedCheckoutGuide=failedCheckoutIdentity(status.checkoutRecords)?'Failed checkout opening: no saved reference or card/payment intent. Inspect the old checkout and purchase history. Do not pay or repeat checkout opening. If you did not submit payment, confirm the basket is empty, tick the failed-checkout confirmation below and use Archive failed checkout. This preserves its history locally; it does not establish merchant cancellation or unpaid status. If payment was submitted or you are unsure, keep the journal and reconcile payment instead.':'';
 const testRecoveryGuide=unreferencedCheckoutTest(status.checkoutRecords)?'Unfinished unpaid checkout test: no saved reference. No payment dispatch is recorded, but this does not prove that no payment was submitted.\n1. Inspect the old checkout on Courtside. If available, use Cancel & return to basket without paying.\n2. Remove the test items and discount, then confirm the basket is completely empty.\n3. Only if you are certain you did not submit payment, tick I did not submit payment below and click Reconcile cleared selection.\nIf you paid during this test or are unsure, keep the journal, inspect purchase history and download the log for assisted recovery. Do not use unpaid-test cleanup. A payment already reported can use Verify booking/payment outcome. Emptying a basket does not prove merchant cancellation.':'';
 const pending=status.checkoutRecords?.find(record=>record.status!=='confirmed');
 const submitted=pending&&(pending.manualPaymentReportedAt||pending.paymentDispatchedAt||['payment-dispatched','payment-uncertain'].includes(pending.phase));
 const lines=[`Version ${status.version||'unknown'}`,status.localCardUnlocked?'Card unlocked':'Card locked'];
 if(status.latestAction){const a=status.latestAction;lines.push(`Latest action: ${a.kind} — ${a.outcome}${a.reasonCode?' ('+a.reasonCode+')':''}`);}
 lines.push(pending?(pending.freeBookingDispatchedAt?'Pending free booking: inspect confirmation; never submit again':submitted?'Pending payment: verify receipt before another booking':`Pending checkout (${pending.phase}): inspect or reconcile`):'No unresolved checkout');
 if(pending?.slot){const s=pending.slot;lines.push(`Pending: ${s.date} ${s.start}, ${s.hours}h, ${s.venue}, court ${s.courts?.join('/')||s.court}, gross £${s.totalGBP}`);}
 if(status.job){
  const when=status.job.when,valid=Number.isFinite(when),release=valid?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(when)):'unknown';
  lines.push(`Playing ${status.job.day}; release ${release} London`);
  if(status.job.settings){const s=status.job.settings;lines.push(`${s.earliestStart}–${s.latestFinish}, prefer ${s.preferredHours}h, minimum ${s.minHours}h; cap £${s.maxTotalGBP}, 1h cap £${s.maxOneHourGBP}`);}else lines.push('Legacy job: original evening preferences');
  lines.push(status.job.discountCode?'Discount requested':'No discount requested');
  lines.push(!valid||when<=now?'Release passed or invalid: inspect result':status.job.prepared?'Preflight passed':'Preflight pending');
 }
 const ready=!!status.localCardUnlocked&&!pending&&status.job?.mode==='payment'&&status.job.when>now&&status.job.prepared===true;
 return {ready,lines,testRecoveryGuide,failedCheckoutGuide,recovery:recoveryPresentation(status),armBlocker:pendingArmBlocker(status.checkoutRecords),summary:ready?'Preflight passed — keep Chrome open and awake':testRecoveryGuide?'Unfinished checkout test needs review':pending?'Recovery required for an earlier checkout':status.job?'Armed run: review readiness below':'Not armed'};
}
