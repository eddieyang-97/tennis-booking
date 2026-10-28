import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {payCheckout} from './payment.js';import {reconcilePaid} from './reconciliation.js';
import {receiptResponse} from './test/receipt-fixture.js';import {verifyBasket} from './stage-rules.js';
import {readiness} from './readiness.js';import {pendingArmBlocker} from './booking-settings.js';
const slot={venue:'bethnal-green-gardens',date:'2026-11-04',court:1,start:'21:00',hours:1,totalGBP:'7.00'};
const key=JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]);
const basket={empty:false,items:[{venue:'Bethnal Green Gardens',court:1,day:4,month:11,hour:21,priceGBP:'7.00'}],subtotalGBP:'7.00',discountGBP:'7.00',totalGBP:'0.00',discountApplied:true,paymentBoundary:false,freeBookingBoundary:true};
const record=()=>({key,slot,status:'pending',phase:'awaiting-payment',freeBookingAllowed:true,discountCode:'SYNTHETIC',discountDispatchedAt:'2026-10-28T00:00:20Z',discount:{subtotalGBP:'7.00',discountGBP:'7.00',totalGBP:'0.00'}});
const text='Booking reference: 100001\nBethnal Green Gardens\nCourt 1\nPlaying date: 4 November 2026\nStart time: 9:00pm\nDuration: 1 hour\nTotal: £ free';
const receipt=()=>receiptResponse({kind:'receipt-read',slot:{...slot,totalGBP:'0.00'},key,freeBooking:true},text,'Booking confirmed').value;
async function fixed(fn){const now=Date.now;Date.now=()=>Date.parse('2026-10-28T00:01:00Z');try{return await fn();}finally{Date.now=now;}}
test('free completion persists its irreversible submission hold before one click, never opens/fills/pays',()=>fixed(async()=>{
 let saved,clicks=0;
 const deps={save:async value=>saved=structuredClone(value),verifyBasket:async()=>basket,completeFree:async expected=>{assert.ok(saved.freeBookingDispatchedAt);assert.equal(saved.paymentDispatchedAt,saved.freeBookingDispatchedAt);assert.deepEqual(expected,basket);clicks++;throw Error('Lost acknowledgement');},receipt:async()=>receipt()};
 const result=await payCheckout(record(),deps);assert.equal(result.status,'confirmed');assert.equal(result.receiptSource,'free-booking-receipt');assert.equal(clicks,1);assert.equal(result.slot.totalGBP,'7.00');
 const pending={...saved};await payCheckout(pending,deps);assert.equal(clicks,1);
}));
test('free parser requires exact booking details, explicit zero total and confirmation; metadata is not proof',()=>{
 const request={kind:'receipt-read',slot:{...slot,totalGBP:'0.00'},key,freeBooking:true};
 assert.equal(receipt().freeBooking,true);
 for(const changed of [text.replace('Court 1','Court 2'),text.replace('4 November','5 November'),text.replace('9:00pm','8:00pm'),text.replace('1 hour','2 hours'),text.replace('£ free','£1.00'),text.replace('Bethnal Green Gardens','Victoria Park')])assert.notEqual(receiptResponse(request,changed,'Booking confirmed').value?.status,'confirmed');
 assert.notEqual(receiptResponse(request,text,'Something went wrong').value?.status,'confirmed');
 assert.notEqual(receiptResponse({...request,freeBooking:false},text,'Booking confirmed').value?.status,'confirmed');
});
test('unfamiliar free receipts never fall back to a price-only account row, and generic paid receipts cannot confirm free booking',async()=>{
 const held={...record(),phase:'free-booking-dispatched',freeBookingDispatchedAt:'2026-10-28T00:00:20Z',paymentDispatchedAt:'2026-10-28T00:00:20Z'};let account=0;
 for(const value of [null,{status:'confirmed',key,reference:'100001',source:'account-purchase'}, {...receipt(),reference:'invalid'}, {...receipt(),totalGBP:'7.00'}])await assert.rejects(reconcilePaid(held,{currentReceipt:async()=>value,accountReceipt:async()=>{account++;return receipt();}}),e=>e.reasonCode==='FREE_BOOKING_UNRESOLVED');
 assert.equal(account,0);assert.equal((await reconcilePaid(held,{currentReceipt:async()=>receipt()})).reference,'100001');
});
test('free recovery guidance describes booking uncertainty without inviting manual payment',()=>{
 const held={...record(),freeBookingDispatchedAt:'2026-10-28T00:00:20Z',paymentDispatchedAt:'2026-10-28T00:00:20Z'};
 assert.match(readiness({checkoutRecords:[held]}).lines.join('\n'),/Pending free booking/);assert.match(pendingArmBlocker([held]),/do not submit again or report a card payment/);
});
test('legacy journals, prior opening, unpaid tests and changed free baskets cannot submit',()=>fixed(async()=>{
 let clicks=0;const deps={save:async()=>{},verifyBasket:async()=>basket,completeFree:async()=>clicks++,receipt:async()=>receipt()};
 for(const change of [{freeBookingAllowed:undefined},{checkoutOpenDispatchedAt:'uncertain'},{checkoutTestOnly:true},{basketOnly:true},{reference:'100001'}])await assert.rejects(payCheckout({...record(),...change},deps));
 await assert.rejects(payCheckout(record(),{...deps,verifyBasket:async()=>({...basket,items:[{...basket.items[0],court:2}]})}));assert.equal(clicks,0);
 assert.throws(()=>verifyBasket({...basket,discountGBP:'8.00'},slot,record().discount));
}));
test('free content command revalidates exact snapshot, complete document and unique enabled control before a single click',()=>{
 let listener,response,clicks=0,current=basket;const button={textContent:'Complete my booking',disabled:false,click:()=>clicks++};
 const context={location:{pathname:'/basket'},basketSummary:()=>current,document:{readyState:'complete',querySelectorAll:()=>[button]},chrome:{runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}}};
 vm.runInNewContext(fs.readFileSync(new URL('./payment-content.js',import.meta.url),'utf8'),context);
 const send=()=>{listener({kind:'free-booking-submit',expected:basket},{id:'test'},value=>response=value);return response;};
 current={...basket,totalGBP:'1.00'};assert.equal(send().ok,false);assert.equal(clicks,0);current=basket;context.document.readyState='loading';assert.equal(send().ok,false);context.document.readyState='complete';button.disabled=true;assert.equal(send().ok,false);button.disabled=false;assert.equal(send().ok,true);assert.equal(clicks,1);
});
