import {VENUES, londonDay, addDays, releaseAt, candidates} from './core.js';
import {verifyBasket,basketEvidence} from './stage-rules.js';
import {retryTab,temporaryTabError} from './retry.js';
import {startRun} from './run-log.js';
import {prepareCheckout,checkoutCandidate,confirmCheckout,PAYMENT_TEST_SLOT,reconcileClearedSelection,archiveFailedCheckout,assertFailedCheckoutAttestation,basketTestKey,recoverPreparationTab} from './checkout.js';
import {payCheckout,openVerifiedCheckout,assertCardFillProvenance} from './payment.js';
import {checkoutKey} from './checkout.js';
import {createLinkFrames} from './link-frames.js';
import {paymentCard} from './card-vault-core.js';
import {reconcilePaid,reportManualPayment} from './reconciliation.js';
import {readGrid,gridReadPolicy} from './grid-read.js';
import {readPageState,pageReadBudget,waitPaymentState,responseWithin} from './page-read.js';
import {normalizeDiscount,ensureDiscount,payableSlot} from './discount.js';
import {normalizeSettings,pendingArmBlocker} from './booking-settings.js';
import {clearUnpaidTest} from './test-cleanup.js';
import {failureFor} from './failures.js';
import {selectionEvidence,selectionFailure} from './selection-evidence.js';
import {executeAction,createSerialExecutor} from './actions.js';
const enqueueAction=createSerialExecutor();
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
 try {await chrome.notifications.create('tennis-payment-result',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:result.freeBooking&&result.booked===true?'Free tennis booking confirmed':result.paid===true?'Tennis payment confirmed':'Tennis booking needs attention',message:result.freeBooking&&result.booked===true?`${result.slot.date} ${result.slot.start}. Free booking receipt verified; no card payment submitted.`:result.paid===true?`${result.slot.date} ${result.slot.start}, £${result.slot.totalGBP}. Payment verified; open the account to check the active booking.`:'Open the extension for the stopped run. An uncertain payment will not be charged again.'});}
 catch {await step('notification-unavailable');}
}
async function readPage(url, request,{scheduled=false,retainGrid=false}={}) {
  if(request.kind==='grid')return readGrid(chrome.tabs,url,request,{tabId:resumedTab,retain:retainGrid,step,...gridReadPolicy(scheduled)});
  return readPageState(chrome.tabs,url,request,{tabId:resumedTab,timeoutMs:pageReadBudget(scheduled),step});
}
async function account(scheduled=false) {
  const result=await readPage(BASE+'/account',{kind:'account'},{scheduled});
  if(!result.ok) throw Object.assign(Error(result.error),{diagnostic:{page:result.page,retainedTabId:result.retainedTabId}});
}
async function check(day, scheduled=false,settings=null,retainForCheckout=false) {
  if(!scheduled)await admitManualCheck();
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
    const results=[];let gridHandoff=null;
    for(const venue of (settings?.venues||VENUES)) {
      const response=await readPage(`${BASE}/book/courts/${venue}/${day}#book`,{kind:'grid',venue,day},{scheduled,retainGrid:scheduled&&retainForCheckout});
      if(!response.ok) throw Object.assign(Error(response.error),{diagnostic:{page:response.page,retainedTabId:response.retainedTabId}});
      results.push({venue,candidates:candidates(response.rows,venue,day,{settings})});
      // The scheduled flow chooses this venue first anyway. Do not delay an
      // eligible preferred candidate behind a slow fallback-venue request.
      if(scheduled) {
       let eligible=false;try{checkoutCandidate(results,settings);eligible=true;}catch{}
       if(eligible){if(retainForCheckout)gridHandoff={tabId:response.gridTabId,venue,day};await step('preferred-candidate-found',{venue});break;}
       if(retainForCheckout)await chrome.tabs.remove(response.gridTabId).catch(()=>{});
      }
    }
    await step('availability-complete');await trace.finish('complete');
    await save({status:'complete',day,checkedAt:new Date().toISOString(),runId:trace.record.id,results,...(settings?{settings}:{}),booked:false,paid:false});
    await chrome.storage.local.remove('running');
    // An ephemeral tab hint, never persisted or accepted as authorization.
    return gridHandoff;
  } catch(e) { await step('stopped',failureFor(e));await trace.finish('stopped');await save({status:'stopped',day,checkedAt:new Date().toISOString(),runId:trace.record.id,error:e.message,...e.diagnostic,booked:false,paid:false});e.recorded=true;throw e; }
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
 const command=async request=>{
  const response=await chrome.tabs.sendMessage(tabId,request);
  if(request.kind==='payment-open')await step('checkout-open-response',{tabId,ok:response?.ok===true,...(response?.routeCategory?{routeCategory:response.routeCategory}:{})});
  // Navigation may remove the read receiver before its reply. Only this
  // read-only probe is eligible for the caller's bounded observation loop.
  if(response==null&&request.kind==='checkout-progress'){
   await step('checkout-read-unavailable',{tabId,reasonCode:'CHECKOUT_READ_UNAVAILABLE'});
   throw Object.assign(Error('Checkout read response unavailable'),{code:'CHECKOUT_READ_UNAVAILABLE'});
  }
  if(!response?.ok)throw Error(response?.error||'Checkout response unavailable');return response.value;
 };
 let lastProgress;
 const state=async()=>{const current=await readTab(()=>chrome.tabs.get(tabId));const url=new URL(current.url);if(url.origin!==BASE)throw Error('Checkout left the trusted site; inspect retained tab');
  const progress=await readTab(()=>command({kind:'checkout-progress'}));
  const evidence={stage:progress.stage,loadState:progress.loadState,merchantError:progress.merchantError===true,...(progress.reference?{reference:progress.reference,totalGBP:progress.totalGBP}:{})},fingerprint=JSON.stringify(evidence);
  if(fingerprint!==lastProgress){await step('checkout-page-progress',{tabId,...evidence});lastProgress=fingerprint;}
  if(progress.merchantError)throw Error('Merchant reported Something went wrong while opening checkout; no repeat request sent');
  if(progress.stage==='existing-purchase')throw Error('Existing-purchase payment page requires read-only recovery assessment; no Pay or cancellation action sent');
  if(progress.stage==='other-page')throw Error('Checkout left supported payment pages; inspect retained tab');
  if(progress.stage!=='card')throw Error('Not the card checkout');return progress;
 };
 return {command,state};
}
async function openStoredCheckout(record,tabId,scheduled,save) {
 const {command,state}=checkoutCommands(tabId);
 const timeoutMs=60000;await step('card-page-readiness',{timeoutMs});
 return openVerifiedCheckout(record,{
  current:()=>readTab(()=>chrome.tabs.get(tabId)),save,command,state,
  read:async()=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId,navigate:false,timeoutMs:pageReadBudget(scheduled),step});if(!response.ok)throw Error(response.error);await step('checkout-basket-verified',{tabId,...basketEvidence(response.value,record.slot)});return response.value;}
 },{timeoutMs});
}

async function automaticPayment(test=false,scheduled=false,basketHandoff=null) {
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
  assertCardFillProvenance(record);
  if(test && checkoutRecords.some(r=>r.test&&r.status==='confirmed'))throw Error('This paid test is already confirmed; it cannot be charged again');
  if(test){tab=(await readTab(()=>chrome.tabs.query({active:true,currentWindow:true})))[0];if(![BASE+'/basket',BASE+'/basket/pay/card'].includes(tab?.url))throw Error('Open the £2.50 test basket or card checkout');}
  else if(record?.tabId)tab=await readTab(()=>chrome.tabs.get(record.tabId));
  if(!tab)throw Error('No checkout tab');
  trace=newRun('automatic-payment',record?.slot.date||PAYMENT_TEST_SLOT.date);await step('started',{key:record?.key,preparationRunId:record?.preparationRunId});
  await step('local-card-preflight');const localCard=await paymentCard(chrome.storage,record);await step('local-card-ready',{reconciliationOnly:!localCard});
  const readBasket=async slot=>{
   resumedTab=null;
   if(basketHandoff&&(basketHandoff.key!==record?.key||basketHandoff.tabId!==tab.id||record.checkoutOpenDispatchedAt))throw Object.assign(Error('Prepared basket handoff changed; inspect checkout'),{reasonCode:'AUTHORIZATION_INVALID'});
   if(basketHandoff&&(await readTab(()=>chrome.tabs.get(tab.id))).url!==BASE+'/basket')throw Object.assign(Error('Prepared basket tab route changed; no navigation sent'),{pageCode:'PAGE_BASKET_ROUTE_CHANGED'});
   const response=basketHandoff
    // Refresh the shared merchant basket, not just the old DOM. Another tab
    // can change the server basket without changing this tab's visible items.
    ?await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:tab.id,timeoutMs:pageReadBudget(scheduled),step})
    :await readPage(BASE+'/basket',{kind:'basket-read'},{scheduled});
   if(!response.ok)throw Error(response.error);verifyBasket(response.value,slot,record?.discount);return response.value;
  };
  const store=async r=>{record=r;checkoutRecords=[...checkoutRecords.filter(x=>x.key!==r.key),r];await chrome.storage.local.set({checkoutRecords});await step(r.phase);};
  if(!record){await readBasket(PAYMENT_TEST_SLOT);record={key:checkoutKey(PAYMENT_TEST_SLOT,true),slot:PAYMENT_TEST_SLOT,test:true,tabId:tab.id,status:'pending',phase:'basket-adopted'};await store(record);}
  const {command,state}=checkoutCommands(tab.id);
  const frame=(type,kind)=>linkFrames.command(tab.id,type,kind,{attempts:kind==='link-state'?1:12});
  record=await ensureDiscount(record,{
   save:store,
   read:async remaining=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:tab.id,navigate:false,observeLoadingMessageErrors:!!record.discountDispatchedAt,timeoutMs:Math.min(remaining||pageReadBudget(scheduled),pageReadBudget(scheduled)),step});if(!response.ok)throw Object.assign(Error('Discount basket observation rejected; inspect retained tab'),failureFor(response));return response.value;},
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
   completeFree:expected=>command({kind:'free-booking-submit',expected}),
   submit:(totalGBP,reference)=>command({kind:'payment-submit',totalGBP,reference}),
   receipt:()=>readPaidEvidence(record,tab.id,true,scheduled)
  });
  if(output.status==='confirmed'){await store({...output,tabId:tab.id});await chrome.action.setBadgeText({text:output.freeBookingDispatchedAt?'BOOK':'PAID'});}
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
  const paymentPossible=!!(record?.paymentDispatchedAt||record?.manualPaymentReportedAt||['payment-dispatched','payment-uncertain'].includes(record?.phase));
  const failure=failureFor(e,{paymentPossible});
  if(trace){await step('stopped',failure);await trace.finish('stopped');}
  const output={status:'stopped',error:e.message,...failure,...(e.code?{errorCode:e.code}:{}),tabId:tab?.id,phase:record?.phase,booked:paymentPossible?null:false,paid:record?.freeBookingDispatchedAt?false:paymentPossible?null:false,...(linkDiagnostic?{linkDiagnostic}:{}),runId:trace?.record.id,finishedAt:trace?.record.finishedAt||new Date().toISOString()};await chrome.storage.local.set({checkoutResult:output});await chrome.action.setBadgeText({text:'!'});await notifyPaymentResult(output);return output;
 }
 finally{busy=false;trace=null;resumedTab=null;}
}

async function notifyCheckout(slot) {
 await chrome.action.setBadgeText({text:'PAY'});
 await chrome.action.setTitle({title:`Checkout ready: ${slot.date} ${slot.start}, £${slot.totalGBP}`});
 try {await chrome.notifications.create('tennis-checkout',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:'Tennis checkout ready',message:`${slot.date} ${slot.start}, £${slot.totalGBP}. Verified basket ready; inspect the extension for payment status.`});}
 catch {await step('notification-unavailable');}
}
async function checkout(expectedDay=null,scheduled=false,basketOnly=false,discountCode='',settings=null,checkoutTestOnly=false,gridHandoff=null) {
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
  const reuseGrid=scheduled&&!pending&&!basketOnly&&!checkoutTestOnly&&gridHandoff!==null;
  if(reuseGrid){
   if(gridHandoff.venue!==slot.venue||gridHandoff.day!==slot.date||!Number.isInteger(gridHandoff.tabId))throw Object.assign(Error('Selection grid handoff identity changed'),{reasonCode:'AUTHORIZATION_INVALID'});
   tab=await readTab(()=>chrome.tabs.get(gridHandoff.tabId));
  }
  else if(pending?.tabId) {
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
  let selectionStarted=false,basketLoaded=!pending&&!reuseGrid;
  const read=async()=>{
   let response;
   if(reuseGrid&&!selectionStarted){
    // Inspect the shared basket once without navigating away from the grid.
    response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{timeoutMs:pageReadBudget(scheduled),step});
   }else{
    if(!basketLoaded){
     const current=await readTab(()=>chrome.tabs.get(tab.id));
     if(![BASE+'/basket',`${BASE}/book/courts/${slot.venue}/${slot.date}#book`].includes(current.url))throw Object.assign(Error('Checkout tab route changed; no basket navigation sent'),{pageCode:'PAGE_BASKET_ROUTE_CHANGED'});
    }
    response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:tab.id,navigate:!basketLoaded,timeoutMs:pageReadBudget(scheduled),step});
    basketLoaded=true;
   }
   if(!response.ok)throw Error(response.error);await step('basket-observed',basketEvidence(response.value,slot));return response.value;
  };
  const output=await prepareCheckout(slot,{
   tabId:tab.id,
   load:async()=> (await chrome.storage.local.get('checkoutRecords')).checkoutRecords||[],
   save:async records=>{const record={...records.at(-1),preparationRunId:trace.record.id};await chrome.storage.local.set({checkoutRecords:[...records.slice(0,-1),record]});await step(record.phase,{key:record.key,...(record.fallbackFrom?{fallbackFrom:record.fallbackFrom}:{})});},
   read,select:async s=>{
    selectionStarted=true;basketLoaded=false;
    const url=`${BASE}/book/courts/${s.venue}/${s.date}#book`,request={kind:'grid',venue:s.venue,day:s.date};
    const grid=reuseGrid
     ?await readGrid(chrome.tabs,url,request,{tabId:tab.id,navigate:false,step,...gridReadPolicy(scheduled)})
     :await readPage(url,request,{scheduled});
    if(!grid.ok)throw Error(grid.error);
    if(reuseGrid&&!candidates(grid.rows,s.venue,s.date,{settings}).some(candidate=>candidate.totalGBP===s.totalGBP&&checkoutKey({...candidate,venue:s.venue},false,settings)===checkoutKey(s,false,settings)))throw Object.assign(Error('Selected slot availability or price changed; no selection sent'),{gridCode:'GRID_CANDIDATE_CHANGED'});
    // One mutation dispatch. Reconciliation occurs in prepareCheckout, never replay.
    const timeoutMs=pageReadBudget(scheduled);await step('selection-message-dispatched',{timeoutMs});
    const dispatched=Date.now();let response;
    try{response=await chrome.tabs.sendMessage(tab.id,{kind:'select-slot',slot:s,selectionTimeoutMs:timeoutMs});}
    catch{/* Lost acknowledgement remains uncertain; never replay this message. */}
    const selectionDiagnostic=selectionEvidence(response?.selectionDiagnostic||response?.value?.selectionDiagnostic),failure=selectionFailure(response);
    await step('selection-result',{ok:response?.ok===true,messageElapsedMs:Math.max(0,Date.now()-dispatched),selectionDiagnostic,...(response?.ok===true?{}:failureFor(failure))});
    if(response?.ok!==true)throw Object.assign(failure,{selectionDiagnostic});
    return {...response.value,selectionDiagnostic};
   },
   retain:async()=>{await chrome.tabs.update(tab.id,{active:true});return tab.id;},notify:basketOnly||checkoutTestOnly?async()=>{await chrome.action.setBadgeText({text:'TEST'});}:notifyCheckout
  },{test:pending?.test===true,basketOnly,allowPartial:scheduled&&!basketOnly,discountCode,settings,checkoutTestOnly});
  await trace.finish(output.status);await chrome.storage.local.set({checkoutResult:{...output,runId:trace.record.id,finishedAt:trace.record.finishedAt}});return output;
 } catch(e) {
  if(!trace)trace=newRun('checkout-preparation',slot?.date||londonDay());
  const failure=failureFor(e);
  await step('checkout-stopped',{...failure,...(e.basketDiagnostic?{basketDiagnostic:e.basketDiagnostic}:{}),...(e.diagnostic?{diagnostic:e.diagnostic}:{})});await trace.finish('stopped');const output={status:'stopped',error:e.message,...failure,...(e.basketDiagnostic?{basketDiagnostic:e.basketDiagnostic}:{}),...(e.diagnostic?{diagnostic:e.diagnostic}:{}),tabId:tab?.id,booked:false,paid:false,runId:trace.record.id};await chrome.storage.local.set({checkoutResult:output});
  await chrome.action.setBadgeText({text:'!'});
  try{await chrome.notifications.create('tennis-checkout-stopped',{type:'basic',iconUrl:chrome.runtime.getURL('notification.png'),title:'Tennis checkout stopped',message:'Open the extension to inspect the result. No automatic payment was attempted.'});}catch{}
  return output;
 } finally {resumedTab=null;busy=false;trace=null;}
}
function paidResult(record) {
 return {status:'confirmed',slot:record.slot,totalPaidGBP:payableSlot(record).totalGBP,discountApplied:!!record.discount,manualPayment:!!record.manualPaymentReportedAt,reference:record.reference,confirmedAt:record.confirmedAt,receiptSource:record.receiptSource,bookingState:record.bookingState,booked:record.bookingState==='confirmed'?true:null,paid:!record.freeBookingDispatchedAt,...(record.freeBookingDispatchedAt?{freeBooking:true}:{})};
}
async function resetUnpaidTest(){
 if(busy)throw Error('Another run is active');busy=true;
 let tab;
 try{
  const {checkoutRecords=[],abandonedCheckouts=[],job}=await chrome.storage.local.get(['checkoutRecords','abandonedCheckouts','job']);
  if(job)throw Error('Cancel the scheduled run before clearing an unpaid test');
  const pending=checkoutRecords.filter(r=>r.status!=='confirmed');if(pending.length!==1)throw Error('No unique unfinished unpaid test to clear');
  let record=pending[0];trace=newRun('unpaid-test-cleanup',record.slot.date);await step('started');
  const store=async value=>{record=value;await chrome.storage.local.set({checkoutRecords:checkoutRecords.map(r=>r.key===value.key?value:r)});await step(value.phase);};
  const read=async()=>{
   if(!tab)tab=await chrome.tabs.create({url:BASE+'/basket',active:false});
   const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:tab.id,navigate:false,timeoutMs:15000,step});if(!response.ok)throw Error(response.error);await step('test-cleanup-basket-observed',basketEvidence(response.value,record.slot));return response.value;
  };
  await clearUnpaidTest(record,{
   save:store,read,
   closeCheckout:async value=>{
    let reference=value.reference;
    const tabs=await chrome.tabs.query({url:BASE+'/basket/pay/card'});
    for(const candidate of tabs){
     const response=await chrome.tabs.sendMessage(candidate.id,{kind:'payment-state'});
     if(!response?.ok)throw Error('Cannot verify an open checkout; test reset stopped');
     if(candidate.id===value.tabId&&!reference){reference=response.value.reference;await store({...record,reference});}
     if(reference&&response.value.reference===reference){await chrome.tabs.remove(candidate.id);await step('test-checkout-tab-closed');}
    }
    return reference;
   },
   purchase:async value=>{const response=await readPage(BASE+'/account',{kind:'test-purchase-state',slot:payableSlot(value),key:value.key,reference:value.reference});if(!response.ok)throw Error(response.error);await step('test-unpaid-purchase-verified');return response.value;},
   remove:async expected=>{await step('test-cleanup-removal-dispatched',{items:expected.items.length,discount:expected.discountApplied===true});const response=await chrome.tabs.sendMessage(tab.id,{kind:'test-remove-next',expected});if(!response?.ok)throw Error(response?.error||'Test removal response unavailable');},
   archive:async abandoned=>{await chrome.storage.local.set({checkoutRecords:checkoutRecords.filter(r=>r.key!==abandoned.key),abandonedCheckouts:[...abandonedCheckouts,abandoned]});}
  });
  await trace.finish('test-auto-cleared');return {status:'test-auto-cleared',basketCleared:true,booked:false,paid:false,runId:trace.record.id};
 }catch(error){if(trace){await step('cleanup-stopped',failureFor(error,{operation:'unpaid-test-cleanup'}));await trace.finish('stopped');}throw error;}
 finally{if(tab)await chrome.tabs.remove(tab.id).catch(()=>{});busy=false;trace=null;resumedTab=null;}
}
async function testDiscountCheckout(code='') {
 if(busy)throw Error('Another run is active');
 const discountCode=normalizeDiscount(code),saved=await chrome.storage.local.get(['checkoutRecords','job','result']);
 if(saved.job)throw Error('Cancel the scheduled run before running an unpaid checkout test');
 let record=(saved.checkoutRecords||[]).find(r=>r.status!=='confirmed');
 if(record&&!record.checkoutTestOnly)throw Error('Resolve the existing checkout before starting an unpaid checkout test');
 if(record&&((record.discountCode||'')!==discountCode||(saved.result?.status==='complete'&&(saved.result.day!==record.slot.date||JSON.stringify(saved.result.settings||null)!==JSON.stringify(record.settings||null)))||record.phase?.startsWith('test-cleanup-'))){await resetUnpaidTest();record=null;}
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
   read:async remaining=>{const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:record.tabId,navigate:false,observeLoadingMessageErrors:!!record.discountDispatchedAt,timeoutMs:Math.min(remaining||15000,15000),step});if(!response.ok)throw Object.assign(Error('Discount basket observation rejected; inspect retained tab'),failureFor(response));return response.value;},
   apply:(code,expected)=>command({kind:'discount-apply',code,expected})
  });
  if(record.discount)await step('discount-verified',{...record.discount});
  const free=payableSlot(record).totalGBP==='0.00';
  if(free){
   if(['checkoutOpenDispatchedAt','reference','freeBookingDispatchedAt'].some(field=>Object.hasOwn(record,field)))throw Object.assign(Error('Opened or submitted free checkout test requires manual review; journal retained'),{reasonCode:'FREE_BOOKING_REVIEW_REQUIRED'});
   // Free completion is the booking mutation itself. An unpaid test must stop
   // at a freshly verified basket, with no opening or submission journal.
   const response=await readPageState(chrome.tabs,BASE+'/basket',{kind:'basket-read'},{tabId:record.tabId,navigate:false,timeoutMs:15000,step});
   if(!response.ok)throw Object.assign(Error('Free test basket observation rejected; inspect retained tab'),failureFor(response));
   verifyBasket(response.value,record.slot,record.discount);
   await store({...record,phase:'awaiting-payment',checkoutTestVerifiedAt:new Date().toISOString()});
  }else{
   await store({...record,phase:'checkout-test-opening'});
   const opened=await openStoredCheckout(record,record.tabId,false,store);
   await store({...opened.record,reference:opened.page.reference,phase:'checkout-test-ready',checkoutTestVerifiedAt:new Date().toISOString()});
  }
  const status=free?'checkout-test-free-ready':'checkout-test-passed';
  await chrome.tabs.update(record.tabId,{active:true});await trace.finish(status);
  const result={status,slot:record.slot,grossTotalGBP:record.slot.totalGBP,discountGBP:record.discount?.discountGBP||'0.00',payableGBP:payableSlot(record).totalGBP,checkoutOpened:!free,...(free?{bookingSubmissionBlocked:true}:{}),paymentBlocked:true,cardFilled:false,booked:false,paid:false,runId:trace.record.id,finishedAt:trace.record.finishedAt};
  await chrome.storage.local.set({checkoutResult:result});return result;
 }catch(error){
  if(trace){await step('stopped',failureFor(error,{operation:'unpaid-checkout-test'}));await trace.finish('stopped');}
  const result={status:'stopped',error:error.message,paymentBlocked:true,booked:false,paid:false,runId:trace?.record.id};await chrome.storage.local.set({checkoutResult:result});return result;
 }finally{busy=false;trace=null;resumedTab=null;}
}
async function readPaidEvidence(record,tabId=record.tabId,wait=false,scheduled=false) {
 return reconcilePaid(record,{
  step,
  currentReceipt:async()=>{
   const free=!!record.freeBookingDispatchedAt,deadline=Date.now()+pageReadBudget(scheduled);
   const bounded=operation=>free?responseWithin(operation,Math.max(1,Math.min(2000,deadline-Date.now()))):operation();
   for(let i=0;i<(wait?(free?Math.ceil(pageReadBudget(scheduled)/500):10):1)&&(!free||Date.now()<deadline);i++) {
    try {
     const current=await bounded(()=>readTab(()=>chrome.tabs.get(tabId)));
     if(new URL(current.url).origin!==BASE||!new URL(current.url).pathname.startsWith('/basket'))return null;
     const response=await bounded(()=>readTab(()=>chrome.tabs.sendMessage(tabId,{kind:'receipt-read',slot:payableSlot(record),key:record.key,reference:record.reference,...(free?{freeBooking:true}:{})})));
     if(free&&Date.now()>=deadline)return null;
     if(free&&response?.value?.status==='merchant-error')return null;
     if(response?.ok&&['confirmed','conflicting'].includes(response.value.status))return response.value;
    }catch(error){if(!free||!wait||(!temporaryTabError(error)&&!/Read response timed out/.test(error.message)))return null;}
    if(wait)await new Promise(r=>setTimeout(r,free?Math.max(0,Math.min(500,deadline-Date.now())):500));
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
 await chrome.action.setBadgeText({text:record.freeBookingDispatchedAt?'BOOK':'PAID'});await notifyPaymentResult(output);return output;
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
  if(trace){await step('stopped',failureFor(e,{paymentPossible:true}));await trace.finish('stopped');}
  const output={status:'stopped',error:e.message,booked:null,paid:null,runId:trace?.record.id,finishedAt:trace?.record.finishedAt||new Date().toISOString()};
  await chrome.storage.local.set({checkoutResult:output});throw e;
 }finally{busy=false;trace=null;resumedTab=null;}
}
chrome.notifications?.onClicked.addListener(async id=>{
 if(id!=='tennis-checkout')return;
 const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords');const record=checkoutRecords.find(r=>r.status!=='confirmed');
 if(record?.tabId)await chrome.tabs.update(record.tabId,{active:true}).catch(()=>{});
});
async function admitManualCheck(){
 const {job}=await chrome.storage.local.get('job');
 if(job)throw Object.assign(Error('Manual availability checks are paused while a release job is armed; cancel the job before checking manually'),{reasonCode:'MANUAL_CHECK_WHILE_ARMED'});
}
async function resume(day) {
  await admitManualCheck();
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
async function runAlarm(alarm){
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
      const gridHandoff=await check(job.day,true,job.settings||null,['checkout','payment'].includes(job.mode));
      let outcome=(await chrome.storage.local.get('result')).result;
      if(['checkout','payment'].includes(job.mode)){
       const prepared=await checkout(job.day,true,false,job.discountCode||'',job.settings||null,false,gridHandoff);
       outcome=job.mode==='payment'&&prepared.status==='awaiting-payment'?await automaticPayment(false,true,{tabId:prepared.tabId,key:prepared.key}):prepared;
      }
      await chrome.storage.local.remove('job');
      return outcome;
    }
  } catch(e) {const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords'),possible=checkoutRecords.some(r=>r.status!=='confirmed'&&(r.paymentDispatchedAt||r.manualPaymentReportedAt));if(!e.recorded)await save({status:'stopped',day:job.day,checkedAt:new Date().toISOString(),step:alarm.name,error:e.message,...e.diagnostic,booked:possible?null:false,paid:possible?null:false});await notifyPaymentResult({status:'stopped'});return {status:'stopped',...failureFor(e,{paymentPossible:possible}),error:e.message,paid:possible?null:false,booked:possible?null:false};}
}
chrome.alarms.onAlarm.addListener(alarm=>enqueueAction(()=>executeAction(chrome.storage.local,alarm.name,()=>runAlarm(alarm),{version:chrome.runtime.getManifest?.().version||'unknown',source:'alarm'})));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.kind==='link-frame' && sender.id===chrome.runtime.id) {
   linkFrames.register(sender).then(ok=>respond({ok}),()=>respond({ok:false}));return true;
  }
  if(sender.id!==chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return;
  const run=async()=>{
    if(message.kind==='check') {await check(message.day,false,message.settings||null); return (await chrome.storage.local.get('result')).result;}
    if(message.kind==='resume') return resume(message.day);
    if(message.kind==='saveSettings'){const settings=normalizeSettings(message.settings);await chrome.storage.local.set({bookingSettings:settings});return {status:'preferences-saved',settings,armedJobChanged:false};}
    if(message.kind==='prepareCheckout')return checkout();
    if(message.kind==='assessRecovery'){
     const unknown={status:'needs-user-action',paymentState:'unknown',merchantCancellationState:'unknown',automaticReplayAllowed:false};
     const deadline=Date.now()+5000;
     try{return await responseWithin(async()=>{
     const {checkoutRecords=[]}=await chrome.storage.local.get('checkoutRecords'),record=checkoutRecords.find(r=>r.status!=='confirmed');
     if(!record)return {status:'no-pending-checkout'};
     const pages=[];let incomplete=false;
     for(const tab of await responseWithin(()=>chrome.tabs.query({url:BASE+'/*'}),1000)){
      if(Date.now()>=deadline){incomplete=true;break;}
      try{const response=await responseWithin(()=>chrome.tabs.sendMessage(tab.id,{kind:'checkout-progress'}),1000);if(response?.ok&&response.value?.stage==='existing-purchase')pages.push(response.value);else incomplete=true;}catch{incomplete=true;}
     }
     const current=(await chrome.storage.local.get('checkoutRecords')).checkoutRecords||[];
     if(JSON.stringify(current.find(r=>r.status!=='confirmed'))!==JSON.stringify(record))return {...unknown,reasonCode:'RECOVERY_STATE_CHANGED'};
     const matching=pages.filter(p=>record.reference&&p.reference===record.reference&&p.totalGBP===payableSlot(record).totalGBP);
     return {...unknown,reasonCode:incomplete?'RECOVERY_EVIDENCE_REQUIRED':pages.length?(matching.length===1?'EXISTING_PURCHASE_READ_ONLY':'REFERENCE_UNAVAILABLE'):'RECOVERY_EVIDENCE_REQUIRED',observationIncomplete:incomplete,referenceRecorded:!!record.reference,existingPurchasePages:pages.length,exactReferenceMatches:matching.length};
     },5000);}catch{return {...unknown,reasonCode:'RECOVERY_EVIDENCE_REQUIRED',observationIncomplete:true};}
    }
    if(message.kind==='daytimeBasketTest')return checkout(message.day,false,true);
    if(message.kind==='testDiscountCheckout')return testDiscountCheckout(message.discountCode);
    if(message.kind==='resetUnpaidTest')return resetUnpaidTest();
    if(message.kind==='verifyPayment')return verifyPayment();
    if(message.kind==='reconcileManualPayment')return verifyPayment(false,message.reference||'');
    if(message.kind==='openCardVault'){await chrome.tabs.create({url:chrome.runtime.getURL('card-vault.html'),active:true});return {status:'local-card-setup-opened'};}
    if(message.kind==='payCheckout')return automaticPayment();
    if(message.kind==='armPayment')return arm(message.day,'payment',message.discountCode,message.settings);
    if(message.kind==='archiveFailedCheckout') {
     if(busy)throw Error('Another run is active');busy=true;
     try{
      const snapshot=await chrome.storage.local.get(['checkoutRecords','abandonedCheckouts']);
      const records=snapshot.checkoutRecords||[],options={noPaymentConfirmed:message.noPaymentConfirmed===true,attestationIdentity:message.attestationIdentity};
      assertFailedCheckoutAttestation(records,options);
      const response=await readPage(BASE+'/basket',{kind:'basket-read'});
      if(!response.ok)throw Error('Basket could not be verified empty; failed checkout remains held');
      const current=await chrome.storage.local.get(['checkoutRecords','abandonedCheckouts']);
      if(JSON.stringify(current)!==JSON.stringify(snapshot))throw Error('Checkout history changed during recovery; inspect and confirm again');
      const reconciled=archiveFailedCheckout(current.checkoutRecords||[],response.value,options);
      // One durable write preserves all journals and the entire prior archive.
      // No merchant mutation, reference invention or payment-status inference.
      await chrome.storage.local.set({checkoutRecords:reconciled.checkoutRecords,abandonedCheckouts:[...(current.abandonedCheckouts||[]),reconciled.abandoned]});
      return {status:'failed-checkout-archived',merchantPaymentState:'unknown',merchantCancellationState:'unknown',booked:null,paid:null};
     }finally{busy=false;}
    }
    if(message.kind==='reconcileSelection') {
     if(busy)throw Error('Another run is active');busy=true;
     try {
      const {checkoutRecords=[],abandonedCheckouts=[]}=await chrome.storage.local.get(['checkoutRecords','abandonedCheckouts']);
      const pendingTest=checkoutRecords.find(r=>r.status!=='confirmed'&&r.checkoutTestOnly);
      if(pendingTest&&message.unpaidTestConfirmed===true&&message.attestationIdentity!==JSON.stringify([pendingTest.key,pendingTest.reference||'',pendingTest.checkoutOpenDispatchedAt||'']))throw Error('Unpaid test confirmation is stale; reopen the popup and confirm the current test');
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
     const status=await chrome.storage.local.get(['latestAction','result','job','running','basketTest','basketTestResult','runHistory','checkoutRecords','checkoutResult','abandonedCheckouts','bookingSettings']);
     let localCardUnlocked=false;try{localCardUnlocked=!!(await chrome.storage.session.get('localPaymentCard')).localPaymentCard;}catch{}
     return {...status,localCardUnlocked,version:chrome.runtime.getManifest().version};
    }
    throw Error('Unknown action');
  };
  const tracked=()=>executeAction(chrome.storage.local,message.kind,run,{version:chrome.runtime.getManifest?.().version||'unknown'});
  // Assessment only observes snapshots; it cannot occupy the mutation/alarm queue.
  const action=message.kind==='status'?run():message.kind==='assessRecovery'?tracked():enqueueAction(tracked);
  action.then(respond,e=>{const uncertain=['verifyPayment','reconcileManualPayment','armPayment','payCheckout','resetUnpaidTest','testDiscountCheckout'].includes(message.kind);respond({status:'stopped',error:e.message,...failureFor(e,{operation:message.kind,paymentPossible:uncertain}),...(e.code?{errorCode:e.code}:{}),...(e.attemptedDay?{attemptedDay:e.attemptedDay}:{}),booked:uncertain?null:false,paid:uncertain?null:false});}); return true;
});
// Recreate one-shot alarms after restart without starting a missed release.
async function restoreReleaseJob() {
  const {job}=await chrome.storage.local.get('job'); if(!job) return;
  if(job.when<=Date.now()) {await save({status:'stopped',day:job.day,checkedAt:new Date().toISOString(),error:'Chrome was closed at release; no late retry'});await chrome.storage.local.remove('job');return;}
  await chrome.alarms.create('prepare',{when:Math.max(Date.now()+1000,job.when-300000)});
  await chrome.alarms.create('release',{when:job.when});
}
chrome.runtime.onStartup.addListener(()=>enqueueAction(restoreReleaseJob));
// Extension updates may clear alarms; retain the saved read-only job and date.
chrome.runtime.onInstalled.addListener(()=>enqueueAction(restoreReleaseJob));
