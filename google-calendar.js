import { googleAccessToken } from './google-mail.js';
export function calendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}
export async function createApprovedEvent(record, details) {
  if (record.status !== 'approved') throw Error('Calendar events require completed room approvals.');
  if (!calendarConfigured()) return {status:'not-configured',error:'Google Calendar is not configured yet.'};
  const calendarId = record.calendarTargetId || process.env.GOOGLE_CALENDAR_ID;
  // Google accepts base32hex IDs. The same request always has the same event ID.
  const eventId = `nc${record.id.replace(/-/g,'')}`;
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const body = {
    id:eventId, summary:record.title,
    description:`Approved New City building request\nReference: ${record.id}\nMinistry: ${record.ministry}\nRequester: ${record.name} (${record.email})\n${details}\nAttendance: ${record.guests}\nNotes: ${record.notes || 'None'}\n\nThis Google Calendar event does not reserve rooms in Planning Center.`,
    location:record.rooms?.join(', ') || record.space,
    start:{dateTime:`${record.date}T${record.start}:00`,timeZone:'America/Chicago'},
    end:{dateTime:`${record.date}T${record.end}:00`,timeZone:'America/Chicago'},
    extendedProperties:{private:{newCityRequestId:record.id}},
    reminders:{useDefault:false}
  };
  try {
    const token = await googleAccessToken();
    if (!token) return {status:'failed',error:'Google authorization failed. Reauthorize the account and retry.'};
    const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    let response = await fetch(`${endpoint}?sendUpdates=none`, {method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    // A response lost after Google accepts the insert can safely be retried.
    if (response.status === 409) response = await fetch(`${endpoint}/${eventId}`,{headers,signal:AbortSignal.timeout(15000)});
    if (!response.ok) return {status:'failed',error:response.status === 403 ? 'Calendar access was denied. Enable Google Calendar API, grant Calendar permission, and check access to the shared calendar.' : `Google Calendar could not save the event (HTTP ${response.status}). Retry after checking the connection.`};
    const event = await response.json();
    if (event.id !== eventId || event.extendedProperties?.private?.newCityRequestId !== record.id || event.status === 'cancelled') return {status:'failed',error:'The calendar event could not be verified. Contact the administrator before retrying.'};
    const url = typeof event.htmlLink === 'string' && /^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(event.htmlLink) ? event.htmlLink : undefined;
    return {status:'created',eventId,calendarId,url};
  } catch {
    return {status:'failed',error:'Calendar delivery could not be confirmed. Retry using the same approval link; the request ID prevents duplicate events.'};
  }
}
