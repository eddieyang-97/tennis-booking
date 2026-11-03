import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {startMerchant} from './server.js';
import {networkGate} from './isolation.js';
import {testBundle} from './bundle.js';

test('actual runtime.reload preserves extension identity and journals, locks card, refuses armed job', {timeout:45000}, async()=>{
 const artifacts=fileURLToPath(new URL('../../../../../artifacts/',import.meta.url));await fs.mkdir(artifacts,{recursive:true});
 const output=await fs.mkdtemp(path.join(artifacts,'browser-reload-')),bundle=path.join(output,'extension');
 const merchant=await startMerchant(),gate=await networkGate(merchant.origin);let context;
 try{
  await testBundle(bundle,merchant.origin);
  context=await chromium.launchPersistentContext(path.join(output,'profile'),{channel:'chromium',headless:true,proxy:{server:gate.proxy,bypass:'<-loopback>'},args:[`--disable-extensions-except=${bundle}`,`--load-extension=${bundle}`,'--disable-background-networking','--disable-component-update','--disable-quic','--no-pings','--disable-features=MediaRouter']});
  await gate.attach(context);
  // Command-line loading bypasses the initial developer-mode UI. Self-reload
  // still requires it, just as an ordinary Load unpacked installation does.
  const manager=await context.newPage();await manager.goto('chrome://extensions');
  await manager.evaluate(()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));await manager.close();
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const identity=new URL(worker.url()).host,url=`chrome-extension://${identity}/popup.html`;
  let popup=await context.newPage();await popup.goto(url);
  await popup.waitForFunction(()=>document.querySelector('#readiness').textContent.includes('Version'));
  const record={key:'synthetic-payment-hold',status:'pending',phase:'payment-dispatched',paymentDispatchedAt:'2026-10-18T23:00:00Z',reference:'100001',priorReferences:[{reference:'99999'}],slot:{venue:'bethnal-green-gardens',date:'2026-10-26',court:1,start:'20:00',hours:2,totalGBP:'14.00'}};
  const saved={checkoutRecords:[record],checkoutResult:{status:'stopped',paid:null},job:{day:'2026-10-27',when:Date.parse('2026-10-19T23:00:00Z'),mode:'payment'}};
  await worker.evaluate(async saved=>{await chrome.storage.local.set(saved);await chrome.storage.session.set({localPaymentCard:{synthetic:true}});},saved);
  const blocked=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'reloadExtension'}));assert.equal(blocked.status,'stopped');
  assert.equal(await worker.evaluate(async()=>!!(await chrome.storage.session.get('localPaymentCard')).localPaymentCard),true);
  await worker.evaluate(()=>chrome.storage.local.remove('job'));delete saved.job;
  await popup.reload();await popup.locator('#diagnosticControls > summary').click();await popup.locator('#developerTools > summary').click();
  const oldWorker=worker,replacement=context.waitForEvent('serviceworker',{predicate:w=>w!==oldWorker&&new URL(w.url()).host===identity,timeout:15000});replacement.catch(()=>{});
  await popup.locator('#reloadExtension').click({noWaitAfter:true}).catch(error=>{if(!/Target.*closed|context was destroyed/i.test(error.message))throw error;});
  popup=await context.newPage();
  const readyBy=Date.now()+10000;
  for(;;){try{await popup.goto(url);break;}catch(error){if(!error.message.includes('ERR_BLOCKED_BY_CLIENT')||Date.now()>=readyBy)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
  worker=await replacement;await popup.waitForFunction(()=>document.querySelector('#readiness').textContent.includes('Version'));
  const status=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'status'}));
  assert.equal(new URL(worker.url()).host,identity);assert.deepEqual(status.checkoutRecords,saved.checkoutRecords);assert.deepEqual(status.checkoutResult,saved.checkoutResult);
  assert.equal(status.localCardUnlocked,false);assert.equal(status.latestAction.kind,'reloadExtension');assert.equal(status.latestAction.outcome,'complete');assert.equal(status.job,undefined);
  assert.ok(Object.values(merchant.state.counts).every(n=>n===0));gate.assertClean();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({scenario:'real-runtime-reload',evidence:'isolated-chromium-synthetic-journal',identityPreserved:true,cardLocked:true,mutations:merchant.state.counts}));
 }finally{if(context)await context.close();await gate.close();await merchant.close();}
});
