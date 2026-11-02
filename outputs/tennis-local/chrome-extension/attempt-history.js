import {addDays,releaseAt,slotKey,VENUES} from './core.js';

// Operational retirement is not payment reconciliation or merchant cancellation.
// Keep the original pending journal in checkoutRecords, including all markers:
// older extension versions must still see its hold rather than replay it.
function validIdentity(record) {
 try {
  const s=record.slot;addDays(s.date,0);
  return VENUES.includes(s.venue)&&[1,2].includes(s.hours)&&/^\d{2}:00$/.test(s.start)&&Number(s.start.slice(0,2))+s.hours<=24&&/^\d+\.\d{2}$/.test(s.totalGBP)&&Number.isFinite(Number(s.totalGBP))&&Number(s.totalGBP)>0&&record.key===slotKey(s);
 }catch{return false;}
}
export function isRetiredAttempt(record,now=Date.now()) {
 try {
  const r=record.runRetirement,at=Date.parse(r.at);
  return ['pending','confirmed'].includes(record.status)&&validIdentity(record)&&r.reason==='release-window-passed'&&Number.isFinite(at)&&at<=now&&record.slot.date<r.nextDay&&releaseAt(record.slot.date)+60000<=at&&at<releaseAt(r.nextDay);
 }catch{return false;}
}
export function isRetiredBasketTest(record,now=Date.now()){return !!record&&isRetiredAttempt({...record,status:'pending'},now);}
export function pendingAttempts(records=[],now=Date.now()) {
 return records.filter(r=>r.status!=='confirmed'&&!isRetiredAttempt(r,now));
}
export function retireAttempts(records,nextDay,now=Date.now()) {
 addDays(nextDay,0);
 if(releaseAt(nextDay)<=now)throw Error('Choose a playing date whose release is still in the future');
 return records.map(record=>{
  if(record.status!=='pending'||isRetiredAttempt(record,now)||Object.hasOwn(record,'runRetirement')||!validIdentity(record)||record.slot.date>=nextDay||releaseAt(record.slot.date)+60000>now)return record;
  return {...record,runRetirement:{reason:'release-window-passed',at:new Date(now).toISOString(),nextDay}};
 });
}
export function assertFreshPlayingDate(records,day,now=Date.now()) {
 if(records.some(r=>r.slot?.date===day&&isRetiredAttempt(r,now)))throw Object.assign(Error('An earlier attempt for this playing date has an unknown outcome; verify it instead of booking again'),{code:'UNRESOLVED_CHECKOUT'});
}
