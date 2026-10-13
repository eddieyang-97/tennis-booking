import {londonDay,addDays} from './core.js';
import {readiness} from './readiness.js';
const day=document.querySelector('#day'), output=document.querySelector('#result');day.value=addDays(londonDay(),8);
function showStatus(result) {
 document.querySelector('#cardStatus').textContent=result.localCardUnlocked?'Local card: unlocked for this Chrome session.':'Local card: locked. Open card setup and unlock the file first.';
 const state=readiness(result);document.querySelector('#readinessSummary').textContent=state.summary;
 const lines=document.querySelector('#readinessLines');lines.replaceChildren(...state.lines.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
}
async function send(kind) {output.textContent='Checking…';try {
 const result=await chrome.runtime.sendMessage({kind,day:day.value});output.textContent=JSON.stringify(result,null,2);
 if(kind==='status')showStatus(result);
 else showStatus(await chrome.runtime.sendMessage({kind:'status'}));
 }catch(e){output.textContent=e.message;}}
for(const kind of ['openCardVault','payCheckout','armPayment','check','resume','prepareCheckout','verifyPayment','cancel','reset','reconcileBasket'])document.querySelector('#'+kind).addEventListener('click',()=>send(kind));
document.querySelector('#refreshStatus').addEventListener('click',()=>send('status'));
send('status');
