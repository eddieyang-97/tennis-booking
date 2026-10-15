// Only background-origin commands can reach this isolated world. No page listener.
function basketSummary() {
 if(location.pathname!=='/basket')throw Error('Not on basket page');
 if(document.body.innerText.includes('There are no items in your basket'))return {empty:true,items:[]};
 const anchors=[...document.querySelectorAll('a[href^="#item-"]')];
 const items=anchors.map(a=>{
  const item=document.getElementById(a.getAttribute('href').slice(1));
  if(!item)throw Error('Basket item layout changed');
  const text=item.innerText;
  const court=/(?:Tennis court|Court) ([1-4])(?!\d)/.exec(text),venue=/Bethnal Green Gardens|Victoria Park/.exec(text),time=/(\d+)(?:st|nd|rd|th) (\w{3})\s*\|\s*(\d+):00(am|pm)\s*[–-]\s*(\d+):59(am|pm)/.exec(text),price=/£\s*(\d+\.\d{2})/.exec(text);
  if(!court||!venue||!time||!price)throw Error('Unknown basket identity or duration');
  if(time[3]!==time[5]||time[4]!==time[6])throw Error('Unknown basket time range');
  return {court:+court[1],venue:venue[0],day:+time[1],month:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(time[2])+1,hour:(+time[3]%12)+(time[4]==='pm'?12:0),priceGBP:price[1]};
 });
 const totals=[...document.querySelectorAll('tr')].filter(r=>r.querySelector('td')?.textContent.trim()==='Total');
 const total=totals.length===1?/£\s*(\d+\.\d{2})/.exec(totals[0].innerText):null;
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
 return {empty:false,items,totalGBP:total[1],...accounting,paymentBoundary:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Pay with card')};
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
 const progress={expectedHours:s.hours,dispatchedHours:0,acknowledgedHours:0,badgeCount:null};
 try {
  const courts=Object.hasOwn(s,'courts')?s.courts:Array(s.hours).fill(s.court);
  if(![1,2].includes(s.hours)||!Array.isArray(courts)||courts.length!==s.hours||courts[0]!==s.court||!courts.every(c=>[1,2,3,4].includes(c)))throw Error('Invalid hourly court identity');
  const findCell=i=>{
   if(!['bethnal-green-gardens','victoria-park'].includes(s.venue)||location.pathname!==`/book/courts/${s.venue}/${s.date}`)throw Error('Wrong selection page');
   const d=new Date(s.date+'T12:00:00Z'),book=document.querySelector('#book');
   const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(d),month=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
   if(!book?.textContent.includes(`${weekday} ${d.getUTCDate()}`)||!book.textContent.includes(month))throw Error('Visible date mismatch');
   const h=+s.start.slice(0,2)+i,label=`${h%12||12}${h>=12?'pm':'am'}`,court=courts[i];
   const rows=[...book.querySelectorAll('tr')].filter(r=>r.querySelector('th')?.textContent.trim()===label);
   if(rows.length!==1)throw Error('Hour unavailable');
   const matches=[...rows[0].querySelectorAll('input[type=checkbox]')].filter(b=>new RegExp(`^(?:Tennis court|Court) ${court}(?!\\d)`).test(b.labels?.[0]?.textContent.trim()||''));
   if(matches.length!==1)throw Error(`Court identity missing or ambiguous: court ${court}, ${label}`);
   return {box:matches[0],court,hour:h,label};
  };
  const badgeCount=()=>{
   const badge=document.querySelector('#menu-basket');if(!badge)throw Error('Basket acknowledgement marker missing');
   const count=badge.getAttribute('data-items');if(count!==null&&count!==''&&!/^\d+$/.test(count))throw Error('Unknown basket acknowledgement count');
   return progress.badgeCount=Number(count||0);
  };
  const validateCell=(cell,price)=>{
   if(cell.box.disabled)throw Error(`Slot unavailable: court ${cell.court}, ${cell.label}`);
   if(cell.box.checked)throw Error(`Slot already selected: court ${cell.court}, ${cell.label}; no additional selection attempted`);
   const match=/£(\d+(?:\.\d{1,2})?)$/.exec(cell.box.labels[0].textContent.trim());
   if(!match)throw Error('Unknown price');const actual=Math.round(+match[1]*100);
   if(price!==undefined&&actual!==price)throw Error('Price changed before selection');return actual;
  };
  // Validate every hour before the first mutation, but never retain DOM nodes
  // across site updates. Each later hour is resolved and validated afresh.
  const prices=Array.from({length:s.hours},(_,i)=>validateCell(findCell(i)));
  if(prices.reduce((sum,p)=>sum+p,0)!==Math.round(+s.totalGBP*100))throw Error('Price changed before selection');
  if(badgeCount()!==0)throw Error('Existing basket before selection; no clicks attempted');
  for(let hour=0;hour<s.hours;hour++) {
   if(badgeCount()!==hour||Array.from({length:hour},(_,i)=>findCell(i).box.checked).some(checked=>!checked))throw Error('Previous hour selection changed; no repeated clicks');
   const cell=findCell(hour);validateCell(cell,prices[hour]);
   progress.dispatchedHours++;cell.box.click();
   let stable=0,acknowledged=false;
   for(let poll=0;poll<Math.ceil(timeoutMs/250);poll++) {
    const count=badgeCount();
    if(count>hour+1)throw Error('Unexpected additional basket items during selection');
    const cells=Array.from({length:hour+1},(_,i)=>findCell(i));
    progress.checkedHours=cells.map(c=>({hour:c.hour,court:c.court,checked:c.box.checked,disabled:c.box.disabled}));
    const ready=count===hour+1&&cells.every(c=>c.box.checked);
    stable=ready?stable+1:0;
    if(stable>=3){acknowledged=true;progress.acknowledgedHours=hour+1;break;}
    await new Promise(r=>setTimeout(r,250));
   }
   if(!acknowledged)throw Error('Hourly selection acknowledgement uncertain; no repeated clicks');
  }
  return {selected:true,selectionDiagnostic:progress};
 }catch(e){throw Object.assign(e,{selectionAttempted:progress.dispatchedHours>0,selectionDiagnostic:progress});}
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!['basket-read','select-slot'].includes(request.kind))return;
 (async()=>{
  if(/\/(verify-human|login|sign-in)(\/|$)/.test(location.pathname))throw Error('Human verification required; inspect retained tab');
  if(request.kind==='basket-read')return stableBasketSummary();
  const timeout=[15000,60000].includes(request.selectionTimeoutMs)?request.selectionTimeoutMs:15000;
  return selectSequentially(request.slot,timeout);
 })().then(value=>respond(value.notReady?{ok:false,notReady:true,error:'Basket DOM not stable'}:{ok:true,value}),e=>respond(request.kind==='basket-read'&&document.readyState&&document.readyState!=='complete'&&/Unknown basket|Basket item layout/.test(e.message)?{ok:false,notReady:true,error:'Basket DOM not ready'}:{ok:false,error:e.message,selectionAttempted:!!e.selectionAttempted,...(e.selectionDiagnostic?{selectionDiagnostic:e.selectionDiagnostic}:{})}));return true;
});
