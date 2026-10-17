import {failureFor} from './failures.js';
// Serialize metadata read/check/write operations, not the actions themselves.
// Chrome storage has no CAS: a separate get + conditional set without this
// queue could still let an in-flight old set overwrite a newer start.
const writes=new WeakMap();
function update(storage,operation){
 const next=(writes.get(storage)||Promise.resolve()).then(operation);
 writes.set(storage,next.catch(()=>{}));return next;
}
export async function executeAction(storage,kind,run,{version='unknown',source='popup'}={}){
 const action={id:crypto.randomUUID(),kind,source,version,startedAt:new Date().toISOString(),outcome:'running'};
 await update(storage,async()=>{
  const {latestAction}=await storage.get('latestAction');
  const previous=Number.isSafeInteger(latestAction?.sequence)?latestAction.sequence:0;
  if(previous<0||previous===Number.MAX_SAFE_INTEGER)throw Error('Action ordering unavailable');
  action.sequence=previous+1;
  await storage.set({latestAction:action});
 });
 const finish=fields=>update(storage,async()=>{
  const {latestAction}=await storage.get('latestAction');
  if(latestAction?.id!==action.id||latestAction.sequence!==action.sequence)return;
  await storage.set({latestAction:{...action,finishedAt:new Date().toISOString(),...fields}});
 });
 // MV3 has one active worker. Termination discards its pending callbacks;
 // a replacement worker reads the persisted sequence. A running status is
 // never evidence that a mutation failed, nor permission to replay it.
 try{
  const result=await run();
  const stopped=result?.status==='stopped';
  await finish({outcome:stopped?'stopped':'complete',status:result?.status||'complete',...(result?.runId?{runId:result.runId}:{}),...(stopped?failureFor(result,{operation:kind,paymentPossible:result.paid===null}):{})});
  return result;
 }catch(error){
  await finish({outcome:'stopped',...failureFor(error,{operation:kind,paymentPossible:['payCheckout','verifyPayment','reconcileManualPayment'].includes(kind)})});
  throw error;
 }
}
