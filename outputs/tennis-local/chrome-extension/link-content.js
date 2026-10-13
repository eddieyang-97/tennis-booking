// Only Link's public controls are used. No card inputs, tokens or OTP values.
// The worker validates this frame's URL and its current top-level checkout.
// Referrer headers are not an authority: they may be omitted by site policy.
{
 const type=location.pathname.includes('/elements-inner-link-button-for-card-')?'button':location.pathname.includes('/universal-link-modal-inner-')?'modal':null;
 if(type) {
  chrome.runtime.onMessage.addListener((request,sender,respond)=>{
   if(sender.id!==chrome.runtime.id || !['link-discover','link-state','link-open','link-continue','link-close'].includes(request.kind))return;
   if(request.kind==='link-discover') {
    chrome.runtime.sendMessage({kind:'link-frame'}).then(result=>respond({ok:result?.ok===true}),()=>respond({ok:false}));return true;
   }
   try {
    if(request.kind==='link-state') {
     const heading=[...document.querySelectorAll('h1,h2,h3')].map(h=>h.textContent.trim());
     const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Continue');
     return respond({ok:true,value:{type,authenticationRequired:heading.includes('Confirm it’s you'),canContinue:heading.includes('Payment methods') && buttons.length===1 && !buttons[0].disabled}});
    }
    const button=request.kind==='link-open' && type==='button'?document.querySelector('button#link-use'):request.kind==='link-close' && type==='modal'?[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Close'||b.textContent.trim()==='Close'):request.kind==='link-continue' && type==='modal' && [...document.querySelectorAll('h1,h2,h3')].some(h=>h.textContent.trim()==='Payment methods')?[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue'):null;
    if(!button || button.disabled)throw Error('Saved Link control unavailable');
    button.click();respond({ok:true});
   }catch(e){respond({ok:false,error:e.message});}
  });
  chrome.runtime.sendMessage({kind:'link-frame'}).catch(()=>{});
 }
}
