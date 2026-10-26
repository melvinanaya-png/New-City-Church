import test from 'node:test';
import assert from 'node:assert/strict';
import {googleAccessToken} from '../google-mail.js';

test('token refresh diagnostics identify expiry and client errors without exposing provider data',async()=>{
  const originalFetch=globalThis.fetch,originalWarn=console.warn;
  const messages=[];console.warn=message=>messages.push(message);
  let failure='invalid_grant';
  globalThis.fetch=async()=>new Response(JSON.stringify({error:failure,error_description:'PRIVATE_PROVIDER_TEXT',refresh_token:'PRIVATE_REFRESH_TOKEN'}),{status:400});
  try {
    assert.equal(await googleAccessToken(),null);
    assert.match(messages.at(-1),/expired, was revoked/);
    await googleAccessToken();assert.equal(messages.length,1);
    failure='invalid_client';assert.equal(await googleAccessToken(),null);
    assert.match(messages.at(-1),/CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    failure='PRIVATE_UNKNOWN_ERROR';await googleAccessToken();
    assert.match(messages.at(-1),/unrecognized/);
    assert.equal(messages.join(' ').includes('PRIVATE_'),false);
    globalThis.fetch=async()=>new Response(JSON.stringify({access_token:'test-access'}),{status:200});
    assert.equal(await googleAccessToken(),'test-access');
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;}
});
