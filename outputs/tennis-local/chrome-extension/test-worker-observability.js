import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {executeAction} from './actions.js';
import {failureFor} from './failures.js';

// Run the actual worker functions with only their boundary dependencies stubbed.
// This is a focused orchestration regression, not a merchant/browser simulator.
const source=fs.readFileSync(new URL('./background.js',import.meta.url),'utf8');
function workerFunction(name,end,context){
 const start=source.indexOf(`async function ${name}(`),stop=source.indexOf(end,start);
 assert.ok(start>=0&&stop>start);return vm.runInNewContext('('+source.slice(start,stop)+')',context);
}
function fixture(){
 const state={},steps=[];
 const storage={get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value)),remove:async key=>delete state[key]};
 const context={chrome:{storage:{local:storage},action:{setBadgeText:async()=>{}}},busy:false,trace:null,resumedTab:null,Date,failureFor,
  newRun:()=>({record:{id:'synthetic-run'},finish:async()=>{}}),step:async(name,detail)=>steps.push({name,...detail}),
  notifyPaymentResult:async()=>{},save:async()=>{},paymentCard:async()=>null,resolvePendingPayment:async()=>{}};
 return {state,steps,storage,context};
}
for(const [mode,status,paid] of [['checkout','stopped',false],['checkout','awaiting-payment',false],['payment','stopped',null],['payment','confirmed',true]])test(`alarm propagates ${mode} ${status} instead of fabricating completion`,async()=>{
 const f=fixture();f.state.job={mode,prepared:true,day:'2026-10-23'};let selections=0,payments=0;
 const expected={status,paid,booked:paid===true?null:paid,runId:'synthetic-result',...(status==='stopped'?{error:'Unique matching purchase not found: observed 0 matches'}:{})};
 Object.assign(f.context,{check:async()=>{f.state.result={status:'complete'};},checkout:async()=>{selections++;return mode==='payment'?{status:'awaiting-payment'}:expected;},automaticPayment:async()=>{payments++;return expected;}});
 const alarm=workerFunction('runAlarm','chrome.alarms.onAlarm.addListener',f.context);
 const result=await executeAction(f.storage,'release',()=>alarm({name:'release'}),{source:'alarm'});
 assert.equal(result?.status,status);assert.equal(result?.runId,expected.runId);assert.equal(f.state.latestAction.status,status);
 assert.equal(f.state.latestAction.outcome,status==='stopped'?'stopped':'complete');
 if(paid===null)assert.equal(f.state.latestAction.recovery.mode,'payment-reconciliation');
 assert.equal(selections,1);assert.equal(payments,mode==='payment'?1:0);assert.equal(f.state.job,undefined);
});

for(const marker of ['paymentDispatchedAt','manualPaymentReportedAt'])for(const command of ['verifyPayment','automaticPayment'])test(`${command} preserves ${marker} reconciliation in trace, latest status and journal`,async()=>{
 const f=fixture(),record={status:'pending',phase:'awaiting-payment',slot:{date:'2026-10-23'},reference:'100001',[marker]:'2026-10-16T23:00:00Z'};
 f.state.checkoutRecords=[record];
 f.context.finishPaidRecord=async()=>{throw Error('Unique matching purchase not found: observed 0 matches');};
 const fn=workerFunction(command,command==='verifyPayment'?'chrome.notifications?.onClicked':'async function notifyCheckout',f.context);
 await executeAction(f.storage,command==='automaticPayment'?'payCheckout':command,()=>fn()).catch(()=>{});
 const stopped=f.steps.find(step=>step.name==='stopped');assert.ok(stopped);
 assert.equal(stopped.recovery.mode,'payment-reconciliation');assert.equal(stopped.recovery.automaticReplayAllowed,false);
 assert.equal(f.state.latestAction.recovery.mode,'payment-reconciliation');assert.equal(f.state.checkoutResult.paid,null);
 assert.deepEqual(f.state.checkoutRecords,[record]);
});
