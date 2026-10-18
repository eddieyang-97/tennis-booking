import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../checkout-content.js',import.meta.url),'utf8');
// Synthetic receipt DOM, actual content-script response. No private page data.
export function receiptResponse(request,text,heading='Payment successful'){
 let listener,response;
 vm.runInNewContext(source,{Date,Intl,location:{origin:'https://tennistowerhamlets.com',pathname:'/basket/receipt'},document:{readyState:'complete',body:{innerText:text},querySelector:selector=>selector==='h1'?{textContent:heading}:selector==='main'?{innerText:text}:null},chrome:{runtime:{id:'test',onMessage:{addListener:fn=>listener=fn}}}});
 listener(request,{id:'test'},value=>response=value);return response;
}
