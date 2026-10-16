import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {DEFAULT_SETTINGS,normalizeSettings,gbpPence,pendingArmBlocker} from './booking-settings.js';import {candidates,addDays} from './core.js';import {checkoutKey,prepareCheckout,singleHourFallback} from './checkout.js';import {payCheckout} from './payment.js';import {recoveryIdentity} from './reconciliation.js';import {readiness,releasePreview} from './readiness.js';
import {diagnosticExport,diagnosticFilename} from './diagnostics.js';
const preferences=()=>normalizeSettings({venues:['victoria-park'],earliestStart:'09:00',latestFinish:'12:00',preferredHours:2,minHours:1,maxTotalGBP:'20.00',maxOneHourGBP:'10.00',allowCourtSwitch:true});
const slot={venue:'victoria-park',date:'2026-10-20',court:1,start:'09:00',hours:2,totalGBP:'18.00'};
const basket={empty:false,items:[9,10].map(hour=>({venue:'Victoria Park',court:1,day:20,month:10,hour,priceGBP:'9.00'})),totalGBP:'18.00',paymentBoundary:true};
async function fixed(fn){const now=Date.now;Date.now=()=>Date.parse('2026-10-13T12:00:00Z');try{return await fn();}finally{Date.now=now;}}
test('settings validate venues, ordered same-day times, supported durations and precise GBP limits',()=>{
 assert.equal(gbpPence('0.29'),29);assert.equal(normalizeSettings({...DEFAULT_SETTINGS,maxTotalGBP:'14.1'}).maxTotalGBP,'14.10');
 for(const bad of [{venues:[]},{venues:null},{venues:['victoria-park','victoria-park']},{venues:['unknown']},{earliestStart:'22:00',latestFinish:'09:00'},{earliestStart:'09:30'},{preferredHours:3},{preferredHours:1,minHours:2},{maxTotalGBP:'1e2'},{maxTotalGBP:'14.001'},{maxTotalGBP:'0'},{maxTotalGBP:'6.00'},{schemaVersion:2},{other:'value'},{allowCourtSwitch:'false'}])assert.throws(()=>normalizeSettings({...DEFAULT_SETTINGS,...bad}));
 assert.equal(normalizeSettings({...DEFAULT_SETTINGS,earliestStart:'23:00',latestFinish:'24:00',preferredHours:1,minHours:1}).latestFinish,'24:00');
 const original=preferences(),copy=normalizeSettings(original);original.venues.push('bethnal-green-gardens');assert.deepEqual(copy.venues,['victoria-park']);
});
test('availability obeys ordered venues, exact time window, minimum duration, court policy and caps',()=>{
 const rows=[8,9,10,11,12].map(hour=>({time:`${hour}am`,inputs:[{label:'Court 1£9'},{label:'Court 2£9'}]}));
 rows.at(-1).time='12pm';let s=preferences(),found=candidates(rows,'victoria-park',slot.date,{settings:s});
 assert.ok(found.length>0);assert.equal(found[0].start,'09:00');assert.equal(found[0].hours,2);assert.ok(found.every(candidate=>Number(candidate.start.slice(0,2))>=9&&Number(candidate.start.slice(0,2))+candidate.hours<=12));
 assert.deepEqual(candidates(rows,'bethnal-green-gardens',slot.date,{settings:s}),[]);
 found=candidates(rows,'victoria-park',slot.date,{settings:{...s,minHours:2,allowCourtSwitch:false}});assert.ok(found.length>0);assert.ok(found.every(candidate=>candidate.hours===2&&!candidate.courts));
 found=candidates(rows,'victoria-park',slot.date,{settings:{...s,maxTotalGBP:'10.00'}});assert.ok(found.length>0);assert.ok(found.every(candidate=>candidate.hours===1));
 assert.deepEqual(candidates(rows,'victoria-park',slot.date,{settings:{...s,maxTotalGBP:'8.00',maxOneHourGBP:'8.00'}}),[]);
});
test('custom settings reach checkout, fallback, payment and historical recovery without weakening legacy rules',()=>fixed(async()=>{
 const s=preferences();assert.doesNotThrow(()=>checkoutKey(slot,false,s));assert.throws(()=>checkoutKey(slot));
 const partial={...basket,items:[basket.items[1]],totalGBP:'9.00'};assert.equal(singleHourFallback(slot,partial,s).start,'10:00');
 assert.throws(()=>singleHourFallback(slot,partial,{...s,minHours:2}));assert.throws(()=>singleHourFallback(slot,partial,{...s,maxOneHourGBP:'8.00'}));
 let records=[],current={empty:true,items:[]},selections=0;
 const deps={load:async()=>structuredClone(records),save:async value=>records=structuredClone(value),read:async()=>current,select:async()=>{selections++;current=basket;},retain:async()=>42,notify:async()=>{}};
 await prepareCheckout(slot,deps,{settings:s});assert.equal(selections,1);assert.deepEqual(records[0].settings,s);
 const changed={...s,maxTotalGBP:'30.00',maxOneHourGBP:'20.00',earliestStart:'08:00'};await prepareCheckout(slot,deps,{settings:changed});assert.deepEqual(records[0].settings,s);assert.equal(selections,1);
 let record=records[0],submits=0;const payment={save:async value=>record=value,verifyBasket:async()=>{},open:async()=>{},state:async()=>({enabled:true,totalGBP:'18.00',reference:'123'}),submit:async amount=>{assert.equal(amount,'18.00');submits++;},receipt:async()=>({status:'confirmed',key:record.key,reference:'123'})};
 record=await payCheckout(record,payment);assert.equal(submits,1);
 const realNow=Date.now;Date.now=()=>Date.parse('2026-11-13T12:00:00Z');try{assert.doesNotThrow(()=>recoveryIdentity(record));}finally{Date.now=realNow;}
 await assert.rejects(payCheckout({...records[0],settings:{...s,maxTotalGBP:'17.00'}},payment),/payment limit/);assert.equal(submits,1);
 const legacy={venue:'bethnal-green-gardens',date:slot.date,court:1,start:'20:00',hours:1,totalGBP:'7.00'};
 records=[{key:checkoutKey(legacy),slot:legacy,status:'pending',phase:'selection-dispatched'}];current={...basket,items:[{venue:'Bethnal Green Gardens',court:1,day:20,month:10,hour:20,priceGBP:'7.00'}],totalGBP:'7.00'};
 await prepareCheckout(legacy,deps,{settings:s});assert.equal(records[0].settings,undefined);assert.equal(selections,1);
}));
test('readiness shows saved settings and London release, and never marks unresolved payment ready',()=>{
 const now=Date.parse('2026-10-13T12:00:00Z'),status={version:'0.8.0',localCardUnlocked:true,checkoutRecords:[],job:{day:'2026-10-21',when:Date.parse('2026-10-13T23:00:00Z'),mode:'payment',prepared:true,settings:preferences()}};
 assert.equal(readiness(status,now).ready,true);assert.match(readiness(status,now).lines.join('\n'),/14 Oct 2026, 00:00 London/);
 for(const patch of [{localCardUnlocked:false},{job:{...status.job,prepared:false}},{checkoutRecords:[{status:'pending',phase:'payment-uncertain'}]},{job:{...status.job,when:now}},{job:null}])assert.equal(readiness({...status,...patch},now).ready,false);
});
test('popup sends real settings, preserves edits across status refresh and exposes diagnostics separately',async()=>{
 const html=fs.readFileSync(new URL('./popup.html',import.meta.url),'utf8'),source=fs.readFileSync(new URL('./popup.js',import.meta.url),'utf8');
 const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{value:'',checked:false,textContent:'',listeners:{},append(){},addEventListener(event,fn){this.listeners[event]=fn;}}]));
 let state={localCardUnlocked:false,checkoutRecords:[],bookingSettings:preferences()},calls=[];
 const downloads=[],revoked=[];
 const context={normalizeSettings,DEFAULT_SETTINGS,diagnosticExport,diagnosticFilename,Blob,URL:{createObjectURL:blob=>{downloads.push({blob});return 'blob:test-log';},revokeObjectURL:url=>revoked.push(url)},setTimeout:fn=>fn(),londonDay:()=> '2026-10-13',addDays,readiness,releasePreview,document:{querySelector:q=>elements[q.slice(1)],querySelectorAll:()=>Object.values(elements),createElement:tag=>tag==='a'?{click(){Object.assign(downloads.at(-1),{href:this.href,filename:this.download});}}:{}},chrome:{runtime:{sendMessage:async message=>{calls.push(structuredClone(message));return message.kind==='status'?structuredClone(state):{status:'preferences-saved'};}}}};
 vm.createContext(context);vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),context);await context.refresh(true);
 assert.equal(elements.earliestStart.value,'09:00');assert.equal(elements.day.value,'2026-10-21');assert.equal(elements.result.textContent,'');
 state.checkoutRecords=[{status:'pending',checkoutTestOnly:true,phase:'awaiting-payment',discountCode:'TESTCODE'}];await context.refresh(true);assert.equal(elements.discountCode.value,'TESTCODE');
 elements.discountCode.value='EDITED';await context.refresh();assert.equal(elements.discountCode.value,'EDITED');
 state.checkoutRecords[0].discountCode='';await context.refresh(true);assert.equal(elements.discountCode.value,'');
 elements.earliestStart.value='08:00';elements.maxTotalGBP.value='22.00';await context.send('saveSettings');
 assert.equal(calls.at(-2).settings.earliestStart,'08:00');assert.equal(calls.at(-2).settings.maxTotalGBP,'22.00');assert.equal(elements.earliestStart.value,'08:00');assert.match(elements.result.textContent,/preferences-saved/);
 await context.refresh(false,true);assert.match(elements.result.textContent,/checkoutRecords/);
 await elements.downloadLog.listeners.click();assert.match(downloads[0].filename,/^tennis-booking-log-.*\.json$/);assert.equal(downloads[0].href,'blob:test-log');assert.equal(revoked[0],'blob:test-log');
 const exported=JSON.parse(await downloads[0].blob.text());assert.ok(exported.exportedAt);assert.equal(exported.format,'tennis-booking-diagnostics');assert.equal(exported.checkoutRecords[0].discountCode,'');assert.match(elements.result.textContent,/downloaded/);
 elements.latestFinish.value='07:00';const count=calls.length;await context.send('armPayment');assert.equal(calls.length,count);assert.match(elements.result.textContent,/Time range/);
});
test('diagnostic download preserves reference and trace evidence while excluding card data and codes',()=>{
 const status={version:'0.8.7',localCardUnlocked:true,localPaymentCard:{number:'4242424242424242'},session:{passphrase:'private'},job:{discountCode:'PRIVATE-CODE',day:'2026-10-22'},checkoutRecords:[{reference:'100001',phase:'test-cleanup-checking',slot:{court:1,date:'2026-10-22'},passphrase:'hidden',card:{number:'4242424242424242',cvc:'123'},discountCode:'PRIVATE-CODE'}],runHistory:[{steps:[{at:'2026-10-16T09:00:00Z',name:'cleanup-stopped',error:'Card 4242 4242 4242 4242 CXC-EXAMPLE'}]}]};
 const result=diagnosticExport(status,new Date('2026-10-16T09:00:00Z')),json=JSON.stringify(result);
 for(const secret of ['4242','PRIVATE-CODE','CXC-EXAMPLE','hidden','private','"cvc"'])assert.equal(json.includes(secret),false);
 assert.equal(result.checkoutRecords[0].reference,'100001');assert.equal(result.runHistory[0].steps[0].name,'cleanup-stopped');assert.equal(result.localCardUnlocked,true);assert.equal(status.job.discountCode,'PRIVATE-CODE');assert.equal(diagnosticFilename(result),'tennis-booking-log-2026-10-16T09-00-00-000Z.json');
 assert.throws(()=>diagnosticExport({status:'stopped',error:'Unavailable'}),/Unavailable/);
});
test('future-release guidance and prior-checkout blockers identify separate dates and recovery actions',()=>{
 const now=Date.parse('2026-10-13T12:00:00Z');assert.match(releasePreview('2026-10-21',now),/14 Oct 2026, 00:00 London/);assert.match(releasePreview('2026-10-20',now),/already released/);assert.match(releasePreview('invalid',now),/valid playing date/);
 const pending={status:'pending',phase:'checkout-opening',slot:{date:'2026-10-20',start:'20:00',hours:2}};
 assert.match(pendingArmBlocker([pending]),/2026-10-20.*20:00.*Verify manual payment/);assert.match(pendingArmBlocker([{...pending,manualPaymentReportedAt:'timestamp'}]),/Verify paid receipt/);assert.equal(pendingArmBlocker([{...pending,status:'confirmed'}]),'');
 assert.match(readiness({checkoutRecords:[pending]},now).summary,/earlier checkout/);
});
test('armed settings survive later preference edits and reach scheduled scanning and unpaid preparation',()=>fixed(async()=>{
 const state={checkoutRecords:[]},tabs=new Map(),visited=[],selected=[];let listener,alarm,nextTab=1,current={empty:true,items:[]};
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,structuredClone(value)),remove:async key=>delete state[key]},session:{get:async()=>({localPaymentCard:{number:'4111111111111111',cvc:'123',expiry:'12/30',postcode:'SW1A 1AA'}})}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},notifications:{create:async()=>{},onClicked:{addListener:()=>{}}},alarms:{clear:async()=>{},create:async()=>{},onAlarm:{addListener:fn=>alarm=fn}},runtime:{id:'test',getManifest:()=>({version:'0.8.0'}),getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>listener=fn},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},tabs:{create:async({url})=>{const tab={id:nextTab++,url,status:'complete'};tabs.set(tab.id,tab);return tab;},get:async id=>tabs.get(id),update:async(id,changes)=>{const tab=tabs.get(id);if(changes.url)tab.url=changes.url;return tab;},remove:async id=>tabs.delete(id),sendMessage:async(id,request)=>{
  if(request.kind==='account')return {ok:true};
  if(request.kind==='grid'){visited.push(request.venue);return {ok:true,rows:[9,10,11].map(hour=>({time:`${hour}am`,inputs:[{label:'Court 1£9'}]}))};}
  if(request.kind==='basket-read')return {ok:true,value:structuredClone(current)};
  if(request.kind==='select-slot'){selected.push(request.slot);current={...basket,items:basket.items.map(item=>({...item,day:Number(request.slot.date.slice(8))}))};return {ok:true,value:{selected:true}};}
  throw Error('No payment command allowed in this scheduled preparation test');
 }}};
 try{
  await import('./background.js');const send=message=>new Promise(resolve=>listener(message,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  const s=preferences(),armed=await send({kind:'armPayment',day:'2026-10-21',settings:s});assert.equal(armed.status,'armed');assert.deepEqual(state.job.settings,s);
  const saved=await send({kind:'saveSettings',settings:{...DEFAULT_SETTINGS,venues:['bethnal-green-gardens']}});assert.equal(saved.armedJobChanged,false);assert.deepEqual(state.job.settings,s);
  // Only prepare; this fixture deliberately stops short of automatic payment.
  state.job.mode='checkout';state.job.prepared=true;const release=state.job.when,previous=Date.now;Date.now=()=>release;
  try{await alarm({name:'release'});}finally{Date.now=previous;}
  assert.equal(state.checkoutResult.status,'awaiting-payment');assert.equal(state.job,undefined);assert.ok(visited.every(venue=>venue==='victoria-park'));assert.equal(selected.length,1);assert.equal(selected[0].start,'09:00');assert.equal(selected[0].totalGBP,'18.00');assert.deepEqual(state.checkoutRecords[0].settings,s);assert.equal(state.checkoutRecords[0].paymentDispatchedAt,undefined);
 }finally{delete globalThis.chrome;}
}));
