import test from 'node:test';import assert from 'node:assert/strict';import {readiness} from './readiness.js';
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
