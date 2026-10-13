let writes=Promise.resolve();
export function startRun(storage,kind,day) {
 const record={id:crypto.randomUUID(),kind,day,startedAt:new Date().toISOString(),status:'running',steps:[]};
 async function step(name,detail={}) {
  record.steps.push({name,at:new Date().toISOString(),...detail});record.steps=record.steps.slice(-100);
  writes=writes.catch(()=>{}).then(async()=>{
   const {runHistory=[]}=await storage.get('runHistory');
   await storage.set({runHistory:[...runHistory.filter(r=>r.id!==record.id),structuredClone(record)].slice(-20)});
  });
  await writes;
 }
 return {record,step,async finish(status){record.status=status;record.finishedAt=new Date().toISOString();await step('finished',{status});}};
}
