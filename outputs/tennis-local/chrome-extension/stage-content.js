// Only background-origin commands can reach this isolated world. No page listener.
function basketSummary() {
 if(location.pathname!=='/basket')throw Error('Not on basket page');
 if(document.body.innerText.includes('There are no items in your basket'))return {empty:true,items:[]};
 const anchors=[...document.querySelectorAll('a[href^="#item-"]')];
 const items=anchors.map(a=>{
  const item=document.getElementById(a.getAttribute('href').slice(1));
  if(!item)throw Error('Basket item layout changed');
  const text=item.innerText;
  const court=/(?:Tennis court|Court) ([1-4])(?!\d)/.exec(text),venue=/Bethnal Green Gardens|St Johns Park|Victoria Park/.exec(text),time=/(\d+)(?:st|nd|rd|th) (\w{3})\s*\|\s*(\d+):00(am|pm)\s*[–-]\s*(\d+):59(am|pm)/.exec(text),price=/£\s*(\d+\.\d{2})/.exec(text);
  if(!court||!venue||!time||!price)throw Error('Unknown basket identity or duration');
  if(time[3]!==time[5]||time[4]!==time[6])throw Error('Unknown basket time range');
  return {court:+court[1],venue:venue[0],day:+time[1],month:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(time[2])+1,hour:(+time[3]%12)+(time[4]==='pm'?12:0),priceGBP:price[1]};
 });
 const totals=[...document.querySelectorAll('tr')].filter(r=>r.querySelector('td')?.textContent.trim()==='Total');
 const totalText=totals.length===1?totals[0].innerText.replace(/^\s*Total\s*/, '').trim():'';
 const total=/^£\s*(\d+\.\d{2})$/.exec(totalText)||(/^£\s*free$/i.test(totalText)?[null,'0.00']:null);
 if(!total||!items.length)throw Error('Unknown basket total/layout');
 const rows=[...document.querySelectorAll('tr')];
 const subtotalRows=rows.filter(r=>r.querySelector('td')?.textContent.trim()==='Subtotal'),discountRows=rows.filter(r=>/^Discount(?:\s|$)/.test(r.querySelector('td')?.textContent.trim()||''));
 let accounting={};
 if(subtotalRows.length||discountRows.length){
  const subtotal=subtotalRows.length===1?/£\s*(\d+\.\d{2})/.exec(subtotalRows[0].innerText):null;
  const discount=discountRows.length===1?/-£\s*(\d+\.\d{2})/.exec(discountRows[0].innerText):null;
  if(!subtotal||discountRows.length!==1||(!discount&&!/\s-\s*$/.test(discountRows[0].innerText)))throw Error('Unknown discount accounting');
  accounting={subtotalGBP:subtotal[1],discountGBP:discount?.[1]||'0.00',discountApplied:!!discount&&!!discountRows[0].querySelector('a[href="/basket/discount-remove"]')};
 }
 const buttons=[...document.querySelectorAll('button')];
 const freeButtons=buttons.filter(b=>b.textContent.trim()==='Complete my booking');
 return {empty:false,items,totalGBP:total[1],...accounting,paymentBoundary:buttons.some(b=>b.textContent.trim()==='Pay with card'),...(total[1]==='0.00'&&freeButtons.length===1&&!freeButtons[0].disabled?{freeBookingBoundary:true}:{})};
}
async function stableBasketSummary() {
 let previous,stable=0;
 for(let i=0;i<6;i++) {
  if(document.readyState==='loading')return {notReady:true};
  const value=basketSummary(),fingerprint=JSON.stringify(value);
  stable=fingerprint===previous?stable+1:1;previous=fingerprint;
  if(stable>=3)return value;
  if(i<5)await new Promise(r=>setTimeout(r,250));
 }
 return {notReady:true};
}
async function selectSequentially(s,timeoutMs=15000) {
 const now=()=>globalThis.performance?.now?.()??Date.now(),started=now(),deadline=started+timeoutMs;
 let firstDispatch=null;
 const progress={expectedHours:s.hours,dispatchedHours:0,acknowledgedHours:0,badgeCount:null,peakBadgeCount:0,timeoutMs,polls:0,checkboxReverted:false,merchantOutcome:'unknown',hourlyDispatches:[]};
 const observedChecked=new Set();
 const stop=(reasonCode,message)=>Object.assign(Error(message),{reasonCode});
 const finishEvidence=()=>{
  progress.elapsedMs=Math.max(0,Math.round(now()-started));
  progress.visibilityState=['hidden','visible'].includes(document.visibilityState)?document.visibilityState:'unknown';
  progress.loadState=['loading','interactive','complete'].includes(document.readyState)?document.readyState:'unknown';
  progress.visibleAlertCategory='none';
  // Optional generic alert observation; layouts and messages are not a verified
  // merchant rejection contract. Never retain the alert's text or identifiers.
  try{
   const notices=[...(document.querySelectorAll?.('[role="alert"], .alert-danger, .alert-error')||[])].slice(0,8).filter(node=>node.getClientRects?.().length);
   for(const node of notices){const text=(node.innerText||'').slice(0,512);progress.visibleAlertCategory=/verify.*human|captcha|sign.?in|log.?in/i.test(text)?'authentication':/session.*expir/i.test(text)?'session':/unavailable|not available|already booked/i.test(text)?'availability':'other';if(progress.visibleAlertCategory!=='other')break;}
  }catch{progress.visibleAlertCategory='unknown';}
  // Passive window correlation only: these entries need not belong to the
  // selection. No URL/body/header is returned and no status proves rejection.
  try{
   if(typeof globalThis.performance?.getEntriesByType!=='function')throw Error('Resource observation unavailable');
   const entries=firstDispatch===null?[]:(globalThis.performance?.getEntriesByType?.('resource')||[]).filter(entry=>['fetch','xmlhttprequest'].includes(entry.initiatorType)&&entry.startTime>=firstDispatch&&entry.startTime<=now()&&new URL(entry.name).origin===location.origin);
   progress.network={correlation:'same-origin-window-only',observedRequests:entries.length,responses:entries.slice(0,8).map(entry=>({status:Number.isInteger(entry.responseStatus)&&entry.responseStatus>=100&&entry.responseStatus<=599?entry.responseStatus:null,completed:entry.responseEnd>0}))};
  }catch{progress.network={correlation:'unavailable',observedRequests:null,responses:[]};}
 };
 try {
  const courts=Object.hasOwn(s,'courts')?s.courts:Array(s.hours).fill(s.court);
  if(![1,2].includes(s.hours)||!Array.isArray(courts)||courts.length!==s.hours||courts[0]!==s.court||!courts.every(c=>[1,2,3,4].includes(c)))throw Error('Invalid hourly court identity');
  if(s.venue==='st-johns-park'&&courts.some(c=>![1,2].includes(c)))throw Error('Invalid St Johns court identity');
  const findCell=i=>{
   if(!['bethnal-green-gardens','st-johns-park','victoria-park'].includes(s.venue)||location.pathname!==`/book/courts/${s.venue}/${s.date}`)throw stop('SELECTION_PAGE_CHANGED','Wrong selection page');
   const d=new Date(s.date+'T12:00:00Z'),book=document.querySelector('#book');
   const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(d),month=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
   if(!book?.textContent.includes(`${weekday} ${d.getUTCDate()}`)||!book.textContent.includes(month))throw stop('SELECTION_PAGE_CHANGED','Visible date mismatch');
   const h=+s.start.slice(0,2)+i,label=`${h%12||12}${h>=12?'pm':'am'}`,court=courts[i];
   const rows=[...book.querySelectorAll('tr')].filter(r=>r.querySelector('th')?.textContent.trim()===label);
   if(rows.length!==1)throw stop('SELECTION_LAYOUT_UNKNOWN','Hour identity unavailable');
   const matches=[...rows[0].querySelectorAll('input[type=checkbox]')].filter(b=>new RegExp(`^(?:Tennis court|Court) ${court}(?!\\d)`).test(b.labels?.[0]?.textContent.trim()||''));
   if(matches.length!==1)throw stop('SELECTION_LAYOUT_UNKNOWN','Court identity missing or ambiguous');
   return {box:matches[0],court,hour:h,label};
  };
  const badgeCount=()=>{
   const badge=document.querySelector('#menu-basket');if(!badge)throw stop('SELECTION_LAYOUT_UNKNOWN','Basket acknowledgement marker missing');
   const count=badge.getAttribute('data-items');if(count!==null&&count!==''&&!/^\d+$/.test(count))throw stop('SELECTION_LAYOUT_UNKNOWN','Unknown basket acknowledgement count');
   progress.badgeCount=Number(count||0);progress.peakBadgeCount=Math.max(progress.peakBadgeCount,progress.badgeCount);return progress.badgeCount;
  };
  const validateCell=(cell,price)=>{
   if(cell.box.disabled)throw stop('SELECTION_SLOT_UNAVAILABLE','Slot unavailable before selection');
   if(cell.box.checked)throw stop('SELECTION_STATE_CHANGED','Slot already selected; no additional selection attempted');
   const match=/£(\d+(?:\.\d{1,2})?)$/.exec(cell.box.labels[0].textContent.trim());
   if(!match)throw stop('SELECTION_LAYOUT_UNKNOWN','Unknown price');const actual=Math.round(+match[1]*100);
   if(price!==undefined&&actual!==price)throw stop('SELECTION_PRICE_CHANGED','Price changed before selection');return actual;
  };
  // Validate every hour before the first mutation, but never retain DOM nodes
  // across site updates. Each later hour is resolved and validated afresh.
  const prices=Array.from({length:s.hours},(_,i)=>validateCell(findCell(i)));
  if(prices.reduce((sum,p)=>sum+p,0)!==Math.round(+s.totalGBP*100))throw stop('SELECTION_PRICE_CHANGED','Price changed before selection');
  if(badgeCount()!==0)throw stop('SELECTION_STATE_CHANGED','Existing basket before selection; no clicks attempted');
  for(let hour=0;hour<s.hours;hour++) {
   if(now()>=deadline)throw stop('SELECTION_ACK_TIMEOUT','Selection deadline reached; no further clicks');
   if(badgeCount()!==hour||Array.from({length:hour},(_,i)=>findCell(i).box.checked).some(checked=>!checked))throw stop('SELECTION_STATE_CHANGED','Previous hour selection changed; no repeated clicks');
   const cell=findCell(hour);validateCell(cell,prices[hour]);
   if(now()>=deadline)throw stop('SELECTION_ACK_TIMEOUT','Selection deadline reached; no further clicks');
   firstDispatch??=now();progress.hourlyDispatches.push({hour:cell.hour,court:cell.court,at:new Date().toISOString(),offsetMs:Math.max(0,Math.round(now()-started))});
   progress.dispatchedHours++;cell.box.click();
   let stable=0,acknowledged=false;
   for(let poll=0;poll<Math.ceil(timeoutMs/250)&&now()<deadline;poll++) {
    progress.polls++;
    const count=badgeCount();
    if(count>hour+1)throw stop('SELECTION_STATE_CHANGED','Unexpected additional basket items during selection');
    const cells=Array.from({length:hour+1},(_,i)=>findCell(i));
    progress.checkedHours=cells.map(c=>({hour:c.hour,court:c.court,checked:c.box.checked,disabled:c.box.disabled}));
    for(const c of progress.checkedHours){if(c.checked)observedChecked.add(c.hour);else if(observedChecked.has(c.hour))progress.checkboxReverted=true;}
    if(now()>=deadline)break;
    const ready=count===hour+1&&cells.every(c=>c.box.checked);
    stable=ready?stable+1:0;
    if(stable>=3){acknowledged=true;progress.acknowledgedHours=hour+1;break;}
    await new Promise(r=>setTimeout(r,Math.max(0,Math.min(250,deadline-now()))));
   }
   if(!acknowledged)throw stop('SELECTION_ACK_TIMEOUT','Hourly selection acknowledgement uncertain; no repeated clicks');
  }
  finishEvidence();
  return {selected:true,selectionDiagnostic:progress};
 }catch(e){finishEvidence();throw Object.assign(e,{reasonCode:e.reasonCode||'SELECTION_OBSERVATION_FAILED',selectionAttempted:progress.dispatchedHours>0,selectionDiagnostic:progress});}
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!['basket-read','select-slot'].includes(request.kind))return;
 (async()=>{
  if(/\/(verify-human|login|sign-in)(\/|$)/.test(location.pathname))throw Object.assign(Error('Human verification required; inspect retained tab'),{reasonCode:'AUTHENTICATION_REQUIRED'});
  if(request.kind==='basket-read')return stableBasketSummary();
  const timeout=[15000,60000].includes(request.selectionTimeoutMs)?request.selectionTimeoutMs:15000;
  return selectSequentially(request.slot,timeout);
 })().then(value=>respond(value.notReady?{ok:false,notReady:true,error:'Basket DOM not stable'}:{ok:true,value}),e=>respond(request.kind==='basket-read'&&document.readyState&&document.readyState!=='complete'&&/Unknown basket|Basket item layout/.test(e.message)?{ok:false,notReady:true,error:'Basket DOM not ready'}:{ok:false,...(request.kind==='basket-read'?{reasonCode:e.reasonCode||'BASKET_LAYOUT_UNKNOWN'}:{}),error:request.kind==='select-slot'?'Court selection stopped; inspect diagnostic evidence':e.message,...(request.kind==='select-slot'?{reasonCode:e.reasonCode||'SELECTION_OBSERVATION_FAILED'}:{}),selectionAttempted:!!e.selectionAttempted,...(e.selectionDiagnostic?{selectionDiagnostic:e.selectionDiagnostic}:{})}));return true;
});
