const statusFields=['version','localCardUnlocked','latestAction','result','job','running','basketTest','basketTestResult','runHistory','checkoutRecords','checkoutResult','abandonedCheckouts','bookingSettings'];
const secretKey=/cardnumber|carddetails|localpaymentcard|securitycode|billing|passphrase|password|ciphertext|(?:^|_)(?:card|number|cvc|cvv|expiry|postcode|email|token|secret|authorization|cookie)(?:$|_)/i;
function sanitize(value){
 if(Array.isArray(value))return value.map(sanitize);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!secretKey.test(key)).map(([key,item])=>[key,/discountcode/i.test(key)?(item?'[redacted]':''):sanitize(item)]));
 if(typeof value==='string')return value.replace(/\b(?:\d[ -]?){12,19}\b/g,'[redacted digits]').replace(/\bCXC-[A-Za-z0-9_-]+\b/g,'[redacted discount]');
 return value;
}
export function diagnosticExport(status,now=new Date()){
 if(!status||typeof status!=='object'||status.status==='stopped')throw Error(status?.error||'Diagnostic status unavailable');
 return {format:'tennis-booking-diagnostics',schemaVersion:1,exportedAt:now.toISOString(),...sanitize(Object.fromEntries(statusFields.filter(key=>Object.hasOwn(status,key)).map(key=>[key,status[key]])))};
}
export function diagnosticFilename(exported){return `tennis-booking-log-${exported.exportedAt.replace(/[:.]/g,'-')}.json`;}
