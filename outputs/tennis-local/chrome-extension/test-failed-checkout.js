import test from 'node:test';import assert from 'node:assert/strict';
import {failedCheckoutIdentity} from './booking-settings.js';
import {archiveFailedCheckout} from './checkout.js';
import {readiness} from './readiness.js';
const slot={venue:'bethnal-green-gardens',date:'2026-10-27',court:1,start:'20:00',hours:2,totalGBP:'14.00'};
const record=()=>({key:JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]),slot:{...slot},status:'pending',test:false,phase:'checkout-opening',checkoutOpenDispatchedAt:'2026-10-19T23:00:43.055Z',basketVerifiedAt:'2026-10-19T23:00:42.461Z'});
const empty={empty:true,items:[]};
test('ordinary reference-less checkout opening can be archived only with current owner attestation and empty basket',()=>{
 const current=record(),confirmed={status:'confirmed',paymentDispatchedAt:'preserved',reference:'100001'},records=[confirmed,current],before=structuredClone(records);
 const options={noPaymentConfirmed:true,attestationIdentity:failedCheckoutIdentity(records)};
 const result=archiveFailedCheckout(records,empty,options);
 assert.deepEqual(records,before);assert.deepEqual(result.checkoutRecords,[confirmed]);
 assert.equal(result.abandoned.phase,'checkout-opening');assert.equal(result.abandoned.checkoutOpenDispatchedAt,current.checkoutOpenDispatchedAt);
 assert.equal(result.abandoned.abandonmentEvidence.basis,'owner-attested-failed-checkout-no-payment');
 assert.equal(result.abandoned.abandonmentEvidence.merchantPaymentState,'unknown');assert.equal(result.abandoned.abandonmentEvidence.merchantCancellationState,'unknown');
 assert.throws(()=>archiveFailedCheckout(records,empty,{}),/confirm|confirmation/i);
 assert.throws(()=>archiveFailedCheckout(records,empty,{...options,attestationIdentity:'stale'}),/changed|stale/i);
 for(const basket of [null,{empty:true},{empty:false,items:[]},{empty:true,items:[{}]}])assert.throws(()=>archiveFailedCheckout(records,basket,options),/empty/i);
 const view=readiness({checkoutRecords:records});assert.match(view.failedCheckoutGuide,/does not establish/i);assert.match(view.armBlocker,/Archive failed checkout/);assert.equal(view.ready,false);
});
test('references, possible card filling/payment, ambiguous records and invalid identities never qualify',()=>{
 const original=record();
 const patches=[{test:true},{test:undefined},{checkoutTestOnly:true},{basketOnly:true},{status:'abandoned'},{phase:'card-filling'},{phase:'awaiting-payment'},{checkoutOpenDispatchedAt:null},{checkoutOpenDispatchedAt:'invalid'},{key:'wrong'},{slot:{...slot,date:'2026-02-30'}},{slot:{...slot,court:9}},{slot:{...slot,hours:3}},{slot:{...slot,totalGBP:'0.00'}},{slot:{...slot,start:'23:00'}}];
 for(const name of ['reference','priorReferences','paymentDispatchedAt','manualPaymentReportedAt','cardFillDispatchedAt','cardFillRecoveryRequired'])for(const value of [null,false,'',[],'evidence'])patches.push({[name]:value});
 for(const patch of patches){const records=[{...original,...patch}],before=structuredClone(records);assert.equal(failedCheckoutIdentity(records),'',JSON.stringify(patch));assert.throws(()=>archiveFailedCheckout(records,empty,{noPaymentConfirmed:true,attestationIdentity:'anything'}));assert.deepEqual(records,before);assert.equal(readiness({checkoutRecords:records}).failedCheckoutGuide,'');}
 assert.equal(failedCheckoutIdentity([original,{...original,key:'another'}]),'');
});
