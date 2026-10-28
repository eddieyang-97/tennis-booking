import {slotKey,slotCourts,NAMES} from './core.js';
import {verifyBasket} from './stage-rules.js';
export function assertUnpaidTest(record){
 if(record?.checkoutTestOnly!==true||record.status!=='pending'||record.test||record.basketOnly||record.paymentDispatchedAt||record.manualPaymentReportedAt||Object.hasOwn(record,'freeBookingDispatchedAt')||record.key!==slotKey(record.slot))throw Error('Only an unpaid checkout test can be reset automatically');
 if(!['selection-dispatched','awaiting-payment','discount-dispatched','checkout-test-opening','checkout-test-ready','test-cleanup-checking','test-cleanup-removing'].includes(record.phase)||(Object.hasOwn(record,'reference')&&!/^\d+$/.test(record.reference))||(record.phase==='checkout-test-ready'&&!record.checkoutOpenDispatchedAt&&!record.reference))throw Error('Test checkout state is uncertain; preserve the journal');
}
export function testBasketSubset(basket,record){
 if(basket?.empty===true&&Array.isArray(basket.items)&&!basket.items.length)return true;
 const s=record.slot,courts=slotCourts(s),seen=new Set();
 const free=basket?.freeBookingBoundary===true&&basket.paymentBoundary===false&&basket.totalGBP==='0.00';
 if(free){
  assertUnpaidTest(record);
  if(record.discount?.totalGBP!=='0.00'||['reference','checkoutOpenDispatchedAt','freeBookingDispatchedAt'].some(field=>Object.hasOwn(record,field)))throw Error('Free test completion state is uncertain; preserve the journal');
  verifyBasket(basket,s,record.discount);
 }
 if(!Array.isArray(basket?.items)||!basket.items.length||basket.items.length>s.hours||(!basket.paymentBoundary&&!free))throw Error('Test basket is not verified; nothing removed');
 for(const item of basket.items){const i=item.hour-Number(s.start.slice(0,2));
  if(!Number.isInteger(i)||i<0||i>=s.hours||seen.has(i)||item.court!==courts[i]||item.venue!==NAMES[s.venue]||item.day!==Number(s.date.slice(8))||item.month!==Number(s.date.slice(5,7))||!/^\d+\.\d{2}$/.test(item.priceGBP))throw Error('Basket contains unrelated or changed items; nothing removed');seen.add(i);
 }
 const gross=basket.items.reduce((n,item)=>n+Math.round(Number(item.priceGBP)*100),0),off=Math.round(Number(basket.discountGBP||'0.00')*100),net=Math.round(Number(basket.totalGBP)*100);
 if(gross<=0||gross>Math.round(Number(s.totalGBP)*100)||!Number.isFinite(net)||off<0||gross-off!==net||net<0||(off>0&&(!record.discountDispatchedAt||!record.discountCode||basket.discountApplied!==true))||(basket.subtotalGBP&&Math.round(Number(basket.subtotalGBP)*100)!==gross))throw Error('Test basket accounting changed; nothing removed');
 return true;
}
export async function clearUnpaidTest(record,deps){
 assertUnpaidTest(record);
 const save=async patch=>{record={...record,...patch};await deps.save(record);};
 // Freeze known checkout tabs before checking the merchant; absence is never unpaid evidence.
 if(record.checkoutOpenDispatchedAt||record.reference){
  const reference=await deps.closeCheckout(record);
  if(!/^\d+$/.test(reference||'')||(record.reference&&record.reference!==reference))throw Error('Test payment reference unavailable; preserve the journal');
  await save({reference,phase:'test-cleanup-checking'});
  const evidence=await deps.purchase(record);
  if(evidence?.status!=='unpaid'||evidence.reference!==reference||evidence.totalGBP!==(record.discount?.totalGBP||record.slot.totalGBP))throw Error('Test payment is paid or uncertain; preserve the journal');
  await save({cleanupUnpaidVerifiedAt:new Date().toISOString()});
 }
 let basket=await deps.read();testBasketSubset(basket,record);
 for(let i=0;i<record.slot.hours+1&&!basket.empty;i++){
  const fingerprint=JSON.stringify(basket);
  if(record.cleanupDispatched?.fingerprint===fingerprint)throw Error('Test cleanup did not complete; no repeated removal was sent');
  await save({phase:'test-cleanup-removing',cleanupDispatched:{fingerprint,at:new Date().toISOString()}});
  try{await deps.remove(basket);}catch{/* Observe the result; never replay this mutation. */}
  const next=await deps.read();testBasketSubset(next,record);
  if(JSON.stringify(next)===fingerprint)throw Error('Test cleanup not acknowledged; inspect the basket');
  basket=next;
 }
 if(!basket.empty||basket.items.length)throw Error('Test basket is not empty; preserve the journal');
 if(record.reference){const evidence=await deps.purchase(record);if(evidence?.status!=='unpaid'||evidence.reference!==record.reference||evidence.totalGBP!==(record.discount?.totalGBP||record.slot.totalGBP))throw Error('Test payment state changed; preserve the journal');}
 const at=new Date().toISOString();
 const archived={...record,status:'abandoned',phase:'test-auto-cleared',abandonedAt:at,abandonmentEvidence:{basis:record.reference?'merchant-unpaid-verified':'unsubmitted-selection-empty',at,key:record.key,...(record.reference?{reference:record.reference}:{}),basketEmptyVerified:true,merchantPaymentState:record.reference?'unpaid':'unknown',merchantCancellationState:'unknown'}};await deps.archive(archived);return archived;
}
