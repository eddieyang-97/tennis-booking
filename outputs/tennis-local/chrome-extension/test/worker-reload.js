import test from 'node:test';
import assert from 'node:assert/strict';
import {Merchant} from './merchant.js';
import {startWorker} from './worker-harness.js';

for(const blocker of ['job','running'])test(`reload refuses ${blocker} without clearing card or journal`,async()=>{
 const merchant=new Merchant(),record=merchant.record({paymentDispatchedAt:'preserved',reference:'100001'}),state={checkoutRecords:[record],[blocker]:{day:'2026-10-25'}},worker=await startWorker(merchant,state);
 const result=await worker.send({kind:'reloadExtension'});
 assert.equal(result.status,'stopped');assert.match(result.error,/before reloading/);
 assert.deepEqual(state.checkoutRecords,[record]);assert.ok(state[blocker]);assert.equal(worker.reloads,0);assert.deepEqual(worker.sessionRemovals,[]);
 assert.ok(Object.values(merchant.counts).every(n=>n===0));
});
test('reload finishes metadata, preserves financial holds/results, and stops queued actions until worker recreation',async()=>{
 const merchant=new Merchant(),record=merchant.record({paymentDispatchedAt:'preserved',manualPaymentReportedAt:'preserved',reference:'100001',priorReferences:[{reference:'99999'}]}),state={checkoutRecords:[record],checkoutResult:{status:'stopped',paid:null},runHistory:[{id:'preserved'}],bookingSettings:{preserved:true}},before=structuredClone(state),worker=await startWorker(merchant,state);
 worker.chrome.runtime.reload=()=>{assert.equal(state.latestAction.outcome,'complete');assert.equal(state.latestAction.kind,'reloadExtension');worker.reloads++;};
 const [reload,arm]=await Promise.all([worker.send({kind:'reloadExtension'}),worker.send({kind:'armPayment',day:'2026-10-27'})]);
 assert.equal(reload.status,'reloading');assert.equal(arm.status,'stopped');assert.match(arm.error,/reloading/);assert.equal(state.job,undefined);
 for(const [key,value] of Object.entries(before))assert.deepEqual(state[key],value);
 assert.equal(worker.reloads,1);assert.deepEqual(worker.sessionRemovals,['localPaymentCard']);assert.ok(Object.values(merchant.counts).every(n=>n===0));
 const recreated=await startWorker(merchant,state);assert.equal((await recreated.send({kind:'status'})).checkoutRecords[0].paymentDispatchedAt,'preserved');assert.equal(recreated.reloads,0);
});
test('reload behind an arming action cannot reload an armed extension',async()=>{
 const merchant=new Merchant(),worker=await startWorker(merchant,{});
 const [arm,reload]=await Promise.all([worker.send({kind:'armPayment',day:'2026-10-27'}),worker.send({kind:'reloadExtension'})]);
 assert.equal(arm.status,'armed',arm.error);assert.equal(reload.status,'stopped');assert.equal(worker.reloads,0);assert.deepEqual(worker.sessionRemovals,[]);
});
for(const failure of ['session','finish'])test(`reload does not run when ${failure} storage fails`,async()=>{
 const worker=await startWorker(new Merchant(),{});
 if(failure==='session')worker.chrome.storage.session.remove=async()=>{throw Error('Session unavailable');};
 else {const set=worker.chrome.storage.local.set;worker.chrome.storage.local.set=async value=>{if(value.latestAction?.finishedAt)throw Error('Storage unavailable');return set(value);};}
 assert.equal((await worker.send({kind:'reloadExtension'})).status,'stopped');assert.equal(worker.reloads,0);
});

test('reload keeps the production popup sender boundary',async()=>{
 const worker=await startWorker(new Merchant(),{});
 for(const sender of [{id:'other',url:'chrome-extension://test/popup.html'},{id:'test',url:'chrome-extension://test/popup.html',tab:{id:42}}]){
  assert.equal(worker.listener({kind:'reloadExtension'},sender,()=>assert.fail('Untrusted reply')),undefined);
 }
 assert.equal(worker.reloads,0);assert.deepEqual(worker.sessionRemovals,[]);
});
