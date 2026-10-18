import test from 'node:test';import assert from 'node:assert/strict';
import {Merchant} from './merchant.js';import {startWorker} from './worker-harness.js';
test('actual worker: check, prepare, fake Pay and account reconciliation; repeat invocation cannot charge twice',async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);
 assert.equal((await worker.send({kind:'check',day:merchant.slot.date})).status,'complete');
 const prepared=await worker.send({kind:'prepareCheckout'});assert.equal(prepared.status,'awaiting-payment',prepared.error);
 const paid=await worker.send({kind:'payCheckout'});assert.equal(paid.status,'confirmed');assert.equal(merchant.counts.pay,1);assert.equal(merchant.counts.selection,2);
 await worker.send({kind:'payCheckout'});assert.equal(merchant.counts.pay,1);assert.equal(state.checkoutRecords[0].status,'confirmed');
});
for(const mutation of ['selection','opening','discount','fill','pay','removal'])for(const boundary of ['persist','dispatch'])for(const when of ['before','after'])test(`worker restart: ${mutation} ${boundary} ${when}`,async()=>{
 const merchant=new Merchant(),state={};let worker=await startWorker(merchant,state);
 await worker.send({kind:'check',day:merchant.slot.date});
 let kind;
 if(mutation==='selection')kind='prepareCheckout';
 else{
  merchant.selected();let record=merchant.record({checkoutTestOnly:mutation==='removal',tabId:42});
  if(mutation==='removal'){record={...record,reference:merchant.reference,checkoutOpenDispatchedAt:new Date(merchant.clock).toISOString()};merchant.purchases.set(merchant.reference,{state:'Pending',totalGBP:'14.00'});}
  if(mutation==='discount')record.discountCode='SYNTHETIC';state.checkoutRecords=[record];worker.seedTab();kind=mutation==='removal'?'resetUnpaidTest':'payCheckout';
 }
 const fault=`${boundary}:${mutation}:${when}`;merchant.fault(fault);const attempted=await worker.send({kind});assert.equal(merchant.faults.has(fault),false,`Fault never reached: ${fault}; ${attempted.error||attempted.status}`);
 const before=structuredClone(merchant.counts),record=state.checkoutRecords?.find(r=>r.status==='pending');
 worker=await startWorker(merchant,state,'after-restart');
 if(record?.tabId)worker.seedTab(record.tabId,merchant.readyAt!==undefined?'https://tennistowerhamlets.com/basket/pay/card':'https://tennistowerhamlets.com/basket');
 await worker.send({kind});
 const marker=mutation==='selection'?!!record:mutation==='pay'?record?.paymentDispatchedAt:mutation==='opening'?record?.checkoutOpenDispatchedAt:mutation==='discount'?record?.discountDispatchedAt:mutation==='fill'?(record?.cardFillDispatchedAt||record?.phase==='card-filling'):record?.cleanupDispatched;
 if(marker)assert.equal(merchant.counts[mutation],before[mutation],`replayed ${mutation}`);
 assert.ok(merchant.counts.pay<=1);assert.ok(merchant.counts.opening<=1);assert.ok(merchant.counts.discount<=1);
});
test('popup rearm overlapping preflight cannot be overwritten by the old alarm job',async()=>{
 const merchant=new Merchant(),state={job:{day:'2026-10-25',when:Date.parse('2026-10-18T23:00:00Z'),mode:'payment',prepared:false}};
 let release;merchant.options.accountGate=new Promise(resolve=>release=resolve);
 const worker=await startWorker(merchant,state),preflight=worker.alarm({name:'prepare'});
 while(!merchant.accountStarted)await new Promise(resolve=>setImmediate(resolve));
 const rearm=worker.send({kind:'armPayment',day:'2026-10-26'});await new Promise(resolve=>setImmediate(resolve));release();
 await preflight;assert.equal((await rearm).status,'armed');assert.equal(state.job.day,'2026-10-26');assert.equal(state.job.prepared,false);
});
test('scheduled alarm reaches paid evidence with one dispatch per mutation',async()=>{
 const merchant=new Merchant();merchant.clock=Date.parse('2026-10-16T23:00:00Z');
 const state={job:{day:'2026-10-24',when:merchant.clock,mode:'payment',prepared:true}},worker=await startWorker(merchant,state);
 await worker.alarm({name:'release'});assert.equal(state.checkoutResult?.status,'confirmed',state.checkoutResult?.error||state.result?.error);assert.equal(state.job,undefined);assert.equal(merchant.counts.pay,1);assert.equal(merchant.counts.opening,1);assert.equal(merchant.counts.fill,1);assert.equal(state.latestAction.kind,'release');
});
test('manual payment report reconciles a reference without inventing a Pay dispatch',async()=>{
 const merchant=new Merchant(),record=merchant.record({checkoutTestOnly:false}),state={checkoutRecords:[record]},worker=await startWorker(merchant,state);
 merchant.purchases.set('100001',{state:'Confirmed',totalGBP:'14.00'});
 assert.equal((await worker.send({kind:'reconcileManualPayment',reference:'100001'})).status,'confirmed');assert.equal(merchant.counts.pay,0);assert.equal(state.checkoutRecords[0].paymentDispatchedAt,undefined);assert.ok(state.checkoutRecords[0].manualPaymentReportedAt);
});

for(const reference of ['100001','100002',null])test(`existing-purchase assessment requires recorded identity: ${reference||'absent'}`,async()=>{
 const merchant=new Merchant(),record=merchant.record({checkoutTestOnly:false,...(reference?{reference}:{})}),state={checkoutRecords:[record]},worker=await startWorker(merchant,state);
 worker.seedTab(42,'https://tennistowerhamlets.com/purchase/card/100001');
 const result=await worker.send({kind:'assessRecovery'});
 assert.equal(result.status,'needs-user-action');assert.equal(result.existingPurchasePages,1);
 assert.equal(result.exactReferenceMatches,reference==='100001'?1:0);assert.equal(result.paymentState,'unknown');assert.equal(result.merchantCancellationState,'unknown');
 assert.equal(result.automaticReplayAllowed,false);assert.deepEqual(state.checkoutRecords,[record]);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
test('repeated actual worker cleanup failures retain the journal and manual attestation has distinct provenance',async()=>{
 const merchant=new Merchant(),record=merchant.record({reference:'100001',checkoutOpenDispatchedAt:new Date(merchant.clock).toISOString()}),state={checkoutRecords:[record]},worker=await startWorker(merchant,state);
 for(let i=0;i<6;i++){assert.equal((await worker.send({kind:'resetUnpaidTest'})).status,'stopped');assert.equal(state.latestAction.reasonCode,'PURCHASE_MISSING');assert.equal(merchant.counts.removal,0);}
 assert.equal((await worker.send({kind:'reconcileSelection',unpaidTestConfirmed:true,attestationIdentity:'stale'})).status,'stopped');
 const result=await worker.send({kind:'reconcileSelection',unpaidTestConfirmed:true,attestationIdentity:JSON.stringify([record.key,record.reference,record.checkoutOpenDispatchedAt])});
 assert.equal(result.status,'selection-reconciled-empty');assert.equal(state.abandonedCheckouts[0].abandonmentEvidence.basis,'owner-attested-no-payment');
});
test('overlapping prepare commands share one journal and cannot duplicate selections',async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);await worker.send({kind:'check',day:merchant.slot.date});
 await Promise.all([worker.send({kind:'prepareCheckout'}),worker.send({kind:'prepareCheckout'})]);assert.equal(merchant.counts.selection,2);assert.equal(state.checkoutRecords.length,1);
});
test('closed prepayment tab recovers read-only without selecting again; submitted closed tab reconciles only',async()=>{
 const merchant=new Merchant();merchant.selected();
 const state={checkoutRecords:[merchant.record({checkoutTestOnly:false,tabId:42})]},worker=await startWorker(merchant,state);
 assert.equal((await worker.send({kind:'prepareCheckout'})).status,'awaiting-payment');assert.equal(merchant.counts.selection,0);
 state.checkoutRecords=[merchant.record({checkoutTestOnly:false,tabId:99,reference:'100001',paymentDispatchedAt:new Date(merchant.clock).toISOString(),phase:'payment-uncertain'})];merchant.purchases.set('100001',{state:'Confirmed',totalGBP:'14.00'});
 assert.equal((await worker.send({kind:'payCheckout'})).status,'confirmed');assert.equal(merchant.counts.pay,0);
});
test('unrelated basket and changed checkout route stop without external mutation',async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);await worker.send({kind:'check',day:merchant.slot.date});
 merchant.basket={...basketFor(merchant),items:[{...basketFor(merchant).items[0],court:2}]};
 assert.equal((await worker.send({kind:'prepareCheckout'})).status,'stopped');assert.equal(merchant.counts.selection,0);
 merchant.selected();state.checkoutRecords=[merchant.record({checkoutTestOnly:false,tabId:42})];worker.seedTab(42,'https://example.invalid/elsewhere');
 assert.equal((await worker.send({kind:'payCheckout'})).status,'stopped');assert.equal(merchant.counts.opening,0);assert.equal(merchant.counts.pay,0);
});
function basketFor(merchant){merchant.selected();return structuredClone(merchant.basket);}
test('unknown grid readiness produces a distinct unavailable reason and no selection',async()=>{
 const merchant=new Merchant();merchant.options.gridError=true;
 const state={},worker=await startWorker(merchant,state);assert.equal((await worker.send({kind:'check',day:merchant.slot.date})).status,'stopped');assert.equal(state.latestAction.reasonCode,'GRID_READY_TIMEOUT');assert.equal(merchant.counts.selection,0);
});
for(const phase of ['basket-verified','discount-verified','reference','confirmation','archive'])for(const when of ['before','after'])test(`acknowledged effect interrupted at ${phase} persistence ${when}`,async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);await worker.send({kind:'check',day:merchant.slot.date});
 let kind='prepareCheckout';
 if(phase!=='basket-verified'){
  merchant.selected();const record=merchant.record({tabId:42,checkoutTestOnly:phase==='archive',...(phase==='discount-verified'?{discountCode:'SYNTHETIC'}:{})});state.checkoutRecords=[record];worker.seedTab();kind=phase==='archive'?'resetUnpaidTest':'payCheckout';
 }
 const label=`persist:${phase}:${when}`;merchant.fault(label);const result=await worker.send({kind});assert.equal(merchant.faults.has(label),false,`${label} not reached: ${result.error||result.status}`);
 const resumed=await startWorker(merchant,state,'after-ack-restart'),record=state.checkoutRecords?.find(r=>r.status==='pending');if(record?.tabId)resumed.seedTab(record.tabId,merchant.readyAt!==undefined?'https://tennistowerhamlets.com/basket/pay/card':'https://tennistowerhamlets.com/basket');
 await resumed.send({kind});assert.ok(merchant.counts.pay<=1);assert.ok(merchant.counts.opening<=1);assert.ok(merchant.counts.discount<=1);assert.ok(merchant.counts.selection<=2);
});
