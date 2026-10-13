import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const code=fs.readFileSync(new URL('./content.js',import.meta.url),'utf8');
function probe(path,heading='Welcome back, Test') {
 let handler,result; const context={chrome:{runtime:{id:'test',onMessage:{addListener:fn=>handler=fn}}},
 location:{pathname:path},document:{querySelector:()=>({textContent:heading})}};
 vm.runInNewContext(code,context);handler({kind:'account'},{id:'test'},r=>result=r);return result;
}
test('verification route stops without private URL or DOM disclosure',()=>{
 const result=probe('/verify-human');assert.equal(result.page,'verification');assert.equal(result.humanRequired,true);
 assert.equal(JSON.stringify(result).includes('Welcome'),false);
});
test('normal signed-in account succeeds and missing marker stops',()=>{
 assert.equal(probe('/account').signedIn,true);assert.equal(probe('/account','Sign in').humanRequired,true);
 assert.equal(probe('/account/login-help').error,'Unexpected account page');
});
test('handled stop clears owned dry-run lock and retains diagnostic tab',async()=>{
 const state={};let listener,updatedListener,alarmListener;const removed=[];let created=0, ready=false,checkoutEnabled=false,selections=0,currentBasket={empty:true,items:[]};const updated=[];
 globalThis.chrome={
 storage:{local:{get:async key=>key==='running'?{running:state.running}:state,set:async x=>Object.assign(state,x),remove:async key=>{delete state[key];}}},
 action:{setBadgeText:async()=>{},setTitle:async()=>{}},
 notifications:{create:async()=>{},onClicked:{addListener:()=>{}}},
 tabs:{create:async()=>{created++;return {id:42};},get:async()=>({id:42,status:'complete',url:'https://tennistowerhamlets.com/account'}),
 onUpdated:{addListener:f=>updatedListener=f,removeListener:()=>{updatedListener=undefined;}},
 update:async(id,options)=>{updated.push({id,...options});if(options.url){updatedListener?.(id,{status:'loading'});updatedListener?.(id,{status:'complete'});}return {id};},
 sendMessage:async(id,request)=>{
  if(!ready)return {ok:false,humanRequired:true,page:'verification',error:'Stopped on verification page'};
  if(request.kind==='grid')return {ok:true,rows:[{time:'8pm',inputs:checkoutEnabled?[{disabled:false,label:'Tennis court 2£7'}]:[]}]};
  if(request.kind==='basket-read')return {ok:true,value:currentBasket};
  if(request.kind==='select-slot'){selections++;const s=request.slot;currentBasket={empty:false,items:[{court:2,venue:'Bethnal Green Gardens',day:+s.date.slice(8),month:10,hour:20,priceGBP:'7.00'}],totalGBP:'7.00',paymentBoundary:true};return {ok:true,value:{selected:true}};}
  return {ok:true};
 },remove:async id=>removed.push(id)},
 alarms:{onAlarm:{addListener:f=>alarmListener=f}},
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listener=f},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}}
 };
 await import('./background.js');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
 // Fixed current date keeps this regression independent of test-day weekdays.
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-12T12:00:00Z');
 try {
 const invoke=(kind='check')=>new Promise(resolve=>listener({kind,day:'2026-10-13'},{id:'test',url:'chrome-extension://test/popup.html'},resolve));
 await invoke();assert.equal(state.running,undefined);assert.equal(state.result.page,'verification');assert.equal(state.result.retainedTabId,42);assert.deepEqual(removed,[]);
 state.running={day:'2026-10-13',started:1};await invoke();assert.equal(state.running.started,1);
 delete state.running;
 await invoke();const before=created;
 const stopped=await invoke('resume');assert.equal(stopped.status,'stopped');assert.equal(created,before);assert.equal(updated.length,0);
 ready=true;const resumed=await invoke('resume');assert.equal(resumed.status,'complete');assert.equal(created,before);assert.equal(updated.length,3);assert.ok(updated.every(x=>x.id===42));assert.deepEqual(removed,[]);
 assert.equal((await invoke('resume')).status,'stopped');assert.equal(created,before);
 // Existing saved alarms keep read-only behavior, even when slots are available.
 Date.now=()=>Date.parse('2026-10-12T23:00:00Z');checkoutEnabled=true;
 state.job={day:'2026-10-20',prepared:true};await alarmListener({name:'release'});assert.equal(selections,0);assert.equal(state.result.status,'complete');
 // Only the explicitly chosen checkout mode retains one verified basket.
 state.job={day:'2026-10-20',prepared:true,mode:'checkout'};await alarmListener({name:'release'});assert.equal(selections,1);assert.equal(state.checkoutResult.status,'awaiting-payment');assert.equal(state.checkoutResult.paid,false);assert.equal(state.checkoutRecords[0].phase,'awaiting-payment');assert.equal(state.job,undefined);
 }finally{Date.now=originalNow;delete globalThis.chrome;}
});
