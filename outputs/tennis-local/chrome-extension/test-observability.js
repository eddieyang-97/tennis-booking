import test from 'node:test';
import assert from 'node:assert/strict';
import {failureFor} from './failures.js';
import {executeAction} from './actions.js';
import {reconcileClearedSelection} from './checkout.js';
import {diagnosticExport} from './diagnostics.js';
import {analyzeLogs} from './test/analyze-logs.js';

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
