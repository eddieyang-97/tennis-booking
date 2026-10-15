import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {prepareCheckout,checkoutKey,checkoutCandidate,confirmCheckout,PAYMENT_TEST_SLOT} from './checkout.js';
import {basketTestKey,reconcileClearedSelection} from './checkout.js';
import {candidates} from './core.js';
import {payCheckout} from './payment.js';
const slot={venue:'bethnal-green-gardens',date:'2026-10-20',court:2,start:'20:00',hours:1,totalGBP:'7.00'};
const basket={empty:false,items:[{venue:'Bethnal Green Gardens',court:2,day:20,month:10,hour:20,priceGBP:'7.00'}],totalGBP:'7.00',paymentBoundary:true};
function fixture(){
 let records=[],current={empty:true,items:[]},clicks=0,notices=0;
 return {get records(){return records;},set records(x){records=x;},set current(x){current=x;},get clicks(){return clicks;},get notices(){return notices;},deps:{load:async()=>structuredClone(records),save:async x=>records=structuredClone(x),read:async()=>current,select:async()=>{clicks++;assert.equal(records[0].phase,'selection-dispatched');current=basket;},retain:async()=>42,notify:async()=>notices++}};
}
async function fixed(fn){const now=Date.now;Date.now=()=>Date.parse('2026-10-13T12:00:00Z');try{return await fn();}finally{Date.now=now;}}
test('daytime test searches exactly two morning hours including weekends; recurring defaults stay evening',()=>fixed(()=>{
 const rows=[9,10,20,21].map(hour=>({time:`${hour>12?hour-12:hour}${hour>=12?'pm':'am'}`,inputs:[{disabled:false,label:'Court 2 £2.50'}]}));
 const morning=candidates(rows,'victoria-park','2026-10-17',{basketOnly:true});
 assert.equal(morning.length,1);assert.equal(morning[0].start,'09:00');assert.equal(morning[0].hours,2);assert.equal(morning[0].totalGBP,'5.00');
 assert.deepEqual(candidates(rows,'victoria-park','2026-10-17'),[]);
 assert.ok(candidates(rows,'victoria-park','2026-10-19').every(candidate=>['20:00','21:00'].includes(candidate.start)));
 const s={...morning[0],venue:'victoria-park'};
 assert.doesNotThrow(()=>basketTestKey(s));
 for(const change of [{start:'10:00'},{hours:1},{totalGBP:'14.01'},{date:'2026-10-21'},{court:8}])assert.throws(()=>basketTestKey({...s,...change}));
}));
test('daytime test uses normal selection and exact basket verification, blocks all payment dependencies, then reconciles',()=>fixed(async()=>{
 const s={venue:'victoria-park',date:'2026-10-17',court:2,start:'09:00',hours:2,totalGBP:'5.00'};
 const f=fixture();f.deps.select=async selected=>{assert.deepEqual(selected,s);f.current={empty:false,items:[9,10].map(hour=>({venue:'Victoria Park',court:2,day:17,month:10,hour,priceGBP:'2.50'})),totalGBP:'5.00',paymentBoundary:true};};
 const result=await prepareCheckout(s,f.deps,{basketOnly:true});
 assert.equal(result.status,'basket-test-ready');assert.equal(result.basketVerified,true);assert.equal(result.paymentBlocked,true);assert.equal(f.records[0].basketOnly,true);
 const deps=new Proxy({}, {get(){throw Error('Payment dependency accessed');}});
 await assert.rejects(payCheckout(f.records[0],deps),/cannot submit payment/);
 assert.throws(()=>reconcileClearedSelection(f.records,{empty:false,items:[{}]}),/Remove/);
 assert.equal(reconcileClearedSelection(f.records,{empty:true,items:[]}).checkoutRecords.length,0);
}));
test('partial morning selection retains test intent and exact mismatch without retry',()=>fixed(async()=>{
 const s={venue:'victoria-park',date:'2026-10-17',court:2,start:'09:00',hours:2,totalGBP:'5.00'};
 const f=fixture();f.deps.select=async()=>{f.current={empty:false,items:[{venue:'Victoria Park',court:2,day:17,month:10,hour:9,priceGBP:'2.50'}],totalGBP:'2.50',paymentBoundary:true};throw Error('Lost second hour');};
 await assert.rejects(prepareCheckout(s,f.deps,{basketOnly:true}),/expected 2, observed 1/);
 assert.equal(f.records[0].basketOnly,true);assert.equal(f.records[0].recoveryRequired,true);assert.equal(f.records[0].basketDiagnostic.actualItems,1);
}));
test('checkout retains verified basket and resumes without selection or payment',()=>fixed(async()=>{
 const f=fixture();const result=await prepareCheckout(slot,f.deps);assert.equal(result.status,'awaiting-payment');assert.equal(result.paid,false);assert.equal(result.booked,false);assert.equal(f.clicks,1);assert.equal(f.notices,1);assert.equal(f.records[0].tabId,42);assert.equal(f.records[0].phase,'awaiting-payment');
 await prepareCheckout(slot,f.deps);assert.equal(f.clicks,1);
}));
test('interruption reconciles matching basket; empty pending basket blocks replay',()=>fixed(async()=>{
 const f=fixture();f.records=[{key:checkoutKey(slot),slot,status:'pending',phase:'selection-dispatched'}];f.current=basket;
 await prepareCheckout(slot,f.deps);assert.equal(f.clicks,0);
 f.current={empty:true,items:[]};await assert.rejects(prepareCheckout(slot,f.deps),/inspect payment/);assert.equal(f.clicks,0);assert.equal(f.records[0].status,'pending');
}));
test('preparing a basket cannot erase payment uncertainty or its submission marker',()=>fixed(async()=>{
 for(const marker of [{phase:'payment-dispatched'},{phase:'payment-uncertain'},{phase:'awaiting-payment',paymentDispatchedAt:'2026-10-13T00:00:00Z'}]) {
  const f=fixture();f.current=basket;f.records=[{key:checkoutKey(slot),slot,status:'pending',...marker}];await assert.rejects(prepareCheckout(slot,f.deps),/receipt reconciliation/);assert.equal(f.clicks,0);assert.deepEqual(f.records[0].phase,marker.phase);
 }
}));
test('unrelated basket, confirmed date and another checkout prevent selection',()=>fixed(async()=>{
 const f=fixture();f.current={...basket,totalGBP:'8.00'};await assert.rejects(prepareCheckout(slot,f.deps),/Existing basket/);
 f.records=[{key:'other',slot:{...slot,court:3},status:'confirmed'}];await assert.rejects(prepareCheckout(slot,f.deps),/already confirmed/);
 f.records=[{key:'other',slot:{...slot,date:'2026-10-21'},status:'pending'}];await assert.rejects(prepareCheckout(slot,f.deps),/Another checkout/);assert.equal(f.clicks,0);
}));
test('lost selection response reconciles exact basket; partial selection stays pending',()=>fixed(async()=>{
 const f=fixture();f.deps.select=async()=>{f.current=basket;throw Error('Disconnected');};await prepareCheckout(slot,f.deps);assert.equal(f.records[0].phase,'awaiting-payment');
 const g=fixture();g.deps.select=async()=>{g.current=basket;throw Error('Disconnected');};await assert.rejects(prepareCheckout({...slot,hours:2,totalGBP:'14.00'},g.deps),/item count/);assert.equal(g.records[0].phase,'selection-dispatched');assert.equal(g.notices,0);
}));
test('candidate respects venue priority and caps; daytime exception is exact',()=>fixed(()=>{
 assert.throws(()=>checkoutKey({...slot,totalGBP:'7.01'}),/price limit/);assert.throws(()=>checkoutKey({...slot,hours:2,totalGBP:'14.01'}),/price limit/);
 const results=[{venue:'bethnal-green-gardens',candidates:[{...slot,totalGBP:'8.00'},slot]},{venue:'victoria-park',candidates:[{...slot,totalGBP:'5.00'}]}];assert.equal(checkoutCandidate(results).venue,'bethnal-green-gardens');
 assert.doesNotThrow(()=>checkoutKey(PAYMENT_TEST_SLOT,true));assert.throws(()=>checkoutKey({...PAYMENT_TEST_SLOT,court:3},true),/Unauthorized/);assert.throws(()=>checkoutKey(PAYMENT_TEST_SLOT),/recurring/);
}));
test('adopt exact test basket without clicks; confirmation requires matching paid receipt',()=>fixed(async()=>{
 const f=fixture();f.current={...basket,items:[{venue:'Victoria Park',court:2,day:17,month:10,hour:7,priceGBP:'2.50'}],totalGBP:'2.50'};
 await prepareCheckout(PAYMENT_TEST_SLOT,f.deps,{test:true,adopt:true});assert.equal(f.clicks,0);
 const record=f.records[0];assert.throws(()=>confirmCheckout(record,{status:'awaiting-payment'}),/matching/);assert.throws(()=>confirmCheckout(record,{status:'confirmed',key:'other',reference:'123'}),/matching/);assert.equal(confirmCheckout(record,{status:'confirmed',key:record.key,reference:'123'}).status,'confirmed');
}));
test('receipt reader rejects provisional and mismatched details without reading card inputs',()=>{
 const source=fs.readFileSync(new URL('./checkout-content.js',import.meta.url),'utf8');
 function read(text,heading='Booking confirmation'){
  const context={chrome:{runtime:{onMessage:{addListener:()=>{}}}},location:{origin:'https://tennistowerhamlets.com',pathname:'/basket/confirmation'},document:{querySelector:q=>q==='h1'?{textContent:heading}:null,body:{innerText:text}},Intl,Date};vm.runInNewContext(source,context);context.slot=slot;context.key='exact';return vm.runInNewContext('checkoutReceipt(slot,key)',context);
 }
 const receipt='Payment received\nBooking reference: 123\nBethnal Green Gardens Court 2\n20th October 2026\n8:00pm\nDuration: 1 hour\nTotal: £7.00';
 assert.equal(read(receipt).status,'confirmed');assert.equal(read(receipt+' provisional booking').status,'awaiting-payment');assert.throws(()=>read(receipt.replace('£7.00','£8.00')),/not verified/);assert.throws(()=>read(receipt.replace('Court 2','Court 3')),/not verified/);assert.equal(read(receipt,'Basket checkout').status,'awaiting-payment');
});
