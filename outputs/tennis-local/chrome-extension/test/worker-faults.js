import test from 'node:test';import assert from 'node:assert/strict';
import {Merchant} from './merchant.js';import {startWorker} from './worker-harness.js';
import {receiptResponse} from './receipt-fixture.js';

const paidReceipt='Booking reference: 100001\nPayment received\nBethnal Green Gardens\n23 October 2026\nCourt 1\n8:00pm–9:59pm\nDuration: 2 hours\nTotal: £14.00';
for(const [name,text,conflict,source] of [
 ['processing date',paidReceipt.replace('23 October 2026','Playing date: 23 October 2026')+'\nPayment processed: 18 October 2026',false,'booking-receipt'],
 ['metadata on separate lines',paidReceipt+'\nPayment processed:\n18 October 2026\nReceipt created:\n17 October 2026',false,'booking-receipt'],
 ['wrong labelled start',paidReceipt.replace('8:00pm–9:59pm','Start time: 7:00pm'),true],
 ['matching labelled start',paidReceipt.replace('8:00pm–9:59pm','Start time: 8:00pm'),false,'booking-receipt'],
 ['wrong standalone start in booking details',paidReceipt.replace('8:00pm–9:59pm','7:00pm'),true],
 ['split playing date and start labels',paidReceipt.replace('23 October 2026','Playing date:\n23 October 2026').replace('8:00pm–9:59pm','Start time:\n8:00pm'),false,'booking-receipt'],
 ['processing time range',paidReceipt+'\nPayment processing window: 7:00pm–7:59pm',false,'booking-receipt'],
 ['metadata cannot substitute for playing date',paidReceipt.replace('23 October 2026','Payment processed: 23 October 2026'),false,'account-purchase'],
 ['contradictory playing dates',paidReceipt+'\nPlaying date: 24 October 2026',true],
 ['wrong play date despite matching metadata',paidReceipt.replace('23 October 2026','Playing date: 24 October 2026')+'\nPayment processed: 23 October 2026',true],
 ['unfamiliar start label',paidReceipt.replace('8:00pm–9:59pm','Recorded at: 7:00pm'),false,'account-purchase']
])test(`scoped receipt fields through worker: ${name}`,async()=>{
 const merchant=new Merchant();merchant.slot.venue='bethnal-green-gardens';
 const record=merchant.record({checkoutTestOnly:false,reference:'100001',tabId:42,paymentDispatchedAt:new Date(merchant.clock).toISOString(),phase:'payment-uncertain'}),state={checkoutRecords:[record]};
 merchant.options.receiptResponse=request=>receiptResponse(request,text);merchant.purchases.set('100001',{state:'Confirmed',totalGBP:'14.00'});
 let accountReads=0;const message=merchant.message.bind(merchant);merchant.message=async(...args)=>{if(args[1].kind==='purchase-read')accountReads++;return message(...args);};
 const worker=await startWorker(merchant,state);worker.seedTab(42,'https://tennistowerhamlets.com/basket/receipt');const result=await worker.send({kind:'verifyPayment'});
 if(conflict){assert.equal(result.reasonCode,'RECEIPT_CONFLICT');assert.equal(result.status,'stopped');assert.equal(accountReads,0);assert.deepEqual(state.checkoutRecords,[record]);}
 else{assert.equal(result.status,'confirmed');assert.equal(result.receiptSource,source);assert.equal(accountReads,source==='account-purchase'?1:0);}
 assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
test('manual check is admitted after queued cancellation, preserving checkout journals',async()=>{
 const merchant=new Merchant(),record=merchant.record({paymentDispatchedAt:'2026-10-17T11:00:00Z'}),state={job:{day:'2026-10-25',when:merchant.clock+86400000},checkoutRecords:[record]},worker=await startWorker(merchant,state);
 const cancel=worker.send({kind:'cancel'}),check=worker.send({kind:'check',day:merchant.slot.date});
 assert.equal((await cancel).status,'cancelled');assert.equal((await check).status,'complete');assert.deepEqual(state.checkoutRecords,[record]);assert.equal(state.job,undefined);assert.equal(state.latestAction.kind,'check');assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const kind of ['check','resume'])test(`armed job refuses potentially slow manual ${kind} before reads and preserves release across worker recreation`,async()=>{
 const merchant=new Merchant();merchant.clock=Date.parse('2026-10-16T22:59:59Z');
 const job={day:'2026-10-24',when:merchant.clock+1000,mode:'availability',prepared:true},oldResult={status:'complete',day:'2026-10-22',results:[]},state={job,result:oldResult};
 let reads=0;const message=merchant.message.bind(merchant);merchant.message=(tab,request,worker)=>{if(request.kind==='account'){reads++;if(reads===1)return new Promise(()=>{});}return message(tab,request,worker);};
 let worker=await startWorker(merchant,state);let timer;
 try{const result=await Promise.race([worker.send({kind,day:'2026-10-23'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Manual read occupied release queue')),150))]);assert.equal(result.reasonCode,'MANUAL_CHECK_WHILE_ARMED');assert.equal(result.status,'stopped');}finally{clearTimeout(timer);}
 assert.equal(reads,0);assert.deepEqual(state.result,oldResult);assert.deepEqual(state.job,job);assert.equal(state.running,undefined);
 merchant.message=message;merchant.clock=job.when;worker=await startWorker(merchant,state,'recreated');await worker.alarm({name:'release'});
 assert.equal(state.result.status,'complete');assert.equal(state.result.day,job.day);assert.equal(state.latestAction.kind,'release');assert.equal(state.job,undefined);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const marker of [{phase:'card-filling'},{phase:'checkout-opening',cardFillDispatchedAt:'2026-10-17T11:00:00Z'},{phase:'checkout-opening',cardFillRecoveryRequired:true}])test(`actual worker refuses enabled card of unknown provenance: ${JSON.stringify(marker)}`,async()=>{
 const merchant=new Merchant(),record=merchant.record({checkoutTestOnly:false,reference:'100001',tabId:42,...marker}),state={checkoutRecords:[record]},worker=await startWorker(merchant,state);
 merchant.readyAt=merchant.clock;worker.seedTab(42,'https://tennistowerhamlets.com/basket/pay/card');
 for(let attempt=0;attempt<2;attempt++){const result=await worker.send({kind:'payCheckout'});assert.equal(result.reasonCode,'CARD_FILL_REVIEW_REQUIRED');assert.equal(result.status,'stopped');}
 assert.deepEqual(state.checkoutRecords,[record]);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const mode of ['exact','missing','unrelated','unrecognized'])test(`actual receipt adapter preserves ${mode} receipt reconciliation semantics`,async()=>{
 const merchant=new Merchant();merchant.slot.venue='bethnal-green-gardens';
 const record=merchant.record({checkoutTestOnly:false,reference:'100001',tabId:42,paymentDispatchedAt:new Date(merchant.clock).toISOString(),phase:'payment-uncertain'}),state={checkoutRecords:[record]};
 const text=mode==='missing'?'':mode==='unrelated'?paidReceipt.replace('100001','100002').replace('Court 1','Court 2'):mode==='unrecognized'?'Booking reference: 100001\nPayment received':paidReceipt;
 merchant.options.receiptResponse=request=>receiptResponse(request,text);merchant.purchases.set('100001',{state:'Confirmed',totalGBP:'14.00'});
 const worker=await startWorker(merchant,state);worker.seedTab(42,'https://tennistowerhamlets.com/basket/receipt');
 const result=await worker.send({kind:'verifyPayment'});assert.equal(result.status,'confirmed');assert.equal(result.receiptSource,mode==='exact'?'booking-receipt':'account-purchase');
 assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const hung of ['query','message'])test(`bounded recovery assessment with hung ${hung} cannot starve release`,async()=>{
 const merchant=new Merchant();merchant.clock=Date.parse('2026-10-16T23:00:00Z');merchant.options.timerDelay=ms=>ms>=1000?100:1;
 const record=merchant.record({reference:'100001'}),state={checkoutRecords:[record],job:{day:'2026-10-24',when:merchant.clock,mode:'availability',prepared:true}},worker=await startWorker(merchant,state);
 worker.seedTab(42,'https://tennistowerhamlets.com/purchase/card/100001');
 let started;const entered=new Promise(resolve=>started=resolve),never=()=>{started();return new Promise(()=>{});};
 if(hung==='query')worker.chrome.tabs.query=never;
 else{const original=worker.chrome.tabs.sendMessage;worker.chrome.tabs.sendMessage=(id,request)=>request.kind==='checkout-progress'?never():original(id,request);}
 let finished=false;const assessment=worker.send({kind:'assessRecovery'}).then(result=>{finished=true;return result;});await entered;
 let timer;try{await Promise.race([worker.alarm({name:'release'}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Release starved')),70))]);}finally{clearTimeout(timer);}
 assert.equal(finished,false);assert.equal(state.result.status,'complete');
 const result=await assessment;assert.equal(result.observationIncomplete,true);assert.equal(result.paymentState,'unknown');assert.equal(result.automaticReplayAllowed,false);
 assert.deepEqual(state.checkoutRecords,[record]);assert.equal(state.latestAction.kind,'release');assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
test('independent recovery observation rejects a changed journal snapshot',async()=>{
 const merchant=new Merchant(),record=merchant.record({reference:'100001'}),state={checkoutRecords:[record]},worker=await startWorker(merchant,state);
 worker.seedTab(42,'https://tennistowerhamlets.com/purchase/card/100001');const original=worker.chrome.tabs.sendMessage;
 worker.chrome.tabs.sendMessage=async(id,request)=>{const response=await original(id,request);if(request.kind==='checkout-progress')state.checkoutRecords=[{...record,reference:'100002'}];return response;};
 const result=await worker.send({kind:'assessRecovery'});assert.equal(result.reasonCode,'RECOVERY_STATE_CHANGED');assert.equal(result.exactReferenceMatches,undefined);assert.equal(result.paymentState,'unknown');assert.equal(state.checkoutRecords[0].reference,'100002');
 assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const [field,from,to] of [['court','Court 1','Court 2'],['venue','Bethnal Green Gardens','Victoria Park'],['date','23 October','24 October'],['year','2026','2027'],['duration','2 hours','1 hour'],['time','8:00pm','7:00pm'],['total','14.00','15.00']])test(`actual receipt adapter through worker holds conflicting ${field} despite paid account row`,async()=>{
 const merchant=new Merchant();merchant.slot.venue='bethnal-green-gardens';const record=merchant.record({checkoutTestOnly:false,reference:'100001',tabId:42,paymentDispatchedAt:new Date(merchant.clock).toISOString(),phase:'payment-uncertain'}),state={checkoutRecords:[record]};
 merchant.options.receiptResponse=request=>receiptResponse(request,paidReceipt.replace(from,to));merchant.purchases.set('100001',{state:'Confirmed',totalGBP:'14.00'});
 let accountReads=0;const message=merchant.message.bind(merchant);merchant.message=async(...args)=>{if(args[1].kind==='purchase-read')accountReads++;return message(...args);};
 const worker=await startWorker(merchant,state);worker.seedTab(42,'https://tennistowerhamlets.com/basket/receipt');
 const result=await worker.send({kind:'verifyPayment'});assert.equal(result.status,'stopped');assert.equal(result.reasonCode,'RECEIPT_CONFLICT');assert.equal(result.paid,null);
 assert.equal(accountReads,0);assert.deepEqual(state.checkoutRecords,[record]);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
test('actual worker: check, prepare, fake Pay and account reconciliation; repeat invocation cannot charge twice',async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);
 assert.equal((await worker.send({kind:'check',day:merchant.slot.date})).status,'complete');
 const prepared=await worker.send({kind:'prepareCheckout'});assert.equal(prepared.status,'awaiting-payment',prepared.error);
 const paid=await worker.send({kind:'payCheckout'});assert.equal(paid.status,'confirmed');assert.equal(merchant.counts.pay,1);assert.equal(merchant.counts.selection,2);
 await worker.send({kind:'payCheckout'});assert.equal(merchant.counts.pay,1);assert.equal(state.checkoutRecords[0].status,'confirmed');
});

test('checkout navigation with missing read replies settles without another opening or discount',async()=>{
 const merchant=new Merchant(),state={},worker=await startWorker(merchant,state);merchant.options.missingProgress=2;
 await worker.send({kind:'check',day:merchant.slot.date});
 const result=await worker.send({kind:'testDiscountCheckout',discountCode:'SYNTHETIC'});
 assert.equal(result.status,'checkout-test-passed',result.error);assert.equal(merchant.options.missingProgress,0);
 assert.equal(merchant.counts.opening,1);assert.equal(merchant.counts.discount,1);assert.equal(merchant.counts.pay,0);
 assert.equal(state.runHistory.flatMap(run=>run.steps).filter(step=>step.name==='checkout-read-unavailable').length,2);
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
