import {readFile, mkdir, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {UserRefreshClient} from 'google-auth-library';

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
      if(backend==='firestore')await client.collection('buildingRequests').doc('_connection_check').get();
      return backend==='firestore'?'Firestore read access verified. Writes still require a live submission test.':'Local files only; storage is not durable on Render Free.';
    }
  };
}
// Explicit credentials only: never silently adopt unrelated workspace ADC.
export function firestoreAuthFromEnvironment(env=process.env) {
  const mode=env.FIRESTORE_AUTH_MODE || (env.FIRESTORE_SERVICE_ACCOUNT_JSON?'service-account':'google-oauth');
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
