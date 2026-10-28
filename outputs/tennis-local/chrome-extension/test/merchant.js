import {slot,basket,journal} from './scenarios.js';
export class Merchant{
 constructor(){this.clock=Date.parse('2026-10-17T12:00:00Z');this.slot={...slot(),date:'2026-10-23'};this.basket={empty:true,items:[]};this.counts={selection:0,discount:0,opening:0,fill:0,pay:0,removal:0};this.purchases=new Map();this.reference='100001';this.faults=new Map();this.boundaries=[];this.options={};}
 fault(label){this.faults.set(label,1);}
 boundary(label){this.boundaries.push(label);if(this.faults.has(label)){this.faults.delete(label);throw Error('Simulated interruption at '+label);}}
 record(overrides={}){return {...journal(),slot:this.slot,key:JSON.stringify([this.slot.venue,this.slot.date,this.slot.court,this.slot.start,this.slot.hours]),...overrides};}
 selected(){this.basket=basket(this.slot);}
 async message(tab,request,worker){
  const mutation={'select-slot':'selection','discount-apply':'discount','payment-open':'opening','card-fill':'fill','payment-submit':'pay','free-booking-submit':'free','test-remove-next':'removal'}[request.kind];
  if(mutation)this.boundary(`dispatch:${mutation}:before`);
  let response;
  if(request.kind==='account'){if(this.options.accountGate){this.accountStarted=true;await this.options.accountGate;}response={ok:true,signedIn:true};}
  else if(request.kind==='grid')response=this.options.gridError?{ok:false,error:'Court grid missing'}:{ok:true,rows:[20,21].map(hour=>({time:hour===20?'8pm':'9pm',inputs:[{label:'Court 1£7',disabled:false}]}))};
  else if(request.kind==='basket-read')response={ok:true,value:structuredClone(this.basket)};
  else if(request.kind==='select-slot'){
   this.slot=structuredClone(request.slot);this.counts.selection+=request.slot.hours;this.selected();
   if(this.options.partial)this.basket={...this.basket,items:[this.basket.items[1]],subtotalGBP:'7.00',totalGBP:'7.00'};
   response={ok:true,value:{selected:true}};
  }else if(request.kind==='discount-apply'){
   this.counts.discount++;this.basket={...this.basket,discountApplied:true,discountGBP:this.options.freeBooking?this.basket.subtotalGBP:'2.00',totalGBP:this.options.freeBooking?'0.00':'12.00',...(this.options.freeBooking?{paymentBoundary:false,freeBookingBoundary:true}:{})};response={ok:true};
  }else if(request.kind==='free-booking-submit'){
   this.counts.free=(this.counts.free||0)+1;this.freeSubmitted=true;
   tab.url='https://tennistowerhamlets.com/basket/receipt';response={ok:true};
  }else if(request.kind==='payment-open'){
   this.counts.opening++;this.readyAt=this.clock+(this.options.cardDelay||0);this.purchases.set(this.reference,{state:'Pending',totalGBP:this.basket.totalGBP});response={ok:true};
  }else if(['checkout-progress','payment-state'].includes(request.kind)){
   if(request.kind==='checkout-progress'&&this.options.missingProgress>0){this.options.missingProgress--;return undefined;}
   if(request.kind==='checkout-progress'&&tab.url.includes('/purchase/card/'))response={ok:true,value:{stage:'existing-purchase',reference:this.reference,totalGBP:'14.00',cancellationSupported:false}};
   else if(this.options.merchantError)response={ok:true,value:{stage:'other-page',merchantError:true,loadState:'complete'}};
   else if(this.clock<(this.readyAt||0)||!this.purchases.has(this.reference))response={ok:true,value:{stage:'basket',loadState:'loading'}};
   else response={ok:true,value:{stage:'card',reference:this.reference,totalGBP:this.purchases.get(this.reference).totalGBP,enabled:!!this.filled,loadState:'complete'}};
  }else if(request.kind==='link-discover'){
   await worker.listener({kind:'link-frame'},{id:'test',url:'https://js.stripe.com/v3/elements-inner-card-fake',frameId:1,tab:{id:tab.id}},()=>{});response={ok:true};
  }else if(request.kind==='link-state')response={ok:true,value:{type:'card'}};
  else if(request.kind==='link-close')response={ok:true};
  else if(request.kind==='card-fill'){this.counts.fill++;this.filled=true;response={ok:true};}
  else if(request.kind==='payment-submit'){
   this.counts.pay++;this.purchases.set(request.reference,{state:'Confirmed',totalGBP:request.totalGBP});response={ok:true};
  }else if(request.kind==='receipt-read')response=this.options.receiptResponse?this.options.receiptResponse(request):{ok:true,value:{status:'awaiting-payment'}};
  else if(['purchase-read','test-purchase-state'].includes(request.kind)){
   const purchase=this.purchases.get(request.reference);
   response=!purchase?{ok:false,error:'Unique matching purchase not found for reference 100001: observed 0 matches'}:purchase.totalGBP!==request.slot.totalGBP?{ok:false,error:'Matching purchase is not confirmed paid at the expected amount'}:request.kind==='test-purchase-state'&&purchase.state==='Pending'?{ok:true,value:{status:'unpaid',reference:request.reference,totalGBP:purchase.totalGBP}}:purchase.state==='Confirmed'?{ok:true,value:{status:'confirmed',key:request.key,reference:request.reference,source:'account-purchase',bookingState:'unknown'}}:{ok:false,error:'Test purchase is paid or uncertain'};
  }else if(request.kind==='test-remove-next'){
   this.counts.removal++;const items=this.basket.items.slice(1);this.basket=items.length?{...this.basket,items,subtotalGBP:'7.00',totalGBP:'7.00'}:{empty:true,items:[]};response={ok:true};
  }else throw Error('Unimplemented fake merchant command '+request.kind);
  if(mutation)this.boundary(`dispatch:${mutation}:after`);
  return response;
 }
}
