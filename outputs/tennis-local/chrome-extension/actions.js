import {failureFor} from './failures.js';
// MV3 has one active worker. Serialize its mutation entry points; status and
// frame discovery stay outside this queue to avoid deadlocking an active run.
export function createSerialExecutor(){let tail=Promise.resolve();return run=>{const next=tail.then(run);tail=next.catch(()=>{});return next;};}
export async function executeAction(storage,kind,run,{version='unknown',source='popup'}={}){
 const action={id:crypto.randomUUID(),kind,source,version,startedAt:new Date().toISOString(),outcome:'running'};
 await storage.set({latestAction:action});
 try{
  const result=await run();
  const stopped=result?.status==='stopped';
  await storage.set({latestAction:{...action,finishedAt:new Date().toISOString(),outcome:stopped?'stopped':'complete',status:result?.status||'complete',...(result?.runId?{runId:result.runId}:{}),...(stopped?failureFor(result,{operation:kind,paymentPossible:result.paid===null}):{})}});
  return result;
 }catch(error){
  await storage.set({latestAction:{...action,finishedAt:new Date().toISOString(),outcome:'stopped',...failureFor(error,{operation:kind,paymentPossible:['payCheckout','verifyPayment','reconcileManualPayment'].includes(kind)})}});
  throw error;
 }
}
