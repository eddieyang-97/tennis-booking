function paymentState() {
 if(location.pathname!=='/basket/pay/card')throw Error('Not the card checkout');
 const pay=document.querySelector('button#submit');
 const match=/^Pay £(\d+\.\d{2})$/.exec(pay?.textContent.trim()||'');
 const reference=/provisional booking \(ref: (\d+)\)/.exec(document.body.innerText)?.[1];
 if(!match || !reference)throw Error('Unknown payment page');
 const linkFramePresent=[...document.querySelectorAll('iframe')].some(frame=>{try{const url=new URL(frame.getAttribute('src'),location.href);return url.origin==='https://js.stripe.com' && url.pathname.startsWith('/v3/elements-inner-link-button-for-card-');}catch{return false;}});
 return {totalGBP:match[1],reference,enabled:!pay.disabled,linkFramePresent};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id || !['checkout-progress','test-remove-next','discount-apply','payment-state','payment-open','payment-submit'].includes(request.kind))return;
 try {
  if(request.kind==='payment-state')return respond({ok:true,value:paymentState()});
  if(request.kind==='checkout-progress'){
   const merchantError=/something went wrong/i.test(document.body.innerText||'');
   if(!merchantError&&location.pathname==='/basket/pay/card')return respond({ok:true,value:{stage:'card',loadState:document.readyState,...paymentState()}});
   return respond({ok:true,value:{stage:location.pathname==='/basket'?'basket':'other-page',loadState:document.readyState,merchantError}});
  }
  if(request.kind==='test-remove-next'){
   if(location.pathname!=='/basket'||JSON.stringify(basketSummary())!==JSON.stringify(request.expected))throw Error('Basket changed before test cleanup');
   const discount=document.querySelector('a[href="/basket/discount-remove"]');
   if(discount){discount.click();return respond({ok:true});}
   const anchors=[...document.querySelectorAll('a[href^="#item-"]')];
   const item=anchors.length?document.getElementById(anchors[0].getAttribute('href').slice(1)):null;
   const links=item?[...item.querySelectorAll('a')].filter(a=>a.textContent.trim()==='Remove'&&/^\/basket\/remove\/[a-f0-9]{32}$/.test(a.getAttribute('href')||'')):[];
   if(links.length!==1)throw Error('Test item removal control unavailable');
   links[0].click();return respond({ok:true});
  }
  if(request.kind==='discount-apply') {
   if(location.pathname!=='/basket'||JSON.stringify(basketSummary())!==JSON.stringify(request.expected))throw Error('Basket changed before discount');
   if(typeof request.code!=='string'||!/^[A-Za-z0-9_-]{1,10}$/.test(request.code))throw Error('Invalid discount code');
   const input=document.querySelector('#checkout-discount'),form=input?.form;
   const buttons=form?[...form.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Apply code'):[];
   if(!input||input.disabled||form.getAttribute('action')!=='/basket/discount'||form.method.toLowerCase()!=='post'||buttons.length!==1||buttons[0].disabled)throw Error('Discount form unavailable');
   input.value=request.code;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   buttons[0].click();return respond({ok:true});
  }
  if(request.kind==='payment-open') {
   if(location.pathname!=='/basket')throw Error('Not the verified basket');
   const basket=basketSummary();
   if(JSON.stringify(basket)!==JSON.stringify(request.expected))throw Error('Basket changed before checkout');
   const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Pay with card');
   if(buttons.length!==1 || buttons[0].disabled)throw Error('Checkout unavailable');
   buttons[0].click();return respond({ok:true});
  }
  const state=paymentState();
  if(!state.enabled || state.totalGBP!==request.totalGBP || state.reference!==request.reference)throw Error('Payment changed before submission');
  document.querySelector('button#submit').click();respond({ok:true});
 }catch(e){respond({ok:false,error:e.message,...(request.kind==='payment-open'?{routeCategory:location.pathname==='/basket'?'basket':location.pathname==='/basket/pay/card'?'card':/\/(verify-human|sign-in|login)(\/|$)/.test(location.pathname)?'authentication':'other-page'}:{})});}
});
