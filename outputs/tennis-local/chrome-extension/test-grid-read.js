import test from 'node:test';import assert from 'node:assert/strict';import {readGrid} from './grid-read.js';
const request={kind:'grid',venue:'victoria-park',day:'2026-10-21'},url='https://tennistowerhamlets.com/book/courts/victoria-park/2026-10-21#book';
function fixture(){let clock=0,created=0,reads=0;const removed=[],steps=[];const f={get created(){return created;},get reads(){return reads;},removed,steps,options:{timeoutMs:1000,now:()=>clock,delay:async ms=>clock+=ms,step:async(name,detail)=>steps.push({name,...detail})},tabs:{create:async()=>({id:++created}),get:async id=>({id,url,status:'loading'}),sendMessage:async()=>{reads++;return {ok:true,rows:[{time:'8pm',inputs:[]}]};},remove:async id=>removed.push(id),update:async id=>({id})}};return f;}
test('ready DOM is read while tab load remains pending; empty availability is not retried',async()=>{
 const f=fixture();const output=await readGrid(f.tabs,url,request,f.options);assert.equal(output.ok,true);assert.equal(output.rows[0].inputs.length,0);assert.equal(f.created,1);assert.equal(f.reads,1);assert.deepEqual(f.removed,[1]);assert.ok(f.steps.some(s=>s.name==='grid-read-ready'&&s.loadState==='loading'));
});
test('delayed content-script receiver is probed without navigation or mutation replay',async()=>{
 const f=fixture();let probes=0;f.tabs.sendMessage=async(_,message)=>{assert.equal(message.kind,'grid');if(++probes===1)throw Error('Receiving end does not exist');return {ok:true,rows:[]};};
 assert.equal((await readGrid(f.tabs,url,request,f.options)).ok,true);assert.equal(probes,2);assert.equal(f.created,1);
});
test('one timed-out navigation gets one fresh attempt; final diagnostic tab is retained',async()=>{
 const f=fixture();f.tabs.sendMessage=async()=>{throw Error('Receiving end does not exist');};
 let error;try{await readGrid(f.tabs,url,request,f.options);}catch(e){error=e;}
 assert.equal(f.created,2);assert.deepEqual(f.removed,[1]);assert.equal(error.diagnostic.errorCode,'GRID_READY_TIMEOUT');assert.equal(error.diagnostic.retainedTabId,2);assert.equal(error.diagnostic.readState,'receiver-unavailable');assert.match(error.message,/availability is unknown/);
 assert.ok(!JSON.stringify(error.diagnostic).includes('https://'));assert.ok(f.steps.some(s=>s.name==='grid-navigation-retry'));
});
test('fresh navigation can recover, and a reused tab retries in place',async()=>{
 const f=fixture();f.tabs.sendMessage=async id=>{if(id===1)throw Error('Receiving end does not exist');return {ok:true,rows:[]};};assert.equal((await readGrid(f.tabs,url,request,f.options)).ok,true);assert.equal(f.created,2);assert.deepEqual(f.removed,[1,2]);
 const reused=fixture();let navigations=0;reused.tabs.update=async id=>{navigations++;return {id};};reused.tabs.sendMessage=async()=>{if(navigations===1)throw Error('Receiving end does not exist');return {ok:true,rows:[]};};assert.equal((await readGrid(reused.tabs,url,request,{...reused.options,tabId:42})).ok,true);assert.equal(navigations,2);assert.equal(reused.created,0);assert.deepEqual(reused.removed,[]);
});
test('authentication, closed tab and rejected grid layout stop without retries or private page reads',async()=>{
 for(const scenario of ['authentication','closed','layout','origin']){
  const f=fixture();let reads=0;f.tabs.sendMessage=async()=>{reads++;return {ok:false,error:'Visible playing date mismatch'};};
  if(scenario==='authentication')f.tabs.get=async()=>({status:'complete',url:'https://tennistowerhamlets.com/verify-human?private=SECRET'});
  if(scenario==='closed')f.tabs.get=async()=>{throw Error('No tab with id 42');};
  if(scenario==='origin')f.tabs.get=async()=>({status:'complete',url:'https://private.example/account?secret=SECRET'});
  let error;try{await readGrid(f.tabs,url,request,f.options);}catch(e){error=e;}
  assert.equal(f.created,1);assert.deepEqual(f.removed,[]);assert.equal(reads,scenario==='layout'?1:0);assert.equal(JSON.stringify(error.diagnostic).includes('SECRET'),false);
 }
});
test('hung grid response is bounded, and checkout/mutation requests cannot enter this reader',async()=>{
 const f=fixture();f.tabs.sendMessage=async()=>new Promise(()=>{});await assert.rejects(readGrid(f.tabs,url,request,{...f.options,attempts:1,messageTimeoutMs:1}),e=>e.diagnostic.errorCode==='GRID_READY_TIMEOUT'&&e.diagnostic.readState==='response-timeout');
 await assert.rejects(readGrid(f.tabs,url,{...request,kind:'select-slot'},f.options),/read-only/);assert.equal(f.created,1);
});
