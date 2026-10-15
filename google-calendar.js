import { googleAccessToken } from './google-mail.js';
export function calendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}
export async function calendarError(response) {
  let payload; try {payload = await response.json();} catch { /* Report status without dumping provider bodies. */ }
  const reasons = [
    ...(Array.isArray(payload?.error?.errors) ? payload.error.errors.map(item => item.reason) : []),
    ...(Array.isArray(payload?.error?.details) ? payload.error.details.map(item => item.reason) : [])
  ];
  const diagnoses = [
    [['ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions'], 'The saved Google refresh token lacks Calendar permission. Authorize both Gmail send and Calendar events scopes, then replace GOOGLE_REFRESH_TOKEN in Render.'],
    [['SERVICE_DISABLED','accessNotConfigured','API_DISABLED'], 'Google Calendar API is disabled for the project used by this token. Enable it in that project and allow a few minutes for activation.'],
    [['domainPolicy'], 'Your Google Workspace policy blocks this Calendar access. Review API access controls in the Workspace Admin console.'],
    [['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded'], 'Google Calendar quota or rate limit was reached. Wait before retrying; credentials do not need replacing.'],
    [['forbiddenForNonOrganizer','requiredAccessLevel'], 'The authorized Google account does not have the required calendar editing permission.'],
    [['forbidden'], 'Google denied calendar access. Verify the account that authorized the refresh token has permission to edit the shared calendar.']
  ];
  for (const [codes, message] of diagnoses) {
    const code = codes.find(code => reasons.includes(code));
    if (code) return `Google Calendar: ${message} (HTTP ${response.status}; ${code})`;
  }
  if (response.status === 404) return 'Google Calendar was not found or is not visible to the authorized account. Check GOOGLE_CALENDAR_ID and calendar sharing. (HTTP 404)';
  if (response.status === 401) return 'Google Calendar authorization was rejected. Reauthorize the Google account. (HTTP 401)';
  if (response.status === 403) return 'Calendar access was denied, but Google supplied no recognized reason. Check Calendar API activation, granted scopes and the authorized account. (HTTP 403)';
  return `Google Calendar could not save the event (HTTP ${response.status}). Retry after checking the connection.`;
}
export async function checkCalendarAccess() {
  if (!calendarConfigured()) return 'Not configured; calendar settings are missing.';
  try {
    const token = await googleAccessToken();
    if (!token) return 'Google token refresh failed; check the matching OAuth credentials and refresh token.';
    // Read-only check: ask for response kind only, never event details.
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events?maxResults=1&fields=kind`, {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if (!response.ok) return calendarError(response);
    return 'Calendar read access verified. Event creation still requires a live approval test.';
  } catch {return 'Calendar check could not reach Google; retry after checking connectivity.';}
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
    if (!response.ok) return {status:'failed',error:await calendarError(response)};
    const event = await response.json();
    if (event.id !== eventId || event.extendedProperties?.private?.newCityRequestId !== record.id || event.status === 'cancelled') return {status:'failed',error:'The calendar event could not be verified. Contact the administrator before retrying.'};
    const url = typeof event.htmlLink === 'string' && /^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(event.htmlLink) ? event.htmlLink : undefined;
    return {status:'created',eventId,calendarId,url};
  } catch {
    return {status:'failed',error:'Calendar delivery could not be confirmed. Retry using the same approval link; the request ID prevents duplicate events.'};
  }
}
