const reasons=Object.freeze({
 SELECTION_ACK_TIMEOUT:'Hourly selection acknowledgement timed out; inspect the retained journal',
 SELECTION_PAGE_CHANGED:'Court selection page changed; no further selection',
 SELECTION_SLOT_UNAVAILABLE:'Court unavailable before selection',
 SELECTION_STATE_CHANGED:'Court selection state changed; inspect the basket',
 SELECTION_PRICE_CHANGED:'Court price changed before selection',
 SELECTION_LAYOUT_UNKNOWN:'Court selection layout is not verified',
 SELECTION_OBSERVATION_FAILED:'Court selection observation failed; outcome unknown',
 SELECTION_RESPONSE_UNCERTAIN:'Court selection response unavailable; outcome unknown',
 AUTHENTICATION_REQUIRED:'Site authentication or human verification required'
});
export function selectionFailure(response){
 const reasonCode=Object.hasOwn(reasons,response?.reasonCode)?response.reasonCode:'SELECTION_RESPONSE_UNCERTAIN';
 return Object.assign(Error(reasons[reasonCode]),{reasonCode});
}
// A content-script reply is evidence, never authority to retry a mutation.
// Construct a closed schema; do not persist arbitrary merchant/transport text.
export function selectionEvidence(value){
 if(!value||typeof value!=='object')return {merchantOutcome:'unknown'};
 const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max?n:null;
 const duration=n=>integer(n,0,86400000);
 const result={merchantOutcome:'unknown'};
 for(const key of ['expectedHours','dispatchedHours','acknowledgedHours'])result[key]=integer(value[key],0,2);
 for(const key of ['badgeCount','peakBadgeCount'])result[key]=integer(value[key],0,1000);
 result.timeoutMs=[15000,60000].includes(value.timeoutMs)?value.timeoutMs:null;
 result.elapsedMs=duration(value.elapsedMs);result.polls=integer(value.polls,0,1000);
 result.checkboxReverted=value.checkboxReverted===true;
 result.visibilityState=['visible','hidden'].includes(value.visibilityState)?value.visibilityState:'unknown';
 result.loadState=['loading','interactive','complete'].includes(value.loadState)?value.loadState:'unknown';
 result.visibleAlertCategory=['none','authentication','session','availability','other'].includes(value.visibleAlertCategory)?value.visibleAlertCategory:'unknown';
 result.checkedHours=(Array.isArray(value.checkedHours)?value.checkedHours:[]).slice(0,2).map(c=>({hour:integer(c?.hour,0,23),court:integer(c?.court,1,4),checked:typeof c?.checked==='boolean'?c.checked:null,disabled:typeof c?.disabled==='boolean'?c.disabled:null}));
 result.hourlyDispatches=(Array.isArray(value.hourlyDispatches)?value.hourlyDispatches:[]).slice(0,2).map(c=>({hour:integer(c?.hour,0,23),court:integer(c?.court,1,4),offsetMs:duration(c?.offsetMs),at:typeof c?.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(c.at)&&Number.isFinite(Date.parse(c.at))?c.at:null}));
 const network=value.network;
 result.network={correlation:network?.correlation==='same-origin-window-only'?'same-origin-window-only':'unavailable',observedRequests:integer(network?.observedRequests,0,100000),responses:(Array.isArray(network?.responses)?network.responses:[]).slice(0,8).map(r=>({status:integer(r?.status,100,599),completed:r?.completed===true}))};
 return result;
}
