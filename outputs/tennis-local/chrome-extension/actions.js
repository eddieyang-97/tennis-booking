import {failureFor} from './failures.js';
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
