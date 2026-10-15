import test from 'node:test';import assert from 'node:assert/strict';import {verifyBasket} from './stage-rules.js';
import {slotKey} from './core.js';
import vm from 'node:vm';import fs from 'node:fs';
import {navigateLoaded} from './navigation.js';
import {retryTab} from './retry.js';
import {startRun} from './run-log.js';

test('temporary read errors retry three times; closed tabs and uncertain navigation stop',async()=>{
 let calls=0;const delays=[];
 assert.equal(await retryTab(async()=>{calls++;if(calls<3)throw Error('Receiving end does not exist');return 'ready';},{delay:async ms=>delays.push(ms)}),'ready');
 assert.equal(calls,3);assert.deepEqual(delays,[250,500]);
 calls=0;await assert.rejects(retryTab(async()=>{calls++;throw Error('Receiving end does not exist');},{delay:async()=>{}}));assert.equal(calls,3);
 for(const options of [{},{navigation:true}]){
  calls=0;await assert.rejects(retryTab(async()=>{calls++;throw Error('No tab with id 42');},{...options,delay:async()=>{}}));assert.equal(calls,1);
 }
 calls=0;await assert.rejects(retryTab(async()=>{calls++;throw Error('Message port closed');},{navigation:true,delay:async()=>{}}));assert.equal(calls,1);
});

test('run steps persist timestamps and retain bounded history across runs',async()=>{
 let data={runHistory:[]};const storage={get:async()=>data,set:async x=>Object.assign(data,x)};
 for(let i=0;i<101;i++){const run=startRun(storage,'basket-test','2026-10-19',{version:'0.6.4'});await run.step('started');await run.step('basket-verified');await run.finish('complete');}
 assert.equal(data.runHistory.length,100);assert.equal(data.runHistory[0].version,'0.6.4');
 const latest=data.runHistory.at(-1);assert.equal(latest.status,'complete');assert.ok(Date.parse(latest.startedAt)<=Date.parse(latest.finishedAt));assert.equal(latest.steps.length,3);assert.ok(latest.steps.every(s=>Number.isFinite(Date.parse(s.at))));
});
const slot={venue:'victoria-park',date:'2026-10-19',court:2,start:'08:00',hours:1,totalGBP:'5.00'};
const basket={empty:false,items:[{court:2,venue:'Victoria Park',day:19,month:10,hour:8,priceGBP:'5.00'}],totalGBP:'5.00',paymentBoundary:true};

test('Victoria Park Court label is parsed with exact one-hour basket identity',()=>{
 const code=fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8');
 const context={chrome:{runtime:{onMessage:{addListener:()=>{}}}},location:{pathname:'/basket'},document:{
  body:{innerText:'Basket'},getElementById:()=>({innerText:'Court 2 Victoria Park 19th Oct | 8:00am–8:59am £5.00'}),
  querySelectorAll:q=>q==='a[href^="#item-"]'?[{getAttribute:()=> '#item-test'}]:q==='tr'?[{querySelector:()=>({textContent:'Total'}),innerText:'Total £5.00'}]:q==='button'?[{textContent:'Pay with card'}]:[]
 }};
 vm.runInNewContext(code,context);
 const parsed=JSON.parse(JSON.stringify(vm.runInNewContext('basketSummary()',context)));
 assert.deepEqual(parsed,basket);assert.equal(verifyBasket(parsed,slot),true);
});
test('two-hour verification requires adjacent same-court identities and exact total',()=>{
 const s={...slot,start:'20:00',hours:2,totalGBP:'14.00'};
 const b={...basket,items:[{...basket.items[0],hour:20,priceGBP:'7.00'},{...basket.items[0],hour:21,priceGBP:'7.00'}],totalGBP:'14.00'};
 assert.equal(verifyBasket(b,s),true);
 for(const changed of [{...b,items:[b.items[0],{...b.items[1],court:3}]},{...b,totalGBP:'15.00'},{...b,items:[b.items[0],{...b.items[1],hour:22}]}])assert.throws(()=>verifyBasket(changed,s));
});
test('mixed basket verifies each hourly court, while keys distinguish court order and preserve legacy identity',()=>{
 const s={...slot,start:'20:00',hours:2,totalGBP:'14.00',courts:[2,3]};
 const b={...basket,items:[{...basket.items[0],hour:20,priceGBP:'7.00'},{...basket.items[0],hour:21,court:3,priceGBP:'7.00'}],totalGBP:'14.00'};
 assert.equal(verifyBasket(b,s),true);assert.throws(()=>verifyBasket({...b,items:[b.items[0],{...b.items[1],court:2}]},s),/mismatch/);
 assert.notEqual(slotKey(s),slotKey({...s,court:3,courts:[3,2]}));assert.equal(slotKey(slot),JSON.stringify([slot.venue,slot.date,slot.court,slot.start,slot.hours]));
 for(const courts of [[2],[2,5],[3,2]])assert.throws(()=>slotKey({...s,courts}),/hourly court/);
});
test('page selection rechecks all adjacent hours before first click; duplicate checked cell stops',async()=>{
 const code=fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8');let listener,clicks=0;
 const boxes=[{disabled:false,checked:false,labels:[{textContent:'Court 2£7'}],click(){clicks++;this.checked=true;}},
 {disabled:true,checked:false,labels:[{textContent:'Court 2£7'}],click(){clicks++;this.checked=true;}}];
 const rows=boxes.map((box,i)=>({querySelector:()=>({textContent:i===0?'8pm':'9pm'}),querySelectorAll:()=>[box]}));
 const book={textContent:'Monday 19th October 2026',querySelectorAll:()=>rows};
 const context={chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},location:{pathname:'/book/courts/victoria-park/2026-10-19'},document:{querySelector:q=>q==='#book'?book:{textContent:'',getAttribute:()=> String(boxes.filter(b=>b.checked).length)}},Intl,Date,setTimeout:callback=>queueMicrotask(callback)};
 vm.runInNewContext(code,context);
 const invoke=s=>new Promise(resolve=>listener({kind:'select-slot',slot:s},{id:'test'},resolve));
 let response=await invoke({...slot,start:'20:00',hours:2,totalGBP:'14.00'});assert.equal(response.ok,false);assert.match(response.error,/Slot unavailable/);assert.equal(clicks,0);
 boxes[1].disabled=false;response=await invoke({...slot,start:'20:00',hours:2,totalGBP:'14.00'});assert.equal(response.ok,true);assert.equal(clicks,2);
 response=await invoke({...slot,start:'20:00',hours:2,totalGBP:'14.00'});assert.equal(response.ok,false);assert.match(response.error,/Slot already selected/);assert.equal(clicks,2);
 boxes.forEach(b=>b.checked=false);boxes[1].labels[0].textContent='Court 3£7';response=await invoke({...slot,start:'20:00',hours:2,totalGBP:'14.00',courts:[2,3]});assert.equal(response.ok,true);assert.equal(clicks,4);
});

test('CSS data-items acknowledgement survives async badge replacement without replay',async()=>{
 const code=fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8');let listener,clicks=0,waits=0;
 let badge={textContent:'',getAttribute:()=>null};
 const box={disabled:false,checked:false,labels:[{textContent:'Court 2£5'}],click(){clicks++;this.checked=true;}};
 const row={querySelector:()=>({textContent:'8am'}),querySelectorAll:()=>[box]};
 const book={textContent:'Monday 19th October 2026',querySelectorAll:()=>[row]};
 vm.runInNewContext(code,{chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},location:{pathname:'/book/courts/victoria-park/2026-10-19'},document:{querySelector:q=>q==='#book'?book:badge},Intl,Date,setTimeout:callback=>{waits++;badge={textContent:'',getAttribute:()=> '1'};queueMicrotask(callback);}});
 const response=await new Promise(resolve=>listener({kind:'select-slot',slot},{id:'test'},resolve));
 assert.equal(response.ok,true);assert.equal(clicks,1);assert.equal(waits,3);
});

test('reused-tab navigation ignores old complete until a new loading/complete cycle',async()=>{
 let listener,removed=false,finished=false;
 const tabs={onUpdated:{addListener:f=>listener=f,removeListener:f=>{assert.equal(f,listener);removed=true;}},update:async()=>{listener(5,{status:'complete'});return {id:5,status:'complete'};},get:async()=>({id:5,status:'complete'})};
 const timers={setTimeout:()=>1,clearTimeout:()=>{}};
 const result=navigateLoaded(tabs,5,'https://tennistowerhamlets.com/basket',timers).then(x=>{finished=true;return x;});
 await Promise.resolve();await Promise.resolve();assert.equal(finished,false);
 listener(9,{status:'loading'});listener(5,{status:'complete'});assert.equal(finished,false);
 listener(5,{status:'loading'});listener(5,{status:'complete'});assert.equal((await result).id,5);assert.equal(removed,true);
});

test('live booked label is identified without a price and stops before any click',async()=>{
 const code=fs.readFileSync(new URL('./stage-content.js',import.meta.url),'utf8');let listener,clicks=0;
 const box={disabled:true,checked:false,labels:[{textContent:'Tennis court 4booked'}],click(){clicks++;}};
 const row={querySelector:()=>({textContent:'7am'}),querySelectorAll:()=>[box]};
 const book={textContent:'Sunday 18th October 2026',querySelectorAll:()=>[row]};
 vm.runInNewContext(code,{chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f}}},location:{pathname:'/book/courts/bethnal-green-gardens/2026-10-18'},document:{querySelector:()=>book},Intl,Date,setTimeout});
 const sundaySlot={venue:'bethnal-green-gardens',date:'2026-10-18',court:4,start:'07:00',hours:1,totalGBP:'7.00'};
 const response=await new Promise(resolve=>listener({kind:'select-slot',slot:sundaySlot},{id:'test'},resolve));
 assert.equal(response.ok,false);assert.equal(response.error,'Slot unavailable: court 4, 7am');assert.equal(clicks,0);
});
