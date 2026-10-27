import http from 'node:http';
// All non-loopback browser traffic is forced through this denying proxy, including
// extension worker fetches that Playwright page routing cannot intercept.
export async function networkGate(origin){
 const denied=[];let intentional=false;
 // Chromium itself probes these services even with background networking off.
 // They are BLOCKED, never forwarded; page/worker route attempts still fail.
 const infrastructure=new Set(['clients2.google.com','accounts.google.com:443','android.clients.google.com:443','content-autofill.googleapis.com:443','www.google.com:443']);
 const reject=(kind,host)=>denied.push({kind,host,intentional,infrastructure:kind!=='page-egress'&&infrastructure.has(host)});
 const proxy=http.createServer((req,res)=>{
  let target;try{target=new URL(req.url);}catch{}
  if(!target||target.origin!==origin){reject('http-egress',target?.host);res.writeHead(403);res.end('Denied by local test gate');return;}
  const forwarded=http.request(target,{method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.on('aborted',()=>res.destroy());upstream.on('error',()=>res.destroy());upstream.pipe(res);});
  forwarded.on('error',()=>{res.writeHead(502);res.end();});req.pipe(forwarded);
 });
 proxy.on('connect',(req,socket)=>{socket.on('error',()=>{});reject('https-egress',req.url);socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
 proxy.on('clientError',(_,socket)=>socket.destroy());
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 return {proxy:`http://127.0.0.1:${proxy.address().port}`,denied,
  async attach(context){await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||url.protocol==='chrome-extension:')return route.continue();if(intentional&&url.host==='js.stripe.com')return route.continue();reject('page-egress',url.host);return route.abort();});},
  async negative(run){intentional=true;try{return await run();}finally{intentional=false;}},
  assertClean(){if(denied.some(item=>!item.intentional&&!item.infrastructure))throw Error('Unexpected browser egress was blocked');},
  close:async()=>{proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
 };
}
