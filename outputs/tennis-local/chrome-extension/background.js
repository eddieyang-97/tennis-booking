import {VENUES, londonDay, addDays, eligible, releaseAt, candidates} from './core.js';
import {verifyBasket} from './stage-rules.js';
import {navigateLoaded} from './navigation.js';
import {retryTab} from './retry.js';
import {startRun} from './run-log.js';
import {prepareCheckout,checkoutCandidate,confirmCheckout,PAYMENT_TEST_SLOT} from './checkout.js';
import {payCheckout} from './payment.js';
import {checkoutKey} from './checkout.js';
import {createLinkFrames} from './link-frames.js';
import {paymentCard} from './card-vault-core.js';
import {reconcilePaid} from './reconciliation.js';
const linkFrames=createLinkFrames(chrome.tabs,{step:(name,detail)=>step(name,detail)});
const BASE='https://tennistowerhamlets.com';
let busy=false;
let resumedTab=null;
let trace=null;
async function step(name,detail={}){if(trace)await trace.step(name,detail);}
async function readTab(operation){return retryTab(operation,{onRetry:attempt=>step('temporary-tab-retry',{attempt})});}
async function save(result) { await chrome.storage.local.set({result}); await chrome.action.setBadgeText({text:result.status==='complete'?'OK':'!'}); }
async function notifyPaymentResult(result) {
 try {await chrome.notifications.create('tennis-payment-result',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:result.paid===true?'Tennis payment confirmed':'Tennis booking needs attention',message:result.paid===true?`${result.slot.date} ${result.slot.start}, £${result.slot.totalGBP}. Payment verified; open the account to check the active booking.`:'Open the extension for the stopped run. An uncertain payment will not be charged again.'});}
 catch {await step('notification-unavailable');}
}
async function readPage(url, request) {
  await step('page-navigation',{page:request.kind});
  const reused=resumedTab!==null;
  const tab=reused ? await navigateLoaded(chrome.tabs,resumedTab,url,globalThis,attempt=>step('temporary-navigation-retry',{attempt})) : await retryTab(()=>chrome.tabs.create({url,active:false}),{navigation:true,onRetry:attempt=>step('temporary-tab-retry',{attempt})});
  let retain=reused;
  try {
    // Bounded load readiness checks; these do not reload or request the site.
    for(let i=0;i<30;i++) {
      const current=await readTab(()=>chrome.tabs.get(tab.id));
      if(current.status==='complete') {
        try { const response=await readTab(()=>chrome.tabs.sendMessage(tab.id,request)); if(response) {
          if(response.humanRequired) {retain=true;response.retainedTabId=tab.id;}
          await step('page-read',{page:request.kind,ok:response.ok});return response;
        } }
        catch(e) { throw e; }
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw Error('Page did not become ready within 15 seconds');
  } finally { if(!retain) await chrome.tabs.remove(tab.id).catch(()=>{}); }
}
async function account() {
  const result=await readPage(BASE+'/account',{kind:'account'});
  if(!result.ok) throw Object.assign(Error(result.error),{diagnostic:{page:result.page,retainedTabId:result.retainedTabId}});
}
async function check(day, scheduled=false) {
  if(busy) throw Error('A check is already running');
  busy=true;
  trace=startRun(chrome.storage.local,scheduled?'release-check':'manual-check',day);
  let ownsRunning=false;
  try {
    await step('started');
    if(!eligible(day)) throw Error('Choose Monday–Thursday');
    if(day<londonDay() || day>addDays(londonDay(),7)) throw Error('Date is outside the current booking window');
    if(scheduled && Date.now()-releaseAt(day)>60000) throw Error('Release check was over one minute late; inspect manually');
    const prior=await chrome.storage.local.get('running');
    if(prior.running) throw Error('An earlier check was interrupted; reset the dry-run state after review');
    await chrome.storage.local.set({running:{day,started:Date.now()}});
    ownsRunning=true;
    await account();
    const results=[];
    for(const venue of VENUES) {
      const response=await readPage(`${BASE}/book/courts/${venue}/${day}#book`,{kind:'grid',venue,day});
      if(!response.ok) throw Object.assign(Error(response.error),{diagnostic:{page:response.page,retainedTabId:response.retainedTabId}});
      results.push({venue,candidates:candidates(response.rows,venue,day)});
    }
    await step('availability-complete');await trace.finish('complete');
    await save({status:'complete',day,checkedAt:new Date().toISOString(),runId:trace.record.id,results,booked:false,paid:false});
    await chrome.storage.local.remove('running');
  } catch(e) { await step('stopped');await trace.finish('stopped');await save({status:'stopped',day,checkedAt:new Date().toISOString(),runId:trace.record.id,error:e.message,...e.diagnostic,booked:false,paid:false});e.recorded=true;throw e; }
  finally {
    // Known completion/failure clears only this invocation's read-only lock.
    // A prior interrupted run remains protected until explicit reset.
    if(ownsRunning) await chrome.storage.local.remove('running');
    busy=false;
    trace=null;
  }
}
async function arm(day,mode='availability') {
  if(!eligible(day)) throw Error('Choose Monday–Thursday');
  const when=releaseAt(day);
  if(when<=Date.now()) throw Error('This date has already released; use Check now');
  if(mode==='payment'){await resolvePendingPayment();await paymentCard(chrome.storage,null);}
  await chrome.alarms.clear('prepare'); await chrome.alarms.clear('release');
  if(!['availability','checkout','payment'].includes(mode))throw Error('Unknown release mode');
  await chrome.storage.local.set({job:{day,when,prepared:false,mode}});
  await chrome.alarms.create('prepare',{when:Math.max(Date.now()+1000,when-300000)});
  await chrome.alarms.create('release',{when});
  return {status:'armed',day,release:new Date(when).toISOString(),mode,paymentAutomatic:mode==='payment'};
}

async function automaticPayment(test=false) {
 if(busy)throw Error('Another run is active');busy=true;
 let tab,record;
 try {
  let {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
  record=checkoutRecords.find(r=>r.status!=='confirmed');
  if(test && record && record.key!==checkoutKey(PAYMENT_TEST_SLOT,true))throw Error('Another checkout requires reconciliation');
  if(record?.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record?.phase)) {
   trace=startRun(chrome.storage.local,'payment-reconciliation',record.slot.date);await step('started');
   return await finishPaidRecord(record);
  }
  if(test && checkoutRecords.some(r=>r.test&&r.status==='confirmed'))throw Error('This paid test is already confirmed; it cannot be charged again');
  if(test){tab=(await readTab(()=>chrome.tabs.query({active:true,currentWindow:true})))[0];if(![BASE+'/basket',BASE+'/basket/pay/card'].includes(tab?.url))throw Error('Open the £2.50 test basket or card checkout');}
  else if(record?.tabId)tab=await readTab(()=>chrome.tabs.get(record.tabId));
  if(!tab)throw Error('No checkout tab');
  trace=startRun(chrome.storage.local,'automatic-payment',record?.slot.date||PAYMENT_TEST_SLOT.date);await step('started');
  await step('local-card-preflight');const localCard=await paymentCard(chrome.storage,record);await step('local-card-ready',{reconciliationOnly:!localCard});
  const readBasket=async slot=>{resumedTab=null;const response=await readPage(BASE+'/basket',{kind:'basket-read'});if(!response.ok)throw Error(response.error);verifyBasket(response.value,slot);return response.value;};
  const store=async r=>{record=r;checkoutRecords=[...checkoutRecords.filter(x=>x.key!==r.key),r];await chrome.storage.local.set({checkoutRecords});await step(r.phase);};
  if(!record){await readBasket(PAYMENT_TEST_SLOT);record={key:checkoutKey(PAYMENT_TEST_SLOT,true),slot:PAYMENT_TEST_SLOT,test:true,tabId:tab.id,status:'pending',phase:'basket-adopted'};await store(record);}
  const command=async request=>{const response=await chrome.tabs.sendMessage(tab.id,request);if(!response?.ok)throw Error(response?.error||'Checkout response unavailable');return response.value;};
  const state=()=>readTab(()=>command({kind:'payment-state'}));
  const frame=(type,kind)=>linkFrames.command(tab.id,type,kind,{attempts:kind==='link-state'?1:12});
  const output=await payCheckout(record,{
   save:store,verifyBasket:readBasket,
   open:async()=>{const current=await readTab(()=>chrome.tabs.get(tab.id));if(current.url===BASE+'/basket/pay/card')return;if(current.url!==BASE+'/basket')throw Error('Checkout tab changed');const expected=await readBasket(record.slot);await command({kind:'payment-open',expected});for(let i=0;i<30;i++){try{await state();return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Card checkout did not load');},
   state,
   ...(localCard?{
    fillCard:async()=>{try{await frame('modal','link-close');}catch{}await linkFrames.command(tab.id,'card','card-fill',{payload:{card:localCard}});},
    waitCardReady:async()=>{for(let i=0;i<30;i++){const current=await state();if(current.enabled)return current;await new Promise(r=>setTimeout(r,500));}throw Error('Card fields did not enable payment; inspect checkout');}
   }:{}),
   submit:(totalGBP,reference)=>command({kind:'payment-submit',totalGBP,reference}),
   receipt:()=>readPaidEvidence(record,tab.id,true)
  });
  if(output.status==='confirmed'){await store({...output,tabId:tab.id});await chrome.action.setBadgeText({text:'PAID'});}
  await trace.finish(output.status);
  const result=output.status==='confirmed'?paidResult(output):{status:output.status,slot:record.slot,booked:false,paid:false};
  await chrome.storage.local.set({checkoutResult:{...result,runId:trace.record.id,finishedAt:trace.record.finishedAt}});await notifyPaymentResult(result);return result;
 }catch(e){
  let linkDiagnostic;
  if(tab && /Saved Link frame/.test(e.message)) {
   linkDiagnostic={};
   try{linkDiagnostic.stripeAccessGranted=await chrome.permissions.contains({origins:['https://js.stripe.com/*']});}catch{}
   try{const response=await chrome.tabs.sendMessage(tab.id,{kind:'payment-state'});if(response?.ok)linkDiagnostic.linkFramePresent=response.value.linkFramePresent;}catch{}
   await step('link-discovery-diagnostic',linkDiagnostic);
  }
  if(trace){await step('stopped');await trace.finish('stopped');}
  const output={status:'stopped',error:e.message,...(e.code?{errorCode:e.code}:{}),tabId:tab?.id,phase:record?.phase,booked:record?.paymentDispatchedAt?null:false,paid:record?.paymentDispatchedAt?null:false,...(linkDiagnostic?{linkDiagnostic}:{}),runId:trace?.record.id,finishedAt:trace?.record.finishedAt||new Date().toISOString()};await chrome.storage.local.set({checkoutResult:output});await chrome.action.setBadgeText({text:'!'});await notifyPaymentResult(output);return output;
 }
 finally{busy=false;trace=null;resumedTab=null;}
}

async function notifyCheckout(slot) {
 await chrome.action.setBadgeText({text:'PAY'});
 await chrome.action.setTitle({title:`Checkout ready: ${slot.date} ${slot.start}, £${slot.totalGBP}`});
 try {await chrome.notifications.create('tennis-checkout',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:'Tennis checkout ready',message:`${slot.date} ${slot.start}, £${slot.totalGBP}. Verified basket ready; inspect the extension for payment status.`});}
 catch {await step('notification-unavailable');}
}
async function checkout(expectedDay=null) {
 if(busy)throw Error('Another run is active');
 busy=true;
 let tab,slot;
 try {
 const {result,basketTest,checkoutRecords=[]}=await chrome.storage.local.get(['result','basketTest','checkoutRecords']);
 if(basketTest && basketTest.status!=='cleared')throw Error('Basket test needs reconciliation first');
 const pending=checkoutRecords.find(r=>r.status!=='confirmed');
 if(expectedDay && pending && pending.slot.date!==expectedDay)throw Error('Another date has an unresolved checkout; release preparation stopped');
 slot=pending?.slot || (result?.status==='complete'?checkoutCandidate(result.results):null);
 if(!slot)throw Error('Check availability before preparing checkout');
 trace=startRun(chrome.storage.local,'checkout-preparation',slot.date);
  await step('started');
  if(pending?.tabId) {tab=await readTab(()=>chrome.tabs.get(pending.tabId));if(!tab.url?.startsWith(BASE+'/'))throw Error('Checkout tab left Courtside');}
  else tab=await retryTab(()=>chrome.tabs.create({url:BASE+'/basket',active:false}),{navigation:true});
  resumedTab=tab.id;
  // Never navigate away from a card form or bank challenge to "resume" selection.
  if(pending && tab.url!==BASE+'/basket')throw Error('Checkout/payment is in progress; use Verify payment confirmation');
  const read=async()=>{const response=await readPage(BASE+'/basket',{kind:'basket-read'});if(!response.ok)throw Error(response.error);return response.value;};
  const output=await prepareCheckout(slot,{
   load:async()=> (await chrome.storage.local.get('checkoutRecords')).checkoutRecords||[],
   save:async records=>{await chrome.storage.local.set({checkoutRecords:records});await step(records.at(-1).phase);},
   read,select:async s=>{
    const grid=await readPage(`${BASE}/book/courts/${s.venue}/${s.date}#book`,{kind:'grid',venue:s.venue,day:s.date});if(!grid.ok)throw Error(grid.error);
    // One mutation dispatch. Reconciliation occurs in prepareCheckout, never replay.
    const response=await chrome.tabs.sendMessage(tab.id,{kind:'select-slot',slot:s});if(!response?.ok)throw Error(response?.error||'Selection response uncertain');
   },
   retain:async()=>{await chrome.tabs.update(tab.id,{active:true});return tab.id;},notify:notifyCheckout
  },{test:pending?.test===true});
  await trace.finish('awaiting-payment');await chrome.storage.local.set({checkoutResult:{...output,runId:trace.record.id,finishedAt:trace.record.finishedAt}});return output;
 } catch(e) {
  if(!trace)trace=startRun(chrome.storage.local,'checkout-preparation',slot?.date||londonDay());
  await trace.finish('stopped');const output={status:'stopped',error:e.message,tabId:tab?.id,booked:false,paid:false,runId:trace.record.id};await chrome.storage.local.set({checkoutResult:output});
  await chrome.action.setBadgeText({text:'!'});
  try{await chrome.notifications.create('tennis-checkout-stopped',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:'Tennis checkout stopped',message:'Open the extension to inspect the result. No automatic payment was attempted.'});}catch{}
  return output;
 } finally {resumedTab=null;busy=false;trace=null;}
}
function paidResult(record) {
 return {status:'confirmed',slot:record.slot,reference:record.reference,confirmedAt:record.confirmedAt,receiptSource:record.receiptSource,bookingState:record.bookingState,booked:record.bookingState==='confirmed'?true:null,paid:true};
}
async function readPaidEvidence(record,tabId=record.tabId,wait=false) {
 return reconcilePaid(record,{
  currentReceipt:async()=>{
   for(let i=0;i<(wait?10:1);i++) {
    try {
     const current=await readTab(()=>chrome.tabs.get(tabId));
     if(new URL(current.url).origin!==BASE||!new URL(current.url).pathname.startsWith('/basket'))return null;
     const response=await readTab(()=>chrome.tabs.sendMessage(tabId,{kind:'receipt-read',slot:record.slot,key:record.key}));
     if(response?.ok&&response.value.status==='confirmed')return response.value;
    }catch{ return null; }
    if(wait)await new Promise(r=>setTimeout(r,500));
   }
   return null;
  },
  accountReceipt:async()=>{
   await step('purchase-history-reconciliation');resumedTab=null;
   for(let attempt=1;attempt<=3;attempt++) {
    const response=await readPage(BASE+'/account',{kind:'purchase-read',slot:record.slot,key:record.key,reference:record.reference,paymentDispatchedAt:record.paymentDispatchedAt});
    if(response?.ok)return response.value;
    if(response?.humanRequired || !/Unique matching purchase not found/.test(response?.error||''))throw Error(response?.error||'Purchase history unavailable');
    if(attempt<3)await new Promise(r=>setTimeout(r,1000));
   }
   throw Error('Paid purchase not verified; payment remains unresolved and will not be repeated');
  }
 });
}
async function finishPaidRecord(record) {
 const receipt=await readPaidEvidence(record),confirmed=confirmCheckout(record,receipt);
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 await step('paid-purchase-verified',{source:confirmed.receiptSource});await trace.finish('confirmed');
 const output={...paidResult(confirmed),runId:trace.record.id,finishedAt:trace.record.finishedAt};
 await chrome.storage.local.set({checkoutRecords:checkoutRecords.map(r=>r.key===record.key?confirmed:r),checkoutResult:output});
 await chrome.action.setBadgeText({text:'PAID'});await notifyPaymentResult(output);return output;
}
async function resolvePendingPayment() {
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 if(checkoutRecords.some(r=>r.status!=='confirmed'))await verifyPayment();
}
async function verifyPayment() {
 if(busy)throw Error('Another run is active');
 busy=true;
 try {
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 const record=checkoutRecords.find(r=>r.status!=='confirmed');if(!record)throw Error('No pending checkout record');
 trace=startRun(chrome.storage.local,'payment-reconciliation',record.slot.date);await step('started');
 return await finishPaidRecord(record);
 }catch(e){
  if(trace){await step('stopped');await trace.finish('stopped');}
  const output={status:'stopped',error:e.message,booked:null,paid:null,runId:trace?.record.id,finishedAt:trace?.record.finishedAt||new Date().toISOString()};
  await chrome.storage.local.set({checkoutResult:output});throw e;
 }finally{busy=false;trace=null;resumedTab=null;}
}
chrome.notifications?.onClicked.addListener(async id=>{
 if(id!=='tennis-checkout')return;
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');const record=checkoutRecords.find(r=>r.status!=='confirmed');
 if(record?.tabId)await chrome.tabs.update(record.tabId,{active:true}).catch(()=>{});
});
async function resume(day) {
  if(busy) throw Error('A check is already running');
  const {result}=await chrome.storage.local.get('result');
  if(!result?.retainedTabId) throw Error('No retained verification tab to resume');
  const tab=await readTab(()=>chrome.tabs.get(result.retainedTabId));
  if(!tab.url?.startsWith(BASE+'/')) throw Error('Retained tab left the Tower Hamlets site; stopped');
  const ready=await readTab(()=>chrome.tabs.sendMessage(tab.id,{kind:'ready'}));
  if(!ready?.ok) throw Error(ready?.error || 'Tab is not ready; finish verification manually');
  // A resumed tab remains open: it is now the user's foreground workflow.
  resumedTab=tab.id;
  try {await check(result.day || day);return (await chrome.storage.local.get('result')).result;}
  finally {resumedTab=null;}
}
chrome.alarms.onAlarm.addListener(async alarm=>{
  const {job}=await chrome.storage.local.get('job'); if(!job) return;
  try {
    if(alarm.name==='prepare') {
     if(job.mode==='payment')await resolvePendingPayment();
     if(busy)throw Error('Another run is active; preflight stopped');
     busy=true;trace=startRun(chrome.storage.local,'release-preflight',job.day);
     try {await step('started');if(job.mode==='payment'){await step('local-card-preflight');await paymentCard(chrome.storage,null);}await account();await chrome.storage.local.set({job:{...job,prepared:true,preparedAt:new Date().toISOString()}});await trace.finish('complete');}
     catch(e){await trace.finish('stopped');throw e;}
     finally{busy=false;trace=null;}
    }
    if(alarm.name==='release') {
      if(!job.prepared) throw Error('Preflight did not complete; check stopped');
      if(job.mode==='payment'){await resolvePendingPayment();await paymentCard(chrome.storage,null);}
      await check(job.day,true);
      if(['checkout','payment'].includes(job.mode)){const prepared=await checkout(job.day);if(job.mode==='payment' && prepared.status==='awaiting-payment')await automaticPayment();}
      await chrome.storage.local.remove('job');
    }
  } catch(e) {if(!e.recorded)await save({status:'stopped',day:job.day,checkedAt:new Date().toISOString(),step:alarm.name,error:e.message,booked:false,paid:false});await notifyPaymentResult({status:'stopped'});}
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.kind==='link-frame' && sender.id===chrome.runtime.id) {
   linkFrames.register(sender).then(ok=>respond({ok}),()=>respond({ok:false}));return true;
  }
  if(sender.id!==chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return;
  (async()=>{
    if(message.kind==='check') {await check(message.day); return (await chrome.storage.local.get('result')).result;}
    if(message.kind==='resume') return resume(message.day);
    if(message.kind==='prepareCheckout')return checkout();
    if(message.kind==='verifyPayment')return verifyPayment();
    if(message.kind==='openCardVault'){await chrome.tabs.create({url:chrome.runtime.getURL('card-vault.html'),active:true});return {status:'local-card-setup-opened'};}
    if(message.kind==='payCheckout')return automaticPayment();
    if(message.kind==='armPayment')return arm(message.day,'payment');
    if(message.kind==='reconcileBasket') {
     if(busy)throw Error('A check is already running');
     busy=true;
     try {
     const response=await readPage(BASE+'/basket',{kind:'basket-read'});
     if(!response.ok || !response.value.empty)throw Error('Basket is not verified empty; inspect manually');
     const {basketTest}=await chrome.storage.local.get('basketTest');
     if(basketTest)await chrome.storage.local.set({basketTest:{...basketTest,status:'cleared',manuallyReconciled:true}});
     return {status:'basket-reconciled-empty',booked:false,paid:false};
     }finally{busy=false;}
    }
    if(message.kind==='cancel') {await chrome.alarms.clear('prepare');await chrome.alarms.clear('release');await chrome.storage.local.remove('job');return {status:'cancelled'};}
    if(message.kind==='reset' && !busy) {await chrome.storage.local.remove('running');return {status:'reset'};}
    if(message.kind==='status') {
     const status=await chrome.storage.local.get(['result','job','running','basketTest','basketTestResult','runHistory','checkoutRecords','checkoutResult']);
     let localCardUnlocked=false;try{localCardUnlocked=!!(await chrome.storage.session.get('localPaymentCard')).localPaymentCard;}catch{}
     return {...status,localCardUnlocked};
    }
    throw Error('Unknown action');
  })().then(respond,e=>respond({status:'stopped',error:e.message,booked:false,paid:false})); return true;
});
// Recreate one-shot alarms after restart without starting a missed release.
async function restoreReleaseJob() {
  const {job}=await chrome.storage.local.get('job'); if(!job) return;
  if(job.when<=Date.now()) {await save({status:'stopped',day:job.day,checkedAt:new Date().toISOString(),error:'Chrome was closed at release; no late retry'});await chrome.storage.local.remove('job');return;}
  await chrome.alarms.create('prepare',{when:Math.max(Date.now()+1000,job.when-300000)});
  await chrome.alarms.create('release',{when:job.when});
}
chrome.runtime.onStartup.addListener(restoreReleaseJob);
// Extension updates may clear alarms; retain the saved read-only job and date.
chrome.runtime.onInstalled.addListener(restoreReleaseJob);
