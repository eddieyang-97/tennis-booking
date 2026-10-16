import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCheckout,reconcileClearedSelection} from './checkout.js';
import {ensureDiscount} from './discount.js';
import {openVerifiedCheckout,payCheckout} from './payment.js';

const slot={venue:'victoria-park',date:'2026-10-22',court:4,courts:[4,1],start:'12:00',hours:2,totalGBP:'10.00'};
const settings={schemaVersion:1,venues:['victoria-park'],earliestStart:'09:00',latestFinish:'22:00',preferredHours:2,minHours:1,maxTotalGBP:'14.00',maxOneHourGBP:'7.00',allowCourtSwitch:true};
const gross={empty:false,items:[12,13].map((hour,i)=>({venue:'Victoria Park',court:slot.courts[i],day:22,month:10,hour,priceGBP:'5.00'})),subtotalGBP:'10.00',discountGBP:'0.00',totalGBP:'10.00',paymentBoundary:true};

test('unpaid mixed-court flow durably blocks payment, applies discount once and opens exact net checkout',async()=>{
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-16T08:00:00Z');
 let records=[],basket={empty:true,items:[]},selected=0,applied=0,opened=0;
 try{
  const deps={load:async()=>records,save:async r=>records=r,read:async()=>basket,select:async()=>{assert.equal(records[0].checkoutTestOnly,true);selected++;basket=structuredClone(gross);},retain:async()=>42,notify:async()=>{}};
  const result=await prepareCheckout(slot,deps,{settings,checkoutTestOnly:true,discountCode:'TESTCODE'});
  assert.equal(result.status,'checkout-test-prepared');assert.equal(result.paymentBlocked,true);
  await assert.rejects(prepareCheckout(slot,deps,{settings}),/reconciliation/);
  let record=await ensureDiscount(records[0],{save:async r=>records=[r],read:async()=>basket,apply:async()=>{assert.ok(records[0].discountDispatchedAt);applied++;basket={...basket,discountApplied:true,discountGBP:'2.50',totalGBP:'7.50'};}});
  const openDeps={current:async()=>({url:'https://tennistowerhamlets.com/basket'}),read:async()=>basket,save:async r=>records=[r],command:async request=>{assert.equal(request.kind,'payment-open');assert.ok(records[0].checkoutOpenDispatchedAt);opened++;throw Error('Checkout response unavailable');},state:async()=>({totalGBP:'7.50',reference:'100001',enabled:false})};
  const checked=await openVerifiedCheckout(record,openDeps);record=checked.record;
  assert.equal(checked.page.totalGBP,'7.50');assert.equal(selected,1);assert.equal(applied,1);assert.equal(opened,1);
  await assert.rejects(payCheckout(record,new Proxy({},{get(){throw Error('Payment dependency accessed');}})),/Unpaid test cannot submit/);
  await assert.rejects(openVerifiedCheckout(record,openDeps),/unresolved/);assert.equal(opened,1);
  const resumed=await openVerifiedCheckout(record,{...openDeps,current:async()=>({url:'https://tennistowerhamlets.com/basket/pay/card'})});
  assert.equal(resumed.page.reference,'100001');assert.equal(opened,1);
 }finally{Date.now=originalNow;}
});

test('checkout opening rejects changed route, basket, amount and payment markers',async()=>{
 const record={slot,checkoutTestOnly:true};
 const deps={current:async()=>({url:'https://tennistowerhamlets.com/basket'}),read:async()=>gross,save:async()=>{},command:async()=>{},state:async()=>({totalGBP:'10.00',reference:'100001'})};
 await assert.rejects(openVerifiedCheckout(record,{...deps,current:async()=>({url:'https://example.com/basket'})}),/changed/);
 await assert.rejects(openVerifiedCheckout(record,{...deps,read:async()=>({...gross,items:[]})}));
 await assert.rejects(openVerifiedCheckout(record,{...deps,state:async()=>({totalGBP:'14.00',reference:'100001'})}),/amount/);
 for(const marker of ['paymentDispatchedAt','manualPaymentReportedAt'])await assert.rejects(openVerifiedCheckout({...record,[marker]:'2026-10-16T08:00:00Z'},deps),/reconciliation/);
});

test('reference-bearing unpaid test cleanup requires explicit attestation and never clears payment markers',()=>{
 const record={slot,status:'pending',checkoutTestOnly:true,phase:'checkout-test-ready',reference:'100001'};
 const empty={empty:true,items:[]},options={unpaidTestConfirmed:true};
 assert.throws(()=>reconcileClearedSelection([record],empty),/preserve payment/);
 assert.equal(reconcileClearedSelection([record],empty,options).checkoutRecords.length,0);
 assert.throws(()=>reconcileClearedSelection([{...record,checkoutTestOnly:false}],empty,options));
 for(const marker of ['paymentDispatchedAt','manualPaymentReportedAt'])assert.throws(()=>reconcileClearedSelection([{...record,[marker]:'2026-10-16T08:00:00Z'}],empty,options));
 assert.throws(()=>reconcileClearedSelection([record],gross,options),/Remove/);
});
