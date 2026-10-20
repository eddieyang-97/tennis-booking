import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {verifyBasket} from './stage-rules.js';import {prepareCheckout,reconcileClearedSelection} from './checkout.js';
import {selectionEvidence,selectionFailure} from './selection-evidence.js';
import {failureFor} from './failures.js';
const source=fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8');
const slot={venue:'bethnal-green-gardens',date:'2026-10-22',court:4,start:'20:00',hours:2,totalGBP:'14.00'};
function site({neverAck=false,disableSecond=false,mixed=false,extra=false,timerStep=250,revert=false,resources=[],ackOnlyFirst=false,alertText=''}={}){
 let clock=0,timers=0,server=extra?[99]:[],pending=[],clicks=[],boxes,listener;
 const courts=mixed?[4,2]:[4,4];
 const rebuild=()=>{boxes?.forEach(b=>b.detached=true);boxes=courts.map((court,i)=>({checked:server.includes(i),disabled:disableSecond&&server.length>0&&i===1,labels:[{textContent:`Tennis court ${court}£7`}],click(){assert.equal(this.detached,undefined,'Never click a stale input');this.checked=true;clicks.push(i);pending.push({at:clock+750,items:[...server,i]});}}));};rebuild();
 const tick=ms=>{clock+=ms;if(revert)boxes.forEach(b=>b.checked=false);if(!neverAck)for(const update of pending.filter(p=>p.at<=clock&&(!ackOnlyFirst||p.items.length===1))){server=update.items;rebuild();}pending=pending.filter(p=>p.at>clock);};
 const book={textContent:'Thursday 22nd October 2026',querySelectorAll:()=>boxes.map((box,i)=>({querySelector:()=>({textContent:i?'9pm':'8pm'}),querySelectorAll:()=>[box]}))};
 const context={location:{origin:'https://tennistowerhamlets.com',pathname:'/book/courts/bethnal-green-gardens/2026-10-22'},document:{visibilityState:'hidden',readyState:'complete',querySelectorAll:()=>alertText?[{innerText:alertText,getClientRects:()=>[{}]}]:[],querySelector:q=>q==='#book'?book:{getAttribute:()=>String(server.length)}},performance:{now:()=>clock,getEntriesByType:()=>resources},URL,chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}}},Intl,Date,setTimeout:callback=>{timers++;tick(timerStep);queueMicrotask(callback);}};
 vm.runInNewContext(source,context);
 return {get boxes(){return boxes;},get server(){return server;},get clock(){return clock;},get timers(){return timers;},clicks,tick,run:()=>new Promise(resolve=>listener({kind:'select-slot',slot:{...slot,...(mixed?{courts}: {})}},{id:'own'},resolve))};
}
test('throttled polling uses elapsed time and never dispatches the second hour after the deadline',async()=>{
 const f=site({neverAck:true,timerStep:5000,revert:true}),response=await f.run();
 assert.equal(response.ok,false);assert.equal(response.reasonCode,'SELECTION_ACK_TIMEOUT');assert.deepEqual(f.clicks,[0]);assert.equal(f.clock,15000);assert.equal(f.timers,3);
 assert.equal(response.selectionDiagnostic.elapsedMs,15000);assert.equal(response.selectionDiagnostic.timeoutMs,15000);assert.equal(response.selectionDiagnostic.checkboxReverted,true);assert.equal(response.selectionDiagnostic.visibilityState,'hidden');
 assert.equal(response.selectionDiagnostic.merchantOutcome,'unknown');
 const paused=site({timerStep:20000}),late=await paused.run();assert.equal(late.reasonCode,'SELECTION_ACK_TIMEOUT');assert.deepEqual(paused.clicks,[0]);assert.equal(paused.timers,1);assert.equal(late.selectionDiagnostic.elapsedMs,20000);
 const partial=site({ackOnlyFirst:true}),stopped=await partial.run();assert.equal(stopped.selectionDiagnostic.acknowledgedHours,1);assert.deepEqual(partial.clicks,[0,1]);assert.equal(partial.clock,15000,'both hours share one elapsed-time budget');
});
test('selection evidence is a closed sanitized schema and failure text is never copied from a response',()=>{
 const supplied={expectedHours:2,dispatchedHours:1,acknowledgedHours:0,elapsedMs:15000,timeoutMs:15000,merchantOutcome:'rejected',responseBody:'PRIVATE',token:'PRIVATE',hourlyDispatches:[{court:1,hour:20,at:'PRIVATE',offsetMs:0}],network:{correlation:'same-origin-window-only',observedRequests:2,responses:[{status:409,completed:true,body:'PRIVATE',url:'PRIVATE'},{status:'PRIVATE'}]},checkedHours:[{hour:20,court:1,checked:false,disabled:false,password:'PRIVATE'}]};
 const value=selectionEvidence(supplied);assert.equal(JSON.stringify(value).includes('PRIVATE'),false);assert.equal(value.merchantOutcome,'unknown');assert.equal(value.network.responses[0].status,409);assert.equal(value.network.responses[1].status,null);
 const failure=selectionFailure({reasonCode:'SELECTION_ACK_TIMEOUT',error:'PRIVATE'});assert.equal(failureFor(failure).reasonCode,'SELECTION_ACK_TIMEOUT');assert.equal(failureFor(failure).recovery.mode,'read-only-observation');assert.equal(failureFor(failure,{paymentPossible:true}).recovery.mode,'payment-reconciliation');
 assert.equal(selectionFailure({reasonCode:'made-up',error:'PRIVATE'}).reasonCode,'SELECTION_RESPONSE_UNCERTAIN');assert.equal(JSON.stringify(failure).includes('PRIVATE'),false);
});
test('passive resource evidence contains only bounded statuses/timing, never bodies, URLs or rejection authority',async()=>{
 const resource=(name,responseStatus,startTime=1)=>({name,responseStatus,startTime,initiatorType:'fetch',responseEnd:5});
 const resources=[resource('https://tennistowerhamlets.com/private?token=PRIVATE',409),resource('https://js.stripe.com/private',500),resource('https://tennistowerhamlets.com/old',403,-1),resource('https://tennistowerhamlets.com/loading',0),...Array.from({length:20},()=>resource('https://tennistowerhamlets.com/anything',200))];
 const response=await site({neverAck:true,revert:true,resources,alertText:'Session expired: PRIVATE merchant token'}).run(),evidence=response.selectionDiagnostic;
 assert.equal(evidence.network.correlation,'same-origin-window-only');assert.equal(evidence.network.observedRequests,22);assert.equal(evidence.network.responses.length,8);assert.equal(evidence.network.responses[0].status,409);assert.equal(evidence.network.responses[1].status,null);assert.equal(evidence.merchantOutcome,'unknown');
 for(const secret of ['PRIVATE','stripe','private','anything'])assert.equal(JSON.stringify(response).includes(secret),false);
 assert.equal(evidence.visibleAlertCategory,'session');
});
test('serialized hourly selection prevents lost server updates and resolves replacement DOM nodes',async()=>{
 const race=site();race.boxes[0].click();race.boxes[1].click();race.tick(750);assert.equal(race.server.length,1,'Concurrent writes based on an empty basket overwrite one hour');
 for(const mixed of [false,true]){const f=site({mixed});const response=await f.run();assert.equal(response.ok,true);assert.deepEqual(f.server,[0,1]);assert.deepEqual(f.clicks,[0,1]);assert.equal(response.value.selectionDiagnostic.acknowledgedHours,2);}
});
test('missing first acknowledgement, second-hour loss and existing basket never trigger repeat clicks',async()=>{
 const missing=site({neverAck:true});const response=await missing.run();assert.equal(response.ok,false);assert.deepEqual(missing.clicks,[0]);assert.equal(response.selectionDiagnostic.dispatchedHours,1);assert.equal(response.selectionDiagnostic.acknowledgedHours,0);
 const changed=site({disableSecond:true});assert.equal((await changed.run()).ok,false);assert.deepEqual(changed.clicks,[0]);assert.deepEqual(changed.server,[0]);
 const unrelated=site({extra:true});assert.equal((await unrelated.run()).ok,false);assert.deepEqual(unrelated.clicks,[]);
});
test('partial basket diagnostics are exact and a failed journal stays protected with recovery evidence',async()=>{
 const partial={empty:false,items:[{venue:'Bethnal Green Gardens',court:4,day:22,month:10,hour:21,priceGBP:'7.00'}],totalGBP:'7.00',paymentBoundary:true};
 let error;try{verifyBasket(partial,slot);}catch(e){error=e;}assert.match(error.message,/expected 2, observed 1/);assert.equal(error.basketDiagnostic.actualSlots[0].hour,21);
 const now=Date.now;Date.now=()=>Date.parse('2026-10-15T00:00:00Z');let records=[],reads=0,clicks=0;
 try{await assert.rejects(prepareCheckout(slot,{tabId:42,load:async()=>records,save:async r=>records=r,read:async()=>++reads===1?{empty:true,items:[]}:partial,select:async()=>{clicks++;throw Object.assign(Error('Selection acknowledgement uncertain'),{selectionDiagnostic:{dispatchedHours:1,acknowledgedHours:0}});}}),/expected 2, observed 1/);assert.equal(clicks,1);assert.equal(records[0].phase,'selection-dispatched');assert.equal(records[0].tabId,42);assert.equal(records[0].recoveryRequired,true);assert.equal(records[0].basketDiagnostic.actualItems,1);}finally{Date.now=now;}
});
test('cleared-selection recovery archives only an unsubmitted intent and never erases a payment journal',()=>{
 const pending={key:JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]),slot,status:'pending',phase:'selection-dispatched'},paid={key:'other',status:'confirmed',paymentDispatchedAt:'2026-10-13T00:00:00Z'};
 const empty={empty:true,items:[]};const result=reconcileClearedSelection([paid,pending],empty);assert.deepEqual(result.checkoutRecords,[paid]);assert.equal(result.abandoned.status,'abandoned');
 assert.throws(()=>reconcileClearedSelection([pending],{empty:false,items:[{}]}),/partial selection/);
 assert.equal(reconcileClearedSelection([{...pending,phase:'awaiting-payment'}],empty).abandoned.status,'abandoned');
 for(const changed of [{paymentDispatchedAt:'2026-10-15T00:00:00Z'},{reference:'100001'},{phase:'payment-uncertain'},{phase:'checkout-opening'}])assert.throws(()=>reconcileClearedSelection([{...pending,...changed}],empty),/unsubmitted selection/);
});
test('basket read waits for DOM stability rather than accepting the first incomplete item list',async()=>{
 let count=1,reads=0;const context={document:{readyState:'interactive'},chrome:{runtime:{id:'own',onMessage:{addListener(){}}}},setTimeout:callback=>{count=2;queueMicrotask(callback);}};vm.createContext(context);vm.runInContext(source,context);context.basketSummary=()=>{reads++;return {empty:false,items:Array(count).fill({}),totalGBP:count===1?'7.00':'14.00'};};
 assert.equal((await context.stableBasketSummary()).items.length,2);assert.equal(reads,4);context.document.readyState='loading';assert.equal((await context.stableBasketSummary()).notReady,true);
});
