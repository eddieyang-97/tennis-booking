import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {readPageState,pageReadBudget,waitPaymentState} from './page-read.js';
import {tabErrorReason} from './retry.js';
function fixture(kind='account'){
 let clock=0,created=0,reads=0;const url='https://tennistowerhamlets.com'+(kind==='basket-read'?'/basket':'/account'),removed=[],steps=[];
 return {url,get clock(){return clock;},get created(){return created;},get reads(){return reads;},removed,steps,options:{now:()=>clock,delay:async ms=>clock+=ms,step:async(name,detail)=>steps.push({name,...detail})},tabs:{create:async()=>({id:++created}),update:async id=>({id}),get:async id=>({id,url,status:'loading'}),sendMessage:async()=>{reads++;return {ok:true};},remove:async id=>removed.push(id)}};
}
test('account, basket and paid-history reads accept ready DOM before full page load',async()=>{
 for(const kind of ['account','basket-read','purchase-read']){const f=fixture(kind);assert.equal((await readPageState(f.tabs,f.url,{kind},f.options)).ok,true);assert.equal(f.created,1);assert.equal(f.reads,1);assert.deepEqual(f.removed,[1]);}
});
test('checkout basket read stays on its exact existing tab without create, navigation or removal',async()=>{
 const f=fixture('basket-read');let calls=0;
 f.tabs.create=f.tabs.update=f.tabs.remove=async()=>{throw Error('Must not change tabs');};
 f.tabs.get=async id=>{assert.equal(id,42);return {id,url:f.url,status:'loading'};};
 f.tabs.sendMessage=async(id,request)=>{assert.equal(id,42);assert.equal(request.kind,'basket-read');return ++calls===1?{notReady:true}:{ok:true,value:{empty:false,items:[{}]}};};
 assert.equal((await readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false})).ok,true);assert.equal(calls,2);
 for(const url of ['https://tennistowerhamlets.com/basket/pay/card','https://tennistowerhamlets.com/book/courts/bethnal-green-gardens/2026-10-23']){
  f.tabs.get=async()=>({url,status:'complete'});await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false}),e=>e.diagnostic.errorCode==='PAGE_BASKET_ROUTE_CHANGED');
 }
 assert.equal(calls,2);
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,navigate:false}),/require a basket tab/);
});
test('navigation-time channel and frame disconnections retry only the read on the same basket tab',async()=>{
 for(const message of ['A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received','The message port closed before a response was received','Frame with ID 0 was removed.']) {
  const f=fixture('basket-read');let calls=0;
  f.tabs.sendMessage=async()=>{if(++calls<3)throw Error(message);return {ok:true,value:{empty:true,items:[]}};};
  assert.equal((await readPageState(f.tabs,f.url,{kind:'basket-read'},f.options)).ok,true);
  assert.equal(calls,3);assert.equal(f.created,1);assert.equal(f.clock,1000);
 }
});
test('basket read errors report operation and safe reason, while closed or denied tabs stop immediately',async()=>{
 for(const [message,reason] of [['No tab with id: 42.','tab-closed'],['Cannot access contents of url https://example.com/?SECRET. Extension manifest must request permission','access-denied'],['Extension context invalidated.','extension-context-invalidated']]) {
  const f=fixture('basket-read');let calls=0;f.tabs.sendMessage=async()=>{calls++;throw Error(message);};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.operation==='message-read'&&e.diagnostic.reason===reason&&e.diagnostic.readState===reason&&!JSON.stringify(e).includes('SECRET'));
  assert.equal(calls,1);assert.deepEqual(f.removed,[]);
 }
 assert.equal(tabErrorReason(Error('Unexpected private URL https://secret.example')),'unclassified-tab-error');
});
test('persistent message disconnects are bounded by the read deadline',async()=>{
 const f=fixture('basket-read');let calls=0;f.tabs.sendMessage=async()=>{calls++;throw Error('The message channel closed before a response was received');};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,timeoutMs:1500}),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT'&&e.diagnostic.readState==='message-channel-closed');
 assert.equal(f.clock,1500);assert.equal(calls,3);assert.equal(f.created,1);assert.deepEqual(f.removed,[]);
});
test('scheduled account and basket reads survive 45-second readiness delay without a navigation retry',async()=>{
 for(const kind of ['account','basket-read'])for(const scheduled of [true,false]){
  const f=fixture(kind);f.tabs.sendMessage=async()=>f.clock<45000?{ok:false,notReady:true}:{ok:true};
  const read=readPageState(f.tabs,f.url,{kind},{...f.options,timeoutMs:pageReadBudget(scheduled)});
  if(scheduled){assert.equal((await read).ok,true);assert.equal(f.clock,45000);assert.deepEqual(f.removed,[1]);}
  else{await assert.rejects(read,e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT');assert.equal(f.clock,15000);assert.deepEqual(f.removed,[]);}
  assert.equal(f.created,1);
 }
});
test('read-only authentication and malformed pages retain diagnostics; mutation messages are rejected before navigation',async()=>{
 const f=fixture();f.tabs.get=async()=>({url:'https://tennistowerhamlets.com/sign-in?private=SECRET',status:'complete'});
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'account'},f.options),e=>e.diagnostic.errorCode==='PAGE_AUTHENTICATION_REQUIRED'&&!JSON.stringify(e.diagnostic).includes('SECRET'));assert.equal(f.reads,0);assert.deepEqual(f.removed,[]);
 const g=fixture('basket-read');g.tabs.sendMessage=async()=>({ok:false,error:'Unknown basket identity'});const response=await readPageState(g.tabs,g.url,{kind:'basket-read'},g.options);assert.equal(response.retainedTabId,1);assert.deepEqual(g.removed,[]);
 for(const kind of ['payment-submit','payment-open','card-fill','select-slot'])await assert.rejects(readPageState(g.tabs,g.url,{kind},g.options),/read-only/);assert.equal(g.created,1);
});
test('card readiness can wait 45 seconds but identity mismatches and closed tabs stop immediately',async()=>{
 const f=fixture();const state={reference:'100001',totalGBP:'7.00'};
 const ready=await waitPaymentState(async()=>({...state,enabled:f.clock>=45000}),{...f.options,timeoutMs:60000,accept:s=>s.enabled});assert.equal(ready.enabled,true);assert.equal(f.clock,45000);
 let calls=0;await assert.rejects(waitPaymentState(async()=>{calls++;return {...state,totalGBP:'8.00',enabled:false};},{...f.options,accept:s=>{if(s.totalGBP!=='7.00')throw Error('Identity mismatch');return s.enabled;}}),/Identity mismatch/);assert.equal(calls,1);
 await assert.rejects(waitPaymentState(async()=>{throw Error('No tab with id');},f.options),/No tab/);
});
test('hung read responses are bounded and leave payment untouched',async()=>{
 const f=fixture();f.tabs.sendMessage=async()=>new Promise(()=>{});
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'account'},{...f.options,timeoutMs:500,messageTimeoutMs:1}),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT'&&e.diagnostic.readState==='response-timeout');assert.deepEqual(f.removed,[]);assert.equal(f.created,1);
 await assert.rejects(waitPaymentState(()=>new Promise(()=>{}),{...f.options,timeoutMs:1}),/readiness timed out/);
});
test('missing checkout-read acknowledgements are observed within the deadline, without retrying mutations',async()=>{
 const f=fixture();let calls=0;
 const unavailable=()=>Object.assign(Error('Checkout read response unavailable'),{code:'CHECKOUT_READ_UNAVAILABLE'});
 const state=await waitPaymentState(async()=>{if(++calls<=2)throw unavailable();return {reference:'100001',totalGBP:'7.00',enabled:true};},f.options);
 assert.equal(state.reference,'100001');assert.equal(calls,3);assert.equal(f.clock,1000);
 const g=fixture();await assert.rejects(waitPaymentState(async()=>{throw unavailable();},{...g.options,timeoutMs:1500}),/readiness timed out/);assert.equal(g.clock,1500);
 // Generic/mutation response failures never acquire this read-only policy.
 await assert.rejects(waitPaymentState(async()=>{throw Error('Checkout response unavailable');},fixture().options),/Checkout response unavailable/);
});
test('blank account DOM while loading is not misclassified as missing login',()=>{
 let listener;const document={readyState:'interactive',querySelector:()=>null};vm.runInNewContext(fs.readFileSync(new URL('./content.js',import.meta.url),'utf8'),{document,location:{pathname:'/account'},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}}});
 const read=()=>{let response;listener({kind:'account'},{id:'own'},r=>response=r);return response;};assert.equal(read().notReady,true);document.readyState='complete';assert.equal(read().humanRequired,true);
});
