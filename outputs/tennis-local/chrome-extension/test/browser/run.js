import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startMerchant} from './server.js';import {networkGate} from './isolation.js';import {testBundle} from './bundle.js';
import {discountReadBrowserCase} from '../browser-discount-read.js';
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
async function send(message){return within(popup.evaluate(message=>chrome.runtime.sendMessage(message),message),30000,'Popup '+message.kind);}
async function within(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' timed out')),ms))]);}finally{clearTimeout(timer);}}
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
 merchant.state.options.selectionDelay=80;merchant.state.options.holdPayResponse=true;merchant.state.options.holdAccountAfterPay=true;
 const release=worker.evaluate(()=>globalThis.__testAlarm({name:'release'})).catch(()=>{});
 const deadline=Date.now()+45000;while(!merchant.state.payObserved&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 if(!merchant.state.payObserved){const status=await send({kind:'status'});throw Error('Release did not reach fake Pay: '+JSON.stringify(status.latestAction||status.checkoutResult||status.result));}
 const before=await send({kind:'status'});assert.ok(before.checkoutRecords[0].paymentDispatchedAt);assert.equal(merchant.state.counts.pay,1);assert.equal(merchant.state.counts.selection,2);
 console.log('Browser gate: Pay dispatched, terminating Chromium');
 // Closing Chromium terminates the real extension worker after a dispatched Pay.
 await context.close();await release;context=null;
 merchant.state.options.holdAccountAfterPay=false;
 console.log('Browser gate: Chromium stopped');
 await launch();const reconciled=await send({kind:'verifyPayment'});assert.equal(reconciled.status,'confirmed',reconciled.error);assert.equal(reconciled.receiptSource,'account-purchase');assert.equal(reconciled.booked,null);
 console.log('Browser gate: process restart reconciliation verified');
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
 console.log('Browser gate: account DOM fixtures verified');
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
 console.log('Browser gate: discounted unpaid cleanup verified');
 await fresh('merchant-error-profile');merchant.state.options.merchantError=true;
 await send({kind:'check',day:'2026-10-25'});
 result=await send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'});assert.equal(result.status,'stopped');assert.match(result.error,/merchant|went wrong/i);
 await send({kind:'testDiscountCheckout',discountCode:'FAKEONLY'});assert.equal(merchant.state.counts.opening,1);assert.equal(merchant.state.counts.discount,1);assert.equal(merchant.state.counts.pay,0);
 assert.ok((await send({kind:'status'})).checkoutRecords[0].checkoutOpenDispatchedAt);
 reports.push({scenario:'merchant-error-no-checkout-replay',outcome:'passed',mutations:{...merchant.state.counts}});
 await fresh('extra-item-profile');merchant.state.items=[{hour:18,court:4}];
 await send({kind:'check',day:'2026-10-25'});result=await send({kind:'testDiscountCheckout'});assert.equal(result.status,'stopped');assert.equal(merchant.state.counts.selection,0);assert.equal(merchant.state.counts.removal,0);assert.equal(merchant.state.counts.pay,0);
 reports.push({scenario:'unrelated-basket-no-mutation',outcome:'passed',mutations:{...merchant.state.counts}});
 // Real content-script acknowledgement timeout after the fake merchant rejects
 // the first hourly POST. HTTP status correlation never authorizes replay.
 await fresh('selection-rejected-profile');merchant.state.options.rejectSelection=true;
 assert.equal((await send({kind:'check',day:'2026-10-25'})).status,'complete');
 result=await send({kind:'prepareCheckout'});assert.equal(result.status,'stopped');assert.equal(result.reasonCode,'SELECTION_ACK_TIMEOUT');
 const rejected=(await send({kind:'status'})).checkoutRecords[0];
 assert.equal(rejected.phase,'selection-dispatched');assert.equal(rejected.selectionFailure.reasonCode,'SELECTION_ACK_TIMEOUT');
 assert.equal(merchant.state.counts.selection,1);assert.equal(merchant.state.counts.opening,0);assert.equal(merchant.state.counts.pay,0);
 reports.push({scenario:'actual-dom-selection-rejection-no-replay',outcome:'passed',evidence:'synthetic-409-checkbox-reversion',mutations:{...merchant.state.counts}});
 // A 200 header followed by a lost JSON body can leave a committed fake-server
 // item with no DOM acknowledgement. It must never authorize a second click.
 await fresh('selection-response-lost-profile');merchant.state.options.loseSelectionResponse=true;
 assert.equal((await send({kind:'check',day:'2026-10-25'})).status,'complete');
 result=await send({kind:'prepareCheckout'});assert.equal(result.status,'stopped');assert.equal(result.reasonCode,'BASKET_MISMATCH');
 const uncertainSelection=(await send({kind:'status'})).checkoutRecords[0];
 assert.equal(uncertainSelection.selectionFailure.reasonCode,'SELECTION_ACK_TIMEOUT');
 assert.equal(uncertainSelection.basketDiagnostic.expectedItems,2);assert.equal(uncertainSelection.basketDiagnostic.actualItems,1);
 assert.equal(uncertainSelection.phase,'selection-dispatched');assert.equal(merchant.state.items.length,1);
 result=await send({kind:'prepareCheckout'});assert.equal(result.status,'stopped');assert.equal(result.reasonCode,'BASKET_MISMATCH');
 assert.equal(merchant.state.counts.selection,1);assert.equal(merchant.state.counts.opening,0);assert.equal(merchant.state.counts.fill,0);assert.equal(merchant.state.counts.pay,0);
 const retainedSelection=(await send({kind:'status'})).checkoutRecords[0];
 assert.equal(retainedSelection.key,uncertainSelection.key);assert.deepEqual(retainedSelection.slot,uncertainSelection.slot);
 assert.equal(retainedSelection.status,'pending');assert.equal(retainedSelection.phase,'selection-dispatched');
 assert.equal(retainedSelection.recoveryRequired,true);assert.equal(retainedSelection.basketVerifiedAt,undefined);
 assert.deepEqual(retainedSelection.selectionFailure,uncertainSelection.selectionFailure);
 assert.equal(retainedSelection.selectionFailure.reasonCode,'SELECTION_ACK_TIMEOUT');
 reports.push({scenario:'actual-dom-selection-committed-response-lost-no-replay',outcome:'passed',evidence:'hypothetical-server-commit-truncated-json',mutations:{...merchant.state.counts}});
 console.log('Browser gate: synthetic selection rejection held without replay');
 // Terminate only the actual MV3 worker while a fake card fill has no reply.
 // Page readiness supplied by another source must not authorize automatic Pay.
 await fresh('card-fill-worker-profile');
 console.log('Browser gate: testing worker termination during card fill');
 await send({kind:'check',day:'2026-10-25'});assert.equal((await send({kind:'prepareCheckout'})).status,'awaiting-payment');
 merchant.state.options.holdFillResponse=true;
 const filling=send({kind:'payCheckout'}).catch(()=>({status:'interrupted'}));
 const fillDeadline=Date.now()+20000;while(!merchant.state.counts.fill&&Date.now()<fillDeadline)await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(merchant.state.counts.fill,1);console.log('Browser gate: fake fill dispatched without reply');const fillingRecord=(await send({kind:'status'})).checkoutRecords[0];assert.ok(fillingRecord.cardFillDispatchedAt);assert.equal(fillingRecord.paymentDispatchedAt,undefined);
 const cdp=await context.newCDPSession(popup),versions=new Map();
 cdp.on('ServiceWorker.workerVersionUpdated',event=>{for(const version of event.versions)versions.set(version.versionId,version);});
 await cdp.send('ServiceWorker.enable');
 const waitVersion=async predicate=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const version=[...versions.values()].find(v=>v.scriptURL===worker.url()&&predicate(v));if(version)return version;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Required worker lifecycle transition missing');};
 const version=await waitVersion(v=>v.runningStatus==='running');
 await within(cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId}),10000,'Worker termination');await waitVersion(v=>v.runningStatus==='stopped');
 // Chrome need not deliver a reply to the popup after terminating its receiver.
 await Promise.race([filling,new Promise(resolve=>setTimeout(resolve,250))]);
 console.log('Browser gate: card-fill worker stopped');
 // Playwright retains its Worker wrapper for this MV3 version; use the CDP
 // lifecycle state as evidence, then wake the new execution with a message.
 await send({kind:'status'});await waitVersion(v=>v.runningStatus==='running');
 const cardPage=context.pages().find(page=>page.url()===merchant.origin+'/basket/pay/card');assert.ok(cardPage);
 await cardPage.locator('#submit').evaluate(button=>button.disabled=false);
 result=await send({kind:'payCheckout'});assert.equal(result.reasonCode,'CARD_FILL_REVIEW_REQUIRED');
 await send({kind:'payCheckout'});assert.deepEqual((await send({kind:'status'})).checkoutRecords[0],fillingRecord);
 assert.equal(merchant.state.counts.fill,1);assert.equal(merchant.state.counts.pay,0);assert.equal(merchant.state.counts.opening,1);
 await cdp.detach();reports.push({scenario:'actual-worker-termination-during-card-fill',outcome:'passed',termination:'ServiceWorker.stopWorker',lifecycle:['running','stopped','running'],mutations:{...merchant.state.counts}});
 console.log('Browser gate: unknown card provenance held after actual worker recreation');
 // Real DOM/content messaging and worker reconciliation, with synthetic paid
 // evidence and a saved fake journal; no payment is dispatched in these cases.
 await fresh('receipt-profile');const receiptPage=await context.newPage();
 const receiptSlot={venue:'bethnal-green-gardens',date:'2026-10-25',court:1,start:'20:00',hours:2,totalGBP:'14.00'};
 const receiptKey=JSON.stringify([receiptSlot.venue,receiptSlot.date,1,'20:00',2]);
 merchant.state.purchases=[{reference:'100001',total:14,state:'Confirmed'}];
 const receiptBase='Booking reference: 100001\nPayment received\nBethnal Green Gardens\nPlaying date: 25 October 2026\nCourt 1\nStart time: 8:00pm\nDuration: 2 hours\nTotal: £14.00';
 for(const [name,text,conflict,source] of [
  ['processing-metadata',receiptBase+'\nPayment processed: 18 October 2026',false,'booking-receipt'],
  ['wrong-playing-date',receiptBase.replace('Playing date: 25','Playing date: 24'),true],
  ['wrong-single-start',receiptBase.replace('Start time: 8:00pm','Start time: 7:00pm'),true],
  ['unknown-layout',receiptBase.replace('Start time: 8:00pm','Recorded at: 7:00pm'),false,'account-purchase']
 ]){
  merchant.state.options.receiptText=text;await receiptPage.goto(merchant.origin+'/basket/receipt');
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({url}))[0].id,receiptPage.url());
  const record={slot:receiptSlot,key:receiptKey,status:'pending',phase:'payment-uncertain',reference:'100001',tabId,paymentDispatchedAt:'2026-10-18T12:00:00Z'};
  await worker.evaluate(record=>chrome.storage.local.set({checkoutRecords:[record]}),record);
  const response=await read(receiptPage,'receipt-read',{slot:receiptSlot,key:receiptKey,reference:'100001'});
  result=await send({kind:'verifyPayment'});
  if(conflict){assert.equal(response.value?.status,'conflicting');assert.equal(result.reasonCode,'RECEIPT_CONFLICT');assert.deepEqual((await send({kind:'status'})).checkoutRecords[0],record);}
  else{assert.equal(result.status,'confirmed',result.error);assert.equal(result.receiptSource,source);assert.equal(result.booked,source==='booking-receipt'?true:null);}
  assert.ok(Object.values(merchant.state.counts).every(count=>count===0));reports.push({scenario:'actual-dom-receipt-'+name,outcome:'passed',evidence:'synthetic-receipt-html'});
 }
 await discountReadBrowserCase({fresh,send,currentWorker:()=>worker,merchant,reports});
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
 const journal=worker?await within(worker.evaluate(()=>chrome.storage.local.get(['latestAction','checkoutRecords','runHistory'])),5000,'Failure journal read').catch(()=>({workerUnavailable:true})):{};
 await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,counts:merchant.state.counts,networkDenials:gate.denied,journal},null,2));
 if(popup)await popup.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
 console.error('Browser gate failed; local-only artifacts: '+output);throw error;
}finally{if(context)await context.close();await gate.close();await merchant.close();}
