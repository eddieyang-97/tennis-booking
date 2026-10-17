import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
export async function testBundle(directory,origin){
 const files=JSON.parse(await fs.readFile(new URL('../../../runtime-files.json',root),'utf8'));
 await fs.mkdir(directory,{recursive:true});
 for(const file of files){let bytes=await fs.readFile(new URL(file,root));
  if(file.endsWith('.js')){let source=bytes.toString().replaceAll('https://tennistowerhamlets.com',origin).replaceAll('https://js.stripe.com',origin);
   if(file==='background.js'){
    // Headless Chrome does not expose its toolbar action as a Playwright page.
    // Permit the identical popup document in a tab in this isolated copy only;
    // keep the extension ID and popup URL checks. Production keeps sender.tab.
    if(!source.includes(' || sender.tab || '))throw Error('Popup sender guard changed; review browser test boundary');
    source="import './fake-clock.js';\n"+source.replace("from './card-vault-core.js'","from './fake-payment.js'").replace(' || sender.tab || ',' || ');
   }
   bytes=Buffer.from(source);
  }
  await fs.writeFile(path.join(directory,file),bytes);
 }
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
 manifest.name='LOCAL TEST ONLY — Tennis booking';manifest.host_permissions=[origin+'/*'];
 manifest.content_scripts[0].matches=[origin+'/*'];manifest.content_scripts[1].matches=[origin+'/v3/*'];manifest.content_scripts[1].js=['fake-frame.js'];
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 await fs.writeFile(path.join(directory,'fake-payment.js'),"export async function paymentCard(){return {testOnly:true};}\n");
 await fs.writeFile(path.join(directory,'fake-clock.js'),`const RealDate=Date,started=performance.now();globalThis.__testClock=Date.parse('2026-10-16T23:00:00Z');globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[Date.now()]));}static now(){return globalThis.__testClock+performance.now()-started;}};const add=chrome.alarms.onAlarm.addListener.bind(chrome.alarms.onAlarm);chrome.alarms.onAlarm.addListener=fn=>{globalThis.__testAlarm=fn;add(fn);};`);
 await fs.writeFile(path.join(directory,'fake-frame.js'),`if(location.pathname==='/v3/elements-inner-card-fake')chrome.runtime.onMessage.addListener((request,sender,respond)=>{if(sender.id!==chrome.runtime.id)return;if(request.kind==='link-discover'){chrome.runtime.sendMessage({kind:'link-frame'}).then(()=>respond({ok:true}));return true;}if(request.kind==='link-state'){respond({ok:true,value:{type:'card'}});return;}if(request.kind==='card-fill'){fetch('/__fill',{method:'POST'}).then(()=>{parent.postMessage('fake-card-ready',location.origin);respond({ok:true});});return true;}});`);
 return {directory,sourceRoot:fileURLToPath(root)};
}
