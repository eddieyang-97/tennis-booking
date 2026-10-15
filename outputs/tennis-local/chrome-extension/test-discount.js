import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {ensureDiscount,verifiedDiscount,payableSlot,normalizeDiscount} from './discount.js';
import {checkoutKey,prepareCheckout,reconcileClearedSelection} from './checkout.js';import {verifyBasket} from './stage-rules.js';import {payCheckout} from './payment.js';import {recoveryIdentity} from './reconciliation.js';
const slot={venue:'bethnal-green-gardens',date:'2026-10-20',court:1,start:'20:00',hours:2,totalGBP:'14.00'};
const gross={empty:false,items:[20,21].map(hour=>({venue:'Bethnal Green Gardens',court:1,day:20,month:10,hour,priceGBP:'7.00'})),subtotalGBP:'14.00',discountGBP:'0.00',discountApplied:false,totalGBP:'14.00',paymentBoundary:true};
const net={...gross,totalGBP:'11.50',discountGBP:'2.50',discountApplied:true};
const initial=()=>({slot,key:JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]),discountCode:'SAVE-TEST',status:'pending',phase:'awaiting-payment'});
async function fixed(fn){const now=Date.now;Date.now=()=>Date.parse('2026-10-13T12:00:00Z');try{return await fn();}finally{Date.now=now;}}
function fixture(){let saved=initial(),basket=gross,clicks=0;return {get saved(){return saved;},set saved(value){saved=value;},get clicks(){return clicks;},set basket(value){basket=value;},deps:{save:async record=>saved=structuredClone(record),read:async()=>structuredClone(basket),apply:async()=>{clicks++;assert.ok(saved.discountDispatchedAt);basket=net;}}};}
test('code is optional, bounded by the observed merchant field, and preserved in the checkout snapshot',()=>fixed(async()=>{
 assert.equal(normalizeDiscount('  SAVE-TEST  '),'SAVE-TEST');assert.equal(normalizeDiscount(''),'');for(const value of [null,123,'X'.repeat(11),'a b','<code>'])assert.throws(()=>normalizeDiscount(value));
 let records=[],basket={empty:true,items:[]};const deps={load:async()=>records,save:async value=>records=value,read:async()=>basket,select:async()=>{basket=gross;},retain:async()=>42,notify:async()=>{}};
 await prepareCheckout(slot,deps,{discountCode:'SAVE-TEST'});assert.equal(records[0].discountCode,'SAVE-TEST');
 await prepareCheckout(slot,deps,{discountCode:'OTHER'});assert.equal(records[0].discountCode,'SAVE-TEST');
}));
test('discount dispatch is journaled once, exact amounts verified, and restarts never reapply',async()=>{
 const f=fixture();let record=await ensureDiscount(initial(),f.deps);assert.equal(f.clicks,1);assert.equal(payableSlot(record).totalGBP,'11.50');assert.equal(record.slot.totalGBP,'14.00');verifyBasket(net,slot,record.discount);
 await ensureDiscount(record,f.deps);assert.equal(f.clicks,1);
 const g=fixture();g.basket=net;await ensureDiscount({...initial(),discountDispatchedAt:'timestamp',phase:'discount-dispatched'},g.deps);assert.equal(g.clicks,0);
 const h=fixture();h.deps.apply=async()=>{h.basket=net;throw Error('Lost response');};record=await ensureDiscount(initial(),h.deps);assert.equal(record.discount.totalGBP,'11.50');
});
test('invalid or expired codes time out without a second submission; delayed POST is allowed',async()=>{
 const f=fixture();let clock=0,clicks=0;f.deps.apply=async()=>clicks++;
 await assert.rejects(ensureDiscount(initial(),f.deps,{timeoutMs:1000,now:()=>clock,delay:async ms=>clock+=ms}),/no code retry/);assert.equal(clicks,1);
 await assert.rejects(ensureDiscount(f.saved,f.deps,{timeoutMs:1000,now:()=>clock,delay:async ms=>clock+=ms}),/no code retry/);assert.equal(clicks,1);
 assert.equal(reconcileClearedSelection([f.saved],{empty:true,items:[]}).checkoutRecords.length,0);
 assert.throws(()=>reconcileClearedSelection([{...f.saved,reference:'123'}],{empty:true,items:[]}),/preserve payment/);
 const g=fixture();clock=0;g.deps.read=async()=>clock<1000?gross:net;g.deps.apply=async()=>{};
 assert.equal((await ensureDiscount(initial(),g.deps,{timeoutMs:2000,now:()=>clock,delay:async ms=>clock+=ms})).discount.totalGBP,'11.50');
});
test('changed items, mismatched accounting, zero total, preexisting discounts and payment-stage changes all stop',async()=>{
 for(const changed of [{...net,totalGBP:'11.00'},{...net,totalGBP:'0.00',discountGBP:'14.00'},{...net,subtotalGBP:'15.00'},{...net,discountApplied:false},{...net,items:[net.items[0]]},{...net,items:net.items.map(item=>({...item,court:2}))}])assert.throws(()=>verifiedDiscount(changed,slot));
 const f=fixture();f.basket=net;await assert.rejects(ensureDiscount(initial(),f.deps),/price mismatch|Existing discount/);assert.equal(f.clicks,0);
 for(const extra of [{reference:'123'},{paymentDispatchedAt:'timestamp'},{test:true},{basketOnly:true}])await assert.rejects(ensureDiscount({...initial(),...extra},fixture().deps),/cannot change/);
 assert.throws(()=>payableSlot({...initial(),discount:verifiedDiscount(net,slot)}),/journal/);
});
test('payment and historical recovery use net amount while authorization and identity retain gross slot',()=>fixed(async()=>{
 const f=fixture();let record=await ensureDiscount(initial(),f.deps),submitted=[];
 assert.equal(checkoutKey(record.slot),record.key);
 const deps={save:async value=>record=value,verifyBasket:async s=>verifyBasket(net,s,record.discount),open:async()=>{},state:async()=>({totalGBP:'11.50',reference:'123',enabled:true}),submit:async amount=>submitted.push(amount),receipt:async()=>({status:'confirmed',key:record.key,reference:'123'})};
 const result=await payCheckout(record,deps);assert.deepEqual(submitted,['11.50']);assert.doesNotThrow(()=>recoveryIdentity(result));assert.equal(payableSlot(result).totalGBP,'11.50');
 await payCheckout(result,{receipt:async()=>({status:'confirmed',key:result.key,reference:'123'})}).catch(error=>assert.match(error.message,/No pending/));
 await assert.rejects(payCheckout(initial(),deps),/Discount must be verified/);
}));
test('live discount handler submits the observed form once and rejects basket changes before mutation',()=>{
 let listener,clicks=0;const input={disabled:false,value:'',dispatchEvent:()=>{}},button={textContent:'Apply code',disabled:false,click:()=>clicks++};
 input.form={getAttribute:()=>'/basket/discount',method:'post',querySelectorAll:()=>[button]};
 vm.runInNewContext(fs.readFileSync(new URL('./payment-content.js',import.meta.url),'utf8'),{location:{pathname:'/basket'},basketSummary:()=>gross,Event:class{},document:{querySelector:()=>input},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}}});
 const send=expected=>{let response;listener({kind:'discount-apply',code:'SAVE-TEST',expected},{id:'own'},value=>response=value);return response;};
 assert.equal(send(net).ok,false);assert.equal(clicks,0);assert.equal(send(gross).ok,true);assert.equal(input.value,'SAVE-TEST');assert.equal(clicks,1);
});
test('basket parser reads observed subtotal, discount removal marker and net total without changing hourly prices',()=>{
 let discounted=false;
 const totalRow=(label,value,marker=false)=>({innerText:`${label}\t${value}`,querySelector:q=>q==='td'?{textContent:label}:marker?{}:null});
 const document={body:{innerText:'Basket'},getElementById:()=>({innerText:'Tennis court 1 Bethnal Green Gardens 20th Oct | 8:00pm–8:59pm £7.00'}),querySelectorAll:q=>q==='a[href^="#item-"]'?[{getAttribute:()=> '#item-test'}]:q==='tr'?[totalRow('Subtotal','£ 7.00'),totalRow(discounted?'Discount (remove)':'Discount',discounted?'-£ 2.50':'-',discounted),totalRow('Total',discounted?'£ 4.50':'£ 7.00')]:q==='button'?[{textContent:'Pay with card'}]:[]};
 const context={document,location:{pathname:'/basket'},chrome:{runtime:{onMessage:{addListener:()=>{}}}}};vm.runInNewContext(fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8'),context);
 let basket=vm.runInNewContext('basketSummary()',context);assert.equal(basket.discountGBP,'0.00');assert.equal(basket.discountApplied,false);
 discounted=true;basket=vm.runInNewContext('basketSummary()',context);assert.equal(basket.discountGBP,'2.50');assert.equal(basket.totalGBP,'4.50');assert.equal(basket.items[0].priceGBP,'7.00');assert.equal(basket.discountApplied,true);
 verifiedDiscount(basket,{...slot,hours:1,totalGBP:'7.00'});
});
test('arming snapshots the optional code, rejects malformed codes before changes, and blank rearming clears it',()=>fixed(async()=>{
 let listener;const state={checkoutRecords:[]},alarms=[];
 // Public test card fixture; no real payment data or browser is used.
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value))},session:{get:async()=>({localPaymentCard:{number:'4111111111111111',cvc:'123',expiry:'12/30',postcode:'SW1A 1AA'}})}},tabs:{},alarms:{clear:async()=>{},create:async(name,value)=>alarms.push({name,...value}),onAlarm:{addListener:()=>{}}},runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:f=>listener=f},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}}};
 try{
  await import('./background.js');
  const send=message=>new Promise(resolve=>listener(message,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  const message={kind:'armPayment',day:'2026-10-21',discountCode:' SAVE-TEST '};
  let result=await send(message);assert.equal(result.status,'armed');assert.equal(result.discountRequested,true);assert.equal(state.job.discountCode,'SAVE-TEST');assert.equal(alarms.length,2);
  message.discountCode='OTHER';assert.equal(state.job.discountCode,'SAVE-TEST');
  result=await send({...message,discountCode:'X'.repeat(11)});assert.equal(result.status,'stopped');assert.equal(state.job.discountCode,'SAVE-TEST');assert.equal(alarms.length,2);
  result=await send({...message,discountCode:''});assert.equal(result.discountRequested,false);assert.equal(state.job.discountCode,undefined);
 }finally{delete globalThis.chrome;}
}));
