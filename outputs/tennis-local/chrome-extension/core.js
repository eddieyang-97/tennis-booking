import {SUPPORTED_VENUES,normalizeSettings,hourValue,settingsCap} from './booking-settings.js';
export const VENUES = [...SUPPORTED_VENUES];
export const NAMES = {'bethnal-green-gardens':'Bethnal Green Gardens','st-johns-park':'St Johns Park','victoria-park':'Victoria Park'};
// Preserve legacy single-court keys and journals. Mixed bookings add an
// explicit court per hour; the first court remains available for old displays.
export function slotCourts(slot) {
 const courts=Object.hasOwn(slot,'courts')?slot.courts:Array(slot.hours).fill(slot.court);
 if(slot.venue==='st-johns-park'&&Array.isArray(courts)&&courts.some(c=>![1,2].includes(c)))throw Error('Invalid St Johns court identity');
 if(!Array.isArray(courts)||courts.length!==slot.hours||courts[0]!==slot.court||!courts.every(c=>[1,2,3,4].includes(c)))throw Error('Invalid hourly court identity');
 return courts;
}
export function slotKey(slot) {slotCourts(slot);return JSON.stringify([slot.venue,slot.date,slot.courts||slot.court,slot.start,slot.hours]);}
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
  // Each job is armed explicitly; every valid calendar date is eligible.
  addDays(day,0); return true;
}
export function releaseAt(day) {
  const release = addDays(day,-7);
  const nominal = Date.parse(release+'T00:00:00Z');
  // London midnight is either UTC midnight or the prior UTC hour.
  return londonDay(nominal-3600000)===release ? nominal-3600000 : nominal;
}
export function candidates(rows, venue, day, {basketOnly=false,settings=null}={}) {
  if (!VENUES.includes(venue) || (!basketOnly && !eligible(day))) return [];
  addDays(day,0);
  const policy=settings&&!basketOnly?normalizeSettings(settings):null;
  if(policy&&!policy.venues.includes(venue))return [];
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
      if(venue==='st-johns-park'&&Number(match[1])>2)throw Error('Unknown St Johns court');
      const key = `${hour}:${match[1]}`;
      if (available.has(key)) throw Error('Duplicate court cell');
      available.set(key,Math.round(Number(match[2])*100));
    }
  }
  const found=[];
  const durations=policy?[2,1].filter(hours=>hours<=policy.preferredHours&&hours>=policy.minHours):(basketOnly?[2]:[2,1]);
  for (const hours of durations) for (const hour of (policy?Array.from({length:hourValue(policy.latestFinish,{end:true})-hourValue(policy.earliestStart)-hours+1},(_,i)=>hourValue(policy.earliestStart)+i):(basketOnly?[9]:[20,21]))) {
    const choices=[1,2,3,4].map(court=>Array(hours).fill(court));
    if(hours===2&&(!policy||policy.allowCourtSwitch))for(let first=1;first<=4;first++)for(let second=1;second<=4;second++)if(first!==second)choices.push([first,second]);
    for(const courts of choices) {
     const prices=courts.map((court,i)=>available.get(`${hour+i}:${court}`));
     if(prices.every(p=>p!==undefined)&&(!policy||prices.reduce((a,b)=>a+b,0)<=settingsCap(policy,hours)))found.push({venue:NAMES[venue],date:day,court:courts[0],...(courts.some(c=>c!==courts[0])?{courts}:{}),start:`${String(hour).padStart(2,'0')}:00`,hours,totalGBP:(prices.reduce((a,b)=>a+b,0)/100).toFixed(2)});
    }
  }
  return found;
}
