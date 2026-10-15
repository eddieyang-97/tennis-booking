const fields=['number','expiry','cvc','postcode'];
export class VaultError extends Error {
 constructor(code){super(vaultMessages[code]||vaultMessages.unknown);this.code=code;}
}
const vaultMessages={
 no_file:'Select your tennis-card.encrypted.json file first.',
 file_size:'This file is empty or too large to be a tennis card file.',
 file_read:'The selected file could not be read. Select it again from your local disk.',
 invalid_json:'This is not a valid JSON file. Select the encrypted card file downloaded by this extension.',
 invalid_file:'This is not a supported encrypted tennis card file, or its encryption fields are damaged.',
 short_passphrase:'Enter the original file passphrase, including any spaces. It must be at least 12 characters.',
 authentication_failed:'The passphrase does not match this file, or the encrypted file has been changed. Try the original passphrase with the original downloaded file.',
 invalid_card:'The file decrypted, but its card fields are invalid. Create a new card file.',
 context_invalidated:'This setup tab is from an earlier extension reload. Close it and reopen card setup from the extension.',
 session_storage:'The file decrypted, but Chrome could not unlock the card into extension memory. Close this tab and reopen setup from the extension.',
 card_locked:'Local card is locked. Open card setup, unlock the encrypted file, then close setup and return to checkout. No Link payment was attempted.',
 card_session_unavailable:'Chrome could not read the unlocked local card. Reopen card setup from the extension and unlock the file again.',
 unknown:'Card setup failed. Reopen setup from the extension and try again.'
};
export function vaultErrorMessage(error){return vaultMessages[error?.code]||vaultMessages.unknown;}
export async function readCardFile(file) {
 if(!file || typeof file.text!=='function')throw new VaultError('no_file');
 if(!file.size || file.size>8192)throw new VaultError('file_size');
 let text;try{text=await file.text();}catch{throw new VaultError('file_read');}
 try{return JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new VaultError('invalid_json');}
}
export async function unlockCardSession(storage,runtime,card) {
 if(!runtime?.id)throw new VaultError('context_invalidated');
 try{await storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await storage.session.set({localPaymentCard:card});const saved=(await storage.session.get('localPaymentCard')).localPaymentCard;if(!fields.every(field=>saved?.[field]===card[field]))throw Error('Session verification failed');}
 catch(error){throw new VaultError(/context invalidated/i.test(error?.message||'')?'context_invalidated':'session_storage');}
}
export async function paymentCard(storage,record) {
 // Receipt reconciliation does not need card access and must never refill.
 if(record?.manualPaymentReportedAt || record?.paymentDispatchedAt || ['payment-dispatched','payment-uncertain'].includes(record?.phase))return null;
 let card;try{card=(await storage.session.get('localPaymentCard')).localPaymentCard;}catch{throw new VaultError('card_session_unavailable');}
 if(!card)throw new VaultError('card_locked');
 try{return validateCard(card);}catch{throw new VaultError('invalid_card');}
}
export function validateCard(card) {
 if(!card || Object.keys(card).length!==fields.length || !fields.every(k=>typeof card[k]==='string'))throw Error('Invalid card file');
 if(!/^\d{12,19}$/.test(card.number)||!/^\d{3,4}$/.test(card.cvc)||! /^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)||!card.postcode.trim()||card.postcode.length>20)throw Error('Check card number, expiry, security code and postcode');
 let sum=0,double=false;for(let i=card.number.length-1;i>=0;i--){let n=+card.number[i];if(double){n*=2;if(n>9)n-=9;}sum+=n;double=!double;}if(sum%10)throw Error('Check card number');
 return {...card};
}
const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function key(password,salt) {
 if(typeof password!=='string'||password.length<12)throw new VaultError('short_passphrase');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptCard(card,password) {
 validateCard(card);const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt),new TextEncoder().encode(JSON.stringify(card)));
 return {format:'tennis-card-v1',salt:encode(salt),iv:encode(iv),ciphertext:encode(new Uint8Array(encrypted))};
}
export async function decryptCard(file,password) {
 if(file?.format!=='tennis-card-v1'||typeof file.ciphertext!=='string'||file.ciphertext.length>4096)throw new VaultError('invalid_file');
 let salt,iv,ciphertext;
 try{salt=decode(file.salt);iv=decode(file.iv);ciphertext=decode(file.ciphertext);if(salt.length!==16||iv.length!==12||ciphertext.length<17)throw Error();}catch{throw new VaultError('invalid_file');}
 const derivedKey=await key(password,salt);
 let plain;try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},derivedKey,ciphertext);}catch{throw new VaultError('authentication_failed');}
 try{return validateCard(JSON.parse(new TextDecoder().decode(plain)));}catch{throw new VaultError('invalid_card');}
}
