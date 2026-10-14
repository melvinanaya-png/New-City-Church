import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'newcity-tests-'));
process.env.DATA_DIR = dir;
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
const {server, validate} = await import('../server.js');
const request = {name:'Test Person',email:'person@example.com',title:'Community dinner',ministry:'Community',date:'2026-12-12',start:'17:00',end:'19:00',space:'Meeting room',guests:25,notes:'Accessible seating',needs:['Tables & chairs'],agree:true};
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = globalThis.fetch;
const messages = [];
globalThis.fetch = (url, options) => {
  if(url === 'https://oauth2.googleapis.com/token') return Promise.resolve(new Response(JSON.stringify({access_token:'test-access-token'}),{status:200}));
  if(url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    const raw = Buffer.from(JSON.parse(options.body).raw,'base64url').toString();
    const [headers,...parts] = raw.split('\r\n\r\n');
    messages.push({to:headers.match(/^To: (.+)$/m)[1].trim().split(', '),from:headers.match(/^From: (.+)$/m)[1].trim(),text:Buffer.from(parts.join('\r\n\r\n').replace(/\r\n/g,''),'base64').toString()});
    return Promise.resolve(new Response('{}',{status:200}));
  }
  return realFetch(url,options);
};
const post = (path, data) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
test('request validation rejects invalid time and email', () => {
  assert.equal(validate(request), undefined);
  assert.match(validate({...request,end:'16:00'}), /End time/);
  assert.match(validate({...request,email:'bad'}), /email/);
});
test('serves page and does not claim email delivery without credentials', async () => {
  assert.match(await (await fetch(base)).text(), /Make room for/);
  assert.equal((await post('/api/requests',request)).status,503);
});
test('Hope receives approval link; only approval notifies Darrell and Mark; replay is idempotent', async () => {
  process.env.GOOGLE_CLIENT_ID='test-client'; process.env.GOOGLE_CLIENT_SECRET='test-secret'; process.env.GOOGLE_REFRESH_TOKEN='test-refresh'; process.env.PUBLIC_BASE_URL = base;
  const response = await post('/api/requests',request);
  assert.equal(response.status,201);
  const {id} = await response.json();
  assert.deepEqual(messages[0].to,['Hope.varwig@newcitystc.church']);
  assert.equal(messages[0].from,'New City Church <melvin.anaya@newcitystc.church>');
  assert.equal(messages.length,1);
  const token = messages[0].text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await post('/api/approve',{id,token:'0'.repeat(64)})).status,403);
  assert.equal((await post('/api/approve',{id,token})).status,200);
  assert.deepEqual(messages[1].to,['facilities@newcitystc.church','mark.forbes@newcitystc.church']);
  assert.equal((await post('/api/approve',{id,token})).status,200);
  assert.equal(messages.length,2);
});
test.after(async () => {globalThis.fetch=realFetch;await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true,force:true});});
