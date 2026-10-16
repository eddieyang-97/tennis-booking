import {encryptCard,decryptCard,readCardFile,unlockCardSession,vaultErrorMessage} from './card-vault-core.js';
const status=document.querySelector('#status');
async function unlock(card){status.textContent='Unlocking card into Chrome memory…';await unlockCardSession(chrome.storage,chrome.runtime,card);}
document.querySelector('#create').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;status.textContent='Encrypting…';
 try {
  const data=new FormData(form),card={number:String(data.get('number')).replace(/[\s-]/g,''),expiry:String(data.get('expiry')).trim(),cvc:String(data.get('cvc')).trim(),postcode:String(data.get('postcode')).trim()};
  const file=await encryptCard(card,String(data.get('passphrase')));
  await unlock(card);const url=URL.createObjectURL(new Blob([JSON.stringify(file)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='tennis-card.encrypted.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  form.reset();status.textContent='Encrypted file downloaded. Card unlocked for this Chrome session. Close this setup tab and run the £2.50 test from the Courtside checkout.';
 }catch(error){status.textContent=error?.code?vaultErrorMessage(error):'Could not save the card. Check its fields and use a passphrase of at least 6 characters.';}
});
document.querySelector('#unlock').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;status.textContent='Unlocking…';
 try{const data=new FormData(form),file=await readCardFile(data.get('file'));status.textContent='Decrypting card file…';const card=await decryptCard(file,String(data.get('passphrase')));await unlock(card);form.reset();status.textContent='Card unlocked for this Chrome session. Close this tab before running payment.';}
 catch(error){status.textContent=vaultErrorMessage(error);}
});
document.querySelector('#lock').addEventListener('click',async()=>{await chrome.storage.session.remove('localPaymentCard');status.textContent='Card locked.';});
