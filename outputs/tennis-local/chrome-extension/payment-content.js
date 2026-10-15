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
 if(sender.id!==chrome.runtime.id || !['payment-state','payment-open','payment-submit'].includes(request.kind))return;
 try {
  if(request.kind==='payment-state')return respond({ok:true,value:paymentState()});
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
