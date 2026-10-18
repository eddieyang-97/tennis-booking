import vm from 'node:vm';import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {webcrypto} from 'node:crypto';
const root=new URL('../',import.meta.url);
export async function startWorker(merchant,state={},version='simulation'){
 const worker={tabs:new Map(),nextTab:1,state,version};
 const local={get:async keys=>{const list=typeof keys==='string'?[keys]:keys||Object.keys(state);return structuredClone(Object.fromEntries(list.map(key=>[key,state[key]])));},set:async value=>{
  const before=(state.checkoutRecords||[]).find(r=>r.status==='pending'),after=value.checkoutRecords?.find(r=>r.status==='pending');
  let label;
  if(after){label=after.paymentDispatchedAt&&!before?.paymentDispatchedAt?'pay':after.cardFillDispatchedAt&&!before?.cardFillDispatchedAt?'fill':after.checkoutOpenDispatchedAt&&!before?.checkoutOpenDispatchedAt?'opening':after.discountDispatchedAt&&!before?.discountDispatchedAt?'discount':after.cleanupDispatched?.fingerprint!==before?.cleanupDispatched?.fingerprint?'removal':after.phase==='selection-dispatched'&&!before?'selection':null;}
  if(!label&&after?.basketVerifiedAt&&!before?.basketVerifiedAt)label='basket-verified';
  if(!label&&after?.discount&&!before?.discount)label='discount-verified';
  if(!label&&after?.reference&&!before?.reference)label='reference';
  if(!label&&value.checkoutRecords?.some(r=>r.status==='confirmed'&&!state.checkoutRecords?.some(old=>old.key===r.key&&old.status==='confirmed')))label='confirmation';
  if(!label&&value.abandonedCheckouts?.length>(state.abandonedCheckouts?.length||0))label='archive';
  if(label)merchant.boundary(`persist:${label}:before`);Object.assign(state,structuredClone(value));if(label)merchant.boundary(`persist:${label}:after`);
 },remove:async keys=>{for(const key of typeof keys==='string'?[keys]:keys)delete state[key];}};
 const chrome={storage:{local,session:{get:async()=>({localPaymentCard:{number:'4242424242424242',expiry:'12/30',cvc:'123',postcode:'TEST'}})}},runtime:{id:'test',getManifest:()=>({version}),getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>worker.listener=fn},onStartup:{addListener(){}},onInstalled:{addListener(){}}},alarms:{onAlarm:{addListener:fn=>worker.alarm=fn},create:async()=>{},clear:async()=>{}},notifications:{onClicked:{addListener(){}},create:async()=>{}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},tabs:{create:async({url})=>{const tab={id:worker.nextTab++,url,status:merchant.options.loading?'loading':'complete'};worker.tabs.set(tab.id,tab);return tab;},get:async id=>{
  const tab=worker.tabs.get(id);if(!tab)throw Error('No tab with id: '+id);
  if(merchant.readyAt!==undefined&&merchant.clock>=merchant.readyAt&&tab.url.includes('/basket'))tab.url='https://tennistowerhamlets.com/basket/pay/card';return {...tab};
 },update:async(id,changes)=>{const tab=worker.tabs.get(id);if(!tab)throw Error('No tab with id');Object.assign(tab,changes);return {...tab};},remove:async id=>worker.tabs.delete(id),query:async({url}={})=>[...worker.tabs.values()].filter(t=>!url||(url.endsWith('/*')?t.url.startsWith(url.slice(0,-1)):t.url===url)),sendMessage:async(id,request)=>{const tab=worker.tabs.get(id);if(!tab)throw Error('No tab with id');return merchant.message(tab,request,worker);}}};
 const RealDate=Date;class ClockDate extends RealDate{constructor(...args){super(...(args.length?args:[merchant.clock]));}static now(){return merchant.clock;}}
 const context=vm.createContext({chrome,console,URL,Intl,Date:ClockDate,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,atob,btoa,setTimeout:(fn,ms)=>setTimeout(()=>{merchant.clock+=ms;fn();},merchant.options.timerDelay?.(ms)??1),clearTimeout});
 const cache=new Map();
 async function moduleAt(url){if(!url.href.startsWith(root.href))throw Error('Harness import outside runtime');if(!cache.has(url.href))cache.set(url.href,new vm.SourceTextModule(await fs.readFile(fileURLToPath(url),'utf8'),{context,identifier:url.href}));return cache.get(url.href);}
 const entry=await moduleAt(new URL('background.js',root));await entry.link((specifier,parent)=>moduleAt(new URL(specifier,parent.identifier)));await entry.evaluate();
 worker.send=message=>new Promise(resolve=>worker.listener(message,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
 worker.chrome=chrome;worker.seedTab=(id=42,url='https://tennistowerhamlets.com/basket')=>{worker.tabs.set(id,{id,url,status:'complete'});worker.nextTab=Math.max(worker.nextTab,id+1);};return worker;
}
