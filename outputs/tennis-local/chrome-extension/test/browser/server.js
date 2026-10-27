import http from 'node:http';
const venueName=venue=>venue==='victoria-park'?'Victoria Park':'Bethnal Green Gardens';
const shell=(body,script='')=>`<!doctype html><meta charset="utf-8"><h1>${body.heading||'Basket'}</h1><a id="menu-basket" data-items="${body.count||0}" href="/basket">Basket</a>${body.html||''}${script?`<script src="${script}"></script>`:''}`;
const id=hour=>String(hour).padStart(32,'0');
export async function startMerchant(){
 const state={items:[],discount:0,reference:'100001',purchases:[],counts:{selection:0,discount:0,opening:0,fill:0,pay:0,removal:0},options:{},venue:'bethnal-green-gardens',day:'2026-10-25'};
 const totals=()=>({gross:state.items.length*7,net:state.items.length*7-state.discount});
 const summary=()=>{
  const {gross,net}=totals();return `<table>${state.items.map(item=>`<tr><td><a href="#item-${id(item.hour)}">Court booking</a></td><td>£7.00</td></tr>`).join('')}<tr><td>Subtotal</td><td>£${gross.toFixed(2)}</td></tr><tr><td>Discount${state.discount?' (<a href="/basket/discount-remove">remove</a>)':''}</td><td>${state.discount?'-£'+state.discount.toFixed(2):'-'}</td></tr><tr><td>Total</td><td>£${net.toFixed(2)}</td></tr></table>`;
 };
 const respond=(res,html,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/site.js'){
   res.writeHead(200,{'Content-Type':'application/javascript'});res.end(`
    for(const box of document.querySelectorAll('input[type=checkbox]'))box.addEventListener('change',async()=>{const r=await fetch('/__select?hour='+box.dataset.hour+'&court='+box.dataset.court,{method:'POST'});if(!r.ok){box.checked=false;return;}const value=await r.json();document.querySelector('#menu-basket').setAttribute('data-items',String(value.count));});
    for(const form of document.querySelectorAll('form[data-discount]'))form.addEventListener('submit',async e=>{e.preventDefault();await fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form))});location.href='/basket';});
    addEventListener('message',e=>{if(e.origin===location.origin&&e.data==='fake-card-ready'){const pay=document.querySelector('#submit');if(pay)pay.disabled=false;}});
   `);return;
  }
  if(url.pathname==='/__select'){
   state.counts.selection++;if(state.options.rejectSelection){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({count:state.items.length}));return;}const item={hour:Number(url.searchParams.get('hour')),court:Number(url.searchParams.get('court'))};
   if(state.options.overwrite)state.items=[];state.items.push(item);
   if(state.options.selectionDelay)await new Promise(resolve=>setTimeout(resolve,state.options.selectionDelay));
   // Synthetic committed mutation with a truncated response; no merchant claim.
   if(state.options.loseSelectionResponse){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"count":');await new Promise(resolve=>setTimeout(resolve,20));res.destroy();return;}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({count:state.items.length}));return;
  }
  if(url.pathname.startsWith('/book/courts/')){
   const [, , ,venue,day]=url.pathname.split('/');state.venue=venue;state.day=day;
   const date=new Date(day+'T12:00:00Z'),weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(date),month=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
   const html=`<div id="book">${weekday} ${date.getUTCDate()} ${month}<table>${[20,21].map(hour=>`<tr><th>${hour===20?'8pm':'9pm'}</th><td><label><input type="checkbox" data-hour="${hour}" data-court="1">${venue==='victoria-park'?'Court':'Tennis court'} 1£7</label></td></tr>`).join('')}</table></div>`;
   respond(res,shell({heading:'Book courts',html,count:state.items.length},'/site.js'));return;
  }
  if(url.pathname==='/basket/discount'&&req.method==='POST'){
   state.counts.discount++;state.discount=2;res.writeHead(204);res.end();return;
  }
  if(url.pathname==='/basket/discount-remove'){state.discount=0;state.counts.removal++;res.writeHead(303,{Location:'/basket'});res.end();return;}
  if(url.pathname.startsWith('/basket/remove/')){state.items=state.items.filter(item=>id(item.hour)!==url.pathname.split('/').pop());state.counts.removal++;if(!state.items.length)state.discount=0;res.writeHead(303,{Location:'/basket'});res.end();return;}
  if(url.pathname==='/basket'){
   if(!state.items.length){respond(res,shell({html:'There are no items in your basket'}));return;}
   const date=new Date(state.day+'T12:00:00Z'),day=date.getUTCDate(),month=new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'UTC'}).format(date);
   const html=summary()+`<form method="post" action="/basket/discount" data-discount><input id="checkout-discount" name="code"><button>Apply code</button></form><form method="post" action="/basket/pay/card"><button id="btn-pay-now">Pay with card</button></form>`+state.items.map(item=>`<div id="item-${id(item.hour)}">Court ${item.court}, ${venueName(state.venue)} ${day}th ${month} | ${item.hour%12||12}:00pm–${item.hour%12||12}:59pm £7.00 <a href="/basket/remove/${id(item.hour)}">Remove</a></div>`).join('');
   respond(res,shell({html,count:state.items.length},'/site.js'));return;
  }
  if(url.pathname==='/basket/pay/card'){
   if(req.method==='POST'){
    state.counts.opening++;if(state.options.merchantError){respond(res,shell({heading:'Something went wrong'}),500);return;}
    state.purchases=[{reference:state.reference,total:totals().net,state:'Pending'}];
   }
   const purchase=state.purchases.find(p=>p.reference===state.reference);
   if(!purchase){respond(res,shell({heading:'Something went wrong'}),404);return;}
   if(state.options.checkoutDelay)await new Promise(resolve=>setTimeout(resolve,state.options.checkoutDelay));
   respond(res,shell({heading:'Basket checkout',count:state.items.length,html:`<p>We have received your provisional booking (ref: ${state.reference}), it will be confirmed once we receive payment.</p><iframe src="/v3/elements-inner-card-fake"></iframe><form method="post" action="/__pay"><button id="submit" disabled>Pay £${purchase.total.toFixed(2)}</button></form><a href="/basket">Cancel &amp; return to basket</a>`},'/site.js'));return;
  }
  if(url.pathname==='/v3/elements-inner-card-fake'){respond(res,shell({heading:'Local fake payment frame',html:'<p>No card information is accepted.</p>'}));return;}
  if(url.pathname==='/__fill'){state.counts.fill++;if(state.options.holdFillResponse)return;res.writeHead(204);res.end();return;}
  if(url.pathname==='/__pay'){
   state.counts.pay++;const purchase=state.purchases.find(p=>p.reference===state.reference);if(purchase)purchase.state='Confirmed';
   state.payObserved=true;if(state.options.holdPayResponse)return;
   respond(res,shell({heading:'Order received',html:'Consult account purchase history.'}));return;
  }
  if(url.pathname==='/account'){
   if(state.options.holdAccountAfterPay&&state.payObserved)return;
   const rows=state.options.duplicatePurchases?[...state.purchases,...state.purchases]:state.purchases;
   const html=`<table><tr>${['Date','Ref','State','Info','Value',''].map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(p=>`<tr><td>Test date</td><td>PT${p.reference}</td><td>${p.state}</td><td>2 courts</td><td>£${p.total.toFixed(2)}</td><td>${p.state==='Confirmed'?'Paid ✔':`Pay £${p.total.toFixed(2)}`}</td></tr>`).join('')}</table>`;
   respond(res,shell({heading:'Welcome back, Test',html}));return;
  }
  if(url.pathname==='/basket/receipt'){
   const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
   respond(res,shell({heading:'Payment successful',html:'<main>'+String(state.options.receiptText||'').split('\n').map(line=>'<div>'+escape(line)+'</div>').join('')+'</main>'}));return;
  }
  if(url.pathname==='/purchase/card/100001'){respond(res,shell({heading:'Pay with card',html:'Booking ref: PT100001 <p>Amount due: £12.00</p><button disabled>Pay £12.00</button>'}));return;}
  respond(res,shell({heading:'Unknown local test page'}),404);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {state,origin:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
