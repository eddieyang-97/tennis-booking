import assert from 'node:assert/strict';
import {clearUnpaidTest} from '../test-cleanup.js';
import {reconcileClearedSelection,prepareCheckout} from '../checkout.js';
import {ensureDiscount} from '../discount.js';
import {openVerifiedCheckout} from '../payment.js';
import {readGrid} from '../grid-read.js';
import {executeAction} from '../actions.js';
import {failureFor} from '../failures.js';
import {londonDay,addDays,slotKey} from '../core.js';
export const slot=()=>({venue:'victoria-park',date:addDays(londonDay(),1),court:1,start:'20:00',hours:2,totalGBP:'14.00'});
export function basket(s=slot()){return {empty:false,items:[20,21].map(hour=>({venue:'Victoria Park',court:1,day:Number(s.date.slice(8)),month:Number(s.date.slice(5,7)),hour,priceGBP:'7.00'})),subtotalGBP:'14.00',discountGBP:'0.00',totalGBP:'14.00',paymentBoundary:true};}
export const journal=()=>{const s=slot();return {slot:s,key:slotKey(s),status:'pending',phase:'awaiting-payment',checkoutTestOnly:true};};
export const scenarios={
 'grid-usable-while-loading':async()=>{
  let mutations=0;const s=slot(),url=`https://tennistowerhamlets.com/book/courts/${s.venue}/${s.date}#book`;
  const tabs={create:async()=>({id:1}),get:async()=>({url,status:'loading'}),sendMessage:async()=>({ok:true,rows:[{time:'8pm',inputs:[]}]}),remove:async()=>{}};
  const result=await readGrid(tabs,url,{kind:'grid',venue:s.venue,day:s.date},{attempts:1});assert.equal(result.ok,true);assert.equal(mutations,0);
 },
 'basket-hour-overwritten':async()=>{
  const s=slot();let records=[],selected=0,current={empty:true,items:[]};
  const result=await prepareCheckout(s,{load:async()=>records,save:async r=>records=r,read:async()=>current,select:async()=>{selected++;current={...basket(s),items:[basket(s).items[1]],totalGBP:'7.00'};},retain:async()=>1,notify:async()=>{}},{allowPartial:true});
  assert.equal(selected,1);assert.equal(result.fallback,'single-hour');assert.equal(result.slot.start,'21:00');assert.equal(records[0].slot.hours,1);
 },
 'post-discount-read-loss':async()=>{
  let record={...journal(),discountCode:'SYNTHETIC'},current=basket(),applies=0,fail=true;
  const deps={save:async r=>record=r,read:async()=>{if(record.discountDispatchedAt&&fail){fail=false;throw Error('unclassified transport failure');}return current;},apply:async()=>{applies++;current={...current,discountApplied:true,discountGBP:'2.00',totalGBP:'12.00'};}};
  await assert.rejects(ensureDiscount(record,deps));assert.ok(record.discountDispatchedAt);
  record=await ensureDiscount(record,deps);assert.equal(record.discount.totalGBP,'12.00');assert.equal(applies,1);
 },
 'acknowledged-checkout-late-card':async()=>{
  let record=journal(),time=0,opens=0;
  const deps={current:async()=>({url:'https://tennistowerhamlets.com/basket'}),read:async()=>basket(),save:async r=>record=r,command:async()=>opens++,state:async()=>{if(time<18000)throw Error('Not the card checkout');return {totalGBP:'14.00',reference:'100001'};}};
  const opened=await openVerifiedCheckout(record,deps,{timeoutMs:60000,now:()=>time,delay:async ms=>time+=ms});assert.equal(opened.page.reference,'100001');assert.equal(opens,1);assert.ok(time>=18000);
  await assert.rejects(openVerifiedCheckout(record,deps),/unresolved/);assert.equal(opens,1);
 },
 'six-cleanup-rejections-then-attestation':async()=>{
  let record={...journal(),reference:'100001',checkoutOpenDispatchedAt:new Date().toISOString()},removes=0;
  const deps={save:async r=>record=r,closeCheckout:async()=>record.reference,purchase:async()=>{throw Error('Unique matching purchase not found for reference 100001: observed 0 matches');},read:async()=>basket(),remove:async()=>removes++,archive:async()=>{throw Error('Unsafe archive');}};
  for(let i=0;i<6;i++){await assert.rejects(clearUnpaidTest(record,deps));assert.equal(record.status,'pending');}
  const archived=reconcileClearedSelection([record],{empty:true,items:[]},{unpaidTestConfirmed:true}).abandoned;
  assert.equal(removes,0);assert.equal(archived.abandonmentEvidence.basis,'owner-attested-no-payment');assert.equal(archived.abandonmentEvidence.merchantPaymentState,'unknown');
 },
 'reference-missing-before-first-read':async()=>{
  let reads=0;const record={...journal(),phase:'checkout-test-opening',checkoutOpenDispatchedAt:new Date().toISOString()};
  await assert.rejects(clearUnpaidTest(record,{closeCheckout:async()=>undefined,read:async()=>reads++}),e=>failureFor(e).reasonCode==='REFERENCE_UNAVAILABLE');assert.equal(reads,0);
 },
 'latest-action-not-historical-result':async()=>{
  const state={checkoutResult:{status:'checkout-test-passed',runId:'old-run'}},storage={set:async value=>Object.assign(state,value)};
  await assert.rejects(executeAction(storage,'resetUnpaidTest',async()=>{throw Error('Test payment reference unavailable');},{version:'synthetic-new-version'}));
  assert.equal(state.latestAction.outcome,'stopped');assert.equal(state.latestAction.version,'synthetic-new-version');assert.equal(state.checkoutResult.runId,'old-run');
 }
};
