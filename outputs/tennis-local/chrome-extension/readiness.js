export function readiness(status,now=Date.now()) {
 const pending=status.checkoutRecords?.find(r=>r.status!=='confirmed');
 const dispatched=pending&&(pending.paymentDispatchedAt||['payment-dispatched','payment-uncertain'].includes(pending.phase));
 const lines=[`Version ${status.version||'unknown'}`,status.localCardUnlocked?'Card unlocked for this Chrome session':'Card locked — unlock after reloading'];
 if(pending)lines.push(dispatched?'Pending payment — verify paid receipt before booking again':'Pending basket — resume or inspect checkout');
 else lines.push('No unresolved checkout');
 if(!status.job)lines.push('No midnight run armed');
 else {
  const release=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(status.job.when));
  lines.push(`Playing ${status.job.day}; release ${release} London`);
  lines.push(status.job.when<=now?'Release time passed — inspect run result':status.job.prepared?'Preflight passed':'Preflight pending');
 }
 const ready=!!status.localCardUnlocked&&!pending&&!!status.job&&status.job.mode==='payment'&&status.job.when>now&&status.job.prepared===true;
 return {ready,lines,summary:ready?'Prepared for midnight (keep Chrome awake)':'Setup or preflight still needed'};
}
