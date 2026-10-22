import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {networkGate} from './isolation.js';

test('an unrecognized external request is denied and fails the gate',async()=>{
 const gate=await networkGate('http://127.0.0.1:1');
 try{
  const status=await new Promise((resolve,reject)=>{
   const request=http.request(gate.proxy,{path:'http://unrecognized.invalid/no-route'},response=>{response.resume();resolve(response.statusCode);});
   request.on('error',reject);request.end();
  });
  assert.equal(status,403);assert.throws(()=>gate.assertClean(),/Unexpected browser egress/);
 }finally{await gate.close();}
});

test('another loopback port is outside the sole merchant boundary',async()=>{
 const gate=await networkGate('http://127.0.0.1:1');
 try{
  await gate.negative(()=>new Promise((resolve,reject)=>{
   const request=http.request(gate.proxy,{path:'http://127.0.0.1:2/wrong-port'},response=>{response.resume();assert.equal(response.statusCode,403);resolve();});
   request.on('error',reject);request.end();
  }));
  gate.assertClean();assert.equal(gate.denied.length,1);
 }finally{await gate.close();}
});
