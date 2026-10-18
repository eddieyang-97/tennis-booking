// Read-only receipt inspection. Never accesses Stripe frames or input values.
function receiptFields(lines,label,shape,legacyContext){
 const values=[];
 for(let i=0;i<lines.length;i++){
  const labelled=label.exec(lines[i]);
  const value=labelled?(labelled[1]||lines[i+1]||''):legacyContext(lines[i-1]||'',lines[i+1]||'')?lines[i]:'';
  if(shape.test(value))values.push(value.match(shape));
 }
 return values;
}
function checkoutReceipt(slot,key,expectedReference) {
 if(location.origin!=='https://tennistowerhamlets.com' || !location.pathname.startsWith('/basket'))throw Error('Open the resulting Courtside receipt page');
 const heading=document.querySelector('h1')?.textContent.trim()||'';
 const text=document.querySelector('main')?.innerText || document.body.innerText;
 if(/provisional/i.test(text) || !/^(Booking confirmation|Booking confirmed|Payment successful)$/i.test(heading))return {status:'awaiting-payment'};
 const reference=/(?:booking reference|booking ref(?:erence)?|ref)\s*[:#]\s*(\d+)/i.exec(text)?.[1];
 const venue=slot.venue==='victoria-park'?'Victoria Park':'Bethnal Green Gardens';
 const date=new Date(slot.date+'T12:00:00Z'),day=date.getUTCDate();
 const courtPattern=new RegExp(`(?:Tennis court|Court)\\s+${slot.court}(?!\\d)`,'i');
 const hour=+slot.start.slice(0,2);
 const totals=[...text.matchAll(/Total\s*[:]?\s*£\s*(\d+\.\d{2})/gi)];
 const paid=/payment (?:successful|received)|payment status\s*:\s*paid/i.test(heading+'\n'+text);
 // A positively identified paid receipt is contradictory evidence, not absent
 // evidence. Only recognize explicit facts; missing/unfamiliar layout remains
 // unverifiable. Never return the merchant text in diagnostics.
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const dateShape=/^(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i;
 const bookingContext=line=>/^(?:(?:Victoria Park|Bethnal Green Gardens)(?:\s+Court\s+\d+)?|(?:Tennis court|Court)\s+\d+)$/i.test(line);
 // Labelled playing dates, or the legacy standalone date immediately after
 // venue/court details. Payment/creation metadata is not booking identity.
 const dates=receiptFields(lines,/^(?:Playing date|Date of play|Court date)\s*:\s*(.*)$/i,dateShape,previous=>bookingContext(previous));
 const courts=[...text.matchAll(/\b(?:Tennis court|Court)\s+(\d+)\b/gi)].map(m=>+m[1]);
 const venues=['Victoria Park','Bethnal Green Gardens'].filter(name=>text.includes(name));
 const durations=[...text.matchAll(/\bduration\s*:\s*(\d+)\s*hours?\b/gi)].map(m=>+m[1]);
 const minute=m=>(+m[1]%12+(/pm/i.test(m[3])?12:0))*60+(+m[2]);
 const timeShape=/^((?:1[0-2]|[1-9])):([0-5]\d)\s*(am|pm)(?:\s*[–—-]\s*((?:1[0-2]|[1-9])):([0-5]\d)\s*(am|pm))?$/i;
 const times=receiptFields(lines,/^(?:Start time|Playing time|Time|Start)\s*:\s*(.*)$/i,timeShape,previous=>bookingContext(previous)||dateShape.test(previous));
 const allowedCourts=slot.courts||[slot.court];
 const conflictingDate=dates.some(m=>+m[1]!==day||months.findIndex(name=>name.toLowerCase()===m[2].toLowerCase())!==date.getUTCMonth()||+m[3]!==date.getUTCFullYear());
 const conflictingRange=times.some(m=>minute(m)!==hour*60||(m[4]&&minute([null,m[4],m[5],m[6]])!==(hour+slot.hours)*60-1));
 const contradictory=conflictingDate||conflictingRange||totals.some(m=>m[1]!==slot.totalGBP)||venues.some(name=>name!==venue)||courts.some(c=>!allowedCourts.includes(c))||durations.some(n=>n!==slot.hours);
 if(expectedReference&&reference===expectedReference&&paid&&contradictory)return {status:'conflicting',key,reference,reasonCode:'RECEIPT_CONFLICT'};
 if(slot.courts?.some(c=>c!==slot.court))throw Error('Mixed-court booking requires purchase-history reconciliation');
 if(contradictory || !reference || !paid || !text.includes(venue) || dates.length===0 || !courtPattern.test(text) || times.length===0 || totals.length!==1 || totals[0][1]!==slot.totalGBP)throw Error('Receipt layout or booking details not verified; inspect manually');
 const duration=new RegExp(`duration\\s*:\\s*${slot.hours}\\s*hours?\\b`,'i');
 const lastHour=hour+slot.hours-1;
 if(!duration.test(text) && !times.some(m=>m[4]&&minute([null,m[4],m[5],m[6]])===(lastHour+1)*60-1))throw Error('Receipt duration not verified');
 return {status:'confirmed',key,reference,source:'booking-receipt',bookingState:'confirmed'};
}
function checkoutPurchase(slot,key,reference,paymentDispatchedAt,manualPaymentReportedAt,testStatusOnly=false) {
 if(location.origin!=='https://tennistowerhamlets.com'||location.pathname!=='/account')throw Error('Open the Courtside account page');
 if(!/^Welcome back,/.test(document.querySelector('h1')?.textContent.trim()||''))throw Error('Account login or human verification required');
 if(!/^\d+$/.test(reference||'')||(!testStatusOnly&&!Number.isFinite(Date.parse(paymentDispatchedAt))&&!Number.isFinite(Date.parse(manualPaymentReportedAt)))||key!==JSON.stringify([slot.venue,slot.date,slot.courts||slot.court,slot.start,slot.hours]))throw Error('Dispatched or manually reported checkout identity required');
 const tables=[...document.querySelectorAll('table')].filter(table=>{
  const headers=[...table.querySelectorAll('th')].map(e=>e.textContent.trim());
  return headers.length===6&&headers.slice(0,5).join('|')==='Date|Ref|State|Info|Value'&&headers[5]==='';
 });
 if(tables.length!==1)throw Error('Purchase history layout not verified');
 const rows=[...tables[0].querySelectorAll('tr')].map(row=>[...row.querySelectorAll('td')].map(e=>e.textContent.trim()));
 const matches=rows.filter(cells=>cells.length===6 && /^(?:PT)?\d+$/.test(cells[1]) && cells[1].replace(/^PT/,'')===reference);
 if(matches.length!==1)throw Error(`Unique matching purchase not found for reference ${reference}: observed ${matches.length} matches; journal retained, no payment retry`);
 const cells=matches[0];
 if(testStatusOnly){if(cells[2]==='Pending'&&cells[4]===`£${slot.totalGBP}`&&cells[5]===`Pay £${slot.totalGBP}`)return {status:'unpaid',reference,totalGBP:slot.totalGBP};throw Error('Test purchase is paid or uncertain; preserve the journal');}
 if(cells[2]!=='Confirmed'||cells[4]!==`£${slot.totalGBP}`||!/^Paid\s*✔$/.test(cells[5]))throw Error('Matching purchase is not confirmed paid at the expected amount');
 // A cancelled booking can still have a paid purchase. The purchase row
 // establishes transaction payment, never active court/cancellation/refund.
 return {status:'confirmed',key,reference,source:'account-purchase',bookingState:'unknown'};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id || !['receipt-read','purchase-read','test-purchase-state'].includes(request.kind))return;
 if(request.kind==='test-purchase-state'&&location.pathname==='/account'&&document.readyState&&document.readyState!=='complete'){respond({ok:false,notReady:true,error:'Account purchase history is still loading'});return;}
 if(['purchase-read','test-purchase-state'].includes(request.kind) && /\/(?:verify-human|sign-in|login)(?:\/|$)/.test(location.pathname)){respond({ok:false,error:'Account login or human verification required',humanRequired:true,page:'account-verification'});return;}
 if(['purchase-read','test-purchase-state'].includes(request.kind)&&location.pathname==='/account'&&document.readyState&&document.readyState!=='complete'&&!document.querySelector('h1')?.textContent.trim()){respond({ok:false,notReady:true,error:'Account DOM not ready'});return;}
 try{respond({ok:true,value:request.kind==='test-purchase-state'?checkoutPurchase(request.slot,request.key,request.reference,null,null,true):request.kind==='purchase-read'?checkoutPurchase(request.slot,request.key,request.reference,request.paymentDispatchedAt,request.manualPaymentReportedAt):checkoutReceipt(request.slot,request.key,request.reference)});}catch(e){respond({ok:false,error:e.message});}
});
