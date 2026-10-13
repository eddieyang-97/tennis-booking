export const VENUES = ['bethnal-green-gardens', 'victoria-park'];
export const NAMES = {'bethnal-green-gardens':'Bethnal Green Gardens','victoria-park':'Victoria Park'};
export function londonDay(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);
  const get = k => p.find(x=>x.type===k).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(day, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('Invalid date');
  const d = new Date(day+'T12:00:00Z');
  if (d.toISOString().slice(0,10)!==day) throw Error('Invalid date');
  d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);
}
export function eligible(day) {
  addDays(day,0); return [1,2,3,4].includes(new Date(day+'T12:00:00Z').getUTCDay());
}
export function releaseAt(day) {
  const release = addDays(day,-7);
  const nominal = Date.parse(release+'T00:00:00Z');
  // London midnight is either UTC midnight or the prior UTC hour.
  return londonDay(nominal-3600000)===release ? nominal-3600000 : nominal;
}
export function candidates(rows, venue, day) {
  if (!VENUES.includes(venue) || !eligible(day)) return [];
  const available = new Map();
  for (const row of rows) {
    const m = /^(\d{1,2})(am|pm)$/.exec(row.time);
    if (!m) throw Error('Court time layout changed');
    const hour = (+m[1]%12)+(m[2]==='pm'?12:0);
    for (const box of row.inputs) {
      if (box.disabled) continue;
      const match = /^(?:Tennis court|Court) ([1-4])\s*£(\d+(?:\.\d{1,2})?)$/.exec(box.label);
      if (!match) {
        if (/^(Tennis court|Court)\b/.test(box.label)) throw Error('Unknown court price');
        continue;
      }
      const key = `${hour}:${match[1]}`;
      if (available.has(key)) throw Error('Duplicate court cell');
      available.set(key,Math.round(Number(match[2])*100));
    }
  }
  const found=[];
  for (const hours of [2,1]) for (const hour of [20,21]) for (let court=1;court<=4;court++) {
    const prices=Array.from({length:hours},(_,i)=>available.get(`${hour+i}:${court}`));
    if (prices.every(p=>p!==undefined)) found.push({venue:NAMES[venue],date:day,court,start:`${hour}:00`,hours,totalGBP:(prices.reduce((a,b)=>a+b,0)/100).toFixed(2)});
  }
  return found;
}
