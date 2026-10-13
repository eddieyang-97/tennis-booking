import test from 'node:test';import assert from 'node:assert/strict';
import {releaseAt,candidates,eligible} from './core.js';
test('London midnight changes correctly across daylight saving',()=>{
 assert.equal(new Date(releaseAt('2026-10-19')).toISOString(),'2026-10-11T23:00:00.000Z');
 assert.equal(new Date(releaseAt('2026-11-02')).toISOString(),'2026-10-26T00:00:00.000Z');
});
test('same court continuity, duration preference, closed cells and padel exclusion',()=>{
 const rows=[{time:'8pm',inputs:[{label:'Tennis court 1£7',disabled:false},{label:'Padel court 1£24',disabled:false}]},
 {time:'9pm',inputs:[{label:'Tennis court 1£7',disabled:false},{label:'Tennis court 2£7',disabled:true}]}];
 const result=candidates(rows,'bethnal-green-gardens','2026-10-13');
 assert.equal(result.length,3);assert.equal(result[0].hours,2);assert.equal(result[0].totalGBP,'14.00');
 assert.deepEqual(candidates(rows,'unknown','2026-10-13'),[]);
});
test('no cross-court two-hour candidate, unknown prices stop',()=>{
 const rows=[{time:'8pm',inputs:[{label:'Court 1£7',disabled:false}]},{time:'9pm',inputs:[{label:'Court 2£7',disabled:false}]}];
 assert.ok(candidates(rows,'victoria-park','2026-10-13').every(x=>x.hours===1));
 assert.throws(()=>candidates([{time:'8pm',inputs:[{label:'Court 1free',disabled:false}]}],'victoria-park','2026-10-13'));
 assert.equal(eligible('2026-10-16'),false);assert.throws(()=>eligible('2026-02-30'));
});
