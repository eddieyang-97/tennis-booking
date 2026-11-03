import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const repo='eddieyang-97/tennis-booking',api='https://api.github.com/repos/'+repo;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function releaseAssets(directory,commit){
 const metadataBytes=await fs.readFile(path.join(directory,'release.json')),m=JSON.parse(metadataBytes);
 if(!/^[a-f0-9]{40}$/.test(commit)||m.schemaVersion!==1||m.repository!==repo||m.channel!=='development'||m.commit!==commit||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(m.version)||m.tag!==`dev-v${m.version}-${commit.slice(0,12)}`||m.zip?.name!==`tennis-booking-v${m.version}.zip`||!/^[a-f0-9]{64}$/.test(m.zip.sha256))throw Error('Release provenance mismatch');
 const zip=await fs.readFile(path.join(directory,m.zip.name)),checksums=await fs.readFile(path.join(directory,'checksums.txt'));
 if(hash(zip)!==m.zip.sha256||checksums.toString().trim()!==`${m.zip.sha256}  ${m.zip.name}`)throw Error('Release archive/checksum mismatch');
 return {metadata:m,files:[{name:m.zip.name,bytes:zip},{name:'release.json',bytes:metadataBytes},{name:'checksums.txt',bytes:checksums}].map(f=>({...f,sha256:hash(f.bytes)}))};
}
export async function publishRelease(bundle,request,context){
 if(context.repository!==repo||context.ref!=='refs/heads/main'||!['push','workflow_dispatch'].includes(context.event)||context.sha!==bundle.metadata.commit)throw Error('Publishing requires the tested main event');
 const {metadata:m,files}=bundle;
 // Superseded runs keep their CI artifact; only the current tested main head
 // becomes a development release. No delayed old run can replace a newer build.
 if((await request('GET','/commits/main')).sha!==context.sha)return {status:'superseded'};
 const ref=await request('GET','/git/ref/tags/'+m.tag,null,true);
 if(ref&&(ref.object?.type!=='commit'||ref.object.sha!==context.sha))throw Error('Release tag points to another commit');
 let release=await request('GET','/releases/tags/'+m.tag,null,true);
 if(release){
  if(release.target_commitish!==context.sha||!release.prerelease||release.tag_name!==m.tag)throw Error('Existing release identity mismatch');
  if(!release.draft){
   if(!ref)throw Error('Published tag is missing');
   const remote=release.assets||[];
   if(remote.length!==files.length||files.some(f=>!remote.some(a=>a.name===f.name&&a.state==='uploaded'&&a.digest===`sha256:${f.sha256}`)))throw Error('Published release differs; it will not be overwritten');
   return {status:'already-published',url:release.html_url};
  }
  // Resume only our own unpublished draft. Published assets are immutable here.
  if((release.assets||[]).some(a=>!files.some(f=>f.name===a.name)))throw Error('Unexpected draft assets; inspect manually');
  for(const asset of release.assets||[])await request('DELETE',`/releases/assets/${asset.id}`);
 }else{
  release=await request('POST','/releases',{tag_name:m.tag,target_commitish:context.sha,name:`Development v${m.version} (${context.sha.slice(0,12)})`,draft:true,prerelease:true,make_latest:'false',body:`Experimental developer build of tested main commit ${context.sha}.\n\nNot verified for unattended live booking or general distribution. Use your existing installation directory and the documented updater. Reload/restart locks the card session; unlock afterward. This release contains runtime files only, no owner data.\n\nSource: https://github.com/${repo}/commit/${context.sha}`});
 }
 for(const file of files){
  const asset=await request('UPLOAD',`/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,file.bytes);
  if(asset.name!==file.name||asset.size!==file.bytes.length||asset.digest!==`sha256:${file.sha256}`)throw Error('Uploaded asset verification failed; draft retained');
 }
 const staged=await request('GET',`/releases/${release.id}`);
 if(staged.assets.length!==files.length||files.some(f=>!staged.assets.some(a=>a.name===f.name&&a.state==='uploaded'&&a.digest===`sha256:${f.sha256}`)))throw Error('Incomplete draft; not publishing');
 const result=await request('PATCH',`/releases/${release.id}`,{draft:false,prerelease:true,make_latest:'false'});
 const published=await request('GET',`/releases/${release.id}`),tag=await request('GET','/git/ref/tags/'+m.tag);
 if(published.draft||!published.prerelease||tag.object?.sha!==context.sha||tag.object.type!=='commit')throw Error('Published release/tag verification failed');
 return {status:'published',url:result.html_url};
}
export function githubRequest(token){
 if(!token)throw Error('Missing GitHub publication token');
 return async(method,route,body=null,optional=false)=>{
  if(!route.startsWith('/')||route.includes('://'))throw Error('Invalid API route');
  const upload=method==='UPLOAD';
  const response=await fetch((upload?'https://uploads.github.com/repos/'+repo:api)+route,{method:upload?'POST':method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':upload?'application/octet-stream':'application/json'},...(body!==null?{body:upload?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  if(optional&&response.status===404)return null;
  if(!response.ok)throw Error(`GitHub ${method} request failed (${response.status}); no response body logged`);
  return response.status===204?null:response.json();
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const bundle=await releaseAssets(process.argv[2]||'artifacts',process.env.GITHUB_SHA);
 console.log(JSON.stringify(await publishRelease(bundle,githubRequest(process.env.GITHUB_TOKEN),{repository:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,event:process.env.GITHUB_EVENT_NAME,sha:process.env.GITHUB_SHA})));
}
