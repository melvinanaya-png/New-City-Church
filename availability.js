import { ROOMS, CLASSROOMS } from './approvals.js';
import { validateRecurrence } from './recurrence.js';
import { calendarConfigured, calendarError } from './google-calendar.js';
import { googleAccessToken } from './google-mail.js';
const ZONE = 'America/Chicago';
export function validateSchedule(data) {
  if (!data || typeof data !== 'object' || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date) return 'Choose a valid date.';
  if (![data.start,data.end].every(time => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || data.end <= data.start) return 'End time must be after start time.';
  return validateRecurrence(data.recurrence);
}
// Resolve local wall time using the calendar's IANA zone, including DST.
export function localInstant(date, time, zone = ZONE) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const format = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant = wall;
  for (let i=0;i<4;i++) {
    const parts = Object.fromEntries(format.formatToParts(instant).map(part=>[part.type,part.value]));
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const delta = wall - rendered;
    if (!delta) return instant;
    instant += delta;
  }
  throw Error('This local time does not exist because of the daylight saving change. Choose another time.');
}
export function scheduleWindows(data) {
  const error=validateSchedule(data); if(error) throw Error(error);
  const count=data.recurrence?.count || 1, windows=[];
  const initial=new Date(`${data.date}T12:00:00Z`);
  let step=0;
  while(windows.length<count) {
    const date=new Date(initial);
    if(data.recurrence?.frequency==='weekly') date.setUTCDate(date.getUTCDate()+step*7*data.recurrence.interval);
    if(data.recurrence?.frequency==='monthly') {
      date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()+step); const month=date.getUTCMonth(); date.setUTCDate(initial.getUTCDate());
      if(date.getUTCMonth()!==month) {step++;continue;}
    }
    const day=date.toISOString().slice(0,10);
    windows.push({date:day,start:localInstant(day,data.start),end:localInstant(day,data.end)}); step++;
  }
  return windows;
}
function eventRooms(event) {
  const encoded=event.extendedProperties?.private?.newCityRooms;
  if(encoded) {try {const parsed=JSON.parse(encoded); if(Array.isArray(parsed) && parsed.length && parsed.every(room=>ROOMS.includes(room))) return parsed;} catch { /* Use readable room fields on older events. */ }}
  const location=event.location || '';
  const description=event.description?.match(/^Rooms:\s*(.+)$/m)?.[1] || '';
  const values=(description || location).split(',').map(value=>value.trim().toLowerCase());
  const rooms=[...new Set([...(values.includes('classrooms') ? CLASSROOMS : []),...ROOMS.filter(room=>values.includes(room.toLowerCase()))])];
  // Unlabelled busy events are conservative whole-building holds.
  return rooms.length ? rooms : ['Entire Building'];
}
function overlapsRoom(room, booked) {
  return room==='Entire Building' || room==='Other' || booked.includes('Entire Building') || booked.includes('Other') || booked.includes(room);
}
function eventInstant(value) {
  if(value?.date) return localInstant(value.date,'00:00');
  if(typeof value?.dateTime!=='string') throw Error('A calendar event has an unreadable time.');
  if(/(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)) {
    const result=Date.parse(value.dateTime); if(Number.isFinite(result)) return result;
  } else return localInstant(value.dateTime.slice(0,10),value.dateTime.slice(11,16),value.timeZone || ZONE);
  throw Error('A calendar event has an unreadable time.');
}
export function findConflicts(data, events) {
  const windows=scheduleWindows(data),blocked=new Map();
  for(const event of events) {
    if(event.status==='cancelled' || event.transparency==='transparent') continue;
    const ownId=data.id && `nc${data.id.replace(/-/g,'')}`;
    if(data.id && (event.extendedProperties?.private?.newCityRequestId===data.id || event.id===ownId || event.recurringEventId===ownId)) continue;
    const start=eventInstant(event.start),end=eventInstant(event.end),booked=eventRooms(event);
    for(const window of windows) if(window.start<end && window.end>start) {
      for(const room of data.rooms) if(overlapsRoom(room,booked)) {
        const dates=blocked.get(room) || new Set();dates.add(window.date);blocked.set(room,dates);
      }
    }
  }
  return [...blocked].map(([room,dates])=>({room,firstConflictDate:[...dates].sort()[0],occurrences:dates.size}));
}
export async function checkAvailability(data) {
  if(!calendarConfigured()) return {ok:false,error:'Calendar availability is not connected. Please contact the facilities team.'};
  try {
    const windows=scheduleWindows(data),token=await googleAccessToken();
    if(!token) return {ok:false,error:'Calendar availability could not be authorized. Please contact the facilities team.'};
    const params=new URLSearchParams({singleEvents:'true',orderBy:'startTime',maxResults:'2500',timeMin:new Date(windows[0].start).toISOString(),timeMax:new Date(windows.at(-1).end).toISOString(),timeZone:ZONE});
    const endpoint=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(data.calendarTargetId || process.env.GOOGLE_CALENDAR_ID)}/events`;
    const events=[],seen=new Set();
    while(true) {
      const response=await fetch(`${endpoint}?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok) return {ok:false,error:await calendarError(response)};
      const result=await response.json();
      if(result.items!==undefined && !Array.isArray(result.items)) throw Error('Invalid calendar response.');
      events.push(...(result.items || []));
      if(!result.nextPageToken) break;
      if(seen.has(result.nextPageToken) || events.length>50000) throw Error('Calendar results could not be checked completely.');
      seen.add(result.nextPageToken);params.set('pageToken',result.nextPageToken);
    }
    return {ok:true,conflicts:findConflicts(data,events)};
  } catch(error) {
    return {ok:false,error:error.message?.includes('daylight saving') ? error.message : 'Calendar availability could not be checked completely. Please try again; bookings are blocked until the check succeeds.'};
  }
}
