import {londonDay} from './core.js';
const day=document.querySelector('#day'), output=document.querySelector('#result');day.value=londonDay();
async function send(kind) {output.textContent='Checking…';try {
 const result=await chrome.runtime.sendMessage({kind,day:day.value});output.textContent=JSON.stringify(result,null,2);
 if(kind==='status') {
  document.querySelector('#cardStatus').textContent=result.localCardUnlocked?'Local card: unlocked for this Chrome session.':'Local card: locked. Open card setup and unlock the file first.';
  const pending=result.checkoutRecords?.find(r=>r.status!=='confirmed');
  const reconcile=pending && (pending.paymentDispatchedAt||['payment-dispatched','payment-uncertain'].includes(pending.phase));
  document.querySelector('#payTest').disabled=!result.localCardUnlocked&&!reconcile;
  if(result.checkoutRecords?.some(r=>r.test&&r.status==='confirmed')){document.querySelector('#payTest').disabled=true;document.querySelector('#payTest').textContent='Paid test already confirmed';}
 }
 }catch(e){output.textContent=e.message;}}
for(const kind of ['openCardVault','payTest','payCheckout','armPayment','check','resume','prepareCheckout','verifyPayment','cancel','reset','reconcileBasket'])document.querySelector('#'+kind).addEventListener('click',()=>send(kind));
send('status');
