import {retryTab,temporaryTabError,tabErrorReason} from './retry.js';
import {failureFor} from './failures.js';
const BASE='https://tennistowerhamlets.com';
// Fixed categories only: URL paths, queries, fragments and references stay private.
function destinationFor(value){
 let url;try{url=new URL(value);}catch{return 'unavailable';}
 if(url.href==='about:blank')return 'loading';
 if(url.origin!==BASE)return 'other-origin';
 if(/\/(verify-human|login|sign-in)(\/|$)/.test(url.pathname))return 'authentication';
 return ({'/basket':'basket','/basket/discount':'discount-endpoint','/basket/pay/card':'card-checkout','/basket/complete':'booking-completion','/basket/receipt':'receipt','/account':'account'})[url.pathname]||(/^\/purchase\/card\/\d+$/.test(url.pathname)?'existing-purchase':'unrecognized');
}
const documentRoutes=new Set(['basket','discount-endpoint','card-checkout','booking-completion','receipt','account','existing-purchase','authentication','unrecognized']);
const pageTypes=new Set(['merchant-error','confirmation','card','basket','authentication','unknown']);
export function pageReadBudget(scheduled=false){return scheduled?60000:15000;}
export async function responseWithin(operation,ms,timers=globalThis){let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=timers.setTimeout(()=>reject(Error('Read response timed out')),ms);})]);}finally{timers.clearTimeout(timer);}}
export async function waitPaymentState(read,{timeoutMs=15000,accept=()=>true,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timers=globalThis}={}) {
 const deadline=now()+timeoutMs;
 while(now()<deadline){
  let state;
  try{state=await responseWithin(read,Math.min(2000,deadline-now()),timers);}
  catch(e){if(e.code!=='CHECKOUT_READ_UNAVAILABLE'&&!temporaryTabError(e)&&!/Read response timed out|Not the card checkout|Unknown payment page|message port closed/i.test(e.message))throw e;}
  if(state&&accept(state))return state;
  await delay(Math.min(500,Math.max(0,deadline-now())));
 }
 throw Error('Card checkout readiness timed out; no payment retry');
}
// Only known read-only adapters. No card, selection, checkout-opening or Pay
// messages are accepted. A failed read retains its tab; navigation is once.
export async function readPageState(tabs,url,request,{tabId=null,navigate=true,timeoutMs=15000,messageTimeoutMs=2000,observeLoadingMessageErrors=false,observeDiscountNavigation=false,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timers=globalThis,step=async()=>{}}={}) {
 const path={'account':'/account','purchase-read':'/account','test-purchase-state':'/account','basket-read':'/basket'}[request.kind];
 if(!path||url!==BASE+path)throw Error('Invalid read-only page request');
 if(!navigate&&(tabId===null||request.kind!=='basket-read'))throw Error('Existing-tab reads require a basket tab');
 if(observeLoadingMessageErrors&&(navigate||tabId===null||request.kind!=='basket-read'))throw Error('Loading message observation requires an existing basket tab');
 if(observeDiscountNavigation&&(navigate||tabId===null||request.kind!=='basket-read'))throw Error('Discount navigation observation requires an existing basket tab');
 const started=now(),deadline=started+timeoutMs,reused=tabId!==null;
 let observationPath,tab,retain=reused,operation='read-diagnostics',messageReadRetries=0,navigationReads=0,last={loadState:'unknown',routeCategory:'loading',readState:'not-probed'};
 const observePage=async()=>{
  operation='page-observation';last.pageType='unavailable';last.observationState='unavailable';delete last.documentRoute;delete last.documentMatchesRoute;delete last.documentState;
  try{
   const response=await responseWithin(()=>tabs.sendMessage(tab.id,{kind:'page-observation',expectedPath:observationPath}),Math.max(1,Math.min(1000,deadline-now())),timers);
   if(response?.ok&&documentRoutes.has(response.value?.documentRoute)&&pageTypes.has(response.value?.pageType)){
    last.observationState='observed';last.documentRoute=response.value.documentRoute;last.documentMatchesRoute=response.value.documentMatchesRequest===true&&last.documentRoute===last.destination;
    last.pageType=last.documentMatchesRoute?response.value.pageType:'stale-document';
    last.documentState=['loading','interactive','complete'].includes(response.value.documentState)?response.value.documentState:'unknown';
   }
  }catch(e){
   const reason=tabErrorReason(e);last.observationState=/timed out/i.test(e?.message||'')?'response-timeout':reason;
   if(['tab-closed','access-denied','extension-context-invalidated'].includes(reason))throw e;
  }
  checkDeadline('observation-after-deadline');navigationReads++;
  // Bounded progress keeps the original run boundary in its capped history.
  if(navigationReads<=3||navigationReads%10===0){operation='read-diagnostics';await step('discount-navigation-observed',{page:request.kind,...last,navigationReads,elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now())});}
  checkDeadline('observation-diagnostics-after-deadline');
  operation='page-observation';
  if(last.pageType==='merchant-error')throw Object.assign(Error('Merchant reported an error after discount submission; outcome unknown; no mutation replay'),{pageCode:'DISCOUNT_MERCHANT_ERROR'});
 };
 const checkDeadline=readState=>{if(now()>=deadline){last.readState=readState;throw Object.assign(Error('Read-only page readiness timed out; inspect retained tab'),{pageCode:'PAGE_READY_TIMEOUT'});}};
 try {
  await step(navigate?'page-navigation':'existing-basket-read',{page:request.kind,timeoutMs, ...(navigate?{}:{tabId})});
  checkDeadline('setup-after-deadline');operation='navigation';
  tab=!navigate?{id:tabId}:reused?await retryTab(()=>tabs.update(tabId,{url}),{navigation:true}):await retryTab(()=>tabs.create({url,active:false}),{navigation:true});
  checkDeadline('navigation-after-deadline');
  while(now()<deadline) {
   operation='tab-state';const current=await retryTab(()=>tabs.get(tab.id));let parsed;
   try{parsed=new URL(current.url);}catch{}
   observationPath=parsed?.pathname;
   last.loadState=current.status||'unknown';last.destination=destinationFor(current.url);last.pendingDestination=current.pendingUrl?destinationFor(current.pendingUrl):'none';
   last.routeCategory=!parsed||parsed.href==='about:blank'?'loading':parsed.origin!==BASE?'other-origin':/\/(verify-human|login|sign-in)(\/|$)/.test(parsed.pathname)?'authentication':parsed.pathname===path?'requested-page':'other-page';
   if(['authentication','other-origin'].includes(last.routeCategory))throw Object.assign(Error(last.routeCategory==='authentication'?'Sign-in or human verification required':'Read-only page left the trusted site'),{pageCode:last.routeCategory==='authentication'?'PAGE_AUTHENTICATION_REQUIRED':'PAGE_UNEXPECTED_ORIGIN'});
   if(!navigate&&last.routeCategory==='other-page'){
    last.readState='route-changed';checkDeadline('route-after-deadline');
    if(observeDiscountNavigation)await observePage();
    // Only the known POST target may be an intermediate document. Never navigate
    // back, resubmit the form, or use this page as discount/checkout evidence.
    if(observeDiscountNavigation&&last.destination==='discount-endpoint'&&last.loadState==='loading'){
     await delay(Math.min(500,Math.max(0,deadline-now())));continue;
    }
    operation='route-validation';throw Object.assign(Error('Checkout tab is no longer the basket; no checkout click sent'),{pageCode:'PAGE_BASKET_ROUTE_CHANGED'});
   }
   checkDeadline('tab-state-after-deadline');
   if(last.routeCategory==='requested-page') {
    let response;
    try {
     operation='message-read';last.readState='probing';
     response=await responseWithin(()=>tabs.sendMessage(tab.id,request),Math.max(1,Math.min(messageTimeoutMs,deadline-now())),timers);
    }catch(e){
     last.readState=/timed out/i.test(e?.message||'')?'response-timeout':tabErrorReason(e);
     // Discount POST navigation can replace a receiver after usable loading
     // DOM reads. Observe this exact tab again, never resend the mutation.
     // Unknown errors qualify only in this opt-in, trusted loading-basket path;
     // closed/denied/invalidated contexts remain immediate stops.
     const loadingMessageError=observeLoadingMessageErrors&&last.loadState==='loading'&&last.readState==='unclassified-tab-error';
     if(!temporaryTabError(e)&&last.readState!=='response-timeout'&&!loadingMessageError)throw e;
     messageReadRetries++;
     // Keep early evidence and periodic progress without evicting the start
     // of a run from its bounded history during a minute of failed reads.
     if(messageReadRetries<=3||messageReadRetries%10===0){operation='read-diagnostics';await step('page-message-read-retry',{page:request.kind,reason:last.readState,operation:'message-read',messageReadRetries,loadState:last.loadState,routeCategory:last.routeCategory,elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now())});operation='message-read';}
    }
    // Diagnostics/storage errors are outside the transport catch. They must
    // not be mistaken for a failed content-script read and retried.
    if(response&&!response.notReady){
     checkDeadline('response-after-deadline');
     if(observeDiscountNavigation){
      if(response.ok===false)await observePage();
      // A reply from an old document cannot authorize continuation after a
      // committed or pending navigation. Reobserve without replaying anything.
      operation='tab-state';const after=await retryTab(()=>tabs.get(tab.id));checkDeadline('response-route-after-deadline');
      if(destinationFor(after.url)!=='basket'||(after.pendingUrl&&destinationFor(after.pendingUrl)!=='basket')){
       last.readState='response-route-changed';await delay(Math.min(500,Math.max(0,deadline-now())));continue;
      }
     }
     if(response.humanRequired||response.ok===false){retain=true;response.retainedTabId=tab.id;response.page=response.page||request.kind;}
     if(response.ok===false)Object.assign(response,failureFor(response,{operation:request.kind}));
     operation='read-diagnostics';await step('page-read',{page:request.kind,ok:response.ok,loadState:last.loadState,...(messageReadRetries?{messageReadRetries,elapsedMs:now()-started}:{}),...(response.ok===false?failureFor(response,{operation:request.kind}):{})});checkDeadline('diagnostics-after-deadline');return response;
    }
    if(response||last.readState==='probing')last.readState='dom-not-ready';
   }
   await delay(Math.min(500,Math.max(0,deadline-now())));
  }
  throw Object.assign(Error('Read-only page readiness timed out; inspect retained tab'),{pageCode:'PAGE_READY_TIMEOUT'});
 }catch(e){
  retain=!!tab;
  const diagnostic={page:request.kind,errorCode:e.pageCode||'PAGE_TAB_ERROR',operation,reason:tabErrorReason(e),timeoutMs,...last,elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now()),messageReadRetries,...(observeDiscountNavigation?{navigationReads}:{}),...(tab||reused?{retainedTabId:tab?.id??tabId}:{})};
  await step('page-read-stopped',diagnostic);
  throw Object.assign(Error(e.pageCode?e.message:'Read-only page unavailable; inspect retained tab'),{diagnostic});
 }finally{if(tab&&!retain)await tabs.remove(tab.id).catch(()=>{});}
}
