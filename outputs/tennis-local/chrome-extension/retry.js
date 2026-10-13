export function temporaryTabError(error) {
 return /Tabs cannot be edited right now|Receiving end does not exist|Could not establish connection|The tab is still loading/i.test(error?.message||String(error));
}
// Read-only calls may retry. Navigation may retry only a rejected edit; mutation
// messages (select/remove) must never use this helper.
export async function retryTab(operation,{attempts=3,delay=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=async()=>{},navigation=false}={}) {
 for(let attempt=1;attempt<=attempts;attempt++) {
  try{return await operation();}
  catch(error) {
   const allowed=navigation ? /Tabs cannot be edited right now/i.test(error.message) : temporaryTabError(error);
   if(!allowed || attempt===attempts)throw error;
   await onRetry(attempt);await delay(250*attempt);
  }
 }
}
