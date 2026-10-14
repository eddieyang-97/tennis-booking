// Isolated content script. Reads only public court labels/account login marker.
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['account','grid','ready'].includes(request.kind)) return;
  try {
    const path=location.pathname;
    const blocked = /\/(?:verify-human|sign-in|login|checkout|payment)(?:\/|$)/.test(path);
    if (blocked) {
      // Report only a known public route category, never queries or page content.
      const category = path.includes('/verify-human') ? 'verification' :
        /\/(sign-in|login)(\/|$)/.test(path) ? 'sign-in' : 'checkout/payment';
      respond({ok:false,error:`Stopped on ${category} page`,humanRequired:true,page:category});return;
    }
    if(request.kind==='ready') {
      const isAccount=path==='/account' && /^Welcome back,/.test(document.querySelector('h1')?.textContent.trim() || '');
      const isGrid=/^\/book\/courts\/(bethnal-green-gardens|victoria-park)(?:\/\d{4}-\d{2}-\d{2})?$/.test(path) && !!document.querySelector('#book table');
      if(!isAccount && !isGrid) throw Error('Normal account or court page is not ready; inspect the tab manually');
      respond({ok:true});return;
    }
    if (request.kind==='account') {
      if (location.pathname!=='/account') throw Error('Unexpected account page');
      const heading=document.querySelector('h1')?.textContent.trim() || '';
      if(!heading && document.readyState && document.readyState!=='complete'){respond({ok:false,notReady:true,error:'Account DOM not ready'});return;}
      if (!/^Welcome back,/.test(heading)) {respond({ok:false,error:'Account login marker missing; inspect the retained tab',humanRequired:true,page:'account'});return;}
      respond({ok:true,signedIn:true}); return;
    }
    if (!['bethnal-green-gardens','victoria-park'].includes(request.venue) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(request.day)) throw Error('Invalid court request');
    if (location.pathname!==`/book/courts/${request.venue}/${request.day}`) throw Error('Requested date was not opened');
    const book=document.querySelector('#book');
    if (!book || !book.querySelector('table')) throw Error('Court grid missing; stop for review');
    const d=new Date(request.day+'T12:00:00Z');
    const weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(d);
    const month=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(d);
    if (!book.textContent.includes(`${weekday} ${d.getUTCDate()}`) || !book.textContent.includes(month)) throw Error('Visible playing date mismatch');
    const rows=[...book.querySelectorAll('table tr')].filter(r=>r.querySelector('th')).map(r=>({
      time:r.querySelector('th').textContent.trim(),
      inputs:[...r.querySelectorAll('input[type=checkbox]')].map(e=>({disabled:e.disabled,label:e.labels?.[0]?.textContent.trim() || ''}))
    }));
    if (!rows.length) throw Error('Empty grid; stop for review');
    respond({ok:true,rows});
  } catch(e) { respond({ok:false,error:e.message}); }
});
