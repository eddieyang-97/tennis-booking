import {VENUES, londonDay, addDays, releaseAt, candidates} from './core.js';
import {verifyBasket,basketEvidence} from './stage-rules.js';
import {retryTab} from './retry.js';
import {startRun} from './run-log.js';
import {prepareCheckout,checkoutCandidate,confirmCheckout,PAYMENT_TEST_SLOT,reconcileClearedSelection,basketTestKey,recoverPreparationTab} from './checkout.js';
import {payCheckout,openVerifiedCheckout} from './payment.js';
import {checkoutKey} from './checkout.js';
import {createLinkFrames} from './link-frames.js';
import {paymentCard} from './card-vault-core.js';
import {reconcilePaid,reportManualPayment} from './reconciliation.js';
import {readGrid,gridReadPolicy} from './grid-read.js';
import {readPageState,pageReadBudget,waitPaymentState} from './page-read.js';
import {normalizeDiscount,ensureDiscount,payableSlot} from './discount.js';
import {normalizeSettings,pendingArmBlocker} from './booking-settings.js';
const linkFrames=createLinkFrames(chrome.tabs,{step:(name,detail)=>step(name,detail)});
const BASE='https://tennistowerhamlets.com';
let busy=false;
let resumedTab=null;
let trace=null;
function newRun(kind,day){return startRun(chrome.storage.local,kind,day,{version:chrome.runtime.getManifest?.().version||'unknown'});}
async function step(name,detail={}){if(trace)await trace.step(name,detail);}
async function readTab(operation){return retryTab(operation,{onRetry:attempt=>step('temporary-tab-retry',{attempt})});}
async function save(result) { await chrome.storage.local.set({result}); await chrome.action.setBadgeText({text:result.status==='complete'?'OK':'!'}); }
async function notifyPaymentResult(result) {
 try {await chrome.notifications.create('tennis-payment-result',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:result.paid===true?'Tennis payment confirmed':'Tennis booking needs attention',message:result.paid===true?`${result.slot.date} ${result.slot.start}, £${result.slot.totalGBP}. Payment verified; open the account to check the active booking.`:'Open the extension for the stopped run. An uncertain payment will not be charged again.'});}
 catch {await step('notification-unavailable');}
}
async function readPage(url, request,{scheduled=false}={}) {
  if(request.kind==='grid')return readGrid(chrome.tabs,url,request,{tabId:resumedTab,step,...gridReadPolicy(scheduled)});
  return readPageState(chrome.tabs,url,request,{tabId:resumedTab,timeoutMs:pageReadBudget(scheduled),step});
}
async function account(scheduled=false) {
  const result=await readPage(BASE+'/account',{kind:'account'},{scheduled});
  if(!result.ok) throw Object.assign(Error(result.error),{diagnostic:{page:result.page,retainedTabId:result.retainedTabId}});
}
async function check(day, scheduled=false,settings=null) {
  if(busy) throw Error('A check is already running');
  busy=true;
  trace=newRun(scheduled?'release-check':'manual-check',day);
  let ownsRunning=false;
  try {
    if(settings)settings=normalizeSettings(settings);
    await step('started',{...(settings?{settings}:{})});
    addDays(day,0);
    if(day<londonDay() || day>addDays(londonDay(),7)) throw Error('Date is outside the current booking window');
    if(scheduled && Date.now()-releaseAt(day)>60000) throw Error('Release check was over one minute late; inspect manually');
    const prior=await chrome.storage.local.get('running');
    if(prior.running) throw Error('An earlier check was interrupted; reset the dry-run state after review');
    await chrome.storage.local.set({running:{day,started:Date.now()}});
    ownsRunning=true;
    await account(scheduled);
    const results=[];
    for(const venue of (settings?.venues||VENUES)) {
      const response=await readPage(`${BASE}/book/courts/${venue}/${day}#book`,{kind:'grid',venue,day},{scheduled});
      if(!response.ok) throw Object.assign(Error(response.error),{diagnostic:{page:response.page,retainedTabId:response.retainedTabId}});
      results.push({venue,candidates:candidates(response.rows,venue,day,{settings})});
      // The scheduled flow chooses this venue first anyway. Do not delay an
      // eligible preferred candidate behind a slow fallback-venue request.
      if(scheduled) {try{checkoutCandidate(results,settings);await step('preferred-candidate-found',{venue});break;}catch{}}
    }
    await step('availability-complete');await trace.finish('complete');
    await save({status:'complete',day,checkedAt:new Date().toISOString(),runId:trace.record.id,results,...(settings?{settings}:{}),booked:false,paid:false});
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
async function arm(day,mode='availability',code='',settings=null) {
  const discountCode=normalizeDiscount(code);
  settings=normalizeSettings(settings||undefined);
  addDays(day,0);
  const when=releaseAt(day);
  if(when<=Date.now()) throw Error('This date has already released; use Check now');
  if(mode==='payment'){
   try{await resolvePendingPayment();}catch(error){
    const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords'),blocker=pendingArmBlocker(checkoutRecords);
    if(blocker)throw Object.assign(Error(`The selected date ${day} has not released yet and can be scheduled. ${blocker}`),{code:'UNRESOLVED_CHECKOUT',attemptedDay:day});
    throw error;
   }
   await paymentCard(chrome.storage,null);
  }
  await chrome.alarms.clear('prepare'); await chrome.alarms.clear('release');
  if(!['availability','checkout','payment'].includes(mode))throw Error('Unknown release mode');
  await chrome.storage.local.set({job:{day,when,prepared:false,mode,settings,...(discountCode?{discountCode}:{})},bookingSettings:settings});
  await chrome.alarms.create('prepare',{when:Math.max(Date.now()+1000,when-300000)});
  await chrome.alarms.create('release',{when});
  return {status:'armed',day,release:new Date(when).toISOString(),mode,paymentAutomatic:mode==='payment',discountRequested:!!discountCode,settings};
}
function checkoutCommands(tabId) {
 const command=async request=>{const response=await chrome.tabs.sendMessage(tabId,request);if(request.kind==='payment-open')await step('checkout-open-response',{tabId,ok:response?.ok===true,...(response?.routeCategory?{routeCategory:response.routeCategory}:{})});if(!response?.ok)throw Error(response?.error||'Checkout response unavailable');return response.value;};
 const state=async()=>{const current=await readTab(()=>chrome.tabs.get(tabId));const url=new URL(current.url);if(url.origin!==BASE||!['/basket','/basket/pay/card'].includes(url.pathname))throw Error('Checkout left supported payment pages; inspect retained tab');return readTab(()=>command({kind:'payment-state'}));};
 return {command,state};
}
async function openStoredCheckout(record,tabId,scheduled,save) {
 const {command,state}=checkoutCommands(tabId);
 await step('card-page-readiness',{timeoutMs:pageReadBudget(scheduled)});
 return openVerifiedCheckout(record,{
  current:()=>readTab(()=>chrome.tabs.get(tabId)),save,command,state,
  read:async()=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId,navigate:false,timeoutMs:pageReadBudget(scheduled),step});if(!response.ok)throw Error(response.error);await step('checkout-basket-verified',{tabId,...basketEvidence(response.value,record.slot)});return response.value;}
 },{timeoutMs:pageReadBudget(scheduled)});
}

async function automaticPayment(test=false,scheduled=false) {
 if(busy)throw Error('Another run is active');busy=true;
 let tab,record;
 try {
  let {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
  record=checkoutRecords.find(r=>r.status!=='confirmed');
  if(record?.basketOnly||record?.checkoutTestOnly)throw Error('Unpaid test cannot submit payment; clear and reconcile its basket');
  if(test && record && record.key!==checkoutKey(PAYMENT_TEST_SLOT,true))throw Error('Another checkout requires reconciliation');
  if(record?.manualPaymentReportedAt || record?.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record?.phase)) {
   trace=newRun('payment-reconciliation',record.slot.date);await step('started');
   return await finishPaidRecord(record,scheduled);
  }
  if(test && checkoutRecords.some(r=>r.test&&r.status==='confirmed'))throw Error('This paid test is already confirmed; it cannot be charged again');
  if(test){tab=(await readTab(()=>chrome.tabs.query({active:true,currentWindow:true})))[0];if(![BASE+'/basket',BASE+'/basket/pay/card'].includes(tab?.url))throw Error('Open the £2.50 test basket or card checkout');}
  else if(record?.tabId)tab=await readTab(()=>chrome.tabs.get(record.tabId));
  if(!tab)throw Error('No checkout tab');
  trace=newRun('automatic-payment',record?.slot.date||PAYMENT_TEST_SLOT.date);await step('started',{key:record?.key,preparationRunId:record?.preparationRunId});
  await step('local-card-preflight');const localCard=await paymentCard(chrome.storage,record);await step('local-card-ready',{reconciliationOnly:!localCard});
  const readBasket=async slot=>{resumedTab=null;const response=await readPage(BASE+'/basket',{kind:'basket-read'},{scheduled});if(!response.ok)throw Error(response.error);verifyBasket(response.value,slot,record?.discount);return response.value;};
  const store=async r=>{record=r;checkoutRecords=[...checkoutRecords.filter(x=>x.key!==r.key),r];await chrome.storage.local.set({checkoutRecords});await step(r.phase);};
  if(!record){await readBasket(PAYMENT_TEST_SLOT);record={key:checkoutKey(PAYMENT_TEST_SLOT,true),slot:PAYMENT_TEST_SLOT,test:true,tabId:tab.id,status:'pending',phase:'basket-adopted'};await store(record);}
  const {command,state}=checkoutCommands(tab.id);
  const frame=(type,kind)=>linkFrames.command(tab.id,type,kind,{attempts:kind==='link-state'?1:12});
  record=await ensureDiscount(record,{
   save:store,
   read:async remaining=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:tab.id,navigate:false,timeoutMs:Math.min(remaining||pageReadBudget(scheduled),pageReadBudget(scheduled)),step});if(!response.ok)throw Error(response.error);return response.value;},
   apply:(code,expected)=>command({kind:'discount-apply',code,expected})
  },{timeoutMs:pageReadBudget(scheduled)});
  if(record.discount)await step('discount-verified',{...record.discount});
  const output=await payCheckout(record,{
   save:store,verifyBasket:readBasket,
   open:()=>openStoredCheckout(record,tab.id,scheduled,store),
   state,
   ...(localCard?{
    fillCard:async()=>{try{await frame('modal','link-close');}catch{}await linkFrames.command(tab.id,'card','card-fill',{payload:{card:localCard}});},
    waitCardReady:async()=>{await step('card-submit-readiness',{timeoutMs:pageReadBudget(scheduled)});return waitPaymentState(state,{timeoutMs:pageReadBudget(scheduled),accept:current=>{if(current.totalGBP!==payableSlot(record).totalGBP||current.reference!==record.reference)throw Error('Checkout identity changed while waiting; no payment');return current.enabled;}});}
   }:{}),
   submit:(totalGBP,reference)=>command({kind:'payment-submit',totalGBP,reference}),
   receipt:()=>readPaidEvidence(record,tab.id,true,scheduled)
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
async function checkout(expectedDay=null,scheduled=false,basketOnly=false,discountCode='',settings=null,checkoutTestOnly=false) {
 if(busy)throw Error('Another run is active');
 busy=true;
 let tab,slot;
 try {
 const {result,basketTest,checkoutRecords=[]}=await chrome.storage.local.get(['result','basketTest','checkoutRecords']);
 if(basketTest && basketTest.status!=='cleared')throw Error('Basket test needs reconciliation first');
 const pending=checkoutRecords.find(r=>r.status!=='confirmed');
 if(pending&&!!pending.checkoutTestOnly!==checkoutTestOnly)throw Error('Another checkout requires reconciliation');
 settings=basketOnly?null:pending?(pending.settings||null):(settings||result?.settings||null);
 if(settings)settings=normalizeSettings(settings);
 if(pending && !!pending.basketOnly!==basketOnly)throw Error('Another checkout requires reconciliation');
 if(expectedDay && pending && pending.slot.date!==expectedDay)throw Error('Another date has an unresolved checkout; release preparation stopped');
 slot=pending?.slot || (!basketOnly && result?.status==='complete'?checkoutCandidate(result.results,settings):null);
 if(basketOnly && !slot) {
  addDays(expectedDay,0);
  if(expectedDay<londonDay()||expectedDay>addDays(londonDay(),7))throw Error('Choose a released date within the next seven days');
  trace=newRun('daytime-basket-test',expectedDay);await step('started');
  await account();
  for(const venue of VENUES) {
   const grid=await readPage(`${BASE}/book/courts/${venue}/${expectedDay}#book`,{kind:'grid',venue,day:expectedDay});
   if(!grid.ok)throw Error(grid.error);
   slot=candidates(grid.rows,venue,expectedDay,{basketOnly:true}).map(candidate=>({...candidate,venue})).find(candidate=>{try{basketTestKey(candidate);return true;}catch{return false;}});
   if(slot)break;
  }
  if(!slot)throw Error('No available 09:00–11:00 basket-test candidate within £14; choose another released date');
 }
 if(!slot)throw Error('Check availability before preparing checkout');
 trace=trace||newRun('checkout-preparation',slot.date);
  await step('started',{slot,scheduled,basketOnly,...(settings?{settings}:{})});
  if(pending?.tabId) {
   tab=await recoverPreparationTab(pending,{get:id=>readTab(()=>chrome.tabs.get(id))},async()=>{
    await step('closed-selection-tab-recovery',{previousTabId:pending.tabId});
    const replacement=await retryTab(()=>chrome.tabs.create({url:BASE+'/basket',active:false}),{navigation:true});
    await chrome.storage.local.set({checkoutRecords:checkoutRecords.map(record=>record.key===pending.key?{...record,tabId:replacement.id,updatedAt:new Date().toISOString()}:record)});
    return replacement;
   });
   if(!tab.url?.startsWith(BASE+'/'))throw Error('Checkout tab left Courtside');
  }
  else tab=await retryTab(()=>chrome.tabs.create({url:BASE+'/basket',active:false}),{navigation:true});
  resumedTab=tab.id;
  // Never navigate away from a card form or bank challenge to "resume" selection.
  if(pending && tab.url!==BASE+'/basket')throw Error('Checkout/payment is in progress; use Verify payment confirmation');
  const read=async()=>{const response=await readPage(BASE+'/basket',{kind:'basket-read'},{scheduled});if(!response.ok)throw Error(response.error);await step('basket-observed',basketEvidence(response.value,slot));return response.value;};
  const output=await prepareCheckout(slot,{
   tabId:tab.id,
   load:async()=> (await chrome.storage.local.get('checkoutRecords')).checkoutRecords||[],
   save:async records=>{const record={...records.at(-1),preparationRunId:trace.record.id};await chrome.storage.local.set({checkoutRecords:[...records.slice(0,-1),record]});await step(record.phase,{key:record.key,...(record.fallbackFrom?{fallbackFrom:record.fallbackFrom}:{})});},
   read,select:async s=>{
    const grid=await readPage(`${BASE}/book/courts/${s.venue}/${s.date}#book`,{kind:'grid',venue:s.venue,day:s.date},{scheduled});if(!grid.ok)throw Error(grid.error);
    // One mutation dispatch. Reconciliation occurs in prepareCheckout, never replay.
    const response=await chrome.tabs.sendMessage(tab.id,{kind:'select-slot',slot:s,selectionTimeoutMs:pageReadBudget(scheduled)});const selectionDiagnostic=response?.selectionDiagnostic||response?.value?.selectionDiagnostic;
    await step('selection-result',{ok:response?.ok===true,...(selectionDiagnostic?{selectionDiagnostic}:{})});
    if(!response?.ok)throw Object.assign(Error(response?.error||'Selection response uncertain'),{selectionDiagnostic});
    return response.value;
   },
   retain:async()=>{await chrome.tabs.update(tab.id,{active:true});return tab.id;},notify:basketOnly||checkoutTestOnly?async()=>{await chrome.action.setBadgeText({text:'TEST'});}:notifyCheckout
  },{test:pending?.test===true,basketOnly,allowPartial:scheduled&&!basketOnly,discountCode,settings,checkoutTestOnly});
  await trace.finish(output.status);await chrome.storage.local.set({checkoutResult:{...output,runId:trace.record.id,finishedAt:trace.record.finishedAt}});return output;
 } catch(e) {
  if(!trace)trace=newRun('checkout-preparation',slot?.date||londonDay());
  await step('checkout-stopped',{...(e.basketDiagnostic?{basketDiagnostic:e.basketDiagnostic}:{}),...(e.diagnostic?{diagnostic:e.diagnostic}:{})});await trace.finish('stopped');const output={status:'stopped',error:e.message,...(e.basketDiagnostic?{basketDiagnostic:e.basketDiagnostic}:{}),...(e.diagnostic?{diagnostic:e.diagnostic}:{}),tabId:tab?.id,booked:false,paid:false,runId:trace.record.id};await chrome.storage.local.set({checkoutResult:output});
  await chrome.action.setBadgeText({text:'!'});
  try{await chrome.notifications.create('tennis-checkout-stopped',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:'Tennis checkout stopped',message:'Open the extension to inspect the result. No automatic payment was attempted.'});}catch{}
  return output;
 } finally {resumedTab=null;busy=false;trace=null;}
}
function paidResult(record) {
 return {status:'confirmed',slot:record.slot,totalPaidGBP:payableSlot(record).totalGBP,discountApplied:!!record.discount,manualPayment:!!record.manualPaymentReportedAt,reference:record.reference,confirmedAt:record.confirmedAt,receiptSource:record.receiptSource,bookingState:record.bookingState,booked:record.bookingState==='confirmed'?true:null,paid:true};
}
async function testDiscountCheckout(code='') {
 if(busy)throw Error('Another run is active');
 const discountCode=normalizeDiscount(code),saved=await chrome.storage.local.get(['checkoutRecords','job']);
 if(saved.job)throw Error('Cancel the scheduled run before running an unpaid checkout test');
 let record=(saved.checkoutRecords||[]).find(r=>r.status!=='confirmed');
 if(record&&!record.checkoutTestOnly)throw Error('Resolve the existing checkout before starting an unpaid checkout test');
 if(record&&(record.discountCode||'')!==discountCode)throw Error('The pending test uses a different discount code; finish or clear that test first');
 if(!record){const prepared=await checkout(null,false,false,discountCode,null,true);if(prepared.status!=='checkout-test-prepared')return prepared;}
 if(busy)throw Error('Another run is active');busy=true;
 try{
  let {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');record=checkoutRecords.find(r=>r.status!=='confirmed');
  if(!record?.checkoutTestOnly||record.manualPaymentReportedAt||record.paymentDispatchedAt)throw Error('No eligible unpaid checkout test');
  trace=newRun('unpaid-checkout-test',record.slot.date);await step('started',{key:record.key});
  const store=async value=>{record=value;checkoutRecords=checkoutRecords.map(r=>r.key===value.key?value:r);await chrome.storage.local.set({checkoutRecords});await step(value.phase);};
  const {command}=checkoutCommands(record.tabId);
  record=await ensureDiscount(record,{
   save:store,
   read:async remaining=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:record.tabId,navigate:false,timeoutMs:Math.min(remaining||15000,15000),step});if(!response.ok)throw Error(response.error);return response.value;},
   apply:(code,expected)=>command({kind:'discount-apply',code,expected})
  });
  if(record.discount)await step('discount-verified',{...record.discount});
  await store({...record,phase:'checkout-test-opening'});
  const opened=await openStoredCheckout(record,record.tabId,false,store);
  await store({...opened.record,reference:opened.page.reference,phase:'checkout-test-ready',checkoutTestVerifiedAt:new Date().toISOString()});
  await chrome.tabs.update(record.tabId,{active:true});await trace.finish('checkout-test-passed');
  const result={status:'checkout-test-passed',slot:record.slot,grossTotalGBP:record.slot.totalGBP,discountGBP:record.discount?.discountGBP||'0.00',payableGBP:payableSlot(record).totalGBP,checkoutOpened:true,paymentBlocked:true,cardFilled:false,booked:false,paid:false,runId:trace.record.id,finishedAt:trace.record.finishedAt};
  await chrome.storage.local.set({checkoutResult:result});return result;
 }catch(error){
  if(trace){await step('stopped');await trace.finish('stopped');}
  const result={status:'stopped',error:error.message,paymentBlocked:true,booked:false,paid:false,runId:trace?.record.id};await chrome.storage.local.set({checkoutResult:result});return result;
 }finally{busy=false;trace=null;resumedTab=null;}
}
async function readPaidEvidence(record,tabId=record.tabId,wait=false,scheduled=false) {
 return reconcilePaid(record,{
  currentReceipt:async()=>{
   for(let i=0;i<(wait?10:1);i++) {
    try {
     const current=await readTab(()=>chrome.tabs.get(tabId));
     if(new URL(current.url).origin!==BASE||!new URL(current.url).pathname.startsWith('/basket'))return null;
     const response=await readTab(()=>chrome.tabs.sendMessage(tabId,{kind:'receipt-read',slot:payableSlot(record),key:record.key}));
     if(response?.ok&&response.value.status==='confirmed')return response.value;
    }catch{ return null; }
    if(wait)await new Promise(r=>setTimeout(r,500));
   }
   return null;
  },
  accountReceipt:async()=>{
   await step('purchase-history-reconciliation');resumedTab=null;
   for(let attempt=1;attempt<=3;attempt++) {
    const response=await readPage(BASE+'/account',{kind:'purchase-read',slot:payableSlot(record),key:record.key,reference:record.reference,paymentDispatchedAt:record.paymentDispatchedAt,manualPaymentReportedAt:record.manualPaymentReportedAt},{scheduled});
    if(response?.ok)return response.value;
    if(response?.humanRequired || !/Unique matching purchase not found/.test(response?.error||''))throw Error(response?.error||'Purchase history unavailable');
    if(attempt<3)await new Promise(r=>setTimeout(r,1000));
   }
   throw Error('Paid purchase not verified; payment remains unresolved and will not be repeated');
  }
 });
}
async function finishPaidRecord(record,scheduled=false) {
 const receipt=await readPaidEvidence(record,record.tabId,false,scheduled),confirmed=confirmCheckout(record,receipt);
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 await step('paid-purchase-verified',{source:confirmed.receiptSource});await trace.finish('confirmed');
 const output={...paidResult(confirmed),runId:trace.record.id,finishedAt:trace.record.finishedAt};
 await chrome.storage.local.set({checkoutRecords:checkoutRecords.map(r=>r.key===record.key?confirmed:r),checkoutResult:output});
 await chrome.action.setBadgeText({text:'PAID'});await notifyPaymentResult(output);return output;
}
async function resolvePendingPayment(scheduled=false) {
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 if(checkoutRecords.some(r=>r.status!=='confirmed'))await verifyPayment(scheduled);
}
async function verifyPayment(scheduled=false,manualReference=null) {
 if(busy)throw Error('Another run is active');
 busy=true;
 try {
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');
 let record=checkoutRecords.find(r=>r.status!=='confirmed');if(!record)throw Error('No pending checkout record');
 trace=newRun(manualReference!==null?'manual-payment-reconciliation':'payment-reconciliation',record.slot.date);await step('started');
 if(manualReference!==null){
  record=reportManualPayment(record,manualReference);
  await chrome.storage.local.set({checkoutRecords:checkoutRecords.map(r=>r.key===record.key?record:r)});
  await step('manual-payment-reported',{key:record.key});
 }
 if(!record.reference&&!record.paymentDispatchedAt)throw Error('No recorded payment reference. If you paid manually, enter its booking reference and use Verify manual payment');
 return await finishPaidRecord(record,scheduled);
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
  try {await check(result.day || day,false,result.settings||null);return (await chrome.storage.local.get('result')).result;}
  finally {resumedTab=null;}
}
chrome.alarms.onAlarm.addListener(async alarm=>{
  const {job}=await chrome.storage.local.get('job'); if(!job) return;
  try {
    if(alarm.name==='prepare') {
     if(job.mode==='payment')await resolvePendingPayment(true);
     if(busy)throw Error('Another run is active; preflight stopped');
     busy=true;trace=newRun('release-preflight',job.day);
     try {await step('started');if(job.mode==='payment'){await step('local-card-preflight');await paymentCard(chrome.storage,null);}await account(true);await chrome.storage.local.set({job:{...job,prepared:true,preparedAt:new Date().toISOString()}});await trace.finish('complete');}
     catch(e){await trace.finish('stopped');throw e;}
     finally{busy=false;trace=null;}
    }
    if(alarm.name==='release') {
      if(!job.prepared) throw Error('Preflight did not complete; check stopped');
      if(job.mode==='payment'){await resolvePendingPayment(true);await paymentCard(chrome.storage,null);}
      await check(job.day,true,job.settings||null);
      if(['checkout','payment'].includes(job.mode)){const prepared=await checkout(job.day,true,false,job.discountCode||'',job.settings||null);if(job.mode==='payment' && prepared.status==='awaiting-payment')await automaticPayment(false,true);}
      await chrome.storage.local.remove('job');
    }
  } catch(e) {if(!e.recorded)await save({status:'stopped',day:job.day,checkedAt:new Date().toISOString(),step:alarm.name,error:e.message,...e.diagnostic,booked:false,paid:false});await notifyPaymentResult({status:'stopped'});}
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.kind==='link-frame' && sender.id===chrome.runtime.id) {
   linkFrames.register(sender).then(ok=>respond({ok}),()=>respond({ok:false}));return true;
  }
  if(sender.id!==chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return;
  (async()=>{
    if(message.kind==='check') {await check(message.day,false,message.settings||null); return (await chrome.storage.local.get('result')).result;}
    if(message.kind==='resume') return resume(message.day);
    if(message.kind==='saveSettings'){const settings=normalizeSettings(message.settings);await chrome.storage.local.set({bookingSettings:settings});return {status:'preferences-saved',settings,armedJobChanged:false};}
    if(message.kind==='prepareCheckout')return checkout();
    if(message.kind==='daytimeBasketTest')return checkout(message.day,false,true);
    if(message.kind==='testDiscountCheckout')return testDiscountCheckout(message.discountCode);
    if(message.kind==='verifyPayment')return verifyPayment();
    if(message.kind==='reconcileManualPayment')return verifyPayment(false,message.reference||'');
    if(message.kind==='openCardVault'){await chrome.tabs.create({url:chrome.runtime.getURL('card-vault.html'),active:true});return {status:'local-card-setup-opened'};}
    if(message.kind==='payCheckout')return automaticPayment();
    if(message.kind==='armPayment')return arm(message.day,'payment',message.discountCode,message.settings);
    if(message.kind==='reconcileSelection') {
     if(busy)throw Error('Another run is active');busy=true;
     try {
      const {checkoutRecords=[],abandonedCheckouts=[]}=await chrome.storage.local.get(['checkoutRecords','abandonedCheckouts']);
      const response=await readPage(BASE+'/basket',{kind:'basket-read'});if(!response.ok)throw Error(response.error);
      const reconciled=reconcileClearedSelection(checkoutRecords,response.value,{unpaidTestConfirmed:message.unpaidTestConfirmed===true});
      await chrome.storage.local.set({checkoutRecords:reconciled.checkoutRecords,abandonedCheckouts:[...abandonedCheckouts,reconciled.abandoned].slice(-20)});
      return {status:'selection-reconciled-empty',booked:false,paid:false};
     }finally{busy=false;}
    }
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
     const status=await chrome.storage.local.get(['result','job','running','basketTest','basketTestResult','runHistory','checkoutRecords','checkoutResult','abandonedCheckouts','bookingSettings']);
     let localCardUnlocked=false;try{localCardUnlocked=!!(await chrome.storage.session.get('localPaymentCard')).localPaymentCard;}catch{}
     return {...status,localCardUnlocked,version:chrome.runtime.getManifest().version};
    }
    throw Error('Unknown action');
  })().then(respond,e=>{const uncertain=['verifyPayment','reconcileManualPayment','armPayment','payCheckout'].includes(message.kind);respond({status:'stopped',error:e.message,...(e.code?{errorCode:e.code}:{}),...(e.attemptedDay?{attemptedDay:e.attemptedDay}:{}),booked:uncertain?null:false,paid:uncertain?null:false});}); return true;
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
