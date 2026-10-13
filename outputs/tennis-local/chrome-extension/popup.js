import {londonDay,addDays} from './core.js';
const day=document.querySelector('#day'), output=document.querySelector('#result');day.value=addDays(londonDay(),8);
async function send(kind) {output.textContent='Checking…';try {
 const result=await chrome.runtime.sendMessage({kind,day:day.value});output.textContent=JSON.stringify(result,null,2);
 if(kind==='status') {
  document.querySelector('#cardStatus').textContent=result.localCardUnlocked?'Local card: unlocked for this Chrome session.':'Local card: locked. Open card setup and unlock the file first.';
 }
 }catch(e){output.textContent=e.message;}}
for(const kind of ['openCardVault','payCheckout','armPayment','check','resume','prepareCheckout','verifyPayment','cancel','reset','reconcileBasket'])document.querySelector('#'+kind).addEventListener('click',()=>send(kind));
send('status');
