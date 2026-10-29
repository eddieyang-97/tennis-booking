import test from 'node:test';import assert from 'node:assert/strict';
import {recoveryPresentation} from './readiness.js';
const pending={key:'synthetic',status:'pending',test:false,phase:'awaiting-payment'};
const available={result:{status:'complete',results:[{venue:'bethnal-green-gardens',candidates:[{court:1}]}]}};
const view=record=>recoveryPresentation({checkoutRecords:[record],...available});
test('no checkout offers availability/manual preparation, with no irrelevant cleanup or legacy controls',()=>{
 const empty=recoveryPresentation();assert.equal(empty.showRecovery,false);assert.equal(empty.actions.prepareCheckout,false);
 const ready=recoveryPresentation(available);assert.equal(ready.actions.prepareCheckout,true);
 for(const id of ['assessRecovery','verifyPayment','reconcileManualPayment','resetUnpaidTest','reconcileSelection','reconcileBasket','resume','reset','payCheckout'])assert.equal(ready.actions[id],false,id);
});
test('unsubmitted normal checkout separates mutation controls from read-only/manual reconciliation',()=>{
 const v=view(pending);assert.equal(v.actions.payCheckout,true);assert.equal(v.actions.prepareCheckout,true);assert.equal(v.actions.reconcileSelection,true);assert.equal(v.actions.reconcileManualPayment,true);assert.equal(v.actions.verifyPayment,false);assert.equal(v.actions.resetUnpaidTest,false);
});
test('discount observation uses continuation, while unsupported free slots expose no automatic submit',()=>{
 const discounted={...pending,discountDispatchedAt:'saved',discount:{totalGBP:'5.00'}};
 assert.equal(view(discounted).actions.prepareCheckout,false);assert.equal(view(discounted).actions.payCheckout,true);
 const free={...discounted,discount:{totalGBP:'0.00'},slot:{court:1,courts:[1,2]},freeBookingAllowed:true};
 assert.equal(view(free).actions.payCheckout,false);assert.equal(view({...free,slot:{court:1},freeBookingAllowed:false}).actions.payCheckout,false);
 assert.equal(view({...free,slot:{court:1},freeBookingAllowed:true}).actions.payCheckout,true);
});
test('payment/free/card-fill uncertainty never offers submit, prepare, cleanup or cleared-selection actions',()=>{
 for(const change of [{paymentDispatchedAt:'submitted'},{manualPaymentReportedAt:'reported'},{freeBookingDispatchedAt:'submitted'},{cardFillDispatchedAt:'interrupted'},{cardFillRecoveryRequired:true},{paymentDispatchedAt:null},{phase:'payment-uncertain'},{phase:'card-filling'}]){
  const r={...pending,...change},before=structuredClone(r),v=view(r);
  for(const id of ['payCheckout','prepareCheckout','resetUnpaidTest','reconcileSelection'])assert.equal(v.actions[id],false,JSON.stringify({change,id}));
  assert.equal(v.actions.verifyPayment,true);assert.equal(v.actions.assessRecovery,true);assert.deepEqual(r,before);
 }
 const free=view({...pending,freeBookingDispatchedAt:'submitted',discount:{totalGBP:'0.00'}});assert.equal(free.actions.reconcileManualPayment,false);assert.match(free.help,/never submit/);
});
test('unpaid test, legacy basket-only and malformed/unknown journals retain appropriate inspection paths',()=>{
 const test=view({...pending,checkoutTestOnly:true});assert.equal(test.actions.resetUnpaidTest,true);assert.equal(test.actions.reconcileSelection,true);assert.equal(test.actions.unpaidTestConfirmed,false);assert.equal(test.actions.payCheckout,false);
 const opened=view({...pending,checkoutTestOnly:true,phase:'checkout-test-opening',checkoutOpenDispatchedAt:'opening'});assert.equal(opened.actions.unpaidTestConfirmed,true);assert.equal(opened.actions.resetUnpaidTest,true);
 const partial=view({...pending,basketOnly:true});assert.equal(partial.actions.reconcileSelection,true);assert.equal(partial.actions.payCheckout,false);assert.equal(partial.actions.reconcileManualPayment,false);
 const unknown=view({...pending,phase:'unknown'});assert.equal(unknown.actions.assessRecovery,true);assert.equal(unknown.actions.payCheckout,false);assert.equal(unknown.actions.reconcileSelection,false);
 const legacy=recoveryPresentation({basketTest:{status:'pending'}});assert.equal(legacy.showRecovery,true);assert.equal(legacy.actions.reconcileBasket,true);
 assert.equal(recoveryPresentation({basketTest:{status:'cleared'}}).actions.reconcileBasket,false);
});
test('armed/interrupted runs pause manual actions, while retained-tab and lock controls are contextual',()=>{
 for(const state of [{job:{mode:'payment'}},{running:{day:'2026-11-05'}}]){
  const v=recoveryPresentation({...available,...state,checkoutRecords:[pending]});assert.equal(v.paused,true);assert.equal(v.actions.payCheckout,false);assert.equal(v.actions.prepareCheckout,false);assert.equal(v.testAvailable,false);assert.equal(v.actions.assessRecovery,true);
 }
 assert.equal(recoveryPresentation({result:{retainedTabId:42}}).actions.resume,true);assert.equal(recoveryPresentation({running:{day:'2026-11-05'}}).actions.reset,true);
 const multiple=recoveryPresentation({checkoutRecords:[pending,{...pending,key:'other'}]});assert.equal(multiple.actions.assessRecovery,true);for(const id of ['prepareCheckout','payCheckout','resetUnpaidTest','reconcileSelection','reconcileManualPayment'])assert.equal(multiple.actions[id],false,id);
 const confirmed=recoveryPresentation({checkoutRecords:[{...pending,status:'confirmed',paymentDispatchedAt:'preserved'}]});assert.equal(confirmed.showRecovery,false);
});
