import { emailTimeRange } from './time-format.js';
import { setupResponsibility } from './setup-policy.js';
import { AGREEMENT_VERSION, agreementHtml, validateSignature, signedAgreement, contractAttachments } from './agreement.js';
import { sendRequesterCopy } from './requester-mail.js';
import { checkAvailability, validateSchedule } from './availability.js';
import { validateRecurrence, recurrenceSummary } from './recurrence.js';
import { calendarConfigured, createApprovedEvent, checkCalendarAccess } from './google-calendar.js';
import { approvalEmailHtml } from './approval-email.js';
import { ROOMS, approvalGroupsFor, approvalComplete, AV_CONTACT, needsAvNotification } from './approvals.js';
import { emailConfigured, sendMail } from './google-mail.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { requestStoreFromEnvironment, storageErrorMessage } from './request-store.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = process.env.DATA_DIR || root + '.data/requests';
const requestStore = requestStoreFromEnvironment(dataDir);
const approvedRecipients = ['facilities@newcitystc.church', 'mark.forbes@newcitystc.church'];
const hash = value => createHash('sha256').update(value).digest('hex');
const approving = new Set();
let bookingQueue = Promise.resolve();
function acquireBookingLock() {
  const previous=bookingQueue; let release;
  bookingQueue=new Promise(resolve=>{release=resolve;});
  return previous.then(()=>release);
}
function availabilityFailure(res, result) {
  if(!result.ok) {json(res,503,{error:result.error});return true;}
  if(result.conflicts.length) {json(res,409,{error:'Booking blocked: '+result.conflicts.map(c=>`${c.room} is already booked on ${c.firstConflictDate}${c.occurrences>1 ? ` (${c.occurrences} dates in the series)` : ''}`).join('; ')+'. Choose different rooms or dates.',conflicts:result.conflicts});return true;}
  return false;
}
export function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Invalid request.';
  const required = ['name', 'email', 'title', 'ministry', 'date', 'start', 'end'];
  for (const field of required) if (typeof data[field] !== 'string' || !data[field].trim() || data[field].length > 200) return `Please provide a valid ${field}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Please enter a valid email address.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date) return 'Choose a valid date.';
  if (![data.start, data.end].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || data.end <= data.start) return 'End time must be after start time.';
  if (!Number.isInteger(Number(data.guests)) || Number(data.guests) < 1 || Number(data.guests) > 5000) return 'Enter an attendance between 1 and 5,000.';
  if (typeof data.notes !== 'string' || data.notes.length > 4000) return 'Notes must be under 4,000 characters.';
  const groups = {
    rooms: ROOMS,
    equipment: ['Sound Technician', 'TV Screens', 'Sound/Mixer', 'Microphones', 'TV/DVD', 'Other'],
    setup: ['Round Tables', 'Rectangular Tables', 'Chairs']
  };
  for (const [name, choices] of Object.entries(groups)) {
    if (!Array.isArray(data[name]) || data[name].length < (name === 'setup' ? 0 : 1) || data[name].length > choices.length || new Set(data[name]).size !== data[name].length || data[name].some(value => !choices.includes(value))) return `Select at least one valid ${name} option.`;
  }
  for (const name of ['rooms', 'equipment']) {
    const detail = data[`${name}Other`];
    if (typeof detail !== 'string' || detail.length > 500 || (data[name].includes('Other') && !detail.trim())) return `Please specify other ${name}.`;
  }
  if (!data.quantities || typeof data.quantities !== 'object' || Array.isArray(data.quantities)) return 'Specify setup quantities.';
  for (const [choice, key, limit] of [['Round Tables','roundTables',6], ['Rectangular Tables','rectangularTables',8], ['Chairs','chairs',60]]) {
    if (data.setup.includes(choice) && (!Number.isInteger(data.quantities[key]) || data.quantities[key] < 1 || data.quantities[key] > limit)) return `Specify a quantity between 1 and ${limit} for ${choice.toLowerCase()}.`;
  }
  const recurrenceError = validateRecurrence(data.recurrence);
  if (recurrenceError) return recurrenceError;
  if (data.agree !== true) return 'Please acknowledge the agreement and that your request requires approval.';
  return validateSignature(data);
}
function requestDetails(record,includeSignature=true) {
  // Old records can still be reviewed until their approval links expire.
  const rooms = record.rooms ? record.rooms.join(', ') + (record.rooms.includes('Other') ? ` (${record.roomsOther})` : '') : record.space;
  const equipment = record.equipment ? record.equipment.join(', ') + (record.equipment.includes('Other') ? ` (${record.equipmentOther})` : '') : (record.needs || []).join(', ');
  const setup = record.setup ? record.setup.map(choice => `${choice}: ${record.quantities?.[{'Round Tables':'roundTables','Rectangular Tables':'rectangularTables','Chairs':'chairs'}[choice]]}`).join(', ') || 'None requested' : 'See original notes';
  return `Setup/cleanup: ${setupResponsibility(record)}\n${includeSignature ? `Agreement: ${record.agreement ? `Signed by ${record.agreement.signedName} at ${record.agreement.signedAt}; version ${record.agreement.version}` : 'No signed agreement on file for this older request'}\n` : ''}Schedule: ${recurrenceSummary(record.date,record.recurrence)}\nRooms: ${rooms}\nEquipment: ${equipment}\nSetup quantities: ${setup}`;
}
async function sendApprovalCopy(record) {
  if(!record.agreement || record.requesterApprovalNotification==='sent')return true;
  let sent=false;
  try{sent=(await sendRequesterCopy(record,'approved')).ok;}catch{ /* Record uncertain delivery without logging the contract. */ }
  record.requesterApprovalNotification=sent?'sent':'failed-or-uncertain';
  await requestStore.save(record);
  return sent;
}
const json = (res, status, value) => {res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value));};
export const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/status') return json(res, 200, {emailConfigured: emailConfigured(), calendarConfigured: calendarConfigured(), storageBackend:requestStore.backend, durableStorageConfigured:requestStore.backend==='firestore'});
    if (path === '/api/availability' && req.method === 'POST') {
      let body=''; for await(const chunk of req) {body+=chunk;if(body.length>4000)return json(res,413,{error:'Request too large.'});}
      let data;try{data=JSON.parse(body);}catch{return json(res,400,{error:'Invalid request.'});}
      const error=validateSchedule(data);if(error)return json(res,400,{error});
      const result=await checkAvailability({date:data.date,start:data.start,end:data.end,recurrence:data.recurrence,rooms:ROOMS});
      return json(res,result.ok?200:503,result.ok?{conflicts:result.conflicts}:{error:result.error});
    }
    if (path === '/approval' && req.method === 'GET') {
      res.writeHead(200, {'Content-Type':'text/html','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'"});
      return res.end(await readFile(root + 'public/approval.html'));
    }
    if (path === '/api/approve' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) {body += chunk; if(body.length > 2000) return json(res,413,{error:'Request too large.'});}
      let input; try {input = JSON.parse(body);} catch {return json(res,400,{error:'Invalid request.'});}
      if (!/^[0-9a-f-]{36}$/.test(input?.id || '') || !/^[0-9a-f]{64}$/.test(input?.token || '')) return json(res,403,{error:'Invalid approval link.'});
      if(approving.has(input.id)) return json(res,409,{error:'Approval is already processing. Please wait and try again.'});
      approving.add(input.id);
      const releaseBookingLock=await acquireBookingLock();
      try {
        const record = await requestStore.get(input.id);
        if(!record)return json(res,404,{error:'Request not found.'});
        // Preserve old single-approver test links when their records still exist.
        if (!record.approvals) {
          record.approvals = [{email:'melvin.anaya@newcitystc.church',tokenHash:record.tokenHash,approvedAt:null}];
          record.approvalGroups = [{name:'Legacy test',approvers:['melvin.anaya@newcitystc.church']}];
        }
        const approver = record.approvals.find(approval => approval.tokenHash === hash(input.token));
        if(!approver) return json(res,403,{error:'Invalid approval link.'});
        if(record.status === 'approved' && record.approvalNotification === 'sent' && record.calendarStatus === 'created' && (!record.agreement || record.requesterApprovalNotification==='sent')) return json(res,200,{status:'approved',calendarStatus:record.calendarStatus,calendarError:record.calendarError});
        if(Date.now() > record.expiresAt) return json(res,410,{error:'This approval link has expired. Contact the site administrator.'});
        approver.approvedAt ||= new Date().toISOString();
        const complete = approvalComplete(record);
        record.status = complete ? 'approved' : 'pending';
        if (!complete) {
          await requestStore.save(record);
          return json(res,200,{status:'pending',remainingGroups:record.approvalGroups.filter(group => !group.approvers.some(email => record.approvals.some(a => a.email === email && a.approvedAt))).map(group => group.name)});
        }
        if(record.calendarStatus !== 'created' && availabilityFailure(res,await checkAvailability(record))) return;
        record.approvedAt ||= new Date().toISOString();
        record.calendarTargetId ||= process.env.GOOGLE_CALENDAR_ID;
        await requestStore.save(record);
        if (record.calendarStatus !== 'created') {
          const calendar = await createApprovedEvent(record,requestDetails(record,false));
          record.calendarStatus = calendar.status; record.calendarError = calendar.error;
          if (calendar.status === 'created') {record.calendarEventId = calendar.eventId; record.calendarEventUrl = calendar.url;}
        }
        if (record.approvalNotification === 'sent') {
          await requestStore.save(record);
          if(!await sendApprovalCopy(record))return json(res,502,{error:'Approval was saved, but the requester confirmation could not be confirmed. Retry from this approval link; do not submit a new request.'});
          return json(res,200,{status:'approved',calendarStatus:record.calendarStatus,calendarError:record.calendarError});
        }
        record.approvalNotification = 'pending';
        await requestStore.save(record);
        const approvedBy = record.approvals.filter(a => a.approvedAt).map(a => a.email).join(', ');
        const response = await sendMail(approvedRecipients, `Approved building request: ${record.title.replace(/[\r\n]/g,' ')}`, `This building request has received all required room approvals.\nApproved by: ${approvedBy}\n\nEvent: ${record.title}\nRequester: ${record.name} (${record.email})\nMinistry: ${record.ministry}\nDate: ${record.date}\nTime: ${emailTimeRange(record.start,record.end)}\n${requestDetails(record)}\nAttendance: ${record.guests}\nNotes: ${record.notes}\nReference: ${record.id}\n\n${record.calendarStatus === 'created' ? `Added to the shared New City Building Google Calendar.${record.calendarEventUrl ? `\nCalendar event: ${record.calendarEventUrl}` : ''}` : `CALENDAR ACTION REQUIRED: Google Calendar entry is pending. ${record.calendarError || 'Check calendar setup.'} Reopen the approval link and confirm again to retry without creating a duplicate.`}\n\nGoogle Calendar does not reserve rooms in Planning Center; any Planning Center entry remains manual.`, `approved-${record.id}`, record.email, undefined, await contractAttachments(record));
        if(!response.ok) return json(res,502,{error:'Approval was saved, but notifications failed. Retry approval to resend the notifications.'});
        record.approvalNotification = 'sent'; await requestStore.save(record);
        if(!await sendApprovalCopy(record))return json(res,502,{error:'Approval was saved, but the requester confirmation could not be confirmed. Retry from this approval link; do not submit a new request.'});
        return json(res,200,{status:'approved',calendarStatus:record.calendarStatus,calendarError:record.calendarError});
      } finally {releaseBookingLock();approving.delete(input.id);}
    }
    if (req.method === 'POST' && path === '/api/requests') {
      if (!emailConfigured()) return json(res, 503, {error: 'Email delivery has not been connected yet. Please contact facilities@newcitystc.church to submit your request.'});
      let body = ''; for await (const chunk of req) {body += chunk; if (body.length > 16000) return json(res, 413, {error: 'Request is too large.'});}
      let data; try {data = JSON.parse(body);} catch {return json(res, 400, {error: 'Invalid request.'});}
      if (data?.website) return json(res, 400, {error: 'Invalid request.'});
      const error = validate(data); if (error) return json(res, 400, {error});
      if(availabilityFailure(res,await checkAvailability({...data,id:undefined,calendarTargetId:undefined})))return;
      const id = randomUUID();
      const approvalGroups = approvalGroupsFor(data.rooms);
      const tokens = [...new Set(approvalGroups.flatMap(group => group.approvers))].map(email => ({email,token:randomBytes(32).toString('hex')}));
      const record = {id, approvalGroups, approvals:tokens.map(({email,token}) => ({email,tokenHash:hash(token),approvedAt:null,notification:'pending'})), expiresAt: Date.now() + 14 * 86400000, ...Object.fromEntries(['name','email','title','ministry','date','start','end','guests','notes','rooms','roomsOther','equipment','equipmentOther','setup','quantities','recurrence'].map(k => [k, data[k]])), status: 'pending', submittedAt: new Date().toISOString()};
      record.agreement = signedAgreement(data);
      record.requesterReceiptNotification = 'pending';
      record.avRequested = needsAvNotification(data.equipment);
      record.avNotification = record.avRequested ? 'pending' : 'not-required';
      approving.add(id);
      try {
      await requestStore.save(record);
      const attachments = await contractAttachments(record);
      for (const {email,token} of tokens) {
        const approvalUrl = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/approval#id=${id}&token=${token}`;
        const routing = approvalGroups.map(group => `${group.name}: either ${group.approvers.join(' or ')}`).join('\n');
        const message = `New building request — pending review\nReference: ${id}\n\nEvent: ${data.title}\nMinistry: ${data.ministry}\nRequester: ${data.name} (${data.email})\nDate: ${data.date}\nTime: ${emailTimeRange(data.start,data.end)}\n${requestDetails(record)}\nAttendance: ${data.guests}\nNotes: ${data.notes || 'None'}\n\nApproval routing:\n${routing}\nYour approval covers the complete schedule shown above. One approval from each applicable room group is required. Hope can approve every group.\n\nPlease review and approve with your private link (expires in 14 days): ${approvalUrl}\nDo not forward this link; anyone with it can approve your room group(s). Once all room groups are approved, Darrell and Mark are notified. After approval, the app adds the event to the shared Google Calendar when connected. Planning Center reservations remain separate.`;
        let delivered = false;
        try {delivered = (await sendMail([email], `${record.avRequested && email === AV_CONTACT ? 'AV support requested — ' : ''}Building request: ${data.title.replace(/[\r\n]/g,' ')}`, message, `${id}-${record.approvals.findIndex(a => a.email === email)}`, data.email, approvalEmailHtml(record, approvalUrl, requestDetails(record), routing), attachments)).ok;} catch { /* Preserve the request and report uncertain delivery without automatic retries. */ }
        record.approvals.find(a => a.email === email).notification = delivered ? 'sent' : 'failed-or-uncertain';
        await requestStore.save(record);
      }
      if (record.avRequested) {
        const approvalEmail = record.approvals.find(a => a.email === AV_CONTACT);
        if (approvalEmail) record.avNotification = approvalEmail.notification === 'sent' ? 'included-in-approval-email' : 'failed-or-uncertain';
        else {
          let delivered = false;
          try {delivered = (await sendMail([AV_CONTACT], `AV support requested: ${data.title.replace(/[\r\n]/g,' ')}`, `A building request includes AV support. This is an advance notice, not a confirmed booking or an approval assignment.\n\nEvent: ${data.title}\nRequester: ${data.name} (${data.email})\nDate: ${data.date}\nTime: ${emailTimeRange(data.start,data.end)}\n${requestDetails(record)}\nNotes: ${data.notes || 'None'}\nReference: ${id}\n\n${setupResponsibility(record)}\nThe assigned room approvers will review the request.`, `av-${id}`, data.email)).ok;} catch { /* Preserve failure status for follow-up. */ }
          record.avNotification = delivered ? 'sent' : 'failed-or-uncertain';
        }
        await requestStore.save(record);
      }
      let requesterSent=false;
      try{requesterSent=(await sendRequesterCopy(record,'received',attachments)).ok;}catch{ /* Preserve the signed request if delivery is uncertain. */ }
      record.requesterReceiptNotification=requesterSent?'sent':'failed-or-uncertain';
      await requestStore.save(record);
      if (record.approvals.some(a => a.notification !== 'sent') || record.avNotification === 'failed-or-uncertain' || !requesterSent) return json(res,502,{error:`Your request was saved, but some notification emails could not be confirmed. Contact facilities@newcitystc.church with reference ${id}. Do not resubmit.`});
      return json(res, 201, {id,status:'pending'});
      } finally {approving.delete(id);}
    }
    const files = {'/':'index.html','/styles.css':'styles.css','/app.js':'app.js','/approval.js':'approval.js','/assets/building-usage-fees.pdf':'assets/building-usage-fees.pdf','/assets/new-city-logo.png':'assets/new-city-logo.png','/assets/fonts/Barlow-Regular.ttf':'assets/fonts/Barlow-Regular.ttf','/assets/fonts/Barlow-Medium.ttf':'assets/fonts/Barlow-Medium.ttf','/assets/fonts/BarlowCondensed-SemiBold.ttf':'assets/fonts/BarlowCondensed-SemiBold.ttf'};
    if (req.method !== 'GET' || !files[path]) return json(res, 404, {error:'Not found'});
    res.writeHead(200, {'Cache-Control':path==='/'?'no-store':'no-cache','Content-Type':path.endsWith('.pdf')?'application/pdf':path.endsWith('.png')?'image/png':path.endsWith('.ttf')?'font/ttf':path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'self' https://newcitystc.church https://www.newcitystc.church"});
    let content=await readFile(root + 'public/' + files[path]);
    if(path==='/')content=content.toString().replace('<!-- AGREEMENT_TERMS -->',agreementHtml()).replace('<!-- AGREEMENT_VERSION -->',AGREEMENT_VERSION);
    res.end(content);
  } catch {json(res, 500, {error:'We could not complete your request. Please contact facilities@newcitystc.church before retrying.'});}
});
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('New City requests listening on port ' + (process.env.PORT || 3000));
  requestStore.check().then(result=>console.log('Request storage check: '+result)).catch(error=>console.log('Request storage check failed: '+storageErrorMessage(error)));
  checkCalendarAccess().then(result => console.log('Google Calendar check: ' + result)).catch(() => console.log('Google Calendar check: Unable to complete diagnostics.'));
});
