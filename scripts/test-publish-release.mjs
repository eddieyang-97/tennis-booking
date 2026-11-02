import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {releaseAssets,publishRelease} from './publish-release.mjs';
const sha='a'.repeat(40),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const context={repository:'eddieyang-97/tennis-booking',ref:'refs/heads/main',event:'push',sha};
function bundle(){return {metadata:{commit:sha,version:'0.9.12',tag:'dev-v0.9.12-'+sha.slice(0,12)},files:['tennis-booking-v0.9.12.zip','release.json','checksums.txt'].map(name=>{const bytes=Buffer.from(name);return {name,bytes,sha256:digest(bytes)};})};}
function server(b,options={}){
 let release=options.existing?structuredClone(options.existing):null,ref=options.ref??null;const calls=[];
 const request=async(method,route,body)=>{
  calls.push({method,route});
  if(method==='GET'&&route==='/commits/main')return {sha:options.main??sha};
  if(method==='GET'&&route.startsWith('/git/ref/'))return ref;
  if(method==='GET'&&route.startsWith('/releases/tags/'))return structuredClone(release);
  if(method==='GET'&&route==='/releases/1')return structuredClone(release);
  if(method==='POST'&&route==='/releases'){release={...body,id:1,assets:[],html_url:'https://github.com/eddieyang-97/tennis-booking/releases/tag/'+body.tag_name};return structuredClone(release);}
  if(method==='DELETE'){release.assets=release.assets.filter(a=>a.id!==Number(route.split('/').at(-1)));return null;}
  if(method==='UPLOAD'){
   const name=decodeURIComponent(route.split('name=')[1]);if(options.failUpload===name)throw Error('Injected upload failure');
   const asset={name,id:release.assets.length+1,state:'uploaded',size:body.length,digest:'sha256:'+digest(body)};
   if(options.corruptUpload===name)asset.digest='sha256:'+'0'.repeat(64);
   release.assets.push(asset);return structuredClone(asset);
  }
  if(method==='PATCH'){assert.equal(release.assets.length,3,'publish must wait for every asset');Object.assign(release,body);ref={object:{type:'commit',sha}};return structuredClone(release);}
  throw Error('Unexpected API call '+method+' '+route);
 };
 return {request,calls,current:()=>release};
}
const writes=s=>s.calls.filter(c=>c.method!=='GET');
test('publishes only a complete verified draft, then verifies release and exact tag',async()=>{
 const b=bundle(),s=server(b),result=await publishRelease(b,s.request,context);
 assert.equal(result.status,'published');assert.equal(s.current().draft,false);assert.equal(s.current().prerelease,true);assert.equal(s.current().target_commitish,sha);
 assert.deepEqual(writes(s).map(c=>c.method),['POST','UPLOAD','UPLOAD','UPLOAD','PATCH']);
});
for(const patch of [{event:'pull_request'},{ref:'refs/heads/feature'},{sha:'b'.repeat(40)},{repository:'other/repo'}])test('refuses unauthorized publication context '+JSON.stringify(patch),async()=>{
 const b=bundle(),s=server(b);await assert.rejects(publishRelease(b,s.request,{...context,...patch}),/tested main/);assert.equal(s.calls.length,0);
});
test('superseded main run never creates a release',async()=>{const b=bundle(),s=server(b,{main:'b'.repeat(40)});assert.equal((await publishRelease(b,s.request,context)).status,'superseded');assert.equal(writes(s).length,0);});
test('existing tag for another commit stops before writes',async()=>{const b=bundle(),s=server(b,{ref:{object:{type:'commit',sha:'b'.repeat(40)}}});await assert.rejects(publishRelease(b,s.request,context),/another commit/);assert.equal(writes(s).length,0);});
for(const mode of ['failUpload','corruptUpload'])test(`${mode} leaves an unpublished draft`,async()=>{
 const b=bundle(),s=server(b,{[mode]:'release.json'});await assert.rejects(publishRelease(b,s.request,context),/upload|asset/i);assert.equal(s.current().draft,true);assert.equal(writes(s).filter(c=>c.method==='PATCH').length,0);
});
function existing(b,draft=false){return {id:1,target_commitish:sha,tag_name:b.metadata.tag,prerelease:true,draft,html_url:'https://example.invalid',assets:b.files.map((f,i)=>({name:f.name,id:i+1,state:'uploaded',size:f.bytes.length,digest:'sha256:'+f.sha256}))};}
test('identical published release is observed without rewriting',async()=>{
 const b=bundle(),s=server(b,{existing:existing(b),ref:{object:{type:'commit',sha}}});assert.equal((await publishRelease(b,s.request,context)).status,'already-published');assert.equal(writes(s).length,0);
});
test('published assets cannot be overwritten when rerun archive differs',async()=>{
 const b=bundle(),prior=existing(b);prior.assets[0].digest='sha256:'+'0'.repeat(64);const s=server(b,{existing:prior,ref:{object:{type:'commit',sha}}});await assert.rejects(publishRelease(b,s.request,context),/not be overwritten/);assert.equal(writes(s).length,0);
});
test('retry replaces only expected assets on its unpublished draft',async()=>{
 const b=bundle(),prior=existing(b,true);prior.assets.pop();const s=server(b,{existing:prior});assert.equal((await publishRelease(b,s.request,context)).status,'published');assert.deepEqual(writes(s).map(c=>c.method),['DELETE','DELETE','UPLOAD','UPLOAD','UPLOAD','PATCH']);
});
test('unexpected draft assets require manual inspection',async()=>{
 const b=bundle(),prior=existing(b,true);prior.assets.push({id:99,name:'unrelated.txt'});const s=server(b,{existing:prior});await assert.rejects(publishRelease(b,s.request,context),/Unexpected draft/);assert.equal(writes(s).length,0);
});
test('local release provenance and archive must agree before publication',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tennis-publish-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('tennis-publish-'));return fs.rm(dir,{recursive:true,force:true});});
 const zip=Buffer.from('synthetic archive; archive-entry validation runs in PowerShell'),name='tennis-booking-v0.9.12.zip';
 const metadata={schemaVersion:1,repository:context.repository,channel:'development',commit:sha,version:'0.9.12',tag:'dev-v0.9.12-'+sha.slice(0,12),zip:{name,sha256:digest(zip)}};
 await fs.writeFile(path.join(dir,name),zip);await fs.writeFile(path.join(dir,'release.json'),JSON.stringify(metadata));await fs.writeFile(path.join(dir,'checksums.txt'),`${digest(zip)}  ${name}\n`);
 assert.equal((await releaseAssets(dir,sha)).files.length,3);
 await fs.writeFile(path.join(dir,name),'tampered');await assert.rejects(releaseAssets(dir,sha),/checksum/);
 await assert.rejects(releaseAssets(dir,'b'.repeat(40)),/provenance/);
});
