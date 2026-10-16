import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCheckout,reconcileClearedSelection} from './checkout.js';
import {ensureDiscount} from './discount.js';
import {openVerifiedCheckout,payCheckout} from './payment.js';
import {clearUnpaidTest} from './test-cleanup.js';
import {slotKey} from './core.js';
import vm from 'node:vm';
import fs from 'node:fs';

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

function cleanupFixture(overrides={}){
 let record={slot,key:slotKey(slot),status:'pending',phase:'awaiting-payment',checkoutTestOnly:true,...overrides},basket=structuredClone(gross),archived,removes=0,purchases=0,closed=0;
 const deps={save:async r=>record=r,read:async()=>basket,closeCheckout:async()=>{closed++;return record.reference||'100001';},purchase:async()=>{purchases++;return {status:'unpaid',reference:'100001',totalGBP:record.discount?.totalGBP||'10.00'};},remove:async expected=>{assert.equal(record.cleanupDispatched.fingerprint,JSON.stringify(expected));removes++;const items=basket.items.slice(1);basket=items.length?{...basket,items,subtotalGBP:'5.00',totalGBP:'5.00'}:{empty:true,items:[]};},archive:async r=>archived=r};
 return {deps,get record(){return record;},get archived(){return archived;},get removes(){return removes;},get purchases(){return purchases;},get closed(){return closed;},set basket(value){basket=value;}};
}
test('automatic test cleanup removes exact partial/full selections and archives only after empty observation',async()=>{
 for(const partial of [false,true]){const f=cleanupFixture();if(partial)f.basket={...gross,items:[gross.items[0]],subtotalGBP:'5.00',totalGBP:'5.00'};
  await clearUnpaidTest(f.record,f.deps);assert.equal(f.removes,partial?1:2);assert.equal(f.purchases,0);assert.equal(f.archived.phase,'test-auto-cleared');}
});
test('opened tests close checkout first and require positive unpaid history before and after cleanup',async()=>{
 const f=cleanupFixture({phase:'checkout-test-ready',reference:'100001',checkoutOpenDispatchedAt:'2026-10-16T08:00:00Z'});
 await clearUnpaidTest(f.record,f.deps);assert.equal(f.closed,1);assert.equal(f.purchases,2);assert.ok(f.archived.cleanupUnpaidVerifiedAt);
 for(const evidence of [null,{status:'confirmed',reference:'100001',totalGBP:'10.00'},{status:'unpaid',reference:'other',totalGBP:'10.00'}]){
  const g=cleanupFixture({reference:'100001'});g.deps.purchase=async()=>evidence;await assert.rejects(clearUnpaidTest(g.record,g.deps),/uncertain/);assert.equal(g.removes,0);assert.equal(g.archived,undefined);
 }
});
test('discount cleanup precedes item removal and a changed final payment state preserves the journal',async()=>{
 const f=cleanupFixture({discountCode:'TESTCODE',discountDispatchedAt:'2026-10-16T08:00:00Z'});
 f.basket={...gross,discountApplied:true,discountGBP:'2.50',totalGBP:'7.50'};
 const remove=f.deps.remove;let discountRemoved=0;
 f.deps.remove=async expected=>{if(expected.discountApplied){discountRemoved++;f.basket=structuredClone(gross);}else await remove(expected);};
 await clearUnpaidTest(f.record,f.deps);assert.equal(discountRemoved,1);assert.equal(f.removes,2);assert.ok(f.archived);
 const g=cleanupFixture({reference:'100001'});let reads=0;
 g.deps.purchase=async()=>({status:++reads===1?'unpaid':'confirmed',reference:'100001',totalGBP:'10.00'});
 await assert.rejects(clearUnpaidTest(g.record,g.deps),/state changed/);assert.equal(g.archived,undefined);
});
test('cleanup preserves real/payment journals, unrelated items, and unresolved removals without mutation replay',async()=>{
 for(const override of [{checkoutTestOnly:false},{paymentDispatchedAt:'timestamp'},{manualPaymentReportedAt:'timestamp'},{status:'confirmed'},{phase:'payment-uncertain'}]){const f=cleanupFixture(override);await assert.rejects(clearUnpaidTest(f.record,f.deps));assert.equal(f.removes,0);}
 const f=cleanupFixture();f.basket={...gross,items:[{...gross.items[0],court:2},gross.items[1]]};await assert.rejects(clearUnpaidTest(f.record,f.deps),/unrelated/);assert.equal(f.removes,0);
 const g=cleanupFixture();let attempts=0;g.deps.remove=async()=>{attempts++;throw Error('response lost');};await assert.rejects(clearUnpaidTest(g.record,g.deps),/acknowledged/);await assert.rejects(clearUnpaidTest(g.record,g.deps),/repeated/);assert.equal(attempts,1);assert.equal(g.archived,undefined);
 const h=cleanupFixture();const remove=h.deps.remove;h.deps.remove=async expected=>{await remove(expected);throw Error('response lost');};await clearUnpaidTest(h.record,h.deps);assert.equal(h.removes,2);assert.ok(h.archived);
});

test('worker clears an opened unpaid test without card access and preserves uncertain purchases',async()=>{
 const oldChrome=globalThis.chrome;
 const original={slot,key:slotKey(slot),status:'pending',phase:'checkout-test-ready',checkoutTestOnly:true,reference:'100001',checkoutOpenDispatchedAt:'2026-10-16T08:00:00Z',tabId:42};
 const state={checkoutRecords:[original]},tabs=new Map([[42,{id:42,url:'https://tennistowerhamlets.com/basket/pay/card',status:'complete'}]]);
 let listener,nextTab=50,basket=structuredClone(gross),pending=true,removes=0;
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value)),remove:async key=>delete state[key]},session:{get:async()=>{throw Error('Card access forbidden');}}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},notifications:{onClicked:{addListener(){}}},alarms:{onAlarm:{addListener(){}},clear:async()=>{},create:async()=>{}},runtime:{id:'test',getManifest:()=>({version:'0.8.5'}),getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>listener=fn},onStartup:{addListener(){}},onInstalled:{addListener(){}}},tabs:{query:async()=>[...tabs.values()].filter(t=>t.id===42),create:async({url})=>{const tab={id:nextTab++,url,status:'complete'};tabs.set(tab.id,tab);return tab;},get:async id=>tabs.get(id),remove:async id=>tabs.delete(id),sendMessage:async(id,request)=>{
  if(request.kind==='payment-state')return {ok:true,value:{reference:'100001',totalGBP:'10.00'}};
  if(request.kind==='test-purchase-state')return pending?{ok:true,value:{status:'unpaid',reference:'100001',totalGBP:'10.00'}}:{ok:false,error:'Test purchase is paid or uncertain'};
  if(request.kind==='basket-read')return {ok:true,value:structuredClone(basket)};
  if(request.kind==='test-remove-next'){removes++;assert.deepEqual(request.expected,basket);basket={empty:true,items:[]};return {ok:true};}
  throw Error('Unexpected command: '+request.kind);
 }}};
 try{
  await import('./background.js');const send=()=>new Promise(resolve=>listener({kind:'resetUnpaidTest'},{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  assert.equal((await send()).status,'test-auto-cleared');assert.equal(removes,1);assert.equal(tabs.has(42),false);assert.equal(state.checkoutRecords.length,0);assert.equal(state.abandonedCheckouts[0].reference,'100001');
  state.checkoutRecords=[original];basket=structuredClone(gross);pending=false;
  assert.equal((await send()).status,'stopped');assert.equal(removes,1);assert.equal(state.checkoutRecords.length,1);
 }finally{globalThis.chrome=oldChrome;}
});

test('removal content handler uses observed item control and refuses changed basket snapshots',()=>{
 let listener,clicks=0;
 const expected=structuredClone(gross),itemId='a'.repeat(32);
 const link={textContent:'Remove',getAttribute:()=>'/basket/remove/'+itemId,click:()=>clicks++};
 const context={location:{pathname:'/basket'},basketSummary:()=>expected,chrome:{runtime:{id:'own',onMessage:{addListener:fn=>listener=fn}}},document:{querySelector:()=>null,querySelectorAll:()=>[{getAttribute:()=>'#item-'+itemId}],getElementById:()=>({querySelectorAll:()=>[link]})}};
 vm.runInNewContext(fs.readFileSync(new URL('./payment-content.js',import.meta.url),'utf8'),context);
 const send=value=>{let result;listener({kind:'test-remove-next',expected:value},{id:'own'},r=>result=r);return result;};
 assert.equal(send({...expected,totalGBP:'14.00'}).ok,false);assert.equal(clicks,0);assert.equal(send(expected).ok,true);assert.equal(clicks,1);
});
