import test from 'node:test';
import assert from 'node:assert/strict';
import {isReceiveTimingRejection} from './rea-har-contract.js';

// Sanitized actual REA 6.8.0 error from the interrupted synthetic capture.
const receiveIssue={path:['capture_path','/log/entries/17/timings/receive'],reason:'invalid_format',message:'HAR schema validation failed: minimum (must be >= 0).'};
const rejection=issues=>({code:'invalid_request',details:{operation:'inspect_web_network_capture',issues}});

test('the observed negative receive-timing rejection is recognized, including multiple entries',()=>{
 assert.equal(isReceiveTimingRejection(rejection([receiveIssue])),true);
 assert.equal(isReceiveTimingRejection(rejection([receiveIssue,{...receiveIssue,path:['capture_path','/log/entries/2/timings/receive']}])),true);
});

test('unrelated, mixed or incomplete REA errors cannot pass as the known HAR limitation',()=>{
 const unrelated={...receiveIssue,path:['capture_path','/log/entries/17/response/status']};
 for(const error of [undefined,{},rejection([]),{code:'invalid_request'},rejection([unrelated]),rejection([receiveIssue,unrelated]),
  rejection([{...receiveIssue,message:'HAR schema validation failed: type (must be number).'}]),
  rejection([{...receiveIssue,reason:'invalid_value'}]),rejection([{...receiveIssue,path:['capture_path','/log/entries/17/timings/send']}]),
  rejection([null]),{...rejection([receiveIssue]),code:'provider_timeout'}]){
  assert.equal(isReceiveTimingRejection(error),false,JSON.stringify(error));
 }
});
