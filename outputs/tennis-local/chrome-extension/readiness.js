import {pendingArmBlocker} from './booking-settings.js';
import {releaseAt} from './core.js';
export function releasePreview(day,now=Date.now()) {
 try{const when=releaseAt(day);return when<=now?'This date has already released. Use Check availability now.':`Scheduled release: ${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(when))} London. No court is selected until then.`;}catch{return 'Choose a valid playing date.';}
}
export function readiness(status,now=Date.now()) {
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
 return {ready,lines,armBlocker:pendingArmBlocker(status.checkoutRecords),summary:ready?'Preflight passed — keep Chrome open and awake':pending?'Recovery required for an earlier checkout':status.job?'Armed run: review readiness below':'Not armed'};
}
