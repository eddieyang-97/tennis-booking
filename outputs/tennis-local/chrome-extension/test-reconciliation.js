import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {reconcilePaid,recoveryIdentity} from './reconciliation.js';
import {payCheckout} from './payment.js';
import {PAYMENT_TEST_SLOT,confirmCheckout} from './checkout.js';
const slot=PAYMENT_TEST_SLOT,key=JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]);
const record={slot,test:true,key,reference:'100001',status:'pending',phase:'payment-uncertain',paymentDispatchedAt:'2026-10-13T00:00:00Z'};
const source=fs.readFileSync(new URL('./checkout-content.js',import.meta.url),'utf8');
const row=['Tue 13th Oct','PT100001','Confirmed','','£2.50','Paid ✔'];
function purchase(rows=[row],headers=['Date','Ref','State','Info','Value',''],path='/account'){
 let listener,reads=0;
 const node=text=>({textContent:text});
 const table={querySelectorAll:q=>q==='th'?headers.map(node):rows.map(cells=>({querySelectorAll:q=>{assert.equal(q,'td');return cells.map(node);}}))};
 const context={location:{origin:'https://tennistowerhamlets.com',pathname:path},document:{querySelector:q=>{assert.equal(q,'h1');reads++;return node('Welcome back, Test');},querySelectorAll:q=>{assert.equal(q,'table');reads++;return [table];}},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}}};
 vm.runInNewContext(source,context);
 return {get reads(){return reads;},send(overrides={},id='own'){let result;listener({kind:'purchase-read',slot,key,reference:record.reference,paymentDispatchedAt:record.paymentDispatchedAt,...overrides},{id},r=>result=r);return result;}};
}
test('account purchase confirms exact PT reference and amount after cancellation without claiming active booking',()=>{
 const result=purchase().send();assert.equal(result.ok,true);assert.equal(result.value.reference,'100001');assert.equal(result.value.bookingState,'unknown');assert.equal(result.value.source,'account-purchase');
 const confirmed=confirmCheckout(record,result.value);assert.equal(confirmed.status,'confirmed');assert.equal(confirmed.paymentDispatchedAt,record.paymentDispatchedAt);assert.equal(confirmed.bookingState,'unknown');
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
