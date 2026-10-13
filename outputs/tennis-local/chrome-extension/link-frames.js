export function linkFrameType(url) {
 try {const u=new URL(url);if(u.origin!=='https://js.stripe.com')return null;
 if(u.pathname.startsWith('/v3/elements-inner-link-button-for-card-'))return 'button';
 if(u.pathname.startsWith('/v3/universal-link-modal-inner-'))return 'modal';
 if(u.pathname.startsWith('/v3/elements-inner-card-'))return 'card';
 }catch{}return null;
}
export function createLinkFrames(tabs,{pause=ms=>new Promise(r=>setTimeout(r,ms)),step=async()=>{}}={}) {
 const registry=new Map();
 async function merchantTab(tabId) {
  const tab=await tabs.get(tabId);
  if(tab.url!=='https://tennistowerhamlets.com/basket/pay/card')throw Error('Link command requires the Courtside card checkout');
 }
 return {
  async register(sender) {
   const type=linkFrameType(sender.url);
   if(!type || !Number.isInteger(sender.frameId) || sender.frameId<=0 || !sender.tab?.id)return false;
   try{await merchantTab(sender.tab.id);}catch{return false;}
   const frames=registry.get(sender.tab.id)||new Map();frames.set(sender.frameId,type);registry.set(sender.tab.id,frames);return true;
  },
  async command(tabId,type,kind,{attempts=12,payload={}}={}) {
   await merchantTab(tabId);
   for(let attempt=0;attempt<attempts;attempt++) {
    // Rediscovery is read-only. Every current frame re-registers with this
    // worker, including after its in-memory registry has been lost.
    try{await tabs.sendMessage(tabId,{kind:'link-discover'});}catch{}
    const frames=registry.get(tabId)||new Map(),live=[];
    for(const [frameId,t] of frames)if(t===type) {
     try{const response=await tabs.sendMessage(tabId,{kind:'link-state'},{frameId});if(response?.ok && response.value?.type===type)live.push({frameId,value:response.value});else frames.delete(frameId);}
     catch{frames.delete(frameId);}
    }
    if(live.length>1)throw Error('Multiple saved Link controls; stopped without a click');
    if(live.length===1) {
     if(kind==='link-state')return live[0].value;
     await merchantTab(tabId);await step(kind,{frameType:type});
     // Dispatch a UI mutation once. Lost acknowledgement never replays it.
     const response=await tabs.sendMessage(tabId,{...payload,kind},{frameId:live[0].frameId});
     if(!response?.ok)throw Error(response?.error||'Link action response uncertain; no repeated click');
     return response.value;
    }
    if(attempt+1<attempts){await step('link-discovery-wait',{frameType:type,attempt:attempt+1});await pause(250);}
   }
   throw Error('Saved Link frame not responding after bounded discovery; check Stripe site access and reload the checkout');
  }
 };
}
