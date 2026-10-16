// Read-only receipt inspection. Never accesses Stripe frames or input values.
function checkoutReceipt(slot,key) {
 if(slot.courts?.some(c=>c!==slot.court))throw Error('Mixed-court booking requires purchase-history reconciliation');
 if(location.origin!=='https://tennistowerhamlets.com' || !location.pathname.startsWith('/basket'))throw Error('Open the resulting Courtside receipt page');
 const heading=document.querySelector('h1')?.textContent.trim()||'';
 const text=document.querySelector('main')?.innerText || document.body.innerText;
 if(/provisional/i.test(text) || !/^(Booking confirmation|Booking confirmed|Payment successful)$/i.test(heading))return {status:'awaiting-payment'};
 const reference=/(?:booking reference|booking ref(?:erence)?|ref)\s*[:#]\s*(\d+)/i.exec(text)?.[1];
 const venue=slot.venue==='victoria-park'?'Victoria Park':'Bethnal Green Gardens';
 const date=new Date(slot.date+'T12:00:00Z'),day=date.getUTCDate();
 const month=new Intl.DateTimeFormat('en-GB',{month:'long',timeZone:'UTC'}).format(date);
 const datePattern=new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s+${month}\\s+${date.getUTCFullYear()}\\b`,'i');
 const courtPattern=new RegExp(`(?:Tennis court|Court)\\s+${slot.court}(?!\\d)`,'i');
 const hour=+slot.start.slice(0,2),time=new RegExp(`\\b${hour%12||12}:00\\s*${hour>=12?'pm':'am'}\\b`,'i');
 const totals=[...text.matchAll(/Total\s*[:]?\s*£\s*(\d+\.\d{2})/gi)];
 const paid=/payment (?:successful|received)|payment status\s*:\s*paid/i.test(heading+'\n'+text);
 if(!reference || !paid || !text.includes(venue) || !datePattern.test(text) || !courtPattern.test(text) || !time.test(text) || totals.length!==1 || totals[0][1]!==slot.totalGBP)throw Error('Receipt layout or booking details not verified; inspect manually');
 const duration=new RegExp(`duration\\s*:\\s*${slot.hours}\\s*hours?\\b`,'i');
 const lastHour=hour+slot.hours-1;
 const end=new RegExp(`\\b${lastHour%12||12}:59\\s*${lastHour>=12?'pm':'am'}\\b`,'i');
 if(!duration.test(text) && !end.test(text))throw Error('Receipt duration not verified');
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
 if(matches.length!==1)throw Error('Unique matching purchase not found; no payment retry');
 const cells=matches[0];
 if(testStatusOnly){if(cells[2]==='Pending'&&cells[4]===`£${slot.totalGBP}`&&cells[5]===`Pay £${slot.totalGBP}`)return {status:'unpaid',reference,totalGBP:slot.totalGBP};throw Error('Test purchase is paid or uncertain; preserve the journal');}
 if(cells[2]!=='Confirmed'||cells[4]!==`£${slot.totalGBP}`||!/^Paid\s*✔$/.test(cells[5]))throw Error('Matching purchase is not confirmed paid at the expected amount');
 // A cancelled booking can still have a paid purchase. The purchase row
 // establishes transaction payment, never active court/cancellation/refund.
 return {status:'confirmed',key,reference,source:'account-purchase',bookingState:'unknown'};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id || !['receipt-read','purchase-read','test-purchase-state'].includes(request.kind))return;
 if(['purchase-read','test-purchase-state'].includes(request.kind) && /\/(?:verify-human|sign-in|login)(?:\/|$)/.test(location.pathname)){respond({ok:false,error:'Account login or human verification required',humanRequired:true,page:'account-verification'});return;}
 if(['purchase-read','test-purchase-state'].includes(request.kind)&&location.pathname==='/account'&&document.readyState&&document.readyState!=='complete'&&!document.querySelector('h1')?.textContent.trim()){respond({ok:false,notReady:true,error:'Account DOM not ready'});return;}
 try{respond({ok:true,value:request.kind==='test-purchase-state'?checkoutPurchase(request.slot,request.key,request.reference,null,null,true):request.kind==='purchase-read'?checkoutPurchase(request.slot,request.key,request.reference,request.paymentDispatchedAt,request.manualPaymentReportedAt):checkoutReceipt(request.slot,request.key)});}catch(e){respond({ok:false,error:e.message});}
});
