import test from 'node:test';
import assert from 'node:assert/strict';
import {failureFor} from './failures.js';
import {executeAction} from './actions.js';
import {reconcileClearedSelection} from './checkout.js';
import {diagnosticExport} from './diagnostics.js';
import {analyzeLogs} from './test/analyze-logs.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function actionStorage(){
 const state={checkoutResult:{status:'payment-uncertain',runId:'historical'},checkoutRecords:[{status:'pending',paymentDispatchedAt:'2026-10-16T23:00:00Z',reference:'100001'}]};
 const storage={get:async()=>structuredClone(state),set:async value=>{await turn();Object.assign(state,structuredClone(value));}};
 return {state,storage};
}

test('worker error codes determine recovery independently of arbitrary message text',()=>{
 const cases=[
  [Object.assign(Error('private response'),{code:'UNRESOLVED_CHECKOUT',attemptedDay:'2026-10-25'}),'UNRESOLVED_CHECKOUT','payment-reconciliation'],
  [Object.assign(Error('private response'),{diagnostic:{page:'account',errorCode:'PAGE_READY_TIMEOUT',retainedTabId:42}}),'PAGE_READY_TIMEOUT','read-only-observation'],
  [{status:'stopped',error:'private response',diagnostic:{errorCode:'GRID_READY_TIMEOUT'}},'GRID_READY_TIMEOUT','read-only-observation'],
  [{reasonCode:'PAGE_AUTHENTICATION_REQUIRED',error:'still loading'},'PAGE_AUTHENTICATION_REQUIRED','user-action'],
  [{errorCode:'GRID_LAYOUT_REJECTED',error:'still loading'},'GRID_LAYOUT_REJECTED','manual-review'],
  [{code:'UNKNOWN_PRIVATE_CODE',diagnostic:{errorCode:'PAGE_TAB_ERROR'}},'PAGE_TAB_ERROR','read-only-observation']
 ];
 for(const [error,reasonCode,mode] of cases){
  error.card='SENSITIVE_CARD';error.reference='SENSITIVE_REFERENCE';error.credentials='SENSITIVE_CREDENTIALS';
  const result=failureFor(error,{operation:'armPayment'});
  assert.deepEqual(result,{reasonCode,operation:'armPayment',recovery:{mode,automaticReplayAllowed:false}});
  assert.doesNotMatch(JSON.stringify(result),/private|SENSITIVE/);
  assert.equal(failureFor(error,{paymentPossible:true}).recovery.mode,'payment-reconciliation');
 }
});

for(const order of ['older-first','newer-first'])for(const failure of ['none','older','newer','returned-older','returned-newer'])test(`latest action ordering: ${order}, failure=${failure}`,async()=>{
 const {state,storage}=actionStorage(),original=structuredClone(state),old=deferred(),recent=deferred(),oldStarted=deferred(),recentStarted=deferred();
 const invoke=(kind,gate,started)=>executeAction(storage,kind,async()=>{started.resolve();await gate.promise;if(failure===kind)throw Object.assign(Error('private response'),{code:'UNRESOLVED_CHECKOUT'});if(failure==='returned-'+kind)return {status:'stopped',errorCode:'PAGE_READY_TIMEOUT',error:'private response',paid:false};return {status:'complete'};});
 const older=invoke('older',old,oldStarted).catch(error=>error);await oldStarted.promise;
 const newer=invoke('newer',recent,recentStarted).catch(error=>error);await recentStarted.promise;
 const id=state.latestAction.id;
 const first=order==='older-first'?old:recent,last=order==='older-first'?recent:old;
 first.resolve();await (order==='older-first'?older:newer);
 assert.equal(state.latestAction.id,id);assert.equal(state.latestAction.kind,'newer');
 if(order==='older-first')assert.equal(state.latestAction.outcome,'running');
 last.resolve();await Promise.all([older,newer]);
 assert.equal(state.latestAction.id,id);assert.equal(state.latestAction.kind,'newer');
 assert.equal(state.latestAction.outcome,['newer','returned-newer'].includes(failure)?'stopped':'complete');
 if(failure==='newer')assert.equal(state.latestAction.reasonCode,'UNRESOLVED_CHECKOUT');
 if(failure==='returned-newer'){assert.equal(state.latestAction.reasonCode,'PAGE_READY_TIMEOUT');assert.equal(state.latestAction.recovery.mode,'read-only-observation');}
 assert.doesNotMatch(JSON.stringify(state.latestAction),/private response/);
 assert.deepEqual(state.checkoutRecords,original.checkoutRecords);assert.deepEqual(state.checkoutResult,original.checkoutResult);
});

test('start registration retains invocation order despite delayed Chrome persistence',async()=>{
 const {state,storage}=actionStorage(),hold=deferred(),writing=deferred(),set=storage.set;
 storage.set=async value=>{if(value.latestAction.kind==='older'&&value.latestAction.outcome==='running'){writing.resolve();await hold.promise;}await set(value);};
 const older=executeAction(storage,'older',async()=>({status:'complete'}));await writing.promise;
 const newer=executeAction(storage,'newer',async()=>({status:'complete'}));hold.resolve();await Promise.all([older,newer]);
 assert.equal(state.latestAction.kind,'newer');assert.equal(state.latestAction.sequence,2);
});

test('failed status persistence does not run or automatically retry the action or poison later metadata writes',async()=>{
 const {state,storage}=actionStorage(),set=storage.set;let calls=0;
 storage.set=async value=>{if(value.latestAction.kind==='failed')throw Error('Storage unavailable');return set(value);};
 await assert.rejects(executeAction(storage,'failed',async()=>{calls++;}),/Storage unavailable/);
 await executeAction(storage,'next',async()=>({status:'complete'}));
 assert.equal(calls,0);assert.equal(state.latestAction.kind,'next');assert.equal(state.checkoutRecords[0].status,'pending');
});

test('delayed Chrome writes cannot publish an old completion after a newer start',async()=>{
 const {state,storage}=actionStorage(),write=deferred(),writing=deferred(),old=deferred(),started=deferred();
 const set=storage.set;storage.set=async value=>{if(value.latestAction.kind==='older'&&value.latestAction.outcome==='complete'){writing.resolve();await write.promise;}await set(value);};
 const older=executeAction(storage,'older',async()=>{started.resolve();await old.promise;return {status:'complete'};});await started.promise;old.resolve();await writing.promise;
 const newer=executeAction(storage,'newer',async()=>({status:'complete'}));await turn();write.resolve();await Promise.all([older,newer]);
 assert.equal(state.latestAction.kind,'newer');assert.equal(state.latestAction.outcome,'complete');assert.equal(state.latestAction.sequence,2);
});

test('worker recreation resumes persisted ordering without completing interrupted work or changing payment holds',async()=>{
 const {state,storage}=actionStorage(),original=structuredClone(state);
 state.latestAction={id:'interrupted',sequence:41,outcome:'running',kind:'payCheckout'};
 const restarted=await import('./actions.js?fresh-worker');
 await restarted.executeAction(storage,'assess',async()=>({status:'complete'}));
 assert.equal(state.latestAction.sequence,42);assert.notEqual(state.latestAction.id,'interrupted');
 assert.deepEqual(state.checkoutRecords,original.checkoutRecords);assert.deepEqual(state.checkoutResult,original.checkoutResult);
});

test('safe blockers distinguish missing/duplicate/unknown purchase and early reference failure',()=>{
 for(const [message,code] of [['Unique matching purchase not found for reference 100001: observed 0 matches','PURCHASE_MISSING'],['Unique matching purchase not found for reference 100001: observed 2 matches','PURCHASE_AMBIGUOUS'],['Test payment reference unavailable','REFERENCE_UNAVAILABLE'],['Purchase history layout not verified','PURCHASE_LAYOUT_UNKNOWN']])assert.equal(failureFor(Error(message)).reasonCode,code);
 assert.equal(failureFor(Error('secret arbitrary response')).reasonCode,'UNCLASSIFIED_FAILURE');
 assert.equal(JSON.stringify(failureFor(Error('secret arbitrary response'))).includes('secret'),false);
 assert.equal(failureFor(Error('no receipt'),{paymentPossible:true}).recovery.mode,'payment-reconciliation');
});
test('latest action survives early failure separately from old checkout result; raw input is not recorded',async()=>{
 const state={checkoutResult:{status:'checkout-test-passed',runId:'older'}};
 const storage={get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value))};
 await assert.rejects(executeAction(storage,'resetUnpaidTest',async()=>{assert.equal(state.latestAction.outcome,'running');throw Error('Test payment reference unavailable');},{version:'test'}));
 assert.equal(state.latestAction.reasonCode,'REFERENCE_UNAVAILABLE');assert.equal(state.latestAction.outcome,'stopped');assert.equal(state.checkoutResult.runId,'older');
 assert.equal(diagnosticExport(state).latestAction.reasonCode,'REFERENCE_UNAVAILABLE');
});
test('attested abandonment records its basis and never claims merchant-unpaid or cancelled',()=>{
 const record={status:'pending',checkoutTestOnly:true,phase:'test-cleanup-checking',reference:'100001',key:'synthetic',slot:{}};
 const {abandoned}=reconcileClearedSelection([record],{empty:true,items:[]},{unpaidTestConfirmed:true});
 assert.equal(abandoned.abandonmentEvidence.basis,'owner-attested-no-payment');
 assert.equal(abandoned.abandonmentEvidence.reference,'100001');assert.equal(abandoned.abandonmentEvidence.merchantPaymentState,'unknown');assert.equal(abandoned.abandonmentEvidence.merchantCancellationState,'unknown');
});
test('log comparison deduplicates historical runs without attributing export version or leaking references',()=>{
 const run={id:'synthetic-run',version:'old-build',kind:'unpaid-test-cleanup',steps:[{name:'started'}]};
 const result=analyzeLogs([{version:'new-build',checkoutRecords:[{reference:'100001'}],runHistory:[run]},{runHistory:[{...run,steps:[...run.steps,{name:'cleanup-stopped',reasonCode:'PURCHASE_MISSING'}]}]}]);
 assert.equal(result.runs.length,1);assert.equal(result.runs[0].version,'old-build');assert.equal(result.runs[0].firstFailure,'PURCHASE_MISSING');assert.equal(JSON.stringify(result).includes('100001'),false);assert.equal(result.runs[0].mutationCountsComplete,false);
});
