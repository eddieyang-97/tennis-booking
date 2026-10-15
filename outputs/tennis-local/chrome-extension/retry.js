export function temporaryTabError(error) {
 return /Tabs cannot be edited right now|Receiving end does not exist|Could not establish connection|The tab is still loading|message (?:port|channel) closed|Frame (?:with ID \d+ )?was removed/i.test(error?.message||String(error));
}
// Only publish known categories; Chrome errors can contain private URLs.
export function tabErrorReason(error) {
 const message=error?.message||String(error);
 if(/No tab with id|Invalid tab ID|tab was closed/i.test(message))return 'tab-closed';
 if(/message (?:port|channel) closed/i.test(message))return 'message-channel-closed';
 if(/Frame (?:with ID \d+ )?was removed/i.test(message))return 'frame-removed';
 if(/Receiving end does not exist|Could not establish connection/i.test(message))return 'receiver-unavailable';
 if(/Tabs cannot be edited right now|The tab is still loading/i.test(message))return 'tab-busy';
 if(/timed out/i.test(message))return 'read-timeout';
 if(/Cannot access|permission|not allowed/i.test(message))return 'access-denied';
 if(/Extension context invalidated/i.test(message))return 'extension-context-invalidated';
 return 'unclassified-tab-error';
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
