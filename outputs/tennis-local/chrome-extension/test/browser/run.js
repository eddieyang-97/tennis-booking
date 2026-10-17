import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startMerchant} from './server.js';import {networkGate} from './isolation.js';import {testBundle} from './bundle.js';
const artifacts=fileURLToPath(new URL('../../../../../artifacts/',import.meta.url));await fs.mkdir(artifacts,{recursive:true});
const output=await fs.mkdtemp(path.join(artifacts,'browser-gate-'));
const merchant=await startMerchant(),gate=await networkGate(merchant.origin),bundle=path.join(output,'test-extension');
let profile=path.join(output,'test-profile');
await testBundle(bundle,merchant.origin);
let context,worker,popup;
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,proxy:{server:gate.proxy,bypass:'<-loopback>'},args:[`--disable-extensions-except=${bundle}`,`--load-extension=${bundle}`,'--disable-background-networking','--disable-component-update','--disable-quic','--no-pings','--disable-features=MediaRouter']});
 await gate.attach(context);
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 popup=await context.newPage();await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
 await popup.waitForFunction(()=>document.querySelector('#readiness').textContent.includes('Version'),null,{timeout:5000}).catch(async error=>{throw Error(error.message+'; popup result: '+await popup.locator('#result').textContent());});
}
async function send(message){return popup.evaluate(message=>chrome.runtime.sendMessage(message),message);}
async function fresh(name){
 await context.close();context=null;profile=path.join(output,name);
 Object.assign(merchant.state,{items:[],discount:0,purchases:[],payObserved:false,options:{},counts:{selection:0,discount:0,opening:0,fill:0,pay:0,removal:0}});
 await launch();await worker.evaluate(()=>{globalThis.__testClock=Date.parse('2026-10-19T12:00:00Z');});
}
async function read(tab,kind,extra={}){
 await tab.waitForLoadState('load');
 const url=tab.url();
 return worker.evaluate(async({url,kind,extra})=>{
  const tabs=await chrome.tabs.query({url});if(tabs.length!==1)throw Error('No unique local test tab');
  for(let i=0;i<20;i++){try{return await chrome.tabs.sendMessage(tabs[0].id,{kind,...extra});}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
  throw Error('Local content receiver unavailable');
 },{url,kind,extra});
}
const reports=[];
try{
 await launch();
 console.log('Browser gate: popup ready');
 // Exercise the actual popup form, saved immutable policy, alarms and adapters.
 await popup.locator('#day').fill('2026-10-25');await popup.locator('#armPayment').click();await popup.waitForFunction(()=>document.querySelector('#result').textContent.includes('"armed"'));
 await popup.locator('#firstVenue').selectOption('victoria-park');await popup.locator('#secondVenue').selectOption('');await popup.locator('#maxTotalGBP').fill('12.00');await popup.locator('#saveSettings').click();await popup.waitForFunction(()=>document.querySelector('#result').textContent.includes('preferences-saved'));
 const job=(await send({kind:'status'})).job;assert.equal(job.settings.venues[0],'bethnal-green-gardens');assert.equal(job.settings.maxTotalGBP,'14.00');
 console.log('Browser gate: settings snapshot verified');
 await worker.evaluate(async()=>{await globalThis.__testAlarm({name:'prepare'});const {job}=await chrome.storage.local.get('job');globalThis.__testClock=job.when;});
 console.log('Browser gate: preflight returned');
 merchant.state.options.selectionDelay=80;merchant.state.options.holdPayResponse=true;
 const release=worker.evaluate(()=>globalThis.__testAlarm({name:'release'})).catch(()=>{});
 const deadline=Date.now()+45000;while(!merchant.state.payObserved&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 if(!merchant.state.payObserved){const status=await send({kind:'status'});throw Error('Release did not reach fake Pay: '+JSON.stringify(status.latestAction||status.checkoutResult||status.result));}
 const before=await send({kind:'status'});assert.ok(before.checkoutRecords[0].paymentDispatchedAt);assert.equal(merchant.state.counts.pay,1);assert.equal(merchant.state.counts.selection,2);
 console.log('Browser gate: Pay dispatched, terminating Chromium');
 // Closing Chromium terminates the real extension worker after a dispatched Pay.
 await context.close();await release;context=null;
 console.log('Browser gate: Chromium stopped');
 await launch();const reconciled=await send({kind:'verifyPayment'});assert.equal(reconciled.status,'confirmed',reconciled.error);assert.equal(reconciled.receiptSource,'account-purchase');assert.equal(reconciled.booked,null);
 await send({kind:'payCheckout'});assert.equal(merchant.state.counts.pay,1);assert.equal(merchant.state.counts.opening,1);assert.equal(merchant.state.counts.fill,1);
 reports.push({scenario:'real-extension-alarm-pay-restart-reconcile',outcome:'passed',evidence:'local-fake-merchant',mutations:{...merchant.state.counts}});
 // Adapter fixtures: no page uses real merchant credentials or card information.
 const page=await context.newPage();
 await page.goto(merchant.origin+'/account');const paidRecord=(await send({kind:'status'})).checkoutRecords[0];
 let response=await read(page,'purchase-read',{slot:paidRecord.slot,key:paidRecord.key,reference:paidRecord.reference,paymentDispatchedAt:paidRecord.paymentDispatchedAt});assert.equal(response.value.status,'confirmed');
 const purchaseRequest={slot:paidRecord.slot,key:paidRecord.key,reference:paidRecord.reference,paymentDispatchedAt:paidRecord.paymentDispatchedAt};
 await page.locator('tr').last().evaluate(row=>row.remove());response=await read(page,'purchase-read',purchaseRequest);assert.equal(response.ok,false);assert.match(response.error,/observed 0 matches/);
 await page.reload();await page.locator('th').first().evaluate(th=>th.textContent='Changed layout');response=await read(page,'purchase-read',purchaseRequest);assert.equal(response.ok,false);assert.match(response.error,/layout/);
 await page.reload();await page.locator('tr').last().locator('td').nth(4).evaluate(td=>td.textContent='£0.01');response=await read(page,'purchase-read',purchaseRequest);assert.equal(response.ok,false);assert.match(response.error,/expected amount/);
 merchant.state.options.duplicatePurchases=true;await page.reload();response=await read(page,'test-purchase-state',{slot:paidRecord.slot,key:paidRecord.key,reference:paidRecord.reference});assert.equal(response.ok,false);assert.match(response.error,/observed 2 matches/);merchant.state.options.duplicatePurchases=false;
 await page.goto(merchant.origin+'/purchase/card/100001');response=await read(page,'checkout-progress');assert.equal(response.value.stage,'existing-purchase');assert.equal(response.value.cancellationSupported,false);assert.equal(merchant.state.counts.pay,1);
 reports.push({scenario:'actual-dom-paid-duplicate-existing-purchase',outcome:'passed',evidence:'local-fake-merchant'});
 await fresh('unpaid-profile');
 merchant.state.options.selectionDelay=80;merchant.state.options.checkoutDelay=1000;
 let result=await send({kind:'check',day:'2026-10-25'});assert.equal(result.status,'complete',result.error);
 const attempts=await Promise.all([send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'}),send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'})]);
 for(const attempt of attempts)assert.equal(attempt.status,'checkout-test-passed',attempt.error);
 assert.equal(merchant.state.counts.selection,2);assert.equal(merchant.state.counts.discount,1);assert.equal(merchant.state.counts.opening,1);assert.equal(merchant.state.counts.pay,0);
 result=await send({kind:'resetUnpaidTest'});assert.equal(result.status,'test-auto-cleared',result.error);
 const cleared=await send({kind:'status'});assert.equal(cleared.checkoutRecords.length,0);assert.equal(cleared.abandonedCheckouts[0].abandonmentEvidence.basis,'merchant-unpaid-verified');
 assert.equal(merchant.state.items.length,0);assert.equal(merchant.state.counts.removal,3);assert.equal(merchant.state.counts.fill,0);assert.equal(merchant.state.counts.pay,0);
 assert.equal(merchant.state.purchases[0].state,'Pending');
 reports.push({scenario:'discount-delayed-checkout-concurrent-test-unpaid-cleanup',outcome:'passed',mutations:{...merchant.state.counts},merchantCancellationState:'unknown'});
 await fresh('merchant-error-profile');merchant.state.options.merchantError=true;
 await send({kind:'check',day:'2026-10-25'});
 result=await send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'});assert.equal(result.status,'stopped');assert.match(result.error,/merchant|went wrong/i);
 await send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'});assert.equal(merchant.state.counts.opening,1);assert.equal(merchant.state.counts.discount,1);assert.equal(merchant.state.counts.pay,0);
 assert.ok((await send({kind:'status'})).checkoutRecords[0].checkoutOpenDispatchedAt);
 reports.push({scenario:'merchant-error-no-checkout-replay',outcome:'passed',mutations:{...merchant.state.counts}});
 await fresh('extra-item-profile');merchant.state.items=[{hour:18,court:4}];
 await send({kind:'check',day:'2026-10-25'});result=await send({kind:'testDiscountCheckout'});assert.equal(result.status,'stopped');assert.equal(merchant.state.counts.selection,0);assert.equal(merchant.state.counts.removal,0);assert.equal(merchant.state.counts.pay,0);
 reports.push({scenario:'unrelated-basket-no-mutation',outcome:'passed',mutations:{...merchant.state.counts}});
 // DST and validation use the real popup and worker settings boundary.
 await fresh('settings-profile');await popup.locator('#day').fill('2026-11-02');await popup.locator('#armPayment').click();await popup.waitForFunction(()=>document.querySelector('#result').textContent.includes('"armed"'));
 assert.equal((await send({kind:'status'})).job.when,Date.parse('2026-10-26T00:00:00Z'));
 result=await send({kind:'saveSettings',settings:{venues:['unknown']}});assert.equal(result.status,'stopped');assert.equal((await send({kind:'status'})).job.settings.maxTotalGBP,'14.00');
 reports.push({scenario:'popup-dst-and-invalid-settings',outcome:'passed'});
 const isolationPage=await context.newPage();await isolationPage.goto(merchant.origin+'/account');
 // A page miss and a worker fetch must never escape the local network boundary.
 await gate.negative(async()=>{
  await isolationPage.evaluate(async()=>{try{await fetch('https://tennistowerhamlets.com/__denied_test');}catch{}});
  await isolationPage.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/v3/elements-inner-card-fake';document.body.append(frame);});
  const frame=await isolationPage.waitForSelector('iframe');const framePage=await frame.contentFrame();
  await framePage.evaluate(async()=>{try{await fetch('https://tennistowerhamlets.com/__denied_frame_test');}catch{}});
  await worker.evaluate(async()=>{try{await fetch('https://js.stripe.com/__denied_test');}catch{}});
 });
 assert.ok(gate.denied.filter(item=>item.kind==='page-egress'&&item.host==='tennistowerhamlets.com'&&item.intentional).length>=2);
 assert.ok(gate.denied.some(item=>item.kind==='https-egress'&&item.host==='js.stripe.com:443'&&item.intentional));
 gate.assertClean();reports.push({scenario:'page-frame-and-worker-network-denial',outcome:'passed',evidence:'denying-local-proxy'});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({browserVersion:context.browser()?.version(),reports,networkDenials:gate.denied},null,2));
 for(const report of reports)console.log(JSON.stringify(report));
}catch(error){
 const journal=worker?await worker.evaluate(()=>chrome.storage.local.get(['latestAction','checkoutRecords','runHistory'])).catch(()=>({workerUnavailable:true})):{};
 await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,counts:merchant.state.counts,networkDenials:gate.denied,journal},null,2));
 if(popup)await popup.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
 console.error('Browser gate failed; local-only artifacts: '+output);throw error;
}finally{if(context)await context.close();await gate.close();await merchant.close();}
