const fs = require('fs');
const assert = require('assert');
const source = JSON.parse(fs.readFileSync('work/verification-guard.json','utf8'));
function evaluate(origin, pathname, present=true) {
  let documentReads=0;
  const location={origin,pathname};
  const document={readyState:'complete',querySelector(){documentReads++;return present?{textContent:'Complete',disabled:true}:null;},querySelectorAll(){documentReads++;return [];}};
  const result = new Function('location','document','URL','return ('+source+')()')(location,document,URL);
  return {result,documentReads};
}
const publicState=evaluate('https://tennistowerhamlets.com','/verify-human');
assert.equal(publicState.result.complete_disabled,true);
for(const [origin,path] of [
 ['https://tennistowerhamlets.com','/account'],
 ['https://tennistowerhamlets.com','/account/sign-in/code'],
 ['https://tennistowerhamlets.com','/basket'],
 ['https://private.example','/verify-human'],
 ['http://tennistowerhamlets.com','/verify-human']]) {
 const outcome=evaluate(origin,path);assert.equal(outcome.result,null);assert.equal(outcome.documentReads,0);
}
assert.equal(evaluate('https://tennistowerhamlets.com','/verify-human',false).result,null);
console.log('Live-address JavaScript guard passed: allowed public state; private paths/wrong origins rejected before any document access; missing public marker rejected.');
