import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {encryptCard,decryptCard,validateCard,readCardFile,unlockCardSession,vaultErrorMessage,paymentCard} from './card-vault-core.js';
const dummy={number:'4242424242424242',expiry:'12/30',cvc:'123',postcode:'E1 1AA'};
test('encrypted local file round-trips without raw fields or passphrase',async()=>{const pass='dummy-test-passphrase';const file=await encryptCard(dummy,pass),serialized=JSON.stringify(file);for(const value of [...Object.values(dummy),pass])assert.equal(serialized.includes(value),false);assert.deepEqual(await decryptCard(file,pass),dummy);await assert.rejects(decryptCard(file,'wrong-test-passphrase'),e=>e.code==='authentication_failed');const changed={...file,ciphertext:(file.ciphertext[0]==='A'?'B':'A')+file.ciphertext.slice(1)};await assert.rejects(decryptCard(changed,pass),e=>e.code==='authentication_failed');assert.notEqual((await encryptCard(dummy,pass)).ciphertext,file.ciphertext);});
test('invalid card fields and short passphrase do not produce a file',async()=>{assert.throws(()=>validateCard({...dummy,number:'4242424242424241'}),/Check card number/);assert.throws(()=>validateCard({...dummy,cvc:'1'}),/Check card/);assert.throws(()=>validateCard({...dummy,expiry:'13/30'}),/Check card/);await assert.rejects(encryptCard(dummy,'short'),/passphrase/);});
test('file reading distinguishes missing, oversized and invalid JSON; accepts UTF-8 BOM',async()=>{
 await assert.rejects(readCardFile(null),e=>e.code==='no_file');
 await assert.rejects(readCardFile({size:9000,text:async()=>''}),e=>e.code==='file_size');
 await assert.rejects(readCardFile({size:8,text:async()=>'{broken'}),e=>e.code==='invalid_json');
 assert.deepEqual(await readCardFile({size:10,text:async()=>'\uFEFF{"ok":1}'}),{ok:1});
 await assert.rejects(decryptCard({format:'other'},'dummy-test-passphrase'),e=>e.code==='invalid_file');
});
test('decrypted card storage failures identify stale setup and never expose secrets',async()=>{
 const storage={session:{setAccessLevel:async()=>{},set:async()=>{throw Error('Extension context invalidated.');}}};
 await assert.rejects(unlockCardSession(storage,{id:'own'},dummy),e=>e.code==='context_invalidated');
 await assert.rejects(unlockCardSession(storage,{},dummy),e=>e.code==='context_invalidated');
 storage.session.set=async()=>{throw Error('Untrusted failure containing '+dummy.number);};
 await assert.rejects(unlockCardSession(storage,{id:'own'},dummy),e=>e.code==='session_storage'&&!e.message.includes(dummy.number));
 assert.equal(vaultErrorMessage(Error(dummy.number)).includes(dummy.number),false);
});
test('unlock verifies browser session write and paid runs require that exact local card',async()=>{
 let saved;const storage={session:{setAccessLevel:async()=>{},set:async data=>saved=data,get:async()=>saved||{}}};
 await assert.rejects(paymentCard(storage,{phase:'link-opening'}),e=>e.code==='card_locked');
 await unlockCardSession(storage,{id:'own'},dummy);assert.deepEqual(await paymentCard(storage,{phase:'link-opening'}),dummy);
 storage.session.get=async()=>({});await assert.rejects(unlockCardSession(storage,{id:'own'},dummy),e=>e.code==='session_storage');
 storage.session.get=async()=>{throw Error('Unavailable');};await assert.rejects(paymentCard(storage,{}),e=>e.code==='card_session_unavailable');
 for(const marker of [{phase:'payment-uncertain'},{phase:'payment-dispatched'},{phase:'checkout-opening',paymentDispatchedAt:'2026-10-13T00:00:00Z'}])assert.equal(await paymentCard(storage,marker),null);
});

function cardFrameFixture({missingPrimary=false,showPostal=true}={}) {
 let listener;const writes=[],inputs={};
 class Input {
  constructor(name,hidden=false){this.name=name;this.hidden=hidden;}
  set value(value){writes.push(this.name);}
  focus(){}blur(){}getAttribute(name){return name==='aria-hidden'&&this.hidden?'true':null;}
  dispatchEvent(event){if(this.name==='cardnumber'&&event.type==='input'){inputs['exp-date'].hidden=false;inputs.cvc.hidden=false;}if(this.name==='cvc'&&event.type==='input'&&showPostal)inputs.postal=new Input('postal');}
 }
 for(const name of ['cardnumber','exp-date','cvc'])inputs[name]=new Input(name,name!=='cardnumber');
 if(missingPrimary)delete inputs['exp-date'];
 const context={location:{pathname:'/v3/elements-inner-card-example.html'},HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},setTimeout:fn=>fn(),chrome:{runtime:{id:'own',sendMessage:async()=>({ok:true}),onMessage:{addListener:f=>listener=f}}},document:{querySelectorAll:selector=>{const name=/name="([^"]+)"/.exec(selector)[1];return inputs[name]?[inputs[name]]:[];}}};
 vm.runInNewContext(fs.readFileSync(new URL('./card-content.js',import.meta.url),'utf8'),context);
 return {writes,listener,fill:()=>new Promise(resolve=>listener({kind:'card-fill',card:dummy},{id:'own'},resolve))};
}
test('Stripe collapsed form reveals fields progressively; autofill uses fresh field references',async()=>{
 const f=cardFrameFixture();const result=await f.fill();assert.equal(result.ok,true);assert.deepEqual(f.writes,['cardnumber','exp-date','cvc','postal']);assert.equal(JSON.stringify(result).includes(dummy.number),false);
});
test('unknown primary layout writes nothing, absent postal stops after bounded discovery',async()=>{
 const f=cardFrameFixture({missingPrimary:true});assert.equal((await f.fill()).ok,false);assert.equal(f.writes.length,0);
 const g=cardFrameFixture({showPostal:false});const result=await g.fill();assert.equal(result.ok,false);assert.match(result.error,/billing postcode/);assert.deepEqual(g.writes,['cardnumber','exp-date','cvc']);assert.equal(result.error.includes(dummy.number),false);
 const h=cardFrameFixture();assert.equal(h.listener({kind:'card-fill',card:dummy},{id:'other'},()=>{}),undefined);assert.equal(h.writes.length,0);
});
