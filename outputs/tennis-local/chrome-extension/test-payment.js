import test,{before,after} from 'node:test';import assert from 'node:assert/strict';
import {payCheckout} from './payment.js';import {checkoutKey,PAYMENT_TEST_SLOT} from './checkout.js';
import vm from 'node:vm';import fs from 'node:fs';
const originalNow=Date.now;before(()=>{Date.now=()=>Date.parse('2026-10-13T00:00:00Z');});after(()=>{Date.now=originalNow;});
function fixture(){let record={slot:PAYMENT_TEST_SLOT,test:true,key:checkoutKey(PAYMENT_TEST_SLOT,true),status:'pending',phase:'basket-adopted'},submits=0,links=0;const page={totalGBP:'2.50',reference:'100001',enabled:true};return {get record(){return record;},get submits(){return submits;},get links(){return links;},page,deps:{save:async r=>record=r,verifyBasket:async()=>{},open:async()=>{},state:async()=>page,link:async()=>links++,waitReady:async()=>page,submit:async()=>{assert.equal(record.phase,'payment-dispatched');submits++;},receipt:async()=>({status:'confirmed',key:record.key,reference:'100001'})}};}
test('Chrome storage key reordering preserves exact test authorization on resume',async()=>{
 const f=fixture(),slot=Object.fromEntries(Object.entries(PAYMENT_TEST_SLOT).sort(([a],[b])=>a.localeCompare(b)));
 assert.notEqual(JSON.stringify(slot),JSON.stringify(PAYMENT_TEST_SLOT));
 assert.equal(checkoutKey(slot,true),f.record.key);
 const resumed=JSON.parse(JSON.stringify({...f.record,slot,phase:'checkout-opening'}));
 assert.equal((await payCheckout(resumed,f.deps)).status,'confirmed');assert.equal(f.submits,1);
 for(const [key,value] of Object.entries(PAYMENT_TEST_SLOT)) {
  const changed={...slot,[key]:typeof value==='number'?value+1:value+'x'};
  assert.throws(()=>checkoutKey(changed,true),/Unauthorized payment test/);
  const missing={...slot};delete missing[key];assert.throws(()=>checkoutKey(missing,true),/Unauthorized payment test/);
 }
 assert.throws(()=>checkoutKey({...slot,extra:true},true),/Unauthorized payment test/);
 assert.throws(()=>checkoutKey({...slot,court:'2'},true),/Unauthorized payment test/);
});
test('saved payment submits once after durable journal and confirms',async()=>{const f=fixture();const result=await payCheckout(f.record,f.deps);assert.equal(result.status,'confirmed');assert.equal(f.submits,1);assert.equal(f.links,0);});

test('legacy possible card fill remains protected through repeated failed readiness and resume',async()=>{
 const f=fixture();let fills=0;
 f.deps.fillCard=async()=>{fills++;};f.deps.waitCardReady=async()=>{throw Error('Card still unready');};
 await assert.rejects(payCheckout({...f.record,reference:'100001',phase:'card-filling'},f.deps),/Card still unready/);
 await assert.rejects(payCheckout(f.record,f.deps),/Card still unready/);
 assert.equal(fills,0);assert.equal(f.submits,0);assert.equal(f.record.cardFillDispatchedAt,undefined);
 f.deps.waitCardReady=async()=>f.page;
 assert.equal((await payCheckout(f.record,f.deps)).status,'confirmed');assert.equal(fills,0);assert.equal(f.submits,1);
});
test('unlocked local card uses card form instead of Link authentication',async()=>{const f=fixture();f.page.enabled=false;let fills=0;f.deps.fillCard=async()=>{assert.equal(f.record.phase,'card-filling');fills++;};f.deps.waitCardReady=async()=>({...f.page,enabled:true});assert.equal((await payCheckout(f.record,f.deps)).status,'confirmed');assert.equal(fills,1);assert.equal(f.links,0);assert.equal(f.submits,1);});
test('amount or reference changes never submit',async()=>{const f=fixture();f.page.totalGBP='7.00';await assert.rejects(payCheckout(f.record,f.deps),/amount/);assert.equal(f.submits,0);});
test('reload renews an unpaid reference only after exact basket verification',async()=>{
 const f=fixture();let verified=0;f.deps.verifyBasket=async()=>verified++;
 const result=await payCheckout({...f.record,reference:'100002',phase:'checkout-opening'},f.deps);
 assert.equal(verified,1);assert.equal(result.reference,'100001');assert.equal(f.record.priorReferences[0].reference,'100002');assert.ok(f.record.paymentDispatchedAt);assert.equal(f.submits,1);
 const g=fixture();g.deps.verifyBasket=async()=>{throw Error('Basket date/time/court/venue mismatch');};await assert.rejects(payCheckout({...g.record,reference:'100002'},g.deps),/Basket/);assert.equal(g.submits,0);
});
test('submission marker survives phase changes and blocks reference renewal and repeat charges',async()=>{
 const f=fixture();f.deps.receipt=async()=>({status:'confirmed',key:f.record.key,reference:'100002'});f.deps.verifyBasket=async()=>{throw Error('Must not touch basket');};
 const record={...f.record,reference:'100002',phase:'checkout-opening',paymentDispatchedAt:'2026-10-13T00:00:00Z'};
 assert.equal((await payCheckout(record,f.deps)).reference,'100002');assert.equal(f.submits,0);assert.equal(f.links,0);
 f.deps.receipt=async()=>({status:'confirmed',key:f.record.key,reference:'100001'});await assert.rejects(payCheckout(record,f.deps),/reference differs/);assert.equal(f.submits,0);
 await assert.rejects(payCheckout({...f.record,phase:'unknown'},f.deps),/Unknown checkout phase/);
});
test('authentication stops before payment and can resume after secure login',async()=>{const f=fixture();f.page.enabled=false;f.deps.waitReady=async()=>({...f.page,authenticationRequired:true});const result=await payCheckout(f.record,f.deps);assert.equal(result.status,'authentication-required');assert.equal(f.submits,0);f.page.enabled=true;await payCheckout(f.record,f.deps);assert.equal(f.submits,1);});
test('lost submit response and missing receipt never replay payment',async()=>{const f=fixture();f.deps.submit=async()=>{assert.equal(f.record.phase,'payment-dispatched');throw Error('disconnected');};f.deps.receipt=async()=>{throw Error('no receipt');};await assert.rejects(payCheckout(f.record,f.deps),/no repeat charge/);assert.equal(f.record.phase,'payment-uncertain');let repeated=0;f.deps.submit=async()=>repeated++;await assert.rejects(payCheckout(f.record,f.deps),/no receipt/);assert.equal(repeated,0);});
test('different receipt reference leaves submitted payment unresolved',async()=>{const f=fixture();f.deps.receipt=async()=>({status:'confirmed',key:f.record.key,reference:'999'});await assert.rejects(payCheckout(f.record,f.deps),/reference differs/);assert.equal(f.record.phase,'payment-uncertain');assert.equal(f.submits,1);});
test('live submit handler validates amount, reference and enabled button without card inputs',()=>{
 let listener,clicks=0;const button={textContent:'Pay £2.50',disabled:false,click:()=>clicks++};
 const context={location:{pathname:'/basket/pay/card'},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}},document:{body:{innerText:'We have received your provisional booking (ref: 100001), it will be confirmed once we receive payment.'},querySelectorAll:q=>{assert.equal(q,'iframe');return [];},querySelector:q=>{assert.equal(q,'button#submit');return button;}}};
 vm.runInNewContext(fs.readFileSync(new URL('./payment-content.js',import.meta.url),'utf8'),context);
 const send=(totalGBP,reference,id='own')=>{let result;listener({kind:'payment-submit',totalGBP,reference},{id},r=>result=r);return result;};
 assert.equal(send('7.00','100001').ok,false);assert.equal(send('2.50','999').ok,false);button.disabled=true;assert.equal(send('2.50','100001').ok,false);button.disabled=false;assert.equal(send('2.50','100001','other'),undefined);assert.equal(clicks,0);assert.equal(send('2.50','100001').ok,true);assert.equal(clicks,1);
});
