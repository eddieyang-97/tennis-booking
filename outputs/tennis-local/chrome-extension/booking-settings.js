export const SUPPORTED_VENUES=['bethnal-green-gardens','victoria-park'];
export const DEFAULT_SETTINGS={schemaVersion:1,venues:[...SUPPORTED_VENUES],earliestStart:'20:00',latestFinish:'22:00',preferredHours:2,minHours:1,maxTotalGBP:'14.00',maxOneHourGBP:'7.00',allowCourtSwitch:true};
export function gbpPence(value) {
 if(typeof value!=='string'||!/^\d{1,4}(?:\.\d{1,2})?$/.test(value))throw Error('Enter a GBP amount with at most two decimal places');
 const [whole,fraction='']=value.split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(amount<=0)throw Error('Maximum payment must be greater than zero');return amount;
}
const money=value=>(gbpPence(value)/100).toFixed(2);
export function hourValue(value,{end=false}={}) {
 if(typeof value!=='string'||!/^\d{2}:00$/.test(value))throw Error('Choose whole-hour times');
 const hour=Number(value.slice(0,2));if(hour<0||hour>(end?24:23))throw Error('Invalid time range');return hour;
}
export function normalizeSettings(value=DEFAULT_SETTINGS) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(DEFAULT_SETTINGS,key)))throw Error('Invalid booking settings');
 if(Object.hasOwn(value,'venues')&&!Array.isArray(value.venues))throw Error('Choose supported venues');
 const s={...DEFAULT_SETTINGS,...value,venues:[...(value.venues||DEFAULT_SETTINGS.venues)]};
 if(s.schemaVersion!==1)throw Error('Unsupported booking settings version');
 if(!Array.isArray(value.venues??DEFAULT_SETTINGS.venues)||s.venues.length<1||s.venues.length>2||new Set(s.venues).size!==s.venues.length||s.venues.some(venue=>!SUPPORTED_VENUES.includes(venue)))throw Error('Choose one or two distinct supported venues');
 if(![1,2].includes(s.preferredHours)||![1,2].includes(s.minHours)||s.minHours>s.preferredHours)throw Error('Choose desired/minimum duration of one or two hours');
 if(typeof s.allowCourtSwitch!=='boolean')throw Error('Invalid court-switch preference');
 const start=hourValue(s.earliestStart),end=hourValue(s.latestFinish,{end:true});
 if(end<=start||end-start<s.preferredHours)throw Error('Time range must fit the desired hours within one day');
 s.maxTotalGBP=money(s.maxTotalGBP);s.maxOneHourGBP=money(s.maxOneHourGBP);
 if(gbpPence(s.maxOneHourGBP)>gbpPence(s.maxTotalGBP))throw Error('One-hour maximum cannot exceed the total maximum');
 return s;
}
export function settingsCap(s,hours){return Math.min(gbpPence(s.maxTotalGBP),hours===1?gbpPence(s.maxOneHourGBP):Infinity);}
// Presentation hint only. Actual cleanup still requires current-journal
// attestation and an observed empty basket in the worker's existing guards.
export function unreferencedCheckoutTest(records=[]) {
 const pending=records.filter(record=>record.status!=='confirmed'),record=pending[0];
 return pending.length===1&&record.checkoutTestOnly===true&&typeof record.key==='string'&&record.key.length>0&&!record.reference&&['checkout-test-opening','checkout-test-ready','test-cleanup-checking','test-cleanup-removing'].includes(record.phase)&&!['paymentDispatchedAt','manualPaymentReportedAt','cardFillDispatchedAt','cardFillRecoveryRequired'].some(field=>Object.hasOwn(record,field));
}
export function pendingArmBlocker(records=[]) {
 const pending=records.find(record=>record.status!=='confirmed');if(!pending)return '';
 const slot=pending.slot,description=slot?`${slot.date} at ${slot.start} (${slot.hours}h)`:'an earlier date';
 const recovery=pending.manualPaymentReportedAt||pending.paymentDispatchedAt||['payment-dispatched','payment-uncertain'].includes(pending.phase)?'Use Verify paid receipt to reconcile its payment.':unreferencedCheckoutTest(records)?'An unfinished unpaid checkout test has no saved reference. Follow the manual test recovery instructions in Check and recover, then use Reconcile cleared selection only if you are certain you did not submit payment.':'If you paid it manually, enter its confirmation reference and use Verify manual payment. Otherwise inspect or resume that earlier checkout.';
 return `Arming is blocked by an unresolved checkout for ${description}. ${recovery}`;
}
// No current-date check here: historical paid journals still need recovery.
export function authorizeSettingsSlot(slot,value) {
 const s=normalizeSettings(value),start=hourValue(slot.start);
 if(!s.venues.includes(slot.venue)||![1,2].includes(slot.hours)||slot.hours<s.minHours||slot.hours>s.preferredHours||start<hourValue(s.earliestStart)||start+slot.hours>hourValue(s.latestFinish,{end:true}))throw Error('Slot is outside saved booking settings');
 if(!s.allowCourtSwitch&&slot.courts?.some(court=>court!==slot.court))throw Error('Saved settings require the same court');
 if(!/^\d+\.\d{2}$/.test(slot.totalGBP)||gbpPence(slot.totalGBP)>settingsCap(s,slot.hours))throw Error('Checkout exceeds saved payment limit');
 return s;
}
