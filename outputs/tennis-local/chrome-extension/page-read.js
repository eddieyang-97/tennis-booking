import {retryTab,temporaryTabError,tabErrorReason} from './retry.js';
import {failureFor} from './failures.js';
const BASE='https://tennistowerhamlets.com';
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
export async function readPageState(tabs,url,request,{tabId=null,navigate=true,timeoutMs=15000,messageTimeoutMs=2000,observeLoadingMessageErrors=false,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timers=globalThis,step=async()=>{}}={}) {
 const path={'account':'/account','purchase-read':'/account','test-purchase-state':'/account','basket-read':'/basket'}[request.kind];
 if(!path||url!==BASE+path)throw Error('Invalid read-only page request');
 if(!navigate&&(tabId===null||request.kind!=='basket-read'))throw Error('Existing-tab reads require a basket tab');
 if(observeLoadingMessageErrors&&(navigate||tabId===null||request.kind!=='basket-read'))throw Error('Loading message observation requires an existing basket tab');
 const reused=tabId!==null;let tab,retain=reused,operation='navigation',messageReadRetries=0,started,deadline,last={loadState:'unknown',routeCategory:'loading',readState:'not-probed'};
 await step(navigate?'page-navigation':'existing-basket-read',{page:request.kind,timeoutMs, ...(navigate?{}:{tabId})});
 try {
  tab=!navigate?{id:tabId}:reused?await retryTab(()=>tabs.update(tabId,{url}),{navigation:true}):await retryTab(()=>tabs.create({url,active:false}),{navigation:true});
  started=now();deadline=started+timeoutMs;
  while(now()<deadline) {
   operation='tab-state';const current=await retryTab(()=>tabs.get(tab.id));let parsed;
   try{parsed=new URL(current.url);}catch{}
   last.loadState=current.status||'unknown';
   last.routeCategory=!parsed||parsed.href==='about:blank'?'loading':parsed.origin!==BASE?'other-origin':/\/(verify-human|login|sign-in)(\/|$)/.test(parsed.pathname)?'authentication':parsed.pathname===path?'requested-page':'other-page';
   if(['authentication','other-origin'].includes(last.routeCategory))throw Object.assign(Error(last.routeCategory==='authentication'?'Sign-in or human verification required':'Read-only page left the trusted site'),{pageCode:last.routeCategory==='authentication'?'PAGE_AUTHENTICATION_REQUIRED':'PAGE_UNEXPECTED_ORIGIN'});
   if(!navigate&&last.routeCategory==='other-page')throw Object.assign(Error('Checkout tab is no longer the basket; no checkout click sent'),{pageCode:'PAGE_BASKET_ROUTE_CHANGED'});
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
     if(now()>=deadline){last.readState='response-after-deadline';throw Object.assign(Error('Read-only page readiness timed out; inspect retained tab'),{pageCode:'PAGE_READY_TIMEOUT'});}
     if(response.humanRequired||response.ok===false){retain=true;response.retainedTabId=tab.id;response.page=response.page||request.kind;}
     if(response.ok===false)Object.assign(response,failureFor(response,{operation:request.kind}));
     operation='read-diagnostics';await step('page-read',{page:request.kind,ok:response.ok,loadState:last.loadState,...(messageReadRetries?{messageReadRetries,elapsedMs:now()-started}:{}),...(response.ok===false?failureFor(response,{operation:request.kind}):{})});return response;
    }
    if(response||last.readState==='probing')last.readState='dom-not-ready';
   }
   await delay(Math.min(500,Math.max(0,deadline-now())));
  }
  throw Object.assign(Error('Read-only page readiness timed out; inspect retained tab'),{pageCode:'PAGE_READY_TIMEOUT'});
 }catch(e){
  retain=!!tab;
  const diagnostic={page:request.kind,errorCode:e.pageCode||'PAGE_TAB_ERROR',operation,reason:tabErrorReason(e),timeoutMs,...last,...(started!==undefined?{elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now()),messageReadRetries}:{}),...(tab?{retainedTabId:tab.id}:{})};
  await step('page-read-stopped',diagnostic);
  throw Object.assign(Error(e.pageCode?e.message:'Read-only page unavailable; inspect retained tab'),{diagnostic});
 }finally{if(tab&&!retain)await tabs.remove(tab.id).catch(()=>{});}
}
