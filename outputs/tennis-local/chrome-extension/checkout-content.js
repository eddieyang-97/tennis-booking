// Read-only receipt inspection. Never accesses Stripe frames or input values.
function checkoutReceipt(slot,key) {
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
 return {status:'confirmed',key,reference};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id || request.kind!=='receipt-read')return;
 try{respond({ok:true,value:checkoutReceipt(request.slot,request.key)});}catch(e){respond({ok:false,error:e.message});}
});
