import test from 'node:test';import assert from 'node:assert/strict';
import {PAYMENT_TEST_SLOT} from './checkout.js';
import {prepareCheckout} from './checkout.js';
import {payCheckout} from './payment.js';
import {verifyBasket} from './stage-rules.js';
test('two-hour MVP flow selects once, fills once, dispatches once and confirms from account history',async()=>{
 const now=Date.now;Date.now=()=>Date.parse('2026-10-13T00:00:00Z');
 const slot={venue:'victoria-park',date:'2026-10-20',court:2,start:'20:00',hours:2,totalGBP:'10.00'};
 const basket={empty:false,items:[20,21].map(hour=>({venue:'Victoria Park',court:2,day:20,month:10,hour,priceGBP:'5.00'})),totalGBP:'10.00',paymentBoundary:true};
 let records=[],current={empty:true,items:[]},selects=0,fills=0,submits=0;
 try {
  const prepared=await prepareCheckout(slot,{load:async()=>records,save:async r=>records=r,read:async()=>current,select:async()=>{selects++;current=basket;},retain:async()=>42,notify:async()=>{}});
  assert.equal(prepared.status,'awaiting-payment');
  const deps={save:async r=>records=[r],verifyBasket:async()=>verifyBasket(current,slot),open:async()=>{},state:async()=>({enabled:fills>0,totalGBP:slot.totalGBP,reference:'100003'}),fillCard:async()=>fills++,waitCardReady:async()=>({enabled:true,totalGBP:slot.totalGBP,reference:'100003'}),submit:async()=>{assert.ok(records[0].paymentDispatchedAt);submits++;},receipt:async()=>({status:'confirmed',key:records[0].key,reference:'100003',source:'account-purchase',bookingState:'unknown'})};
  records=[await payCheckout(records[0],deps)];
  assert.equal(records[0].status,'confirmed');assert.ok(records[0].basketVerifiedAt);assert.equal(selects,1);assert.equal(fills,1);assert.equal(submits,1);
  await assert.rejects(payCheckout(records[0],deps),/No pending/);assert.equal(submits,1);
 }finally{Date.now=now;}
});
test('worker reconciles old paid journal with closed tab and locked card before arming a new payment job',async()=>{
 const key=JSON.stringify(['victoria-park','2026-10-17',2,'07:00',1]);
 const state={checkoutRecords:[{slot:PAYMENT_TEST_SLOT,key,test:true,reference:'100001',tabId:9,status:'pending',phase:'payment-uncertain',paymentDispatchedAt:'2026-10-13T00:00:00Z'}]};
 let listener,sessionReads=0,mutations=0,accountReads=0;const alarms=[];
 const local={get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,state[k]])),set:async values=>Object.assign(state,structuredClone(values)),remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete state[k];}};
 const runtime={id:'own',getURL:path=>'chrome-extension://own/'+path,onMessage:{addListener:f=>listener=f},onStartup:{addListener(){}},onInstalled:{addListener(){}}};
 const oldChrome=globalThis.chrome,oldNow=Date.now;
 globalThis.chrome={runtime,storage:{local,session:{get:async()=>{sessionReads++;return {};}}},tabs:{get:async id=>{if(id===9)throw Error('No tab with id');return {id,url:'https://tennistowerhamlets.com/account',status:'complete'};},create:async()=>({id:10}),remove:async()=>{},sendMessage:async(id,request)=>{
  assert.equal(request.kind,'purchase-read');accountReads++;return {ok:true,value:{status:'confirmed',key,reference:'100001',source:'account-purchase',bookingState:'unknown'}};
 },update:async()=>mutations++,onUpdated:{addListener(){},removeListener(){}}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},notifications:{onClicked:{addListener(){}},create:async()=>{}},alarms:{onAlarm:{addListener(){}},clear:async()=>{},create:async(...args)=>alarms.push(args)}};
 Date.now=()=>Date.parse('2026-10-13T00:00:00Z');
 try {
  await import('./background.js');
  const send=kind=>new Promise(resolve=>listener({kind,day:'2026-10-21'},{id:'own',url:'chrome-extension://own/popup.html'},resolve));
  const result=await send('verifyPayment');assert.equal(result.paid,true);assert.equal(result.booked,null);assert.equal(accountReads,1);assert.equal(sessionReads,0);assert.equal(mutations,0);
  assert.equal(state.checkoutRecords[0].status,'confirmed');assert.ok(state.checkoutRecords[0].paymentDispatchedAt);assert.equal(state.runHistory.at(-1).status,'confirmed');
  const locked=await send('armPayment');assert.equal(locked.error,'Local card is locked. Open card setup, unlock the encrypted file, then close setup and return to checkout. No Link payment was attempted.');assert.equal(alarms.length,0);
  globalThis.chrome.storage.session.get=async()=>({localPaymentCard:{number:'4242424242424242',expiry:'12/30',cvc:'123',postcode:'E1 1AA'}});
  const armed=await send('armPayment');assert.equal(armed.status,'armed');assert.equal(state.job.mode,'payment');assert.equal(alarms.length,2);assert.equal(mutations,0);
  const again=await send('payTest');assert.match(again.error,/Unknown action/);assert.equal(mutations,0);
 }finally{globalThis.chrome=oldChrome;Date.now=oldNow;}
});
