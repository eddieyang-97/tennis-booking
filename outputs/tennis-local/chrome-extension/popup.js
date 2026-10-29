import {londonDay,addDays} from './core.js';
import {normalizeSettings,DEFAULT_SETTINGS,failedCheckoutIdentity} from './booking-settings.js';
import {readiness,releasePreview} from './readiness.js';
import {diagnosticExport,diagnosticFilename} from './diagnostics.js';
const field=id=>document.querySelector('#'+id),day=field('day'),output=field('result');
let formEdited=false;
let attestationIdentity='';
let failedAttestationIdentity='';
let recoveryViewIdentity='';
day.value=addDays(londonDay(),8);
field('releaseHelp').textContent=releasePreview(day.value);
day.addEventListener('input',()=>field('releaseHelp').textContent=releasePreview(day.value));
for(const [id,first,last] of [['earliestStart',0,23],['latestFinish',1,24]])for(let hour=first;hour<=last;hour++){
 const option=document.createElement('option');option.value=option.textContent=`${String(hour).padStart(2,'0')}:00`;field(id).append(option);
}
function readSettings(){return normalizeSettings({schemaVersion:1,venues:[field('firstVenue').value,field('secondVenue').value,field('thirdVenue').value].filter(Boolean),earliestStart:field('earliestStart').value,latestFinish:field('latestFinish').value,preferredHours:Number(field('preferredHours').value),minHours:Number(field('minHours').value),allowCourtSwitch:field('allowCourtSwitch').checked,maxTotalGBP:field('maxTotalGBP').value,maxOneHourGBP:field('maxOneHourGBP').value});}
function writeSettings(settings){const s=normalizeSettings(settings);field('firstVenue').value=s.venues[0];field('secondVenue').value=s.venues[1]||'';field('thirdVenue').value=s.venues[2]||'';for(const id of ['earliestStart','latestFinish','preferredHours','minHours','maxTotalGBP','maxOneHourGBP'])field(id).value=String(s[id]);field('allowCourtSwitch').checked=s.allowCourtSwitch;}
writeSettings(DEFAULT_SETTINGS);
async function refresh(initial=false,show=false){
 const status=await chrome.runtime.sendMessage({kind:'status'}),view=readiness(status);
 field('readiness').textContent=[view.summary,...view.lines].join('\n');
 field('armBlocker').textContent=view.armBlocker||'';
 const recovery=view.recovery;
 field('recoveryControls').hidden=!recovery.showRecovery;
 field('recoveryHelp').textContent=recovery.help;
 for(const [id,visible] of Object.entries(recovery.actions))field(id+'Row').hidden=!visible;
 const recoveryIdentity=JSON.stringify([(status.checkoutRecords||[]).filter(r=>r.status!=='confirmed').map(r=>[r.key,r.phase]),recovery.actions]);
 if(recovery.showRecovery&&(initial||recoveryIdentity!==recoveryViewIdentity))field('recoveryControls').open=true;
 recoveryViewIdentity=recoveryIdentity;
 field('manualBookingHelp').textContent=recovery.manualHelp;
 field('check').disabled=recovery.paused;
 field('resume').disabled=recovery.paused;
 field('availabilityHelp').textContent=recovery.paused?'Availability checks are paused while a job is armed or an interrupted check needs review. Cancel the scheduled job or inspect Advanced diagnostics as applicable.':'';
 field('testDiscountCheckout').disabled=!recovery.testAvailable;
 field('resetUnpaidTest').disabled=recovery.paused;
 field('developerHelp').textContent=recovery.testAvailable?'Worker safety checks still apply to every test.':'Resolve the current checkout or scheduled/interrupted run before testing.';
 const test=status.checkoutRecords?.find(r=>r.status!=='confirmed'&&r.checkoutTestOnly),identity=test?JSON.stringify([test.key,test.reference||'',test.checkoutOpenDispatchedAt||'']):'';
 field('testRecoveryGuide').textContent=view.testRecoveryGuide;
 field('testRecoveryGuide').hidden=!view.testRecoveryGuide;
 if(view.testRecoveryGuide&&(initial||identity!==attestationIdentity))field('recoveryControls').open=true;
 if(identity!==attestationIdentity)field('unpaidTestConfirmed').checked=false;
 attestationIdentity=identity;
 const failedIdentity=failedCheckoutIdentity(status.checkoutRecords);
 field('failedCheckoutGuide').textContent=view.failedCheckoutGuide;
 field('failedCheckoutRecovery').hidden=!view.failedCheckoutGuide;
 if(view.failedCheckoutGuide&&(initial||failedIdentity!==failedAttestationIdentity))field('recoveryControls').open=true;
 if(failedIdentity!==failedAttestationIdentity)field('failedCheckoutNoPayment').checked=false;
 failedAttestationIdentity=failedIdentity;
 field('cardStatus').textContent=status.localCardUnlocked?'Local card: unlocked for this Chrome session.':'Local card: locked. Open card setup and unlock the file first.';
 if(initial&&!formEdited){const pendingTest=status.checkoutRecords?.find(record=>record.status!=='confirmed'&&record.checkoutTestOnly);writeSettings(status.job?.settings||status.bookingSettings||DEFAULT_SETTINGS);field('discountCode').value=status.job?.discountCode??pendingTest?.discountCode??'';}
 if(show)output.textContent=JSON.stringify(status,null,2);
}
async function send(kind){output.textContent='Checking…';try{
 const message={kind,day:day.value};
 if(['armPayment','check','saveSettings'].includes(kind))message.settings=readSettings();
 if(['armPayment','testDiscountCheckout'].includes(kind))message.discountCode=field('discountCode').value;
 if(kind==='reconcileSelection'){message.unpaidTestConfirmed=field('unpaidTestConfirmed').checked;message.attestationIdentity=attestationIdentity;}
 if(kind==='archiveFailedCheckout'){message.noPaymentConfirmed=field('failedCheckoutNoPayment').checked;message.attestationIdentity=failedAttestationIdentity;}
 if(kind==='reconcileManualPayment')message.reference=field('manualReference').value;
 const result=await chrome.runtime.sendMessage(message);output.textContent=result.status==='stopped'?result.error:JSON.stringify(result,null,2);
 try{await refresh();}catch{/* Keep the completed action result visible. */}
}catch(error){output.textContent=error.message;}}
for(const kind of ['openCardVault','payCheckout','armPayment','check','resume','prepareCheckout','verifyPayment','cancel','reset','reconcileBasket','reconcileSelection','archiveFailedCheckout','saveSettings','reconcileManualPayment','testDiscountCheckout','resetUnpaidTest','assessRecovery'])field(kind).addEventListener('click',()=>send(kind));
for(const control of document.querySelectorAll('input,select'))control.addEventListener('input',()=>{formEdited=true;});
field('preferredHours').addEventListener('change',()=>{if(Number(field('minHours').value)>Number(field('preferredHours').value))field('minHours').value=field('preferredHours').value;});
field('showStatus').addEventListener('click',()=>refresh(false,true).catch(error=>output.textContent=error.message));
async function downloadDiagnostics(){
 output.textContent='Preparing diagnostic log…';let url;
 try{
  const status=await chrome.runtime.sendMessage({kind:'status'}),exported=diagnosticExport(status);
  url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=diagnosticFilename(exported);link.click();
  output.textContent='Diagnostic log downloaded. Attach the JSON file in this chat. Booking references and court details are included; card details, passphrases and discount codes are excluded.';
 }catch(error){output.textContent=error.message;}
 finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),10000);}
}
field('downloadLog').addEventListener('click',()=>downloadDiagnostics());
refresh(true).catch(error=>{field('readiness').textContent='Status unavailable';output.textContent=error.message;});
