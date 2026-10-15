import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'newcity-tests-'));
process.env.DATA_DIR = dir;
delete process.env.GOOGLE_CALENDAR_ID;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
const {approvalGroupsFor} = await import('../approvals.js');
const {server, validate} = await import('../server.js');
const request = {name:'Test Person',email:'person@example.com',title:'Community dinner',ministry:'Community',date:'2026-12-12',start:'17:00',end:'19:00',rooms:['Kitchen'],roomsOther:'',equipment:['Other'],equipmentOther:'Whiteboard',setup:['Round Tables','Chairs'],quantities:{roundTables:5,chairs:25},guests:25,notes:'Accessible seating',agree:true};
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
const messages = [];
const calendarEvents = new Map();
let calendarFailure = false;
let calendarInserts = 0;
globalThis.fetch = (url, options) => {
  if(String(url).startsWith('https://www.googleapis.com/calendar/v3/')) {
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
    const boundary=headers.match(/boundary="([^"]+)"/)?.[1];
    const decoded={};
    if (boundary) {
      for (const part of parts.join('\r\n\r\n').split(`--${boundary}`).slice(1,-1)) {
        const [partHeaders,...encoded]=part.trim().split('\r\n\r\n');
        decoded[partHeaders.includes('text/html')?'html':'text']=Buffer.from(encoded.join('\r\n\r\n').replace(/\r\n/g,''),'base64').toString();
      }
    } else decoded.text=Buffer.from(parts.join('\r\n\r\n').replace(/\r\n/g,''),'base64').toString();
    messages.push({to:headers.match(/^To: (.+)$/m)[1].trim().split(', '),from:headers.match(/^From: (.+)$/m)[1].trim(),...decoded});
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
  process.env.GOOGLE_CLIENT_ID='test-client'; process.env.GOOGLE_CLIENT_SECRET='test-secret'; process.env.GOOGLE_REFRESH_TOKEN='test-refresh'; process.env.PUBLIC_BASE_URL = base;
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
  assert.match(messages.at(-1).text,/CALENDAR ACTION REQUIRED/);
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
test.after(async () => {globalThis.fetch=realFetch;await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true});});
