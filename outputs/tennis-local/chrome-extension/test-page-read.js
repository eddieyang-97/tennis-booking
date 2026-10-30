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
test('discount observation survives an unclassified loading message failure on the same tab',async()=>{
 const f=fixture('basket-read');let calls=0;f.tabs.create=f.tabs.update=f.tabs.remove=async()=>assert.fail('Observation must not navigate or remove');
 f.tabs.sendMessage=async(id,request)=>{assert.equal(id,42);assert.equal(request.kind,'basket-read');if(++calls===1)throw Error('Unknown Chrome failure containing PRIVATE');return {ok:true,value:{empty:false}};};
 const result=await readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true,timeoutMs:2000});
 assert.equal(result.ok,true);assert.equal(calls,2);assert.equal(f.clock,500);assert.ok(f.steps.some(s=>s.name==='page-message-read-retry'&&s.reason==='unclassified-tab-error'));
 assert.equal(JSON.stringify(f.steps).includes('PRIVATE'),false);
});
test('persistent unclassified discount reads exhaust the original budget with safe retry evidence',async()=>{
 const f=fixture('basket-read');let calls=0;f.tabs.sendMessage=async()=>{calls++;throw Error('PRIVATE merchant token');};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true,timeoutMs:1500}),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT'&&e.diagnostic.readState==='unclassified-tab-error'&&e.diagnostic.elapsedMs===1500&&e.diagnostic.remainingMs===0&&e.diagnostic.messageReadRetries===3);
 assert.equal(calls,3);assert.equal(f.created,0);assert.deepEqual(f.removed,[]);assert.equal(JSON.stringify(f.steps).includes('PRIVATE'),false);
});
test('loading error recovery is opt-in and stops on complete, closed, denied or invalidated contexts',async()=>{
 for(const [message,status,enabled] of [['Unknown PRIVATE','loading',false],['Unknown PRIVATE','complete',true],['No tab with id: 42.','loading',true],['Cannot access PRIVATE','loading',true],['Extension context invalidated.','loading',true]]){
  const f=fixture('basket-read');let calls=0;f.tabs.get=async()=>({url:f.url,status});f.tabs.sendMessage=async()=>{calls++;throw Error(message);};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:enabled}),e=>e.diagnostic.errorCode==='PAGE_TAB_ERROR');assert.equal(calls,1);assert.equal(f.clock,0);
 }
 for(const kind of ['account','purchase-read','payment-submit','discount-apply']){
  const f=fixture(kind);await assert.rejects(readPageState(f.tabs,f.url,{kind},{...f.options,observeLoadingMessageErrors:true}));assert.equal(f.created,0);
 }
});
test('each post-error observation rechecks origin/authentication/route and never retries rejected DOM evidence',async()=>{
 for(const [url,code] of [['https://other.example/basket','PAGE_UNEXPECTED_ORIGIN'],['https://tennistowerhamlets.com/verify-human','PAGE_AUTHENTICATION_REQUIRED'],['https://tennistowerhamlets.com/basket/pay/card','PAGE_BASKET_ROUTE_CHANGED']]){
  const f=fixture('basket-read');let gets=0,calls=0;f.tabs.get=async()=>({url:++gets===1?f.url:url,status:'loading'});f.tabs.sendMessage=async()=>{calls++;throw Error('Unknown error');};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true}),e=>e.diagnostic.errorCode===code);assert.equal(calls,1);
 }
 const f=fixture('basket-read');let calls=0;f.tabs.sendMessage=async()=>{if(++calls===1)throw Error('Unknown error');return {ok:false,reasonCode:'BASKET_MISMATCH',error:'Invalid basket'};};
 const result=await readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true});assert.equal(result.reasonCode,'BASKET_MISMATCH');assert.equal(calls,2);
});
test('read logging failures are not retried as transport failures and late evidence cannot succeed',async()=>{
 const f=fixture('basket-read');let calls=0;f.tabs.sendMessage=async()=>{calls++;return {ok:true};};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true,step:async name=>{if(name==='page-read')throw Error('Unknown storage failure');}}),e=>e.diagnostic.operation==='read-diagnostics');assert.equal(calls,1);
 const g=fixture('basket-read');g.tabs.sendMessage=async()=>{await g.options.delay(2000);return {ok:true};};
 await assert.rejects(readPageState(g.tabs,g.url,{kind:'basket-read'},{...g.options,timeoutMs:1500}),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT'&&e.diagnostic.readState==='response-after-deadline');
});
for(const slow of ['initial-step','tab-state','successful-log','navigation'])test(`read budget includes awaited ${slow} and rejects evidence after expiry`,async()=>{
 const f=fixture('basket-read');let calls=0;const send=f.tabs.sendMessage;
 f.tabs.sendMessage=async(...args)=>{calls++;return send(...args);};
 if(slow==='initial-step'||slow==='successful-log')f.options.step=async name=>{if(name===(slow==='initial-step'?'existing-basket-read':'page-read'))await f.options.delay(1000);};
 if(slow==='tab-state'){const get=f.tabs.get;f.tabs.get=async(...args)=>{await f.options.delay(1000);return get(...args);};}
 if(slow==='navigation'){const create=f.tabs.create;f.tabs.create=async(...args)=>{await f.options.delay(1000);return create(...args);};}
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,timeoutMs:1000,...(slow==='navigation'?{}:{tabId:42,navigate:false})}),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT');
 assert.equal(calls,slow==='successful-log'?1:0);assert.equal(f.clock,1000);
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

function discountNavigationFixture(){
 const f=fixture('basket-read');f.options={...f.options,tabId:42,navigate:false,observeLoadingMessageErrors:true,observeDiscountNavigation:true,timeoutMs:3000};
 f.tabs.create=f.tabs.update=f.tabs.remove=async()=>assert.fail('Read-only observation cannot navigate or remove');
 f.tabs.sendMessage=async(id,request)=>request.kind==='page-observation'?{ok:true,value:{documentMatchesRequest:true,documentRoute:'discount-endpoint',pageType:'unknown',documentState:'loading'}}:{ok:true,value:{empty:false}};
 return f;
}
test('post-discount endpoint navigation returns to exact basket within original budget without any navigation',async()=>{
 const f=discountNavigationFixture();let gets=0,reads=0;
 f.tabs.get=async()=>({id:42,url:++gets<=2?f.url+'/discount?private=PRIVATE#100001':f.url,status:'loading',pendingUrl:f.url});
 const send=f.tabs.sendMessage;f.tabs.sendMessage=async(id,request)=>{if(request.kind==='basket-read')reads++;return send(id,request);};
 assert.equal((await readPageState(f.tabs,f.url,{kind:'basket-read'},f.options)).ok,true);assert.equal(reads,1);assert.equal(f.clock,1000);
 assert.ok(f.steps.some(s=>s.name==='discount-navigation-observed'&&s.destination==='discount-endpoint'));assert.equal(JSON.stringify(f.steps).includes('PRIVATE'),false);assert.equal(JSON.stringify(f.steps).includes('100001'),false);
});
test('post-discount merchant errors and unexpected destinations stop with safe route/page evidence',async()=>{
 for(const [path,destination,pageType,code] of [['/basket/discount','discount-endpoint','merchant-error','DISCOUNT_MERCHANT_ERROR'],['/system/error/PRIVATE','unrecognized','merchant-error','DISCOUNT_MERCHANT_ERROR'],['/basket/pay/card','card-checkout','card','PAGE_BASKET_ROUTE_CHANGED'],['/basket/receipt','receipt','confirmation','PAGE_BASKET_ROUTE_CHANGED'],['/unknown/PRIVATE','unrecognized','unknown','PAGE_BASKET_ROUTE_CHANGED']]){
  const f=discountNavigationFixture();let probes=0;f.tabs.get=async()=>({url:'https://tennistowerhamlets.com'+path+'?token=PRIVATE',status:'loading'});
  f.tabs.sendMessage=async(id,request)=>{assert.equal(request.kind,'page-observation');probes++;return {ok:true,value:{documentMatchesRequest:true,documentRoute:destination,pageType,documentState:'complete',raw:'PRIVATE',reference:'100001'}};};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode===code&&e.diagnostic.destination===destination&&e.diagnostic.pageType===pageType&&e.diagnostic.readState==='route-changed'&&!JSON.stringify(e).includes('PRIVATE')&&!JSON.stringify(e).includes('100001'));
  assert.equal(probes,1);assert.equal(f.clock,0);
 }
});
test('discount route waiting is opt-in, bounded, and unavailable on terminal/unsupported pages',async()=>{
 for(const [enabled,status,code,elapsed] of [[false,'loading','PAGE_BASKET_ROUTE_CHANGED',0],[true,'complete','PAGE_BASKET_ROUTE_CHANGED',0],[true,'loading','PAGE_READY_TIMEOUT',3000]]){
  const f=discountNavigationFixture();f.tabs.get=async()=>({url:f.url+'/discount',status});
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},{...f.options,observeDiscountNavigation:enabled}),e=>e.diagnostic.errorCode===code);assert.equal(f.clock,elapsed);
 }
});
test('stale document evidence cannot classify a changed route as a merchant error or authorize basket use',async()=>{
 const f=discountNavigationFixture();let gets=0,reads=0;
 f.tabs.get=async()=>({url:++gets<3?f.url+'/discount':f.url,status:'loading'});
 f.tabs.sendMessage=async(id,request)=>{if(request.kind==='page-observation')return {ok:true,value:{documentMatchesRequest:false,documentRoute:'basket',pageType:'merchant-error',documentState:'complete'}};reads++;return {ok:true,value:{empty:false}};};
 assert.equal((await readPageState(f.tabs,f.url,{kind:'basket-read'},f.options)).ok,true);assert.equal(reads,1);assert.equal(f.clock,1000);
 assert.ok(f.steps.some(s=>s.documentMatchesRoute===false));
});
test('discount basket response is discarded if the tab changes route while its read is in flight',async()=>{
 const f=discountNavigationFixture();let moved=false,reads=0;
 f.tabs.get=async()=>({url:moved?f.url+'/pay/card':f.url,status:'loading'});
 f.tabs.sendMessage=async(id,request)=>{if(request.kind==='page-observation')return {ok:true,value:{documentMatchesRequest:true,documentRoute:'card-checkout',pageType:'card',documentState:'complete'}};reads++;moved=true;return {ok:true,value:{discountApplied:true,totalGBP:'0.00'}};};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode==='PAGE_BASKET_ROUTE_CHANGED'&&e.diagnostic.destination==='card-checkout');assert.equal(reads,1);
});
test('read-only page probe returns only fixed categories, never page text, input values or references',()=>{
 let listener;const location={origin:'https://tennistowerhamlets.com',pathname:'/basket/discount'},document={readyState:'complete',querySelector:()=>({textContent:'Something went wrong!'}),body:{innerText:'PRIVATE 100001'}};
 vm.runInNewContext(fs.readFileSync(new URL('./payment-content.js',import.meta.url),'utf8'),{location,document,chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}}});
 const send=(id='own')=>{let response;listener({kind:'page-observation'},{id},r=>response=r);return response;};
 assert.equal(send('other'),undefined);const result=send();assert.equal(result?.value.pageType,'merchant-error');assert.equal(result.value.documentRoute,'discount-endpoint');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(JSON.stringify(result).includes('100001'),false);
 location.origin='https://untrusted.example';assert.equal(send().ok,false);
});

test('discount page observation stops for authentication, lost tabs and closed contexts without leaking details',async()=>{
 for(const [url,code] of [['https://tennistowerhamlets.com/verify-human?token=PRIVATE','PAGE_AUTHENTICATION_REQUIRED'],['https://other.example/PRIVATE','PAGE_UNEXPECTED_ORIGIN']]){
  const f=discountNavigationFixture();let probes=0;f.tabs.get=async()=>({url,status:'loading'});f.tabs.sendMessage=async()=>{probes++;};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode===code&&!JSON.stringify(e).includes('PRIVATE'));assert.equal(probes,0);
 }
 for(const message of ['No tab with id: 42','Cannot access contents PRIVATE','Extension context invalidated.']){
  const f=discountNavigationFixture();let probes=0;f.tabs.get=async()=>({url:f.url+'/discount',status:'loading'});f.tabs.sendMessage=async()=>{probes++;throw Error(message);};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode==='PAGE_TAB_ERROR'&&e.diagnostic.operation==='page-observation'&&!JSON.stringify(e).includes('PRIVATE'));assert.equal(probes,1);assert.equal(f.clock,0);
 }
});
test('discount probes and their diagnostics share the caller budget; storage failure is not a retry',async()=>{
 for(const slow of ['probe','diagnostics']){
  const f=discountNavigationFixture();f.tabs.get=async()=>({url:f.url+'/discount',status:'loading'});
  if(slow==='probe')f.tabs.sendMessage=async()=>{await f.options.delay(3000);return {ok:true,value:{documentRoute:'discount-endpoint',documentMatchesRequest:true,pageType:'unknown'}};};
  else f.options.step=async name=>{if(name==='discount-navigation-observed')await f.options.delay(3000);};
  await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode==='PAGE_READY_TIMEOUT'&&e.diagnostic.remainingMs===0);assert.equal(f.clock,3000);
 }
 const f=discountNavigationFixture();let probes=0;const send=f.tabs.sendMessage;f.tabs.sendMessage=async(...args)=>{probes++;return send(...args);};f.tabs.get=async()=>({url:f.url+'/discount',status:'loading'});f.options.step=async name=>{if(name==='discount-navigation-observed')throw Error('PRIVATE storage failure');};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.operation==='read-diagnostics'&&!JSON.stringify(e).includes('PRIVATE'));assert.equal(probes,1);assert.equal(f.clock,0);
});
test('a rejected basket with a merchant error heading becomes a discount outcome hold, never a basket success',async()=>{
 const f=discountNavigationFixture();f.tabs.sendMessage=async(id,request)=>request.kind==='basket-read'?{ok:false,error:'PRIVATE layout'}:{ok:true,value:{documentRoute:'basket',documentMatchesRequest:true,pageType:'merchant-error',documentState:'complete'}};
 await assert.rejects(readPageState(f.tabs,f.url,{kind:'basket-read'},f.options),e=>e.diagnostic.errorCode==='DISCOUNT_MERCHANT_ERROR'&&e.diagnostic.destination==='basket'&&!JSON.stringify(e).includes('PRIVATE'));
});
