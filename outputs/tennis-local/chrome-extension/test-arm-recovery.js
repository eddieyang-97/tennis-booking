import test from 'node:test';import assert from 'node:assert/strict';
import {retireAttempts,isRetiredAttempt,pendingAttempts,assertFreshPlayingDate} from './attempt-history.js';
import {slotKey,releaseAt} from './core.js';
const now=Date.parse('2026-11-02T12:00:00Z'),day='2026-11-10';
const slot={venue:'bethnal-green-gardens',date:'2026-11-09',court:1,start:'21:00',hours:1,totalGBP:'7.00'};
const record=(patch={})=>({slot,key:slotKey(slot),test:false,status:'pending',phase:'free-booking-dispatched',freeBookingDispatchedAt:'2026-11-02T00:00:20Z',paymentDispatchedAt:'2026-11-02T00:00:20Z',...patch});
test('Arm retires old attempts without rewriting outcome, authorization or submission evidence',()=>{
 for(const patch of [{},{phase:'discount-dispatched',discountDispatchedAt:'intent'},{phase:'card-filling',cardFillDispatchedAt:null},{phase:'manual-payment-reported',manualPaymentReportedAt:'intent',reference:'100001',priorReferences:[{reference:'100000'}]},{checkoutTestOnly:true,phase:'checkout-test-opening'}]){
  const original=record(patch),before=structuredClone(original),[retired]=retireAttempts([original],day,now);
  assert.equal(isRetiredAttempt(retired,now),true);const {runRetirement,...journal}=retired;assert.deepEqual(journal,before);assert.deepEqual(original,before);
  assert.deepEqual(pendingAttempts([retired],now),[]);assert.throws(()=>assertFreshPlayingDate([retired],slot.date,now),/earlier attempt.*unknown/i);
  assert.doesNotThrow(()=>assertFreshPlayingDate([retired],day,now));assert.deepEqual(retireAttempts([retired],day,now),[retired]);
 }
});
test('Active, malformed, same-date, confirmed and not-yet-released attempts are not silently retired',()=>{
 for(const patch of [{key:'bad'},{status:'unknown'},{status:'confirmed'},{slot:{...slot,date:day}},{slot:{...slot,court:99}},{slot:{...slot,totalGBP:'NaN'}}]){
  const r=record(patch);assert.deepEqual(retireAttempts([r],day,now),[r]);assert.equal(isRetiredAttempt(r,now),false);
 }
 const active=record();assert.deepEqual(retireAttempts([active],day,releaseAt(slot.date)+59999),[active]);
 for(const bad of [{reason:'cancelled'},{at:'bad'},{nextDay:slot.date},{at:'2026-11-01T12:00:00Z'},{nextDay:'2026-02-30'}]){
  const [retired]=retireAttempts([active],day,now);retired.runRetirement={...retired.runRetirement,...bad};assert.equal(isRetiredAttempt(retired,now),false);assert.equal(pendingAttempts([retired],now).length,1);
 }
});
import {readiness} from './readiness.js';
import {prepareCheckout} from './checkout.js';
test('retired journals are visible as unknown history, not unresolved controls or a false resolution',async()=>{
 const retired=retireAttempts([record()],day,now),job={day,when:releaseAt(day),mode:'payment',prepared:true};
 // Readiness uses the same clock as the persisted metadata in this regression.
 const realNow=Date.now;Date.now=()=>now;
 try{
  const view=readiness({checkoutRecords:retired,localCardUnlocked:true,job,version:'simulation'},now);
  assert.equal(view.ready,true);assert.equal(view.recovery.showRecovery,false);assert.match(view.lines.join('\n'),/unknown outcome/);assert.equal(view.armBlocker,'');
  const preview=readiness({checkoutRecords:[record()],localCardUnlocked:true},now,day);assert.equal(preview.summary,'Ready to recover and arm');assert.match(preview.armBlocker,/Click Arm/);
  let reads=0,mutations=0;
  await assert.rejects(prepareCheckout({...slot,court:2},{load:async()=>retired,read:async()=>reads++,select:async()=>mutations++,save:async()=>mutations++}),/earlier attempt.*unknown/i);assert.equal(reads,0);assert.equal(mutations,0);
 }finally{Date.now=realNow;}
});
