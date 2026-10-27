// Optional issue #12 experiment. Only the existing loopback fake merchant is used.
// REA is an external, pinned investigation dependency; never part of runtime/CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startMerchant} from './server.js';
import {networkGate} from './isolation.js';
import {testBundle} from './bundle.js';
import {isReceiveTimingRejection} from './rea-har-contract.js';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const reaNode=process.env.REA_NODE,reaCli=process.env.REA_CLI;
assert.ok(reaNode&&reaCli,'Set REA_NODE and REA_CLI to the local compatible Node and rea-agents@6.8.0 CLI.');
const reaPackage=JSON.parse(await fs.readFile(path.resolve(path.dirname(reaCli),'../package.json'),'utf8'));
assert.equal(reaPackage.name,'rea-agents');assert.equal(reaPackage.version,'6.8.0','Reassess evidence/schema expectations before changing REA version');
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
const output=await fs.mkdtemp(path.join(root,'artifacts','rea-investigation-'));
const merchant=await startMerchant(),gate=await networkGate(merchant.origin);
let context;
function rea(args){
 const child=spawn(reaNode,[reaCli,...args,'--format','json','--full-output'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 const timer=setTimeout(()=>child.kill(),45000);
 const result=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>16*1024*1024)child.kill();});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.on('error',reject);
  child.on('close',code=>{
   clearTimeout(timer);
   try{
    const result=JSON.parse(stdout);
    if(code!==0||!result.ok)return reject(Object.assign(Error(`REA exited ${code}: ${result.error?.code??'unknown'}`),{reaError:result.error}));
    resolve(result);
   }catch{reject(Error(`REA returned invalid JSON (exit ${code}): ${stderr.slice(0,1000)}`));}
  });
 });
 return result;
}
try{
 const profile=path.join(output,'profile'),bundle=path.join(output,'test-extension');
 await testBundle(bundle,merchant.origin);
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,recordHar:{path:path.join(output,'synthetic.har'),content:'omit'},proxy:{server:gate.proxy,bypass:'<-loopback>'},args:[`--disable-extensions-except=${bundle}`,`--load-extension=${bundle}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--disable-background-networking','--disable-component-update','--disable-quic','--no-pings','--disable-features=MediaRouter']});
 await gate.attach(context);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const page=await context.newPage();await page.goto(merchant.origin+'/book/courts/bethnal-green-gardens/2026-10-25');
 const endpoint='http://127.0.0.1:'+(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];
 const discovery=await rea(['list-browser-targets',endpoint,'--allowed-origins',merchant.origin]);
 await fs.writeFile(path.join(output,'discovery.json'),JSON.stringify(discovery,null,2));
 const target=discovery.data.normalized_result.targets.find(target=>target.url===page.url());assert.ok(target);
 const baseline=await rea(['inspect-web-page',endpoint,target.target_id,'--observation-ms','100','--include-script-sources']);
 // Export consumes Evidence, not the CLI's {ok,data,meta} transport envelope.
 await fs.writeFile(path.join(output,'baseline.json'),JSON.stringify(baseline.data,null,2));
 assert.equal(baseline.data.normalized_result.network.prior_activity_available,false);
 assert.equal(baseline.data.normalized_result.network.requests.length,0,'Late attachment must not fabricate earlier script requests');
 assert.ok(baseline.data.normalized_result.scripts.items.some(script=>new URL(script.url).pathname==='/site.js'));
 const exported=await rea(['export-web-scripts',path.join(output,'baseline.json'),path.join(output,'scripts')]);
 await fs.writeFile(path.join(output,'export.json'),JSON.stringify(exported,null,2));
 const analysis=await rea(['analyze-javascript-application',path.join(output,'scripts'),'--analysis-timeout-ms','15000']);
 await fs.writeFile(path.join(output,'analysis.json'),JSON.stringify(analysis,null,2));
 assert.ok(analysis.data.normalized_result.graph.nodes.some(node=>node.kind==='endpoint'&&node.identity.key.includes('/__select')),'Static analysis must retain the fake selection endpoint candidate');
 const cdp=await context.newCDPSession(page),requests=new Map();
 cdp.on('Network.requestWillBeSent',event=>requests.set(event.requestId,{method:event.request.method,path:new URL(event.request.url).pathname,started:event.timestamp,initiator:event.initiator.stack?.callFrames[0]?.url??null,status:null,failed:false}));
 cdp.on('Network.responseReceived',event=>{const request=requests.get(event.requestId);if(request)request.status=event.response.status;});
 cdp.on('Network.loadingFailed',event=>{const request=requests.get(event.requestId);if(request)request.failed=true;});
 await cdp.send('Network.enable');
 const reports=[];
 for(const scenario of ['accepted-delayed','rejected-409','accepted-response-lost']){
  merchant.state.items=[];merchant.state.options={selectionDelay:600,rejectSelection:scenario==='rejected-409',loseSelectionResponse:scenario==='accepted-response-lost'};merchant.state.counts.selection=0;
  await page.reload();requests.clear();
  // Adapter mutations run only on the fake merchant. A single dispatch per case;
  // no retry if the content script or response is missing.
  const capturePromise=rea(['inspect-web-page',endpoint,target.target_id,'--observation-ms','4000']);
  // CLI has no observer-ready signal. Assert afterward that the action fell in
  // its capture window and the exact selection request was retained; otherwise fail.
  await delay(1500);
  const dispatchedAt=Date.now();
  const selectionPromise=worker.evaluate(async({url,slot})=>{
   const tabs=await chrome.tabs.query({url});if(tabs.length!==1)throw Error('No unique synthetic grid');
   return chrome.tabs.sendMessage(tabs[0].id,{kind:'select-slot',slot,selectionTimeoutMs:15000});
  },{url:page.url(),slot:{venue:'bethnal-green-gardens',date:'2026-10-25',court:1,start:'20:00',hours:1,totalGBP:'7.00'}}).catch(error=>({ok:false,transportError:error.message}));
  await page.evaluate(()=>fetch('/favicon.ico').then(response=>response.status).catch(()=>null));
  const [capture,selection]=await Promise.all([capturePromise,selectionPromise]);
  await fs.writeFile(path.join(output,scenario+'.json'),JSON.stringify(capture,null,2));
  await fs.writeFile(path.join(output,scenario+'-adapter.json'),JSON.stringify({selection,counts:merchant.state.counts,items:merchant.state.items},null,2));
  const observed=capture.data.normalized_result;
  assert.ok(dispatchedAt>=Date.parse(observed.capture_window.started_at)&&dispatchedAt<Date.parse(observed.capture_window.ended_at),'Action missed the REA observation window');
  const selectionRequests=observed.network.requests.filter(request=>new URL(request.url).pathname==='/__select');
  assert.equal(selectionRequests.length,1,'REA must retain the exact fake selection request');
  const baselineRequest=[...requests.values()].filter(request=>request.path==='/__select');
  assert.equal(baselineRequest.length,1);assert.equal(merchant.state.counts.selection,1);
  assert.equal(selection.ok,scenario==='accepted-delayed');
  assert.equal(merchant.state.items.length,scenario==='rejected-409'?0:1);
  if(scenario==='rejected-409'){assert.equal(baselineRequest[0].status,409);assert.equal(selection.selectionDiagnostic.checkboxReverted,true);}
  if(scenario==='accepted-response-lost'){assert.equal(baselineRequest[0].failed,true);assert.equal(selection.selectionDiagnostic.acknowledgedHours,0);}
  // Read the merchant basket via real content scripts after the observation.
  // A missing response is never taken as permission to repeat selection.
  await page.goto(merchant.origin+'/basket');
  const basket=await worker.evaluate(async url=>{const tabs=await chrome.tabs.query({url});return chrome.tabs.sendMessage(tabs[0].id,{kind:'basket-read'});},page.url());
  assert.equal(basket.ok,true);assert.equal(basket.value.items.length,merchant.state.items.length);
  assert.equal(merchant.state.counts.opening,0);assert.equal(merchant.state.counts.fill,0);assert.equal(merchant.state.counts.pay,0);assert.equal(merchant.state.counts.discount,0);
  reports.push({scenario,evidence:'synthetic-loopback-only',selectionAcknowledged:selection.ok,checkboxReverted:selection.value?.selectionDiagnostic.checkboxReverted??selection.selectionDiagnostic?.checkboxReverted,serverItems:merchant.state.items.length,basketItems:basket.value.items.length,mutations:{...merchant.state.counts},directCdp:baselineRequest,reaSelection:selectionRequests,reaCoverage:observed.completeness,extensionDiagnostic:selection.value?.selectionDiagnostic??selection.selectionDiagnostic});
  await page.goto(merchant.origin+'/book/courts/bethnal-green-gardens/2026-10-25');
  console.log('REA comparison passed: '+scenario);
 }
 await fs.writeFile(path.join(output,'comparison.json'),JSON.stringify(reports,null,2));
 // Observe a read-only navigation separately: snapshots cannot span document replacement.
 const sessionPromise=rea(['observe-web-session',endpoint,target.target_id,'--observation-ms','3000']);
 await delay(1500);await page.goto(merchant.origin+'/basket');
 const session=await sessionPromise;
 await fs.writeFile(path.join(output,'session.json'),JSON.stringify(session,null,2));
 assert.ok(session.data.normalized_result.timeline.some(event=>event.type==='navigation_committed'&&new URL(event.url).pathname==='/basket'));
 gate.assertClean();
 await context.close();context=null;
 let interruptedHar;
 try{
  const har=await rea(['inspect-web-network-capture',path.join(output,'synthetic.har'),'har']);
  await fs.writeFile(path.join(output,'har-inspection.json'),JSON.stringify(har,null,2));
  interruptedHar={status:'accepted'};
 }catch(error){
  if(!isReceiveTimingRejection(error.reaError))throw error;
  // Keep the original capture intact. Do not replace unknown timings with zero.
  interruptedHar={status:'rejected',code:error.reaError.code,issues:error.reaError.details?.issues};
  await fs.writeFile(path.join(output,'har-limitation.json'),JSON.stringify(interruptedHar,null,2));
 }
 const cleanBrowser=await chromium.launch({channel:'chromium',headless:true,proxy:{server:gate.proxy,bypass:'<-loopback>'},args:['--disable-background-networking','--disable-component-update','--disable-quic','--no-pings','--disable-features=MediaRouter']});
 try{
  const cleanContext=await cleanBrowser.newContext({recordHar:{path:path.join(output,'complete.har'),content:'omit'}});
  await gate.attach(cleanContext);
  const cleanPage=await cleanContext.newPage();await cleanPage.goto(merchant.origin+'/account');
  await cleanContext.close();
 }finally{await cleanBrowser.close();}
 const cleanHar=await rea(['inspect-web-network-capture',path.join(output,'complete.har'),'har']);
 await fs.writeFile(path.join(output,'complete-har-inspection.json'),JSON.stringify(cleanHar,null,2));
 gate.assertClean();
 await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({reaVersion:reaPackage.version,browser:baseline.data.normalized_result.browser.product,scenarios:reports.map(report=>({name:report.scenario,serverItems:report.serverItems,acknowledged:report.selectionAcknowledged,mutations:report.mutations})),navigationObserved:true,scriptExportAndAnalysis:true,interruptedHar,completeHar:'accepted',merchantBehaviorStillUnknown:true},null,2));
 console.log(JSON.stringify({output,scenarios:reports.map(report=>report.scenario),evidence:'synthetic-loopback-only',merchantBehaviorStillUnknown:true}));
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.message,denied:gate.denied,counts:merchant.state.counts,items:merchant.state.items},null,2));console.error('Investigation artifacts: '+output);throw error;}
finally{await context?.close();await gate.close();await merchant.close();}
