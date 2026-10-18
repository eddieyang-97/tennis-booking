import fs from 'node:fs';
export function analyzeLogs(exports){
 const runs=new Map();
 for(const snapshot of exports)for(const run of snapshot.runHistory||[]){
  if(typeof run.id!=='string')continue;
  const old=runs.get(run.id);if(!old||(run.steps?.length||0)>(old.steps?.length||0))runs.set(run.id,run);
 }
 return {format:'tennis-log-analysis',evidence:'observations-not-replay',runs:[...runs.values()].sort((a,b)=>(a.startedAt||'').localeCompare(b.startedAt||'')).map(run=>({runId:run.id,version:run.version||'unknown',kind:run.kind,status:run.status,firstFailure:run.steps?.find(s=>s.reasonCode||s.ok===false)?.reasonCode||'not-recorded',reportedDispatches:(run.steps||[]).filter(s=>/dispatched$/.test(s.name||'')).length,mutationCountsComplete:false,proposedScenario:/cleanup/.test(run.kind||'')?'cleanup-observation-failure':/checkout/.test(run.kind||'')?'checkout-readiness-observation':'readiness-observation'}))};
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop())){
 const paths=process.argv.slice(2);if(!paths.length)throw Error('Supply local diagnostic JSON files; output contains local run IDs and no merchant references');
 console.log(JSON.stringify(analyzeLogs(paths.map(path=>JSON.parse(fs.readFileSync(path,'utf8')))),null,2));
}
