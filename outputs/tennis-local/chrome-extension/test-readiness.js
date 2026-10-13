import test from 'node:test';import assert from 'node:assert/strict';import {readiness} from './readiness.js';
import vm from 'node:vm';import fs from 'node:fs';import {addDays} from './core.js';
const now=Date.parse('2026-10-13T00:00:00Z'),when=Date.parse('2026-10-13T23:00:00Z');
const status={version:'0.5.0',localCardUnlocked:true,checkoutRecords:[],job:{day:'2026-10-21',when,mode:'payment',prepared:true}};
test('readiness requires unlocked card, future payment job, successful preflight and no pending journal',()=>{
 assert.equal(readiness(status,now).ready,true);
 for(const changes of [{localCardUnlocked:false},{job:null},{job:{...status.job,prepared:false}},{job:{...status.job,mode:'availability'}},{job:{...status.job,when:now}},{checkoutRecords:[{status:'pending',paymentDispatchedAt:'2026-10-13T00:00:00Z'}]}])assert.equal(readiness({...status,...changes},now).ready,false);
 assert.equal(readiness({...status,checkoutRecords:[{status:'confirmed'}]},now).ready,true);
});
test('release display uses London time, and uncertainty is shown as recovery rather than payment readiness',()=>{
 const output=readiness({...status,checkoutRecords:[{status:'pending',phase:'payment-uncertain'}]},now);
 assert.ok(output.lines.some(line=>line.includes('14 Oct 2026, 00:00 London')));assert.ok(output.lines.some(line=>line.includes('verify paid receipt')));assert.equal(output.ready,false);
});
test('popup preserves eight-day default and removed paid test, then refreshes readiness without losing action results',async()=>{
 const html=fs.readFileSync(new URL('./popup.html',import.meta.url),'utf8'),source=fs.readFileSync(new URL('./popup.js',import.meta.url),'utf8');
 const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{textContent:'',value:'',children:[],addEventListener(){},replaceChildren(...children){this.children=children;}}]));
 assert.equal(elements.payTest,undefined);let state=structuredClone(status);const calls=[];
 const context={londonDay:()=> '2026-10-13',addDays,readiness:s=>readiness(s,now),document:{querySelector:q=>{assert.ok(elements[q.slice(1)],`Missing popup element ${q}`);return elements[q.slice(1)];},createElement:()=>({textContent:''})},chrome:{runtime:{sendMessage:async message=>{calls.push(message.kind);if(message.kind==='status')return state;if(message.kind==='cancel')state={...state,job:null};return {status:message.kind==='cancel'?'cancelled':'armed'};}}}};
 vm.createContext(context);vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),context);
 await context.send('armPayment');assert.equal(elements.day.value,'2026-10-21');assert.equal(elements.readinessSummary.textContent,'Prepared for midnight (keep Chrome awake)');assert.match(elements.result.textContent,/"armed"/);
 await context.send('cancel');assert.equal(elements.readinessSummary.textContent,'Setup or preflight still needed');assert.ok(elements.readinessLines.children.some(e=>e.textContent==='No midnight run armed'));assert.match(elements.result.textContent,/"cancelled"/);assert.equal(calls.at(-1),'status');
});
