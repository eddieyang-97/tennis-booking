// Public Stripe Card Element fields only. Never returns values or logs them.
if(location.pathname.startsWith('/v3/elements-inner-card-')) {
 chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !['link-discover','link-state','card-fill'].includes(request.kind))return;
  if(request.kind==='link-discover'){chrome.runtime.sendMessage({kind:'link-frame'}).then(result=>respond({ok:result?.ok===true}),()=>respond({ok:false}));return true;}
  if(request.kind==='link-state'){respond({ok:true,value:{type:'card'}});return;}
  let stage='validation';
  (async()=>{
   const card=request.card;
   if(!card||!/^\d{12,19}$/.test(card.number)||! /^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)||!/^\d{3,4}$/.test(card.cvc)||typeof card.postcode!=='string')throw Error();
   const inputs=name=>[...document.querySelectorAll(`input[name="${name}"]`)];
   const usable=input=>input&&!input.disabled&&!input.readOnly;
   stage='layout';
   // Empty Stripe forms have these three inputs. Postal is mounted only after
   // card entry, so its absence here is expected, not a layout failure.
   for(const name of ['cardnumber','exp-date','cvc']){const matches=inputs(name);if(matches.length!==1||!usable(matches[0]))throw Error();}
   if(inputs('postal').length>1)throw Error();
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error();
   async function enter(name,value,label) {
    stage=label;let input;
    for(let attempt=0;attempt<50;attempt++) {
     const matches=inputs(name);if(matches.length>1)throw Error();
     if(matches.length===1&&usable(matches[0])&&matches[0].getAttribute('aria-hidden')!=='true'){input=matches[0];break;}
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!input)throw Error();
    input.focus();setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();
   }
   await enter('cardnumber',card.number,'card number');
   await enter('exp-date',card.expiry,'expiry');
   await enter('cvc',card.cvc,'security code');
   await enter('postal',card.postcode,'billing postcode');
   return {filled:true};
  })().then(value=>respond({ok:true,value}),()=>respond({ok:false,error:`Card autofill stopped at ${stage}; the expected field was unavailable or rejected input`}));
  return true;
 });
 chrome.runtime.sendMessage({kind:'link-frame'}).catch(()=>{});
}
