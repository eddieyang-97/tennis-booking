import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {reconcilePaid,recoveryIdentity,reportManualPayment} from './reconciliation.js';
import {payCheckout} from './payment.js';
import {PAYMENT_TEST_SLOT,confirmCheckout} from './checkout.js';
import {slotKey} from './core.js';
import {paymentCard} from './card-vault-core.js';
const slot=PAYMENT_TEST_SLOT,key=JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]);
const record={slot,test:true,key,reference:'100001',status:'pending',phase:'payment-uncertain',paymentDispatchedAt:'2026-10-13T00:00:00Z'};
const source=fs.readFileSync(new URL('./checkout-content.js',import.meta.url),'utf8');
const row=['Tue 13th Oct','PT100001','Confirmed','','£2.50','Paid ✔'];
function purchase(rows=[row],headers=['Date','Ref','State','Info','Value',''],path='/account',readyState='complete'){
 let listener,reads=0;
 const node=text=>({textContent:text});
 const table={querySelectorAll:q=>q==='th'?headers.map(node):rows.map(cells=>({querySelectorAll:q=>{assert.equal(q,'td');return cells.map(node);}}))};
 const context={location:{origin:'https://tennistowerhamlets.com',pathname:path},document:{readyState,querySelector:q=>{assert.equal(q,'h1');reads++;return node('Welcome back, Test');},querySelectorAll:q=>{assert.equal(q,'table');reads++;return [table];}},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}}};
 vm.runInNewContext(source,context);
 return {get reads(){return reads;},send(overrides={},id='own'){let result;listener({kind:'purchase-read',slot,key,reference:record.reference,paymentDispatchedAt:record.paymentDispatchedAt,...overrides},{id},r=>result=r);return result;}};
}
test('account purchase confirms exact PT reference and amount after cancellation without claiming active booking',()=>{
 const result=purchase().send();assert.equal(result.ok,true);assert.equal(result.value.reference,'100001');assert.equal(result.value.bookingState,'unknown');assert.equal(result.value.source,'account-purchase');
 const confirmed=confirmCheckout(record,result.value);assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.paymentDispatchedAt,record.paymentDispatchedAt);assert.equal(confirmed.bookingState,'unknown');
});
test('test reset requires explicit Pending / Pay purchase evidence, never absent or paid history',()=>{
 const overrides={kind:'test-purchase-state',paymentDispatchedAt:undefined};
 const pending=[row[0],row[1],'Pending','2 courts','£2.50','Pay £2.50'];
 assert.equal(purchase([pending]).send(overrides).value.status,'unpaid');
 for(const rows of [[],[row],[pending,pending],[[...pending.slice(0,5),'Processing']],[[...pending.slice(0,4),'£7.00',pending[5]]]])assert.equal(purchase(rows).send(overrides).ok,false);
 assert.equal(purchase([pending],undefined,'/verify-human').send(overrides).humanRequired,true);
 const loading=purchase([],undefined,'/account','loading');assert.equal(loading.send(overrides).notReady,true);assert.equal(loading.reads,0);
 assert.match(purchase([]).send(overrides).error,/reference 100001: observed 0 matches/);
});
test('mixed-court paid history binds the complete hourly-court key and supports historical recovery',()=>{
 const mixed={venue:'victoria-park',date:'2026-10-20',court:2,courts:[2,3],start:'20:00',hours:2,totalGBP:'10.00'},mixedKey=slotKey(mixed);
 const read=purchase([[row[0],row[1],row[2],'','£10.00',row[5]]]).send({slot:mixed,key:mixedKey});assert.equal(read.ok,true);
 assert.equal(recoveryIdentity({...record,test:false,slot:mixed,key:mixedKey}).key,mixedKey);
 assert.equal(purchase().send({slot:mixed,key}).ok,false);
});
test('account history rejects ambiguous, unpaid, mismatched and unknown layouts',()=>{
 for(const rows of [[row,row],[[...row.slice(0,4),'£7.00',row[5]]],[[...row.slice(0,5),'Unpaid']],[[row[0],row[1],'Pending',...row.slice(3)]],[[row[0],'PT100002',...row.slice(2)]],[]])assert.equal(purchase(rows).send().ok,false);
 assert.equal(purchase([row],['Reference']).send().ok,false);
 assert.equal(purchase().send({paymentDispatchedAt:undefined}).ok,false);assert.equal(purchase().send({key:'other'}).ok,false);
 assert.equal(purchase().send({},'other'),undefined);
 const blocked=purchase([row],undefined,'/verify-human');assert.equal(blocked.send().humanRequired,true);assert.equal(blocked.reads,0);
});
test('stale checkout tab falls back to purchase history without navigation or a second charge',async()=>{
 let account=0,submit=0;const receipt=purchase().send().value;
 const deps={currentReceipt:async()=>{throw Error('No tab with id');},accountReceipt:async()=>{account++;return receipt;}};
 const output=await payCheckout(record,{receipt:()=>reconcilePaid(record,deps),submit:async()=>submit++});
 assert.equal(output.status,'confirmed');assert.equal(account,1);assert.equal(submit,0);
});
test('historical payment recovery works after booking window expires; corrupt journals cannot query history',async()=>{
 const now=Date.now;Date.now=()=>Date.parse('2027-01-01T00:00:00Z');try{assert.equal(recoveryIdentity(record),record);}finally{Date.now=now;}
 for(const changed of [{key:'other'},{reference:'PT100001'},{paymentDispatchedAt:null},{slot:{...slot,totalGBP:'0.00'}},{slot:{...slot,court:3}}]){
  let reads=0;await assert.rejects(reconcilePaid({...record,...changed},{currentReceipt:async()=>reads++,accountReceipt:async()=>reads++}));assert.equal(reads,0);
 }
});
test('unverified purchase remains unresolved and never reopens or refills checkout',async()=>{
 let mutations=0;await assert.rejects(payCheckout(record,{receipt:()=>reconcilePaid(record,{currentReceipt:async()=>null,accountReceipt:async()=>{throw Error('Unpaid');}}),open:async()=>mutations++,fillCard:async()=>mutations++,submit:async()=>mutations++}),/Unpaid/);assert.equal(mutations,0);
});
function normalPending(){const s={venue:'victoria-park',date:'2026-10-20',court:2,start:'20:00',hours:1,totalGBP:'2.50'};return {slot:s,key:slotKey(s),test:false,status:'pending',phase:'checkout-opening',tabId:42};}
test('manual report records a distinct durable hold and only matching paid history can confirm it',async()=>{
 const pending=normalPending(),reported=reportManualPayment(pending,' PT100001 ');
 assert.equal(reported.phase,'manual-payment-reported');assert.ok(reported.manualPaymentReportedAt);assert.equal(reported.paymentDispatchedAt,undefined);assert.equal(pending.reference,undefined);assert.equal(reported.reference,'100001');
 const receipt=purchase().send({slot:reported.slot,key:reported.key,paymentDispatchedAt:undefined,manualPaymentReportedAt:reported.manualPaymentReportedAt});assert.equal(receipt.ok,true);
 let mutations=0;const result=await payCheckout(reported,{receipt:()=>reconcilePaid(reported,{currentReceipt:async()=>null,accountReceipt:async()=>receipt.value}),open:async()=>mutations++,fillCard:async()=>mutations++,submit:async()=>mutations++});
 assert.equal(result.status,'confirmed');assert.equal(result.paymentDispatchedAt,undefined);assert.ok(result.manualPaymentReportedAt);assert.equal(mutations,0);
 assert.equal(await paymentCard({session:{get:async()=>{throw Error('Must not read card');}}},reported),null);
 assert.throws(()=>reportManualPayment(reported,'100002'),/differs/);
 assert.equal(reportManualPayment(reported,'100001').manualPaymentReportedAt,reported.manualPaymentReportedAt);
 for(const change of [{test:true},{basketOnly:true},{status:'confirmed'},{paymentDispatchedAt:'timestamp'},{key:'wrong'}])assert.throws(()=>reportManualPayment({...pending,...change},'100001'));
 for(const reference of ['', 'text','123 456',null])assert.throws(()=>reportManualPayment(pending,reference));
});
test('failed manual reconciliation remains protected and never opens or submits checkout',async()=>{
 const reported=reportManualPayment(normalPending(),'100001');let mutations=0;
 await assert.rejects(payCheckout(reported,{receipt:()=>reconcilePaid(reported,{currentReceipt:async()=>null,accountReceipt:async()=>{throw Error('No matching paid purchase');}}),open:async()=>mutations++,submit:async()=>mutations++}),/No matching/);assert.equal(mutations,0);
 const wrong=purchase().send({slot:reported.slot,key:reported.key,reference:'100002',paymentDispatchedAt:undefined,manualPaymentReportedAt:reported.manualPaymentReportedAt});assert.equal(wrong.ok,false);
 assert.equal(purchase().send({paymentDispatchedAt:undefined,manualPaymentReportedAt:'invalid'}).ok,false);
});
test('manual recovery endpoint reads account only, confirms without card access, and preserves the original journal',async()=>{
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-13T12:00:00Z');
 const pending=normalPending(),state={checkoutRecords:[pending]};let listener,created=0;
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value))},session:{get:async()=>{throw Error('Card access forbidden');}}},action:{setBadgeText:async()=>{}},notifications:{create:async()=>{},onClicked:{addListener:()=>{}}},alarms:{onAlarm:{addListener:()=>{}}},runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,getManifest:()=>({version:'0.8.1'}),onMessage:{addListener:fn=>listener=fn},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},tabs:{get:async id=>{if(id===42)throw Error('No tab with id');return {id,url:'https://tennistowerhamlets.com/account',status:'complete'};},create:async({url})=>{assert.equal(url,'https://tennistowerhamlets.com/account');created++;return {id:43};},remove:async()=>{},sendMessage:async(id,request)=>{assert.equal(id,43);assert.equal(request.kind,'purchase-read');assert.ok(request.manualPaymentReportedAt);assert.equal(request.paymentDispatchedAt,undefined);return purchase().send(request);}}};
 try{
  await import('./background.js');const send=message=>new Promise(resolve=>listener(message,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  const old=await send({kind:'verifyPayment'});assert.equal(old.status,'stopped');assert.match(old.error,/paid manually/);assert.equal(old.paid,null);assert.equal(created,0);
  const future=await send({kind:'armPayment',day:'2026-10-24'});
  assert.equal(future.status,'stopped');assert.equal(future.errorCode,'UNRESOLVED_CHECKOUT');assert.match(future.error,/2026-10-24 has not released yet/);assert.match(future.error,/checkout for 2026-10-20/);assert.match(future.error,/Verify manual payment/);assert.equal(state.job,undefined);assert.equal(created,0);
  const result=await send({kind:'reconcileManualPayment',reference:'100001'});assert.equal(result.status,'confirmed');assert.equal(result.paid,true);assert.equal(result.manualPayment,true);assert.equal(result.booked,null);assert.equal(created,1);assert.equal(state.checkoutRecords[0].paymentDispatchedAt,undefined);assert.equal(state.checkoutRecords[0].phase,'receipt-verified');
 }finally{delete globalThis.chrome;Date.now=originalNow;}
});
