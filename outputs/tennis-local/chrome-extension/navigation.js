import {retryTab} from './retry.js';
// Listen before navigating a reused tab. Its previous complete status is stale.
export async function navigateLoaded(tabs,id,url,timers=globalThis,onRetry=async()=>{}) {
 let listener,timer;
 const loaded=new Promise((resolve,reject)=>{
  let loading=false;
  listener=(tabId,change)=>{
   if(tabId!==id)return;
   if(change.status==='loading')loading=true;
   if(loading && change.status==='complete')resolve();
  };
  tabs.onUpdated.addListener(listener);
  timer=timers.setTimeout(()=>reject(Error('Navigation completion uncertain; inspect retained tab')),15000);
 });
 try {await Promise.all([retryTab(()=>tabs.update(id,{url}),{navigation:true,onRetry}),loaded]);return await retryTab(()=>tabs.get(id),{onRetry});}
 finally {timers.clearTimeout(timer);tabs.onUpdated.removeListener(listener);}
}
