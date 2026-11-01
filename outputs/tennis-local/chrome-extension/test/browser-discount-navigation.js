// Synthetic navigation hypotheses for the unrecorded 30 October destination.
// Real Chromium, content scripts and worker; only the loopback merchant is used.
import assert from 'node:assert/strict';
export async function discountNavigationBrowserCases({fresh,send,currentWorker,restart,returnToBasket,merchant,reports}){
 for(const mode of ['return','free','error','unknown','changed']){
  await fresh('discount-navigation-'+mode);let worker=currentWorker();
  merchant.state.options.discountNavigation=mode==='free'?'return':mode;merchant.state.options.freeBooking=mode==='free';
  const armed=await send({kind:'armPayment',day:'2026-10-27',discountCode:'FAKEONLY'});assert.equal(armed.status,'armed',armed.error);
  await worker.evaluate(async()=>{await globalThis.__testAlarm({name:'prepare'});const {job}=await chrome.storage.local.get('job');globalThis.__testClock=job.when;await globalThis.__testAlarm({name:'release'});});
  let state=await send({kind:'status'}),record=state.checkoutRecords[0];
  const success=['return','free'].includes(mode);assert.equal(state.checkoutResult.status,success?'confirmed':'stopped',state.checkoutResult.error);
  assert.equal(merchant.state.counts.discount,1);assert.ok(record.discountDispatchedAt);assert.equal(merchant.state.counts.selection,2);
  if(success){
   assert.ok(state.runHistory.some(run=>run.steps.some(step=>step.name==='discount-navigation-observed'&&step.destination==='discount-endpoint')),'must actually observe intermediate POST route');
   if(mode==='free'){assert.equal(merchant.state.counts.free,1);assert.equal(merchant.state.counts.pay,0);assert.equal(merchant.state.counts.fill,0);assert.equal(merchant.state.counts.opening,0);}
   else {assert.equal(merchant.state.counts.pay,1);assert.equal(merchant.state.counts.fill,1);assert.equal(merchant.state.counts.opening,1);}
  }else{
   assert.equal(record.phase,'discount-dispatched');assert.equal(record.discount,undefined);assert.equal(record.paymentDispatchedAt,undefined);assert.equal(record.checkoutOpenDispatchedAt,undefined);
   assert.equal(merchant.state.counts.pay,0);assert.equal(merchant.state.counts.fill,0);assert.equal(merchant.state.counts.opening,0);
   if(mode==='error'){
    assert.equal(state.latestAction.reasonCode,'DISCOUNT_MERCHANT_ERROR');
    assert.ok(state.runHistory.some(run=>run.steps.some(step=>step.destination==='discount-endpoint'&&step.pageType==='merchant-error')));
    const original=structuredClone(record);worker=await restart();
    assert.equal((await send({kind:'payCheckout'})).status,'stopped');assert.deepEqual((await send({kind:'status'})).checkoutRecords[0],original);assert.equal(merchant.state.counts.discount,1);assert.equal(merchant.state.counts.pay,0);
    // Only the test driver simulates the later site returning to a valid basket.
    await returnToBasket();
    assert.equal((await send({kind:'payCheckout'})).status,'confirmed');state=await send({kind:'status'});record=state.checkoutRecords[0];
    assert.equal(record.discountDispatchedAt,original.discountDispatchedAt);assert.equal(merchant.state.counts.discount,1);assert.equal(merchant.state.counts.pay,1);
   }
   if(mode==='unknown')assert.equal(state.latestAction.reasonCode,'PAGE_BASKET_ROUTE_CHANGED');
  }
  reports.push({scenario:'discount-navigation-'+mode,outcome:'passed',evidence:'synthetic-post-navigation-real-content-scripts',...(mode==='error'?{workerRestart:'ServiceWorker.stopWorker'}:{}),mutations:{...merchant.state.counts}});
 }
}
