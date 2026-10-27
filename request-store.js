import {readFile, mkdir, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {UserRefreshClient, GoogleAuth} from 'google-auth-library';

const validId = id => /^[0-9a-f-]{36}$/.test(id);
export function createRequestStore({backend='file', directory, projectId, credentials, authClient, client}={}) {
  if (!['file','firestore'].includes(backend)) throw new Error('Invalid STORAGE_BACKEND.');
  if (backend==='firestore' && !client) {
    if (!projectId) throw new Error('Firestore requires FIRESTORE_PROJECT_ID.');
    if (!authClient && (!credentials?.client_email || !credentials?.private_key || credentials.project_id!==projectId)) throw new Error('Firestore requires a matching project and service account.');
    client=new Firestore({projectId,...(authClient?{authClient}:{credentials}),preferRest:true});
  }
  function document(id) {
    if(!validId(id))throw new Error('Invalid request ID.');
    return backend==='firestore'?client.collection('buildingRequests').doc(id):join(directory,`${id}.json`);
  }
  return {
    backend,
    async get(id) {
      const target=document(id);
      if(backend==='firestore') {
        const snapshot=await target.get();
        if(!snapshot.exists)return null;
        return JSON.parse(snapshot.data().payload.toString('utf8'));
      }
      try{return JSON.parse(await readFile(target,'utf8'));}
      catch(error){if(error.code==='ENOENT')return null;throw error;}
    },
    async save(record) {
      const target=document(record.id);
      const payload=JSON.stringify(record);
      // Leave room for Firestore document metadata beneath its 1 MiB limit.
      if(Buffer.byteLength(payload)>900_000)throw new Error('Request exceeds storage size limit.');
      if(backend==='firestore') {
        // Bytes preserve the complete signed snapshot, including optional fields,
        // without exposing request fields to browser clients or public endpoints.
        await target.set({payload:Buffer.from(payload)});
        return;
      }
      await mkdir(directory,{recursive:true});
      const temporary=target+'.'+randomUUID()+'.tmp';
      try {await writeFile(temporary,payload,{mode:0o600});await rename(temporary,target);}
      finally {await unlink(temporary).catch(()=>{});}
    },
    async check() {
      // This read checks credentials/database access without creating test records.
      if(backend==='firestore') {
        try {await client.collection('buildingRequests').doc('_connection_check').get();}
        catch(error) {
          // Some SDK REST errors discard Google's structured reason. Retrieve it
          // with the same identity and a read-only request, never logging bodies.
          if(authClient) {
            await diagnoseFirestoreOAuth(authClient,projectId);
          }
          throw error;
        }
      }
      return backend==='firestore'?'Firestore read access verified. Writes still require a live submission test.':'Local files only; storage is not durable on Render Free.';
    }
  };
}
// Explicit credentials only: never silently adopt unrelated workspace ADC.
export function firestoreAuthFromEnvironment(env=process.env) {
  const mode=env.FIRESTORE_AUTH_MODE || (env.FIRESTORE_SERVICE_ACCOUNT_JSON?'service-account':'google-oauth');
  if(mode==='attached-service-account')return {authClient:new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']})};
  if(mode==='google-oauth') {
    if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) throw new Error('Firestore Google authorization requires the existing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.');
    return {authClient:new UserRefreshClient(env.GOOGLE_CLIENT_ID,env.GOOGLE_CLIENT_SECRET,env.GOOGLE_REFRESH_TOKEN)};
  }
  if(mode!=='service-account')throw new Error('Invalid FIRESTORE_AUTH_MODE.');
  try{return {credentials:JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON || '')};}
  catch{throw new Error('Set FIRESTORE_SERVICE_ACCOUNT_JSON securely in Render.');}
}
export function requestStoreFromEnvironment(directory) {
  const backend=process.env.STORAGE_BACKEND || 'file';
  return createRequestStore({backend,directory,projectId:process.env.FIRESTORE_PROJECT_ID,...(backend==='firestore'?firestoreAuthFromEnvironment():{})});
}

// Return only fixed diagnostics; provider errors may contain private request data.
export function storageErrorMessage(error) {
  const chain=[error,error?.cause,error?.cause?.cause].filter(Boolean);
  const reasons=chain.flatMap(item=>[
    item.reason,
    ...(Array.isArray(item.statusDetails)?item.statusDetails.map(detail=>detail.reason):[]),
    ...(Array.isArray(item.response?.data?.error?.details)?item.response.data.error.details.map(detail=>detail.reason):[])
  ]);
  if(reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT'))return 'The Google refresh token lacks Firestore permission. Reauthorize Gmail send, Calendar events and datastore together, then replace GOOGLE_REFRESH_TOKEN.';
  if(reasons.some(reason=>['SERVICE_DISABLED','API_DISABLED'].includes(reason)))return 'Firestore API is disabled for the project used by this request. Enable Cloud Firestore API in the app project.';
  if(reasons.includes('SERVICE_USAGE_DENIED'))return 'The authorized Google user needs Service Usage Consumer permission on the API consumer project.';
  if(reasons.includes('BILLING_DISABLED'))return 'Google reports billing is disabled for the API consumer project. Review project billing requirements.';
  if(chain.some(item=>item.code===5 || item.code===404 || item.response?.status===404))return 'Database not found. Confirm FIRESTORE_PROJECT_ID and a Native mode database with ID (default).';
  if(chain.some(item=>item.code===7 || item.code===403 || item.httpStatusCode===403 || item.response?.status===403))return 'Firestore permission denied. In Google Cloud IAM, verify the Google account used in OAuth Playground has Cloud Datastore User on FIRESTORE_PROJECT_ID. A grant to the unused service account does not grant the user access. Also check the datastore scope and API activation.';
  if(chain.some(item=>item.code===16 || item.code===401 || item.httpStatusCode===401 || item.response?.status===401))return 'Google authorization was rejected. Check that the OAuth client ID, secret and refresh token match.';
  if(chain.some(item=>item.code===8 || item.code===429 || item.response?.status===429))return 'Firestore quota or rate limit reached. Check Google Cloud quotas before retrying.';
  if(chain.some(item=>[4,14,'ENOTFOUND','EAI_AGAIN','ECONNRESET'].includes(item.code)))return 'Firestore could not be reached or timed out. Check connectivity and retry.';
  return 'Firestore check failed without a recognized reason. Verify project ID, database (default), datastore scope and the authorizing user’s IAM access. No local-file fallback was used.';
}

export async function diagnoseFirestoreOAuth(authClient,projectId,fetchImpl=fetch) {
  const access=await authClient.getAccessToken();
  const token=typeof access==='string'?access:access?.token;
  if(!token)throw Object.assign(new Error('Google authorization unavailable.'),{code:16});
  const database=`projects/${projectId}/databases/(default)`;
  const response=await fetchImpl(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:batchGet`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({documents:[`${database}/documents/buildingRequests/_connection_check`]}),
    signal:AbortSignal.timeout(15000)
  });
  if(response.ok)return;
  let payload;try{payload=await response.json();}catch{}
  const details=Array.isArray(payload?.error?.details)?payload.error.details:[];
  // Keep only structural metadata, never the provider's message or response body.
  throw {code:response.status,statusDetails:details.map(detail=>({reason:detail.reason}))};
}
