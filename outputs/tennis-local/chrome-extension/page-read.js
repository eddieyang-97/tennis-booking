import {retryTab,temporaryTabError,tabErrorReason} from './retry.js';
const BASE='https://tennistowerhamlets.com';
export function pageReadBudget(scheduled=false){return scheduled?60000:15000;}
async function responseWithin(operation,ms,timers){let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=timers.setTimeout(()=>reject(Error('Read response timed out')),ms);})]);}finally{timers.clearTimeout(timer);}}
export async function waitPaymentState(read,{timeoutMs=15000,accept=()=>true,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timers=globalThis}={}) {
 const deadline=now()+timeoutMs;
 while(now()<deadline){
  let state;
  try{state=await responseWithin(read,Math.min(2000,deadline-now()),timers);}
  catch(e){if(!temporaryTabError(e)&&!/Read response timed out|Not the card checkout|Unknown payment page|message port closed/i.test(e.message))throw e;}
  if(state&&accept(state))return state;
  await delay(Math.min(500,Math.max(0,deadline-now())));
 }
 throw Error('Card checkout readiness timed out; no payment retry');
}
// Only known read-only adapters. No card, selection, checkout-opening or Pay
// messages are accepted. A failed read retains its tab; navigation is once.
export async function readPageState(tabs,url,request,{tabId=null,navigate=true,timeoutMs=15000,messageTimeoutMs=2000,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timers=globalThis,step=async()=>{}}={}) {
 const path={'account':'/account','purchase-read':'/account','test-purchase-state':'/account','basket-read':'/basket'}[request.kind];
 if(!path||url!==BASE+path)throw Error('Invalid read-only page request');
 if(!navigate&&(tabId===null||request.kind!=='basket-read'))throw Error('Existing-tab reads require a basket tab');
 const reused=tabId!==null;let tab,retain=reused,operation='navigation',last={loadState:'unknown',routeCategory:'loading',readState:'not-probed'};
 await step(navigate?'page-navigation':'existing-basket-read',{page:request.kind,timeoutMs, ...(navigate?{}:{tabId})});
 try {
  tab=!navigate?{id:tabId}:reused?await retryTab(()=>tabs.update(tabId,{url}),{navigation:true}):await retryTab(()=>tabs.create({url,active:false}),{navigation:true});
  const deadline=now()+timeoutMs;
  while(now()<deadline) {
   operation='tab-state';const current=await retryTab(()=>tabs.get(tab.id));let parsed;
   try{parsed=new URL(current.url);}catch{}
   last.loadState=current.status||'unknown';
   last.routeCategory=!parsed||parsed.href==='about:blank'?'loading':parsed.origin!==BASE?'other-origin':/\/(verify-human|login|sign-in)(\/|$)/.test(parsed.pathname)?'authentication':parsed.pathname===path?'requested-page':'other-page';
   if(['authentication','other-origin'].includes(last.routeCategory))throw Object.assign(Error(last.routeCategory==='authentication'?'Sign-in or human verification required':'Read-only page left the trusted site'),{pageCode:last.routeCategory==='authentication'?'PAGE_AUTHENTICATION_REQUIRED':'PAGE_UNEXPECTED_ORIGIN'});
   if(!navigate&&last.routeCategory==='other-page')throw Object.assign(Error('Checkout tab is no longer the basket; no checkout click sent'),{pageCode:'PAGE_BASKET_ROUTE_CHANGED'});
   if(last.routeCategory==='requested-page') {
    try {
     operation='message-read';last.readState='probing';
     const response=await responseWithin(()=>tabs.sendMessage(tab.id,request),Math.min(messageTimeoutMs,deadline-now()),timers);
     if(response&&!response.notReady){
      if(response.humanRequired||response.ok===false){retain=true;response.retainedTabId=tab.id;response.page=response.page||request.kind;}
      await step('page-read',{page:request.kind,ok:response.ok,loadState:last.loadState});return response;
     }
     last.readState='dom-not-ready';
    }catch(e){last.readState=/timed out/i.test(e.message)?'response-timeout':tabErrorReason(e);if(!temporaryTabError(e)&&!/Read response timed out/i.test(e.message))throw e;}
   }
   await delay(Math.min(500,Math.max(0,deadline-now())));
  }
  throw Object.assign(Error('Read-only page readiness timed out; inspect retained tab'),{pageCode:'PAGE_READY_TIMEOUT'});
 }catch(e){
  retain=!!tab;
  const diagnostic={page:request.kind,errorCode:e.pageCode||'PAGE_TAB_ERROR',operation,reason:tabErrorReason(e),timeoutMs,...last,...(tab?{retainedTabId:tab.id}:{})};
  await step('page-read-stopped',diagnostic);
  throw Object.assign(Error(e.pageCode?e.message:'Read-only page unavailable; inspect retained tab'),{diagnostic});
 }finally{if(tab&&!retain)await tabs.remove(tab.id).catch(()=>{});}
}
