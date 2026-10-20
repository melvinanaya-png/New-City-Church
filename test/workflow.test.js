import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'newcity-tests-'));
process.env.DATA_DIR = dir;
delete process.env.GOOGLE_CALENDAR_ID;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
const {AGREEMENT_VERSION, AGREEMENT_TERMS}=await import('../agreement.js');
const {approvalGroupsFor} = await import('../approvals.js');
const {server, validate} = await import('../server.js');
const request = {name:'Test Person',email:'person@example.com',title:'Community dinner',ministry:'Community',date:'2026-12-12',start:'17:00',end:'19:00',rooms:['Kitchen'],roomsOther:'',equipment:['Other'],equipmentOther:'Whiteboard',setup:['Round Tables','Chairs'],quantities:{roundTables:5,chairs:25},guests:25,notes:'Accessible seating',agree:true,signatureName:'Test Person',signatureConsent:true,agreementVersion:AGREEMENT_VERSION};
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
const messages = [];
const requesterMessages = [];
let failRequesterApproval = false;
function decodeMime(raw, output={attachments:[]}) {
  const separator=raw.indexOf('\r\n\r\n');if(separator<0)return output;
  const headers=raw.slice(0,separator),body=raw.slice(separator+4);
  const boundary=headers.match(/boundary="([^"]+)"/)?.[1];
  if(boundary){for(const part of body.split(`--${boundary}`).slice(1,-1))decodeMime(part.trim(),output);return output;}
  const content=Buffer.from(body.replace(/\r\n/g,''),'base64');
  if(/Content-Disposition: attachment/i.test(headers))output.attachments.push({filename:headers.match(/filename="([^"]+)"/)?.[1],content});
  else output[headers.includes('text/html')?'html':'text']=content.toString();
  return output;
}
const calendarEvents = new Map();
let calendarFailure = false;
let calendarInserts = 0;
let availabilityEvents = [];
let availabilityFailure = false;
let includeCreatedBookings = false;
let availabilityPages = null;
globalThis.fetch = (url, options) => {
  if(String(url).startsWith('https://www.googleapis.com/calendar/v3/')) {
    if(String(url).includes('singleEvents=true')) {
      if(availabilityFailure)return Promise.resolve(new Response('{}',{status:503}));
      if(availabilityPages) {const page=new URL(String(url)).searchParams.get('pageToken');return Promise.resolve(new Response(JSON.stringify(availabilityPages[page?1:0]),{status:200}));}
      return Promise.resolve(new Response(JSON.stringify({items:[...availabilityEvents,...(includeCreatedBookings?[...calendarEvents.values()]:[])]}),{status:200}));
    }
    if(calendarFailure) return Promise.resolve(new Response('{}',{status:403}));
    if(options.method === 'POST') {
      calendarInserts++;
      const event=JSON.parse(options.body);
      if(calendarEvents.has(event.id)) return Promise.resolve(new Response('{}',{status:409}));
      calendarEvents.set(event.id,{...event,htmlLink:`https://calendar.google.com/calendar/event?eid=${event.id}`});
      return Promise.resolve(new Response(JSON.stringify(calendarEvents.get(event.id)),{status:201}));
    }
    if(String(url).includes('?maxResults=')) return Promise.resolve(new Response(JSON.stringify({kind:'calendar#events'}),{status:200}));
    const event=calendarEvents.get(String(url).split('/').at(-1));
    return Promise.resolve(new Response(JSON.stringify(event||{}),{status:event?200:404}));
  }
  if(url === 'https://oauth2.googleapis.com/token') return Promise.resolve(new Response(JSON.stringify({access_token:'test-access-token'}),{status:200}));
  if(url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    const raw = Buffer.from(JSON.parse(options.body).raw,'base64url').toString();
    const [headers,...parts] = raw.split('\r\n\r\n');
    const decoded=decodeMime(raw);
    const message={to:headers.match(/^To: (.+)$/m)[1].trim().split(', '),from:headers.match(/^From: (.+)$/m)[1].trim(),...decoded};
    if(message.to.includes('person@example.com')) {
      requesterMessages.push(message);
      if(failRequesterApproval && message.text.includes('received all required room approvals'))return Promise.resolve(new Response('{}',{status:503}));
    } else messages.push(message);
    return Promise.resolve(new Response('{}',{status:200}));
  }
  return realFetch(url,options);
};
const post = (path, data) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
test('request validation rejects invalid time and email', () => {
  assert.equal(validate(request), undefined);
  assert.match(validate({...request,end:'16:00'}), /End time/);
  assert.match(validate({...request,email:'bad'}), /email/);
  for (const group of ['rooms','equipment']) assert.match(validate({...request,[group]:[]}), /Select at least one/);
  assert.match(validate({...request,quantities:{roundTables:0,chairs:25}}), /quantity/);
  assert.match(validate({...request,rooms:['Other'],roomsOther:''}), /specify other rooms/);
  assert.match(validate({...request,agree:false}), /acknowledge/);
  assert.equal(validate({...request,setup:['Rectangular Tables'],quantities:{rectangularTables:3}}), undefined);
});
test('serves page and does not claim email delivery without credentials', async () => {
  assert.match(await (await fetch(base)).text(), /MAKE ROOM FOR/);
  assert.equal((await post('/api/requests',request)).status,503);
});
test('Hope receives common-room requests; approval notifies Darrell, Mark and Daija once', async () => {
  process.env.GOOGLE_CALENDAR_ID='test-calendar@group.calendar.google.com'; process.env.GOOGLE_CLIENT_ID='test-client'; process.env.GOOGLE_CLIENT_SECRET='test-secret'; process.env.GOOGLE_REFRESH_TOKEN='test-refresh'; process.env.PUBLIC_BASE_URL = base;
  const response = await post('/api/requests',request);
  assert.equal(response.status,201);
  const {id} = await response.json();
  assert.deepEqual(messages[0].to,['hope.varwig@newcitystc.church']);
  assert.equal(messages[0].from,'New City Church <melvin.anaya@newcitystc.church>');
  assert.equal(messages.length,1);
  assert.match(messages[0].html,/Approve request/);
  assert.match(messages[0].html,/href="http:\/\//);
  assert.ok(messages[0].html.includes(tokenFrom(messages[0])));
  assert.match(messages[0].html,/clicking the button alone does not approve/);
  assert.match(messages[0].text,/Rooms: Kitchen/);
  assert.match(messages[0].text,/Equipment: Other \(Whiteboard\)/);
  assert.match(messages[0].text,/Round Tables: 5, Chairs: 25/);
  const token = messages[0].text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await post('/api/approve',{id,token:'0'.repeat(64)})).status,403);
  assert.equal((await post('/api/approve',{id,token})).status,200);
  assert.match(messages[1].text,/Round Tables: 5, Chairs: 25/);
  assert.deepEqual(messages[1].to,['facilities@newcitystc.church','mark.forbes@newcitystc.church','DaijaO2006@gmail.com']);
  assert.equal((await post('/api/approve',{id,token})).status,200);
  assert.equal(messages.length,2);
});
test('routing covers every classroom, Worship Center, and Hope-only spaces', () => {
  for (const room of ['Upper Elementary','Lower Elementary','City Students','Pre K','Nursery']) {
    assert.equal(validate({...request,rooms:[room]}), undefined);
    assert.deepEqual(approvalGroupsFor([room])[0].approvers,['milyn.farrier@newcitystc.church','hope.varwig@newcitystc.church']);
  }
  assert.deepEqual(approvalGroupsFor(['Worship Center'])[0].approvers,['melvin.anaya@newcitystc.church','hope.varwig@newcitystc.church']);
  assert.deepEqual(approvalGroupsFor(['City Commons'])[0].approvers,['hospitality@newcitystc.church','hope.varwig@newcitystc.church']);
  for (const room of ['Kitchen','Entire Building','Other']) assert.deepEqual(approvalGroupsFor([room])[0].approvers,['hope.varwig@newcitystc.church']);
});
const tokenFrom = message => message.text.match(/token=([a-f0-9]{64})/)[1];
test('mixed classroom and worship request waits for coverage of both room groups', async () => {
  const before = messages.length;
  const response = await post('/api/requests',{...request,rooms:['Upper Elementary','Nursery','Worship Center']});
  assert.equal(response.status,201);
  const {id} = await response.json();
  const approvals = messages.slice(before);
  assert.equal(approvals.length,3,'each recipient gets only one individual email');
  assert.deepEqual(approvals.map(m=>m.to[0]).sort(),['hope.varwig@newcitystc.church','melvin.anaya@newcitystc.church','milyn.farrier@newcitystc.church']);
  const milyn = approvals.find(m=>m.to[0].startsWith('milyn.'));
  const melvin = approvals.find(m=>m.to[0].startsWith('melvin.'));
  const first = await post('/api/approve',{id,token:tokenFrom(milyn)});
  assert.equal(first.status,200);
  assert.deepEqual(await first.json(),{status:'pending',remainingGroups:['Worship Center']});
  assert.equal(messages.length,before+3,'no facilities notification before every room is covered');
  const second = await post('/api/approve',{id,token:tokenFrom(melvin)});
  assert.equal(second.status,200);
  assert.equal((await second.json()).status,'approved');
  assert.equal(messages.length,before+4);
  assert.deepEqual(messages.at(-1).to,['facilities@newcitystc.church','mark.forbes@newcitystc.church','DaijaO2006@gmail.com']);
  assert.match(messages.at(-1).text,/milyn.farrier@/);
  assert.match(messages.at(-1).text,/melvin.anaya@/);
  assert.match(messages.at(-1).text,/Added to the shared/);
  const hope=approvals.find(m=>m.to[0].startsWith('hope.'));
  await post('/api/approve',{id,token:tokenFrom(hope)});
  assert.equal(messages.length,before+4,'late approval does not resend final notifications');
});
test('Hope alone can approve a request covering classrooms, worship and commons', async () => {
  const before=messages.length;
  const {id}=await (await post('/api/requests',{...request,rooms:['Lower Elementary','Worship Center','City Commons']})).json();
  const hope=messages.slice(before).find(m=>m.to[0].startsWith('hope.'));
  const response=await post('/api/approve',{id,token:tokenFrom(hope)});
  assert.equal((await response.json()).status,'approved');
  assert.equal(messages.length,before+5);
});
test('HTML approval email escapes event details and preserves the private link', async () => {
  const {approvalEmailHtml}=await import('../approval-email.js');
  const url='https://example.com/approval#id=test&token=private';
  const html=approvalEmailHtml({...request,id:'test',title:'<script>alert("x")</script>',notes:'<img src=x onerror=alert(1)>'},url,'Rooms: Kitchen','Hope');
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
  assert.match(html,/&lt;script&gt;/);
  assert.ok(html.includes('href="https://example.com/approval#id=test&amp;token=private"'));
});
test('Google Calendar insert waits for final room coverage and uses Central Time', async () => {
  process.env.GOOGLE_CALENDAR_ID='test-calendar@group.calendar.google.com';
  const before=messages.length, count=calendarEvents.size;
  const {id}=await (await post('/api/requests',{...request,rooms:['Nursery','Worship Center']})).json();
  const emails=messages.slice(before), milyn=emails.find(m=>m.to[0].startsWith('milyn.')), melvin=emails.find(m=>m.to[0].startsWith('melvin.'));
  await post('/api/approve',{id,token:tokenFrom(milyn)});
  assert.equal(calendarEvents.size,count);
  const response=await post('/api/approve',{id,token:tokenFrom(melvin)});
  assert.equal((await response.json()).calendarStatus,'created');
  const event=calendarEvents.get('nc'+id.replace(/-/g,''));
  assert.deepEqual(event.start,{dateTime:'2026-12-12T17:00:00',timeZone:'America/Chicago'});
  assert.deepEqual(event.end,{dateTime:'2026-12-12T19:00:00',timeZone:'America/Chicago'});
  assert.match(event.description,/Round Tables: 5, Chairs: 25/);
  assert.equal(event.recurrence,undefined,'one-time requests do not become recurring');
  assert.ok(!event.description.includes('Agreement:'),'signature metadata stays out of shared calendar');
  assert.equal(event.attendees,undefined,'no meeting invitations sent to leaders');
  assert.equal(calendarEvents.size,count+1);
  assert.match(messages.at(-1).text,/Added to the shared/);
  const inserts=calendarInserts,notifications=messages.length;
  await post('/api/approve',{id,token:tokenFrom(melvin)});
  assert.equal(calendarInserts,inserts);assert.equal(messages.length,notifications);
});
test('calendar failure is reported honestly and retry creates one event without resending notifications', async () => {
  const before=messages.length;
  const {id}=await (await post('/api/requests',request)).json();
  const token=tokenFrom(messages[before]);
  calendarFailure=true;
  let result=await (await post('/api/approve',{id,token})).json();
  assert.equal(result.calendarStatus,'failed');assert.match(result.calendarError,/denied/);
  assert.match(messages.at(-1).text,/CALENDAR ACTION REQUIRED/);
  const sent=messages.length;
  calendarFailure=false;
  result=await (await post('/api/approve',{id,token})).json();
  assert.equal(result.calendarStatus,'created');assert.equal(messages.length,sent);
});
test('deterministic event IDs recover an accepted insert when local result was lost', async () => {
  const {createApprovedEvent}=await import('../google-calendar.js');
  const record={...request,id:'11111111-1111-4111-8111-111111111111',status:'approved'};
  const count=calendarEvents.size;
  assert.equal((await createApprovedEvent(record,'Rooms: Kitchen')).status,'created');
  assert.equal((await createApprovedEvent(record,'Rooms: Kitchen')).status,'created');
  assert.equal(calendarEvents.size,count+1);
  await assert.rejects(createApprovedEvent({...record,status:'pending'},'Rooms: Kitchen'),/completed room approvals/);
});
test('calendar diagnostics distinguish missing scopes, disabled API, and policy without exposing raw provider text', async () => {
  const {calendarError}=await import('../google-calendar.js');
  const errorFor = error => calendarError(new Response(JSON.stringify({error}),{status:403}));
  assert.match(await errorFor({errors:[{reason:'insufficientPermissions'}]}),/refresh token lacks Calendar permission/);
  assert.match(await errorFor({details:[{reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}),/ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
  assert.match(await errorFor({details:[{reason:'SERVICE_DISABLED'}]}),/API is disabled/);
  assert.match(await errorFor({errors:[{reason:'domainPolicy'}]}),/Workspace policy/);
  const unknown=await errorFor({message:'sensitive-token-example',details:[{reason:'sensitive-token-example'}]});
  assert.ok(!unknown.includes('sensitive-token-example'));
});
test('startup calendar check performs no event insert or email send', async () => {
  const {checkCalendarAccess}=await import('../google-calendar.js');
  const inserts=calendarInserts,emails=messages.length;
  assert.match(await checkCalendarAccess(),/read access verified/);
  assert.equal(calendarInserts,inserts);assert.equal(messages.length,emails);
});
test('City Commons accepts Hospitality approval and notifies Daija after approval', async () => {
  const before=messages.length;
  const response=await post('/api/requests',{...request,rooms:['City Commons'],setup:[],quantities:{}});
  assert.equal(response.status,201);
  const {id}=await response.json();
  const emails=messages.slice(before);
  assert.deepEqual(emails.map(m=>m.to[0]).sort(),['hope.varwig@newcitystc.church','hospitality@newcitystc.church']);
  const hospitality=emails.find(m=>m.to[0].startsWith('hospitality@'));
  assert.match(hospitality.text,/Setup quantities: None requested/);
  const approved=await post('/api/approve',{id,token:tokenFrom(hospitality)});
  assert.equal((await approved.json()).status,'approved');
  assert.deepEqual(messages.at(-1).to,['facilities@newcitystc.church','mark.forbes@newcitystc.church','DaijaO2006@gmail.com']);
  assert.match(messages.at(-1).text,/None requested/);
});
test('setup is optional but quantities remain required for selected items', () => {
  assert.equal(validate({...request,setup:[],quantities:{}}),undefined);
  assert.match(validate({...request,setup:['Chairs'],quantities:{}}),/quantity/);
  assert.match(validate({...request,setup:['Round Tables'],quantities:{roundTables:1.5}}),/quantity/);
  assert.equal(validate({...request,setup:['Chairs'],quantities:{chairs:20}}),undefined);
});
test('AV selections notify Melvin on submission without granting unrelated room approval', async () => {
  for (const equipment of ['Sound Technician','TV Screens','Sound/Mixer','Microphones','TV/DVD']) {
    const before=messages.length;
    const response=await post('/api/requests',{...request,rooms:['Kitchen'],equipment:[equipment],equipmentOther:''});
    assert.equal(response.status,201);
    const emails=messages.slice(before);
    assert.equal(emails.length,2);
    const notice=emails.find(message=>message.to[0]==='melvin.anaya@newcitystc.church');
    assert.ok(notice);assert.ok(notice.text.includes(equipment));
    assert.match(notice.text,/not a confirmed booking or an approval assignment/);
    assert.ok(!notice.text.includes('token='));
  }
});
test('Melvin receives one email when he is both Worship Center approver and AV contact', async () => {
  const before=messages.length;
  const response=await post('/api/requests',{...request,rooms:['Worship Center'],equipment:['Sound Technician','TV Screens'],equipmentOther:''});
  assert.equal(response.status,201);
  const emails=messages.slice(before);
  assert.equal(emails.length,2);
  assert.equal(emails.filter(m=>m.to[0]==='melvin.anaya@newcitystc.church').length,1);
  assert.match(emails.find(m=>m.to[0].startsWith('melvin.')).text,/token=/);
});
test('Squarespace embedding is allowed while approval pages remain protected', async () => {
  const response=await fetch(base+'/?embed=1');
  const policy=response.headers.get('content-security-policy');
  assert.match(policy,/frame-ancestors 'self' https:\/\/newcitystc.church https:\/\/www.newcitystc.church/);
  assert.ok(!policy.includes('frame-ancestors *'));
  const approval=await fetch(base+'/approval');
  assert.match(approval.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('recurring requests validate bounded schedules and preserve one-time events', async () => {
  const {recurrenceRule,recurrenceSummary}=await import('../recurrence.js');
  assert.equal(validate({...request,recurrence:null}),undefined);
  for (const recurrence of [{frequency:'weekly',interval:0,count:12},{frequency:'weekly',interval:2,count:1},{frequency:'weekly',interval:2,count:105},{frequency:'monthly',interval:2,count:12},{frequency:'weekly',interval:2,count:2.5},'weekly']) assert.ok(validate({...request,recurrence}));
  assert.match(validate({...request,date:'2026-02-30'}),/valid date/);
  assert.equal(recurrenceRule('2026-10-21',{frequency:'weekly',interval:2,count:12}),'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=12');
  assert.equal(recurrenceRule('2026-10-21',{frequency:'weekly',interval:1,count:4}),'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;COUNT=4');
  assert.equal(recurrenceRule('2026-10-31',{frequency:'monthly',interval:1,count:6}),'RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;COUNT=6');
  assert.match(recurrenceSummary('2026-10-31',{frequency:'monthly',interval:1,count:6}),/months without this day are skipped/);
  assert.equal(recurrenceRule(request.date,null),undefined);
});
test('every-other-Wednesday series is emailed and created only after approval without duplicates', async () => {
  const before=messages.length,count=calendarEvents.size;
  const response=await post('/api/requests',{...request,title:'Bible study',date:'2026-10-21',recurrence:{frequency:'weekly',interval:2,count:12}});
  assert.equal(response.status,201);
  const {id}=await response.json();
  assert.equal(calendarEvents.size,count);
  assert.match(messages[before].text,/Every other Wednesday · 12 total occurrences/);
  assert.match(messages[before].html,/Every other Wednesday · 12 total occurrences/);
  const token=tokenFrom(messages[before]);
  assert.equal((await (await post('/api/approve',{id,token})).json()).calendarStatus,'created');
  const event=calendarEvents.get('nc'+id.replace(/-/g,''));
  assert.deepEqual(event.recurrence,['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;COUNT=12']);
  assert.deepEqual(event.start,{dateTime:'2026-10-21T17:00:00',timeZone:'America/Chicago'});
  assert.match(messages.at(-1).text,/Every other Wednesday · 12 total occurrences/);
  const inserts=calendarInserts, sent=messages.length;
  await post('/api/approve',{id,token});
  assert.equal(calendarInserts,inserts);assert.equal(messages.length,sent);
});
const busy = (rooms,start='2026-12-12T17:30:00-06:00',end='2026-12-12T18:30:00-06:00') => ({id:'busy',status:'confirmed',start:{dateTime:start},end:{dateTime:end},extendedProperties:{private:{newCityRooms:JSON.stringify(rooms)}}});
test('overlap checks handle room separation, adjacent times, building holds, all-day and manual events', async () => {
  const {findConflicts}=await import('../availability.js');
  assert.equal(findConflicts(request,[busy(['Kitchen'])])[0].room,'Kitchen');
  assert.deepEqual(findConflicts(request,[busy(['Nursery'])]),[]);
  assert.deepEqual(findConflicts(request,[busy(['Kitchen'],'2026-12-12T19:00:00-06:00','2026-12-12T20:00:00-06:00')]),[]);
  assert.equal(findConflicts(request,[busy(['Entire Building'])]).length,1);
  assert.equal(findConflicts({...request,rooms:['Entire Building']},[busy(['Nursery'])]).length,1);
  assert.deepEqual(findConflicts(request,[{...busy(['Kitchen']),transparency:'transparent'}]),[]);
  assert.deepEqual(findConflicts(request,[{...busy(['Kitchen']),status:'cancelled'}]),[]);
  assert.equal(findConflicts(request,[{start:{date:'2026-12-12'},end:{date:'2026-12-13'},location:'Kitchen'}]).length,1);
  assert.equal(findConflicts(request,[{start:{dateTime:'2026-12-12T17:00:00-06:00'},end:{dateTime:'2026-12-12T18:00:00-06:00'}}]).length,1,'unlabelled busy events block conservatively');
});
test('series availability expands biweekly and monthly dates across DST', async () => {
  const {scheduleWindows,findConflicts}=await import('../availability.js');
  const data={...request,date:'2026-10-21',recurrence:{frequency:'weekly',interval:2,count:3}};
  const windows=scheduleWindows(data);
  assert.deepEqual(windows.map(w=>w.date),['2026-10-21','2026-11-04','2026-11-18']);
  assert.equal(new Date(windows[0].start).toISOString(),'2026-10-21T22:00:00.000Z');
  assert.equal(new Date(windows[1].start).toISOString(),'2026-11-04T23:00:00.000Z');
  assert.equal(findConflicts(data,[busy(['Kitchen'],'2026-11-04T17:30:00-06:00','2026-11-04T18:30:00-06:00')])[0].firstConflictDate,'2026-11-04');
  assert.deepEqual(scheduleWindows({...request,date:'2026-01-31',recurrence:{frequency:'monthly',interval:1,count:3}}).map(w=>w.date),['2026-01-31','2026-03-31','2026-05-31']);
});
test('submission blocks booked rooms without sending emails and availability reveals no event details', async () => {
  availabilityEvents=[{...busy(['Kitchen']),summary:'Private meeting',description:'Private notes'}];
  const before=messages.length;
  let response=await post('/api/requests',request);assert.equal(response.status,409);assert.equal(messages.length,before);
  response=await post('/api/availability',{date:request.date,start:request.start,end:request.end});
  assert.equal(response.status,200);const text=await response.text();assert.match(text,/Kitchen/);assert.ok(!text.includes('Private'));
  availabilityEvents=[];
});
test('final approval blocks a booking made since submission', async () => {
  const before=messages.length;
  const {id}=await (await post('/api/requests',request)).json();const token=tokenFrom(messages[before]);
  availabilityEvents=[busy(['Kitchen'])];
  const inserts=calendarInserts,sent=messages.length;
  const response=await post('/api/approve',{id,token});assert.equal(response.status,409);
  assert.equal(calendarInserts,inserts);assert.equal(messages.length,sent);
  availabilityEvents=[];
});
test('availability failure blocks submissions instead of claiming rooms are free', async () => {
  availabilityFailure=true;
  const before=messages.length;
  assert.equal((await post('/api/requests',request)).status,503);assert.equal(messages.length,before);
  availabilityFailure=false;
});
test('two pending requests cannot both book the same room through concurrent final approvals', async () => {
  const make=async()=>{const before=messages.length;const {id}=await (await post('/api/requests',{...request,date:'2027-05-12'})).json();return {id,token:tokenFrom(messages[before])};};
  const first=await make(),second=await make();
  includeCreatedBookings=true;
  const responses=await Promise.all([post('/api/approve',first),post('/api/approve',second)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  includeCreatedBookings=false;
});
test('availability reads later calendar pages and cannot be bypassed by a submitted request ID', async () => {
  availabilityPages=[{items:[],nextPageToken:'second-page'},{items:[{...busy(['Kitchen']),extendedProperties:{private:{newCityRequestId:'pretend-own-id',newCityRooms:'["Kitchen"]'}}}]}];
  const before=messages.length;
  const response=await post('/api/requests',{...request,id:'pretend-own-id'});
  assert.equal(response.status,409);assert.equal(messages.length,before);
  availabilityPages=null;
});
test('agreement requires signature, current terms and electronic consent', () => {
  assert.match(validate({...request,signatureName:''}),/full name/);
  assert.match(validate({...request,signatureConsent:false}),/electronically/);
  assert.match(validate({...request,agreementVersion:'old'}),/agreement has changed/);
  assert.ok(AGREEMENT_TERMS.some(term=>term.includes('$50 lost-key fee')));
  assert.ok(AGREEMENT_TERMS.some(term=>term.includes('church does not provide setup')));
  assert.ok(AGREEMENT_TERMS.some(term=>term.includes('not a fixed amount')));
});
test('requester receives a private signed PDF and fee document at submission and after approval', async () => {
  const before=messages.length, copies=requesterMessages.length;
  const response=await post('/api/requests',request);assert.equal(response.status,201);
  const {id}=await response.json();
  const receipt=requesterMessages[copies];assert.ok(receipt);
  assert.match(receipt.text,/still pending approval/);assert.match(receipt.text,/responsible for setup/);
  assert.ok(!receipt.text.includes('token='));assert.ok(!receipt.text.includes('lockbox code:'));
  assert.equal(receipt.attachments.length,2);
  assert.ok(receipt.attachments[0].content.subarray(0,4).equals(Buffer.from('%PDF')));
  assert.ok(receipt.attachments[0].filename.includes(id));
  const {readFile}=await import('node:fs/promises');
  const record=JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));
  assert.equal(record.agreement.signedName,'Test Person');assert.equal(record.agreement.electronicConsent,true);
  assert.equal(record.agreement.version,AGREEMENT_VERSION);assert.equal(record.agreement.terms.length,AGREEMENT_TERMS.length);assert.ok(record.agreement.signedAt);
  assert.deepEqual(receipt.attachments[1].content,Buffer.from(record.agreement.feesDocumentBase64,'base64'));
  const token=tokenFrom(messages[before]);
  assert.equal((await post('/api/approve',{id,token})).status,200);
  assert.equal(requesterMessages.length,copies+2);assert.match(requesterMessages.at(-1).text,/received all required room approvals/);
  await post('/api/approve',{id,token});assert.equal(requesterMessages.length,copies+2,'repeat approval does not resend the requester copy');
});
test('public form displays all agreement terms and fee sheet before signing', async () => {
  const response=await fetch(base);const html=await response.text();
  assert.match(html,/name="signatureName" required/);assert.match(html,/name="signatureConsent" type="checkbox" required/);
  assert.ok(!html.includes('<!-- AGREEMENT_TERMS -->'));assert.ok(html.includes('$50 lost-key fee'));
  const fees=await fetch(base+'/assets/building-usage-fees.pdf');assert.equal(fees.status,200);assert.equal(fees.headers.get('content-type'),'application/pdf');
});
test('failed requester confirmation can retry without resending completed staff notices', async () => {
  const before=messages.length;
  const {id}=await (await post('/api/requests',request)).json();const token=tokenFrom(messages[before]);
  failRequesterApproval=true;
  const first=await post('/api/approve',{id,token});assert.equal(first.status,502);
  assert.match((await first.json()).error,/requester confirmation/);
  const staff=messages.length;
  failRequesterApproval=false;
  const second=await post('/api/approve',{id,token});assert.equal(second.status,200);assert.equal(messages.length,staff);
});
test('configured room photos are included as attachments without inventing references', async () => {
  const {RESET_PHOTOS,contractAttachments,signedAgreement}=await import('../agreement.js');
  const record={...request,id:'photo-attachment-test',agreement:signedAgreement(request)};
  assert.equal((await contractAttachments(record)).length,2,'no photos are claimed when none are supplied');
  RESET_PHOTOS.Kitchen={path:'./public/assets/new-city-logo.png',filename:'test-reference.png',type:'image/png'};
  try {
    const attachments=await contractAttachments(record);assert.equal(attachments.length,3);
    assert.equal(attachments[2].filename,'test-reference.png');assert.equal(attachments[2].type,'image/png');
    assert.equal(attachments[2].content.subarray(1,4).toString(),'PNG');
  }finally{delete RESET_PHOTOS.Kitchen;}
});
test.after(async () => {globalThis.fetch=realFetch;await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true});});
