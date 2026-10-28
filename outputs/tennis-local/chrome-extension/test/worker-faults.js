import test from 'node:test';import assert from 'node:assert/strict';
import {Merchant} from './merchant.js';import {startWorker} from './worker-harness.js';
import {receiptResponse} from './receipt-fixture.js';

const paidReceipt='Booking reference: 100001\nPayment received\nBethnal Green Gardens\n23 October 2026\nCourt 1\n8:00pm–9:59pm\nDuration: 2 hours\nTotal: £14.00';

function failedOpening(merchant){return merchant.record({test:false,checkoutTestOnly:false,phase:'checkout-opening',checkoutOpenDispatchedAt:new Date(merchant.clock).toISOString()});}
function archiveMessage(record){return {kind:'archiveFailedCheckout',noPaymentConfirmed:true,attestationIdentity:JSON.stringify([record.key,record.checkoutOpenDispatchedAt])};}
test('failed ordinary opening recovery preserves history/results and executes no merchant mutations, including repeats and restart',async()=>{
 const merchant=new Merchant(),record=failedOpening(merchant),confirmed=merchant.record({key:'paid-history',status:'confirmed',reference:'100002',paymentDispatchedAt:'preserved'}),history=[{key:'old-archive',paymentDispatchedAt:'preserved'}],result={status:'stopped',error:'prior checkout error'},state={checkoutRecords:[confirmed,record],abandonedCheckouts:history,checkoutResult:result};
 let worker=await startWorker(merchant,state);const message=archiveMessage(record);
 assert.equal((await worker.send(message)).status,'failed-checkout-archived');assert.deepEqual(state.checkoutRecords,[confirmed]);assert.deepEqual(state.checkoutResult,result);assert.deepEqual(state.abandonedCheckouts[0],history[0]);
 assert.equal(state.abandonedCheckouts[1].phase,'checkout-opening');assert.equal(state.abandonedCheckouts[1].abandonmentEvidence.merchantPaymentState,'unknown');
 worker=await startWorker(merchant,state);assert.equal((await worker.send(message)).status,'stopped');assert.equal(state.abandonedCheckouts.length,2);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const when of ['before','after'])test(`failed checkout archive persistence interruption ${when} is recoverable without mutation or journal loss`,async()=>{
 const merchant=new Merchant(),record=failedOpening(merchant),state={checkoutRecords:[record]},message=archiveMessage(record);merchant.fault(`persist:archive:${when}`);
 let worker=await startWorker(merchant,state);assert.equal((await worker.send(message)).status,'stopped');
 if(when==='before')assert.deepEqual(state.checkoutRecords,[record]);else assert.equal(state.abandonedCheckouts[0].checkoutOpenDispatchedAt,record.checkoutOpenDispatchedAt);
 worker=await startWorker(merchant,state);assert.equal((await worker.send(message)).status,when==='before'?'failed-checkout-archived':'stopped');assert.equal(state.abandonedCheckouts.length,1);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const change of ['reference','paymentDispatchedAt','manualPaymentReportedAt','cardFillDispatchedAt','archive','confirmed-history'])test(`failed checkout recovery rejects concurrent evidence change: ${change}`,async()=>{
 const merchant=new Merchant(),record=failedOpening(merchant),state={checkoutRecords:[record]},worker=await startWorker(merchant,state),send=worker.chrome.tabs.sendMessage;let changed=false;
 worker.chrome.tabs.sendMessage=async(id,request)=>{if(request.kind==='basket-read'&&!changed){changed=true;if(change==='archive')state.abandonedCheckouts=[{key:'concurrent'}];else if(change==='confirmed-history')state.checkoutRecords.push({key:'paid',status:'confirmed',paymentDispatchedAt:'preserved'});else state.checkoutRecords[0][change]=null;}return send(id,request);};
 const result=await worker.send(archiveMessage(record));assert.equal(result.status,'stopped');assert.match(result.error,/changed/);assert.equal(state.checkoutRecords[0].phase,'checkout-opening');assert.ok(Object.values(merchant.counts).every(count=>count===0));
});
for(const evidence of ['not-confirmed','stale','not-empty','unknown-basket','unreadable','card-fill'])test(`failed checkout recovery retains journal when ${evidence}`,async()=>{
 const merchant=new Merchant(),record=failedOpening(merchant),state={checkoutRecords:[record]},worker=await startWorker(merchant,state),message=archiveMessage(record);
 if(evidence==='not-confirmed')message.noPaymentConfirmed=false;
 if(evidence==='stale')message.attestationIdentity='stale';
 if(evidence==='not-empty')merchant.selected();
 if(evidence==='unknown-basket')merchant.basket={items:[]};
 if(evidence==='card-fill')record.cardFillDispatchedAt=null;
 if(evidence==='unreadable'){const send=worker.chrome.tabs.sendMessage;worker.chrome.tabs.sendMessage=async(id,request)=>request.kind==='basket-read'?{ok:false,error:'Unknown basket layout'}:send(id,request);}
 const before=structuredClone(state.checkoutRecords);assert.equal((await worker.send(message)).status,'stopped');assert.deepEqual(state.checkoutRecords,before);assert.equal(state.abandonedCheckouts,undefined);assert.ok(Object.values(merchant.counts).every(count=>count===0));
});

async function navigationRun(merchant=new Merchant(),state={}){
 merchant.clock=Date.parse('2026-10-16T23:00:00Z');
 state.job={day:'2026-10-24',when:merchant.clock,mode:'payment',prepared:true};
 const worker=await startWorker(merchant,state),navigations=[],reads=[];
 const {create,update,sendMessage}=worker.chrome.tabs;
 worker.chrome.tabs.create=async changes=>{const tab=await create(changes);navigations.push({kind:'create',id:tab.id,url:changes.url});return tab;};
 worker.chrome.tabs.update=async(id,changes)=>{if(changes.url)navigations.push({kind:'update',id,url:changes.url});return update(id,changes);};
 worker.chrome.tabs.sendMessage=async(id,request)=>{reads.push({id,kind:request.kind});return sendMessage(id,request);};
 return {worker,state,merchant,navigations,reads};
}

test('release observes delayed discount after five loading reads and unknown transport failure, without mutation replay',async()=>{
 const f=await navigationRun(),send=f.worker.chrome.tabs.sendMessage;f.state.job.discountCode='SYNTHETIC';let reads=0,gross,discountTab;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='discount-apply'){
   gross=structuredClone(f.merchant.basket);discountTab=id;const response=await send(id,request);f.worker.tabs.get(id).status='loading';return response;
  }
  if(request.kind==='basket-read'&&f.merchant.counts.discount){
   assert.equal(id,discountTab);reads++;
   if(reads<=5)return {ok:true,value:structuredClone(gross)};
   if(reads===6)throw Error('Unclassified Chrome transport PRIVATE');
   f.worker.tabs.get(id).status='complete';
  }
  return send(id,request);
 };
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,'confirmed',f.state.checkoutResult.error);
 assert.ok(reads>=7);assert.equal(f.state.checkoutRecords[0].slot.totalGBP,'14.00');assert.equal(f.state.checkoutRecords[0].discount.totalGBP,'12.00');
 assert.equal(JSON.stringify(f.state).includes('PRIVATE'),false);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:1,opening:1,fill:1,pay:1,removal:0});
 assert.equal(f.navigations.filter(n=>n.kind==='update'&&n.url.endsWith('/basket')).length,2,'only the existing post-selection load and pre-payment refresh');
});
for(const slow of ['initial-step','tab-state','successful-log'])test(`discount deadline includes slow ${slow} through worker storage and messaging; restart never replays`,async()=>{
 const f=await navigationRun();f.state.job.discountCode='SYNTHETIC';let delayed=false;
 if(slow==='tab-state'){
  const get=f.worker.chrome.tabs.get;f.worker.chrome.tabs.get=async id=>{if(f.merchant.counts.discount&&!delayed){delayed=true;f.merchant.clock+=60000;}return get(id);};
 }else{
  const set=f.worker.chrome.storage.local.set;f.worker.chrome.storage.local.set=async value=>{
   const last=value.runHistory?.at(-1)?.steps?.at(-1),name=slow==='initial-step'?'existing-basket-read':'page-read';
   if(f.merchant.counts.discount&&!delayed&&last?.name===name&&last.page==='basket-read'){delayed=true;f.merchant.clock+=60000;}
   return set(value);
  };
 }
 await f.worker.alarm({name:'release'});assert.equal(delayed,true);assert.equal(f.state.checkoutResult.status,'stopped','late valid discount evidence cannot authorize checkout');
 const record=structuredClone(f.state.checkoutRecords[0]);assert.equal(record.phase,'discount-dispatched');assert.ok(record.discountDispatchedAt);assert.equal(record.discount,undefined);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:1,opening:0,fill:0,pay:0,removal:0});
 const restarted=await startWorker(f.merchant,f.state);restarted.seedTab(record.tabId);
 const resumed=await restarted.send({kind:'payCheckout'});assert.equal(resumed.status,'confirmed',resumed.error);assert.equal(f.merchant.counts.discount,1);assert.equal(f.merchant.counts.selection,2);assert.equal(f.merchant.counts.pay,1);
 assert.equal(f.state.checkoutRecords[0].discountDispatchedAt,record.discountDispatchedAt);assert.deepEqual(f.state.checkoutRecords[0].slot,record.slot);
});
for(const outcome of ['accepted','unapplied'])test(`persistent loading read failure preserves discount hold and restart observes ${outcome} without reapplying`,async()=>{
 const f=await navigationRun(),send=f.worker.chrome.tabs.sendMessage;f.state.job.discountCode='SYNTHETIC';let reads=0,gross;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='discount-apply'){
   gross=structuredClone(f.merchant.basket);await send(id,request);f.worker.tabs.get(id).status='loading';
   if(outcome==='unapplied')f.merchant.basket=structuredClone(gross);
   throw Error('Unknown acknowledgement PRIVATE');
  }
  if(request.kind==='basket-read'&&f.merchant.counts.discount){if(++reads<=5)return {ok:true,value:structuredClone(gross)};throw Error('Unknown transport PRIVATE');}
  return send(id,request);
 };
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.reasonCode,'PAGE_READY_TIMEOUT');assert.equal(f.state.latestAction.reasonCode,'PAGE_READY_TIMEOUT');
 assert.ok(reads>6);const original=structuredClone(f.state.checkoutRecords[0]);assert.equal(original.phase,'discount-dispatched');assert.ok(original.discountDispatchedAt);
 assert.equal(original.discount,undefined);assert.equal(original.checkoutOpenDispatchedAt,undefined);assert.equal(original.paymentDispatchedAt,undefined);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:1,opening:0,fill:0,pay:0,removal:0});assert.equal(JSON.stringify(f.state).includes('PRIVATE'),false);
 const steps=f.state.runHistory.at(-1).steps,stopped=steps.find(s=>s.name==='page-read-stopped');assert.equal(stopped.remainingMs,0);assert.ok(stopped.messageReadRetries>1);assert.equal(steps[0].name,'started','retry progress must not evict the original run boundary');
 const restarted=await startWorker(f.merchant,f.state,'recreated');restarted.seedTab(original.tabId);
 const result=await restarted.send({kind:'payCheckout'});
 assert.equal(result.status,outcome==='accepted'?'confirmed':'stopped',result.error);
 assert.equal(f.state.checkoutRecords[0].discountDispatchedAt,original.discountDispatchedAt);assert.deepEqual(f.state.checkoutRecords[0].slot,original.slot);assert.equal(f.merchant.counts.discount,1);assert.equal(f.merchant.counts.selection,2);
 assert.equal(f.merchant.counts.pay,outcome==='accepted'?1:0);assert.equal(f.merchant.counts.opening,outcome==='accepted'?1:0);
 if(outcome==='unapplied')assert.equal(f.state.checkoutRecords[0].phase,'discount-dispatched');
});
for(const change of ['extra-item','net-accounting','complete-error','authentication'])test(`post-discount read recovery refuses ${change} without opening or Pay`,async()=>{
 const f=await navigationRun(),send=f.worker.chrome.tabs.sendMessage;f.state.job.discountCode='SYNTHETIC';let reads=0;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='discount-apply'){const response=await send(id,request);f.worker.tabs.get(id).status='loading';return response;}
  if(request.kind==='basket-read'&&f.merchant.counts.discount){
   if(++reads===1){if(change==='complete-error')f.worker.tabs.get(id).status='complete';if(change==='authentication')f.worker.tabs.get(id).url='https://tennistowerhamlets.com/verify-human';throw Error('Unknown PRIVATE');}
   if(change==='extra-item')f.merchant.basket.items.push({...f.merchant.basket.items[0],court:4});
   if(change==='net-accounting')f.merchant.basket.totalGBP='11.00';
   if(change==='complete-error')throw Error('Unknown PRIVATE');
  }
  return send(id,request);
 };
 await f.worker.alarm({name:'release'});assert.equal(f.state.checkoutResult.status,'stopped');assert.equal(f.state.checkoutRecords[0].phase,'discount-dispatched');
 assert.deepEqual(f.merchant.counts,{selection:2,discount:1,opening:0,fill:0,pay:0,removal:0});assert.equal(JSON.stringify(f.state).includes('PRIVATE'),false);
 if(change==='complete-error')assert.equal(f.state.checkoutResult.reasonCode,'PAGE_TAB_ERROR');
 if(change==='authentication')assert.equal(f.state.checkoutResult.reasonCode,'PAGE_AUTHENTICATION_REQUIRED');
});

for(const mode of ['reverted','lost-reply','transport-error','read-failure'])test(`selection failure keeps sanitized evidence and never selects another candidate after ${mode}`,async()=>{
 const f=await navigationRun(),send=f.worker.chrome.tabs.sendMessage;let attempted=false;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='select-slot'){
   attempted=true;f.merchant.counts.selection++;
   if(mode==='lost-reply')return undefined;
   if(mode==='transport-error')throw Error('PRIVATE transport credential');
   return {ok:false,reasonCode:'SELECTION_ACK_TIMEOUT',error:'PRIVATE merchant response',selectionDiagnostic:{expectedHours:2,dispatchedHours:1,acknowledgedHours:0,badgeCount:0,checkboxReverted:true,timeoutMs:60000,elapsedMs:60000,raw:'PRIVATE',network:{correlation:'same-origin-window-only',observedRequests:1,responses:[{status:409,completed:true,body:'PRIVATE'}]}}};
  }
  if(attempted&&request.kind==='basket-read'){
   assert.equal(f.state.checkoutRecords[0].selectionFailure.reasonCode,['lost-reply','transport-error'].includes(mode)?'SELECTION_RESPONSE_UNCERTAIN':'SELECTION_ACK_TIMEOUT','failure evidence must be durable before another observation');
   if(mode==='read-failure')return {ok:false,error:'Unknown basket layout'};
  }
  return send(id,request);
 };
 await f.worker.alarm({name:'release'});assert.equal(f.state.checkoutResult.status,'stopped');
 const code=['lost-reply','transport-error'].includes(mode)?'SELECTION_RESPONSE_UNCERTAIN':'SELECTION_ACK_TIMEOUT';
 assert.equal(f.state.checkoutRecords[0].phase,'selection-dispatched');assert.equal(f.state.checkoutRecords[0].selectionFailure.reasonCode,code);
 if(mode!=='read-failure'){assert.equal(f.state.checkoutResult.reasonCode,code);assert.equal(f.state.latestAction.reasonCode,code);}
 assert.equal(JSON.stringify(f.state).includes('PRIVATE'),false);assert.equal(f.state.checkoutRecords[0].selectionDiagnostic.merchantOutcome,'unknown');
 assert.ok(f.state.runHistory.some(run=>run.steps.some(step=>step.name==='selection-result'&&step.reasonCode===code)));
 // A new VM sees the same durable hold; resume is observation-only, not a
 // retry against the same court or the next candidate, even with an empty basket.
 const restarted=await startWorker(f.merchant,f.state);await restarted.send({kind:'prepareCheckout'});
 assert.deepEqual(f.merchant.counts,{selection:1,discount:0,opening:0,fill:0,pay:0,removal:0});
});
test('uncertain hourly acknowledgement may still use one exactly verified authorized hour without another selection',async()=>{
 const f=await navigationRun(),send=f.worker.chrome.tabs.sendMessage;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind!=='select-slot')return send(id,request);
  f.merchant.slot=structuredClone(request.slot);f.merchant.counts.selection++;f.merchant.selected();
  f.merchant.basket={...f.merchant.basket,items:[f.merchant.basket.items[0]],subtotalGBP:'7.00',totalGBP:'7.00'};
  return {ok:false,reasonCode:'SELECTION_ACK_TIMEOUT',selectionDiagnostic:{expectedHours:2,dispatchedHours:1,acknowledgedHours:0}};
 };
 await f.worker.alarm({name:'release'});assert.equal(f.state.checkoutResult.status,'confirmed',f.state.checkoutResult.error);
 assert.equal(f.state.checkoutRecords[0].slot.hours,1);assert.equal(f.state.checkoutRecords[0].slot.totalGBP,'7.00');assert.equal(f.state.checkoutRecords[0].selectionFailure.reasonCode,'SELECTION_ACK_TIMEOUT');
 assert.deepEqual(f.merchant.counts,{selection:1,discount:0,opening:1,fill:1,pay:1,removal:0});
});

test('scheduled release reuses one freshly read grid and verified basket through one fake payment',async()=>{
 const f=await navigationRun();await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult?.status,'confirmed',f.state.checkoutResult?.error||f.state.result?.error);
 const gridNavigations=f.navigations.filter(n=>n.url.includes('/book/courts/'));
 assert.equal(gridNavigations.length,1,'availability grid must not be loaded again for selection');
 const gridReads=f.reads.filter(r=>r.kind==='grid');assert.equal(gridReads.length,2,'selection needs a fresh DOM observation');assert.equal(gridReads[0].id,gridReads[1].id);
 assert.equal(f.navigations.filter(n=>n.kind==='create'&&n.url.endsWith('/basket')).length,1,'one separate initial empty-basket read');
 assert.equal(f.navigations.filter(n=>n.kind==='update'&&n.url.endsWith('/basket')).length,2,'selected basket and pre-payment server refresh');
 assert.equal(f.reads.filter(r=>r.kind==='basket-read').length,4,'empty, selected, pre-payment and immediately pre-opening checks remain');
 assert.deepEqual(f.merchant.counts,{selection:2,discount:0,opening:1,fill:1,pay:1,removal:0});
 assert.ok(f.state.runHistory.some(run=>run.steps.some(step=>step.name==='grid-existing-read')));
 assert.equal(JSON.stringify(f.state).includes('gridTabId'),false,'tab handoff must not become durable authorization');
});

test('pre-payment refresh detects server basket changes hidden by an unchanged tab DOM',async()=>{
 const f=await navigationRun(),snapshots=new Map(),{create,update,sendMessage}=f.worker.chrome.tabs;let selectedRead=false;
 f.worker.chrome.tabs.create=async changes=>{const tab=await create(changes);if(changes.url.endsWith('/basket'))snapshots.set(tab.id,structuredClone(f.merchant.basket));return tab;};
 f.worker.chrome.tabs.update=async(id,changes)=>{const tab=await update(id,changes);if(changes.url?.endsWith('/basket'))snapshots.set(id,structuredClone(f.merchant.basket));return tab;};
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind!=='basket-read')return sendMessage(id,request);
  const response={ok:true,value:structuredClone(snapshots.get(id))};
  if(!selectedRead&&!response.value.empty){selectedRead=true;f.merchant.basket.items=f.merchant.basket.items.map(item=>({...item,court:4}));}
  return response;
 };
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,'stopped','an old DOM cannot authorize the changed server basket');
 assert.equal(f.state.checkoutResult.reasonCode,'BASKET_MISMATCH');
 assert.deepEqual(f.merchant.counts,{selection:2,discount:0,opening:0,fill:0,pay:0,removal:0});
 assert.equal(f.state.checkoutRecords[0].slot.court,1);assert.equal(f.state.checkoutRecords[0].paymentDispatchedAt,undefined);
});

test('read-only progress response lost during navigation is observed again without reopening checkout',async()=>{
 const f=await navigationRun(),original=f.worker.chrome.tabs.sendMessage;let progressReads=0;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>request.kind==='checkout-progress'&&++progressReads===1?undefined:original(id,request);
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,'confirmed',f.state.checkoutResult.error);assert.ok(progressReads>1);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:0,opening:1,fill:1,pay:1,removal:0});
});

test('persistent missing progress responses time out with the opening journal held and no fill or Pay',async()=>{
 const f=await navigationRun(),original=f.worker.chrome.tabs.sendMessage;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>request.kind==='checkout-progress'?undefined:original(id,request);
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.reasonCode,'CHECKOUT_READY_TIMEOUT');assert.equal(f.state.checkoutResult.status,'stopped');
 assert.ok(f.state.checkoutRecords[0].checkoutOpenDispatchedAt);assert.equal(f.state.checkoutRecords[0].paymentDispatchedAt,undefined);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:0,opening:1,fill:0,pay:0,removal:0});
});

for(const change of ['closed','other-date','card-page','verification','extra-basket-item','price','lower-price','unavailable'])test(`scheduled grid handoff rejects changed state without selection: ${change}`,async()=>{
 const f=await navigationRun();const original=f.worker.chrome.tabs.sendMessage;let changed=false;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  const response=await original(id,request);
  if(!changed&&request.kind==='basket-read'){
   changed=true;const grid=[...f.worker.tabs.values()].find(t=>t.url.includes('/book/courts/'));
   if(change==='closed')f.worker.tabs.delete(grid?.id);
   if(change==='other-date'&&grid)grid.url=grid.url.replace('2026-10-24','2026-10-25');
   if(change==='card-page'&&grid)grid.url='https://tennistowerhamlets.com/basket/pay/card';
   if(change==='verification'&&grid)grid.url='https://tennistowerhamlets.com/verify-human';
   if(change==='extra-basket-item')response.value={empty:false,items:[{court:4}],totalGBP:'7.00'};
  }
  if(changed&&request.kind==='grid'&&['price','lower-price','unavailable'].includes(change))return {ok:true,rows:[20,21].map(hour=>({time:hour===20?'8pm':'9pm',inputs:[{label:change==='lower-price'?'Court 1£6':'Court 1£8',disabled:change==='unavailable'}]}))};
  return response;
 };
 await f.worker.alarm({name:'release'});assert.equal(f.state.latestAction.outcome,'stopped');
 if(['price','lower-price','unavailable'].includes(change))assert.equal(f.state.latestAction.reasonCode,'GRID_CANDIDATE_CHANGED');
 assert.ok(Object.values(f.merchant.counts).every(count=>count===0));
 assert.equal(f.navigations.filter(n=>n.url.includes('/book/courts/')).length,1,'never reload an uncertain handoff');
});

for(const readNumber of [3,4])for(const change of ['extra-item','price','route'])test(`fresh basket handoff check ${readNumber} rejects ${change} before opening or card fill`,async()=>{
 const f=await navigationRun(),original=f.worker.chrome.tabs.sendMessage;let reads=0;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='basket-read'&&++reads===readNumber){
   if(change==='route'){f.worker.tabs.get(id).url='https://tennistowerhamlets.com/basket/pay/card';throw Error('Receiving end does not exist');}
   const value=structuredClone(f.merchant.basket);
   if(change==='extra-item')value.items.push({...value.items[0],court:4});else value.totalGBP='13.00';
   return {ok:true,value};
  }
  return original(id,request);
 };
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,'stopped');assert.equal(f.merchant.counts.selection,2);
 assert.deepEqual([f.merchant.counts.opening,f.merchant.counts.fill,f.merchant.counts.pay,f.merchant.counts.removal],[0,0,0,0]);
 assert.equal(f.state.checkoutRecords.length,1);assert.equal(f.state.checkoutRecords[0].paymentDispatchedAt,undefined);
 assert.equal(f.navigations.filter(n=>n.kind==='update'&&n.url.endsWith('/basket')).length,2,'exactly one pre-payment refresh, no additional reload after the mismatch');
});

for(const option of ['partial','discount','fallback-venue','third-venue','empty'])test(`navigation reuse preserves ${option} release behavior`,async()=>{
 const f=await navigationRun(),original=f.worker.chrome.tabs.sendMessage;
 if(option==='partial')f.merchant.options.partial=true;
 if(option==='discount')f.state.job.discountCode='SYNTHETIC';
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='grid'&&(option==='empty'||option==='fallback-venue'&&request.venue==='bethnal-green-gardens'||option==='third-venue'&&request.venue!=='victoria-park'))return {ok:true,rows:[]};
  return original(id,request);
 };
 await f.worker.alarm({name:'release'});
 if(option==='empty'){
  assert.equal(f.state.checkoutResult.status,'stopped');assert.equal(f.worker.tabs.size,0);assert.ok(Object.values(f.merchant.counts).every(count=>count===0));
 }else{
  assert.equal(f.state.checkoutResult.status,'confirmed',f.state.checkoutResult.error);
  assert.equal(f.merchant.counts.pay,1);assert.equal(f.merchant.counts.opening,1);
  assert.equal(f.merchant.counts.discount,option==='discount'?1:0);
  if(option==='partial'){assert.equal(f.state.checkoutResult.slot.hours,1);assert.equal(f.state.checkoutResult.totalPaidGBP,'7.00');}
  if(option==='fallback-venue')assert.equal(f.state.checkoutResult.slot.venue,'st-johns-park');
  if(option==='third-venue')assert.equal(f.state.checkoutResult.slot.venue,'victoria-park');
 }
});

for(const fault of ['persist:selection:before','persist:selection:after','dispatch:selection:after','persist:opening:after','dispatch:opening:after','dispatch:pay:after'])test(`scheduled handoff interruption preserves journal on restart: ${fault}`,async()=>{
 const f=await navigationRun();f.merchant.fault(fault);await f.worker.alarm({name:'release'});
 assert.equal(f.merchant.faults.has(fault),false);const before=structuredClone(f.merchant.counts),records=structuredClone(f.state.checkoutRecords||[]);
 const restarted=await startWorker(f.merchant,f.state,'recreated');await restarted.alarm({name:'release'});
 assert.deepEqual(f.merchant.counts,before,'worker recreation cannot replay a release mutation');
 assert.deepEqual(f.state.checkoutRecords||[],records);
});
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

async function freeRun(){
 const f=await navigationRun();f.state.job.discountCode='SYNTHETIC';f.merchant.options.freeBooking=true;
 f.merchant.options.receiptResponse=request=>f.merchant.freeSubmitted?receiptResponse(request,`Booking reference: 100001\nBethnal Green Gardens\nCourt 1\nPlaying date: 24 October 2026\nStart time: 8:00pm\nDuration: 2 hours\nTotal: £ free`,'Booking confirmed'):{ok:true,value:{status:'awaiting-payment'}};
 return f;
}
test('release completes a full-discount booking without any card/open/Pay, and restart is receipt-only',async()=>{
 const f=await freeRun();await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,'confirmed',f.state.checkoutResult.error);assert.equal(f.state.checkoutResult.paid,false);assert.equal(f.state.checkoutResult.booked,true);assert.equal(f.state.checkoutResult.freeBooking,true);
 assert.deepEqual(f.merchant.counts,{selection:2,discount:1,opening:0,fill:0,pay:0,removal:0,free:1});
 const record=f.state.checkoutRecords[0];assert.equal(record.slot.totalGBP,'14.00');assert.ok(record.freeBookingDispatchedAt);assert.equal(record.paymentDispatchedAt,record.freeBookingDispatchedAt);
 await (await startWorker(f.merchant,f.state)).send({kind:'payCheckout'});assert.equal(f.merchant.counts.free,1);
});
for(const mode of ['transient','late'])test(`free confirmation observes ${mode} read evidence within its deadline without submission replay`,async()=>{
 const f=await freeRun(),send=f.worker.chrome.tabs.sendMessage;let reads=0;
 f.worker.chrome.tabs.sendMessage=async(id,request)=>{
  if(request.kind==='receipt-read'&&request.freeBooking){reads++;
   if(mode==='transient'&&reads<3)throw Error('The message port closed before a response was received');
   if(mode==='late')f.merchant.clock+=60000;
  }
  return send(id,request);
 };
 await f.worker.alarm({name:'release'});
 assert.equal(f.state.checkoutResult.status,mode==='transient'?'confirmed':'stopped',f.state.checkoutResult.error);
 assert.equal(f.merchant.counts.free,1);assert.equal(f.merchant.counts.opening,0);assert.equal(f.merchant.counts.fill,0);assert.equal(f.merchant.counts.pay,0);
 if(mode==='late')assert.equal(f.state.checkoutRecords[0].status,'pending');
});
for(const label of ['persist:pay:before','persist:pay:after','dispatch:free:before','dispatch:free:after'])test(`free booking ${label}: restart preserves hold and never replays an uncertain submission`,async()=>{
 const f=await freeRun();f.merchant.fault(label);await f.worker.alarm({name:'release'});assert.equal(f.merchant.faults.has(label),false);
 const dispatched=structuredClone(f.state.checkoutRecords[0]),restart=await startWorker(f.merchant,f.state);restart.seedTab(dispatched.tabId,f.merchant.freeSubmitted?'https://tennistowerhamlets.com/basket/receipt':'https://tennistowerhamlets.com/basket');
 const result=await restart.send({kind:'payCheckout'});
 if(dispatched.status==='confirmed')assert.equal(result.status,'stopped');
 else if(label==='persist:pay:before')assert.equal(result.status,'confirmed',result.error);else {assert.equal(result.status,'stopped');assert.equal(f.state.checkoutRecords[0].freeBookingDispatchedAt,dispatched.freeBookingDispatchedAt);}
 assert.ok((f.merchant.counts.free||0)<=1);assert.equal(f.merchant.counts.discount,1);assert.equal(f.merchant.counts.selection,2);assert.equal(f.merchant.counts.opening,0);assert.equal(f.merchant.counts.fill,0);assert.equal(f.merchant.counts.pay,0);
});
test('free merchant error leaves a protected hold, cannot archive/prepare or fall back to account history',async()=>{
 const f=await freeRun();f.merchant.options.receiptResponse=()=>({ok:true,value:{status:'awaiting-payment'}});await f.worker.alarm({name:'release'});
 const record=structuredClone(f.state.checkoutRecords[0]);assert.equal(f.state.checkoutResult.reasonCode,'FREE_BOOKING_UNRESOLVED');
 const restart=await startWorker(f.merchant,f.state);restart.seedTab(record.tabId,'https://tennistowerhamlets.com/basket/receipt');
 for(const message of [{kind:'payCheckout'},{kind:'verifyPayment'},{kind:'prepareCheckout'},{kind:'reconcileSelection'},{kind:'archiveFailedCheckout',noPaymentConfirmed:true,attestationIdentity:JSON.stringify([record.key,record.checkoutOpenDispatchedAt])}])assert.equal((await restart.send(message)).status,'stopped');
 assert.equal(f.state.checkoutRecords[0].paymentDispatchedAt,record.paymentDispatchedAt);assert.equal(f.merchant.counts.free,1);assert.equal(f.merchant.counts.pay,0);
});
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
