import {pendingArmBlocker,unreferencedCheckoutTest,failedCheckoutIdentity} from './booking-settings.js';
import {releaseAt} from './core.js';
export function releasePreview(day,now=Date.now()) {
 try{const when=releaseAt(day);return when<=now?'This date has already released. Use Check availability now.':`Scheduled release: ${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(when))} London. No court is selected until then.`;}catch{return 'Choose a valid playing date.';}
}
export function readiness(status,now=Date.now()) {
 const failedCheckoutGuide=failedCheckoutIdentity(status.checkoutRecords)?'Failed checkout opening: no saved reference or card/payment intent. Inspect the old checkout and purchase history. Do not pay or repeat checkout opening. If you did not submit payment, confirm the basket is empty, tick the failed-checkout confirmation below and use Archive failed checkout. This preserves its history locally; it does not establish merchant cancellation or unpaid status. If payment was submitted or you are unsure, keep the journal and reconcile payment instead.':'';
 const testRecoveryGuide=unreferencedCheckoutTest(status.checkoutRecords)?'Unfinished unpaid checkout test: no saved reference. No payment dispatch is recorded, but this does not prove that no payment was submitted.\n1. Inspect the old checkout on Courtside. If available, use Cancel & return to basket without paying.\n2. Remove the test items and discount, then confirm the basket is completely empty.\n3. Only if you are certain you did not submit payment, tick I did not submit payment below and click Reconcile cleared selection.\nIf you paid manually or are unsure, keep the journal and inspect purchase history; use Verify manual payment only for an actual manual payment with its confirmation reference. Emptying a basket does not prove merchant cancellation.':'';
 const pending=status.checkoutRecords?.find(record=>record.status!=='confirmed');
 const submitted=pending&&(pending.manualPaymentReportedAt||pending.paymentDispatchedAt||['payment-dispatched','payment-uncertain'].includes(pending.phase));
 const lines=[`Version ${status.version||'unknown'}`,status.localCardUnlocked?'Card unlocked':'Card locked'];
 if(status.latestAction){const a=status.latestAction;lines.push(`Latest action: ${a.kind} — ${a.outcome}${a.reasonCode?' ('+a.reasonCode+')':''}`);}
 lines.push(pending?(submitted?'Pending payment: verify receipt before another booking':`Pending checkout (${pending.phase}): inspect or reconcile`):'No unresolved checkout');
 if(pending?.slot){const s=pending.slot;lines.push(`Pending: ${s.date} ${s.start}, ${s.hours}h, ${s.venue}, court ${s.courts?.join('/')||s.court}, gross £${s.totalGBP}`);}
 if(status.job){
  const when=status.job.when,valid=Number.isFinite(when),release=valid?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(when)):'unknown';
  lines.push(`Playing ${status.job.day}; release ${release} London`);
  if(status.job.settings){const s=status.job.settings;lines.push(`${s.earliestStart}–${s.latestFinish}, prefer ${s.preferredHours}h, minimum ${s.minHours}h; cap £${s.maxTotalGBP}, 1h cap £${s.maxOneHourGBP}`);}else lines.push('Legacy job: original evening preferences');
  lines.push(status.job.discountCode?'Discount requested':'No discount requested');
  lines.push(!valid||when<=now?'Release passed or invalid: inspect result':status.job.prepared?'Preflight passed':'Preflight pending');
 }
 const ready=!!status.localCardUnlocked&&!pending&&status.job?.mode==='payment'&&status.job.when>now&&status.job.prepared===true;
 return {ready,lines,testRecoveryGuide,failedCheckoutGuide,armBlocker:pendingArmBlocker(status.checkoutRecords),summary:ready?'Preflight passed — keep Chrome open and awake':testRecoveryGuide?'Unfinished checkout test needs review':pending?'Recovery required for an earlier checkout':status.job?'Armed run: review readiness below':'Not armed'};
}
