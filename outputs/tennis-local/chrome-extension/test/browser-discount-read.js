// Permanent regression invoked by the maintained isolated browser/CI runner.
// Only synthetic Chrome-boundary faults are injected. Real content scripts
// perform the final basket/checkout reads; the merchant is loopback-only.
import assert from 'node:assert/strict';
export async function discountReadBrowserCase({fresh,send,currentWorker,merchant,reports}){
 await fresh('discount-loading-read-profile');
 const worker=currentWorker();
 await worker.evaluate(()=>{
  const send=chrome.tabs.sendMessage.bind(chrome.tabs),get=chrome.tabs.get.bind(chrome.tabs);
  let active=false,tabId,lastBasket,gross,reads=0;
  chrome.tabs.get=async id=>{const tab=await get(id);return active&&id===tabId&&reads<=6?{...tab,status:'loading'}:tab;};
  chrome.tabs.sendMessage=async(id,request,...rest)=>{
   if(request.kind==='discount-apply'){active=true;tabId=id;gross=structuredClone(lastBasket);}
   if(active&&request.kind==='basket-read'&&id===tabId){
    reads++;globalThis.__discountReadFaultCount=reads;
    if(reads<=5)return {ok:true,value:structuredClone(gross)};
    if(reads===6)throw Error('Synthetic unclassified Chrome read failure PRIVATE');
   }
   const response=await send(id,request,...rest);
   if(request.kind==='basket-read'&&response?.ok)lastBasket=response.value;
   return response;
  };
 });
 const armed=await send({kind:'armPayment',day:'2026-10-27',discountCode:'FAKEONLY'});assert.equal(armed.status,'armed',armed.error);
 await worker.evaluate(async()=>{await globalThis.__testAlarm({name:'prepare'});const {job}=await chrome.storage.local.get('job');globalThis.__testClock=job.when;await globalThis.__testAlarm({name:'release'});});
 const state=await send({kind:'status'});assert.equal(state.checkoutResult?.status,'confirmed',state.checkoutResult?.error||state.result?.error||state.latestAction?.reasonCode);
 const record=state.checkoutRecords[0];
 assert.equal(state.checkoutResult.status,'confirmed',state.checkoutResult.error);
 assert.equal(record.slot.totalGBP,'14.00');assert.equal(record.discount.totalGBP,'12.00');assert.ok(record.discountDispatchedAt);
 assert.deepEqual(merchant.state.counts,{selection:2,discount:1,opening:1,fill:1,pay:1,removal:0});
 assert.ok(await worker.evaluate(()=>globalThis.__discountReadFaultCount>=7));
 assert.ok(state.runHistory.some(run=>run.steps.some(step=>step.name==='page-message-read-retry'&&step.reason==='unclassified-tab-error')));
 assert.equal(JSON.stringify(state).includes('PRIVATE'),false);
 reports.push({scenario:'discount-five-loading-reads-message-failure-recovery',outcome:'passed',evidence:'local-fake-merchant-with-injected-Chrome-boundary-fault',mutations:{...merchant.state.counts}});
}
