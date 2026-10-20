import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequestStore} from '../request-store.js';
const id='978db4dd-5b2e-4c8d-9dc9-87c4a0969157';
const record={id,status:'pending',approvals:[{email:'approver@example.com',tokenHash:'private-hash',approvedAt:null}],agreement:{terms:['Signed terms'],feesDocumentBase64:Buffer.from('PDF snapshot').toString('base64')},optional:undefined};
function database() {
  const docs=new Map();let unavailable=false;
  return {docs,setUnavailable(value){unavailable=value;},collection(name){assert.equal(name,'buildingRequests');return {doc(key){return {
    async get(){if(unavailable)throw new Error('UNAVAILABLE');return {exists:docs.has(key),data:()=>docs.get(key)};},
    async set(value){if(unavailable)throw new Error('UNAVAILABLE');docs.set(key,value);}
  };}};}};
}
test('Firestore preserves signed snapshots and approval progress across store restarts',async()=>{
  const client=database();
  const first=createRequestStore({backend:'firestore',client});
  assert.equal(await first.get(id),null);
  await first.save(record);
  const restarted=createRequestStore({backend:'firestore',client});
  const restored=await restarted.get(id);
  assert.deepEqual(restored,JSON.parse(JSON.stringify(record)));
  restored.approvals[0].approvedAt='2026-10-20T12:00:00Z';
  restored.status='approved';restored.calendarEventId='existing-event';
  await restarted.save(restored);
  assert.deepEqual(await first.get(id),restored);
  const before=client.docs.size;await restarted.check();assert.equal(client.docs.size,before);
});
test('Firestore failures propagate instead of silently falling back or reporting not found',async()=>{
  const client=database();const store=createRequestStore({backend:'firestore',client});
  client.setUnavailable(true);
  await assert.rejects(store.save(record),/UNAVAILABLE/);
  await assert.rejects(store.get(id),/UNAVAILABLE/);
  await assert.rejects(store.check(),/UNAVAILABLE/);
  assert.equal(client.docs.size,0);
});
test('storage rejects unsafe IDs, oversized documents and incomplete configuration',async()=>{
  const store=createRequestStore({backend:'firestore',client:database()});
  await assert.rejects(store.get('../private'),/Invalid request ID/);
  await assert.rejects(store.save({...record,notes:'x'.repeat(900001)}),/size limit/);
  assert.throws(()=>createRequestStore({backend:'firestore',projectId:'missing'}),/matching project/);
  assert.throws(()=>createRequestStore({backend:'invalid'}),/Invalid STORAGE_BACKEND/);
});
test('local development records also survive store recreation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'newcity-store-'));
  try {
    await createRequestStore({directory}).save(record);
    assert.deepEqual(await createRequestStore({directory}).get(id),JSON.parse(JSON.stringify(record)));
  } finally {await rm(directory,{recursive:true,force:true});}
});
