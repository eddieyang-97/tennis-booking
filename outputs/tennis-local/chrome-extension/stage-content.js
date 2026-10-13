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
 return {empty:false,items,totalGBP:total[1],paymentBoundary:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Pay with card')};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id || !['basket-read','select-slot'].includes(request.kind))return;
 let selectionAttempted=false;
 (async()=>{
  if(/\/(verify-human|login|sign-in)(\/|$)/.test(location.pathname))throw Error('Human verification required; inspect retained tab');
  if(request.kind==='basket-read')return basketSummary();
  const s=request.slot;
  if(!['bethnal-green-gardens','victoria-park'].includes(s.venue)||location.pathname!==`/book/courts/${s.venue}/${s.date}`)throw Error('Wrong selection page');
  const d=new Date(s.date+'T12:00:00Z');const book=document.querySelector('#book');
  const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(d),month=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
  if(!book?.textContent.includes(`${weekday} ${d.getUTCDate()}`)||!book.textContent.includes(month))throw Error('Visible date mismatch');
  const boxes=[];let total=0;
  for(let i=0;i<s.hours;i++) {
   const h=+s.start.slice(0,2)+i,label=`${h%12||12}${h>=12?'pm':'am'}`;
   const rows=[...book.querySelectorAll('tr')].filter(r=>r.querySelector('th')?.textContent.trim()===label);
   if(rows.length!==1)throw Error('Hour unavailable');
   // Identify the court before checking availability: booked labels have no price.
   const matches=[...rows[0].querySelectorAll('input[type=checkbox]')].filter(b=>new RegExp(`^(?:Tennis court|Court) ${s.court}(?!\\d)`).test(b.labels?.[0]?.textContent.trim()||''));
   if(matches.length!==1)throw Error(`Court identity missing or ambiguous: court ${s.court}, ${label}`);
   if(matches[0].disabled)throw Error(`Slot unavailable: court ${s.court}, ${label} (${matches[0].labels[0].textContent.trim()})`);
   if(matches[0].checked)throw Error(`Slot already selected: court ${s.court}, ${label}; no additional selection attempted`);
   const m=/£(\d+(?:\.\d{1,2})?)$/.exec(matches[0].labels[0].textContent.trim());if(!m)throw Error('Unknown price');total+=Math.round(+m[1]*100);boxes.push(matches[0]);
  }
  if(total!==Math.round(+s.totalGBP*100))throw Error('Price changed before selection');
  for(const box of boxes) {if(box.disabled||box.checked)throw Error('Availability changed');selectionAttempted=true;box.click();}
  // Wait only on visible acknowledgement; no network polling or replay clicks.
  for(let i=0;i<60;i++) {
   // The visible badge is a CSS pseudo-element sourced from data-items.
   const count=document.querySelector('#menu-basket')?.getAttribute('data-items');
   if(+count===s.hours)return {selected:true};
   await new Promise(r=>setTimeout(r,250));
  }
  throw Error('Selection acknowledgement uncertain; do not retry');
 })().then(value=>respond({ok:true,value}),e=>respond({ok:false,error:e.message,selectionAttempted}));return true;
});
