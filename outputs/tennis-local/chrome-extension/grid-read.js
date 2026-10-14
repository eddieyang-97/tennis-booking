import {retryTab,temporaryTabError} from './retry.js';
const BASE='https://tennistowerhamlets.com';
export function gridReadPolicy(scheduled=false) {return {timeoutMs:scheduled?60000:20000,retryDelayMs:scheduled?5000:500};}
function route(url,expected) {
 try {
  const parsed=new URL(url);
  if(parsed.origin!==BASE)return parsed.href==='about:blank'?'loading':'other-origin';
  if(/\/(verify-human|login|sign-in)(\/|$)/.test(parsed.pathname))return 'authentication';
  return parsed.pathname===new URL(expected).pathname?'requested-grid':'other-page';
 }catch{return 'loading';}
}
async function boundedRead(operation,ms,timers) {
 let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=timers.setTimeout(()=>reject(Error('Grid read response timed out')),ms);})]);}
 finally{timers.clearTimeout(timer);}
}
// Only reads court grids. No selection, checkout, Stripe or payment messages.
export async function readGrid(tabs,url,request,{tabId=null,attempts=2,timeoutMs=20000,retryDelayMs=500,messageTimeoutMs=2000,delay=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timers=globalThis,step=async()=>{}}={}) {
 if(request.kind!=='grid'||!['bethnal-green-gardens','victoria-park'].includes(request.venue)||url!==`${BASE}/book/courts/${request.venue}/${request.day}#book`)throw Error('Invalid read-only grid request');
 let tab,last={loadState:'unknown',routeCategory:'loading',readState:'not-probed'};
 const reused=tabId!==null;
 for(let attempt=1;attempt<=attempts;attempt++) {
  if(!reused)tab=null;
  last={loadState:'unknown',routeCategory:'loading',readState:'not-probed'};
  await step('grid-navigation',{venue:request.venue,attempt,timeoutMs,retryDelayMs});
  try {
   tab=reused?await retryTab(()=>tabs.update(tabId,{url}),{navigation:true}):await retryTab(()=>tabs.create({url,active:false}),{navigation:true});
   const deadline=now()+timeoutMs;
   while(now()<deadline) {
    const current=await retryTab(()=>tabs.get(tab.id));
    last={...last,loadState:current.status||'unknown',routeCategory:route(current.url,url)};
    if(last.routeCategory==='authentication')throw Object.assign(Error('Grid requires sign-in or human verification'),{gridCode:'GRID_AUTHENTICATION_REQUIRED'});
    if(last.routeCategory==='other-origin')throw Object.assign(Error('Grid left the trusted site'),{gridCode:'GRID_UNEXPECTED_ORIGIN'});
    if(last.routeCategory==='requested-grid') {
     // DOM readiness can precede tabs.status=complete, especially when an
     // unrelated resource keeps the load event pending. Probe without reload.
     try {
      const response=await boundedRead(()=>tabs.sendMessage(tab.id,request),Math.min(messageTimeoutMs,deadline-now()),timers);
      if(response?.humanRequired)throw Object.assign(Error('Grid requires sign-in or human verification'),{gridCode:'GRID_AUTHENTICATION_REQUIRED'});
      if(response?.ok) {
       await step('grid-read-ready',{venue:request.venue,attempt,loadState:last.loadState});
       if(!reused)await tabs.remove(tab.id).catch(()=>{});
       return response;
      }
      if(response && !/Court grid missing|Empty grid/.test(response.error||''))throw Object.assign(Error(response.error||'Grid read failed'),{gridCode:'GRID_LAYOUT_REJECTED'});
      last.readState='dom-not-ready';
     }catch(e){
      if(e.gridCode)throw e;
      if(!temporaryTabError(e)&&!/Grid read response timed out|message port closed/i.test(e.message))throw e;
      last.readState=/timed out/.test(e.message)?'response-timeout':'receiver-unavailable';
     }
    }
    await delay(Math.min(500,Math.max(0,deadline-now())));
   }
   throw Object.assign(Error('Court grid readiness timed out; availability is unknown'),{gridCode:'GRID_READY_TIMEOUT'});
  }catch(e){
   const diagnostics={page:'grid',errorCode:e.gridCode||'GRID_TAB_ERROR',venue:request.venue,day:request.day,attempt,timeoutMs,retryDelayMs,...last,...(tab?{retainedTabId:tab.id}:{})};
   await step('grid-read-stopped',diagnostics);
   if(e.gridCode==='GRID_READY_TIMEOUT'&&attempt<attempts) {
    if(!reused)await tabs.remove(tab.id).catch(()=>{});
    await step('grid-navigation-retry',{venue:request.venue,attempt:attempt+1,retryDelayMs});await delay(retryDelayMs);continue;
   }
   throw Object.assign(Error(e.gridCode?e.message:'Court grid tab unavailable; availability is unknown'),{diagnostic:diagnostics});
  }
 }
}
