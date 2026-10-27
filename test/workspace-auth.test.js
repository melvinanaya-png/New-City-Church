import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceTokenProvider,workspaceDelegationConfigured} from '../workspace-auth.js';
import {firestoreAuthFromEnvironment} from '../request-store.js';
import {legacyRedirectBase,legacyRedirectLocation} from '../legacy-redirect.js';
const env={GOOGLE_AUTH_MODE:'workspace-delegation',GOOGLE_SERVICE_ACCOUNT_EMAIL:'requests@example-project.iam.gserviceaccount.com',GOOGLE_WORKSPACE_USER:'melvin.anaya@newcitystc.church'};

test('keyless Workspace delegation signs fixed scopes with an attached identity and caches short-lived tokens',async()=>{
 let now=1793100000000,signs=0,exchanges=0;
 const provider=createWorkspaceTokenProvider({now:()=>now,getServiceToken:async()=>'runtime-token',fetchImpl:async(url,options)=>{
  if(url.startsWith('https://iamcredentials.googleapis.com/')) {
   signs++;
   assert.equal(options.headers.Authorization,'Bearer runtime-token');
   const payload=JSON.parse(JSON.parse(options.body).payload);
   assert.equal(payload.iss,env.GOOGLE_SERVICE_ACCOUNT_EMAIL);assert.equal(payload.sub,env.GOOGLE_WORKSPACE_USER);
   assert.equal(payload.exp-payload.iat,3600);assert.equal(payload.aud,'https://oauth2.googleapis.com/token');
   assert.deepEqual(payload.scope.split(' '),['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events']);
   return new Response(JSON.stringify({signedJwt:'signed-assertion'}),{status:200});
  }
  assert.equal(url,'https://oauth2.googleapis.com/token');
  const body=new URLSearchParams(options.body);assert.equal(body.get('assertion'),'signed-assertion');
  assert.equal(body.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');exchanges++;
  return new Response(JSON.stringify({access_token:'delegated-token',expires_in:3600}),{status:200});
 }});
 assert.deepEqual(await Promise.all([provider(env),provider(env)]),['delegated-token','delegated-token']);
 assert.equal(signs,1);assert.equal(exchanges,1);
 await provider(env);assert.equal(signs,1);
 now+=3600000;assert.equal(await provider(env),'delegated-token');assert.equal(signs,2);
 assert.equal(workspaceDelegationConfigured({...env,GOOGLE_WORKSPACE_USER:'other@example.com'}),false);
 assert.equal(workspaceDelegationConfigured({...env,GOOGLE_SERVICE_ACCOUNT_EMAIL:'not-an-account'}),false);
});
test('delegation denies signing failures without leaking secrets or falling back to user refresh tokens',async()=>{
 const provider=createWorkspaceTokenProvider({getServiceToken:async()=>'runtime-token',fetchImpl:async()=>new Response('PRIVATE_PROVIDER_BODY',{status:403})});
 await assert.rejects(provider(env),error=>/service account signing/.test(error.message) && !error.message.includes('PRIVATE'));
 await assert.rejects(provider({...env,GOOGLE_WORKSPACE_USER:''}),/settings are missing/);
 const auth=firestoreAuthFromEnvironment({FIRESTORE_AUTH_MODE:'attached-service-account'});
 assert.equal(typeof auth.authClient.getClient,'function');assert.equal(auth.credentials,undefined);
});
test('legacy migration redirects preserve approval paths and cannot redirect to a request-supplied host',()=>{
 const base=legacyRedirectBase('https://new-city-123.us-west1.run.app');
 assert.equal(legacyRedirectLocation(base,'/approval?id=example'),'https://new-city-123.us-west1.run.app/approval?id=example');
 assert.equal(new URL(legacyRedirectLocation(base,'//evil.example/approval')).hostname,base.hostname);
 assert.throws(()=>legacyRedirectBase('https://evil.example'),/Cloud Run/);
 assert.equal(legacyRedirectBase(''),null);
});
