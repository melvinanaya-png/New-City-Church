import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recurrenceSummary } from './recurrence.js';
const root = fileURLToPath(new URL('.',import.meta.url));
const fees = await readFile(root+'public/assets/building-usage-fees.pdf');
export const AGREEMENT_VERSION = '2026-10-20-v1';
export const AGREEMENT_TERMS = [
  'I will be personally present during all usage of the church facilities, including setup, decoration, the event, and teardown.',
  'My group is responsible for its own setup, decoration, teardown, cleaning, and restoring the room. The church does not provide setup or teardown services.',
  'Upon approval of my facilities use request, I will provide any fees required by the church. I have reviewed Building Usage Fees; the church will confirm the applicable charges before use.',
  'I am responsible for damage to church facilities, equipment, or property resulting from my group’s use. Damage charges are not a fixed amount in this agreement; the church will determine the amount based on the damage and repair or replacement costs.',
  'If I lose the building key, I will pay a $50 lost-key fee. I will return the key as instructed and will not share the key or access code with unauthorized people.',
  'I will follow church policies and guidelines and leave every space I use clean and orderly.',
  'All tables must be cleaned, dried, and returned to the original room setup or storage.',
  'Chairs must be inspected for spills or damage and returned to the original room setup or storage.',
  'All dishes, pots, pans, and utensils must be washed, dried, and returned to their proper storage places.',
  'Stovetops must be wiped down if used.',
  'The oven must be wiped clean if used.',
  'The microwave must be cleaned of spills and spatters if used.',
  'The kitchen floor must be swept.',
  'All leftover food must be given away or disposed of. No food may be left in the kitchen.',
  'Inside trash bags must be tied and taken to the dumpster.',
  'Trash cans must be relined.',
  'All lights must be turned off, including bathroom lights.',
  'I will report any damage immediately to facilities@newcitystc.church.',
  'My signature applies to the requested date and all requested recurring occurrences. Submitting a signed request does not confirm a reservation; room approval is still required.'
];
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function agreementHtml() {
  return `<ol>${AGREEMENT_TERMS.map(term=>`<li>${escape(term)}</li>`).join('')}</ol>`;
}
export function validateSignature(data) {
  if(data.agreementVersion !== AGREEMENT_VERSION) return 'The agreement has changed. Refresh the form and review it before signing.';
  if(typeof data.signatureName !== 'string' || data.signatureName.trim().length<2 || data.signatureName.length>200 || /[\x00-\x1f]/.test(data.signatureName)) return 'Sign the agreement by typing your full name.';
  if(data.signatureConsent !== true) return 'Consent to signing electronically is required.';
}
export function signedAgreement(data) {
  return {version:AGREEMENT_VERSION,terms:[...AGREEMENT_TERMS],signedName:data.signatureName.trim(),signedAt:new Date().toISOString(),electronicConsent:true,feesSha256:createHash('sha256').update(fees).digest('hex'),feesDocumentBase64:fees.toString('base64')};
}
export function contractPdf(record) {
  if(!record.agreement) return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
    const doc = new PDFDocument({size:'LETTER',margin:48,info:{Title:'New City Church — Signed Building Use Agreement',CreationDate:new Date(record.agreement.signedAt),ModDate:new Date(record.agreement.signedAt)}});
    const chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.font(root+'public/assets/fonts/Barlow-Regular.ttf');
    doc.fillColor('#4f8cad').fontSize(23).text('NEW CITY CHURCH');
    doc.fillColor('#333132').fontSize(18).text('Building Use Agreement');doc.moveDown();
    doc.fontSize(11).text(`Reference: ${record.id}\nEvent: ${record.title}\nRequester: ${record.name} (${record.email})\nFirst date: ${record.date}, ${record.start}–${record.end} Central Time\nSchedule: ${recurrenceSummary(record.date,record.recurrence)}\nRooms: ${(record.rooms || []).join(', ')}\nAgreement version: ${record.agreement.version}`);
    doc.moveDown();
    record.agreement.terms.forEach((term,index)=>{doc.fontSize(10).text(`${index+1}. ${term}`,{paragraphGap:7});});
    doc.moveDown();doc.fontSize(14).text('Electronic signature');
    doc.fontSize(11).text(`Signed by: ${record.agreement.signedName}\nRecorded at: ${record.agreement.signedAt} (UTC)\nThe signer explicitly consented to use this typed name as an electronic signature.`);
    doc.moveDown();doc.fontSize(9).text(`Building Usage Fees is attached separately. Fee document SHA-256: ${record.agreement.feesSha256}\nThis agreement is not evidence of room approval. The church will confirm applicable charges. Setup, cleaning and room restoration are the requester’s responsibility.`);
    doc.end();
  });
}
// Add real, church-supplied reference photos here. Never substitute stock images.
export const RESET_PHOTOS = {};
export async function contractAttachments(record) {
  if(!record.agreement) return [];
  const pdf=await contractPdf(record);
  const attachments=[{filename:`New-City-Signed-Agreement-${record.id}.pdf`,type:'application/pdf',content:pdf},{filename:'Building-Usage-Fees.pdf',type:'application/pdf',content:Buffer.from(record.agreement.feesDocumentBase64,'base64')}];
  const rooms=record.rooms.includes('Entire Building')?Object.keys(RESET_PHOTOS):record.rooms;
  for(const room of rooms) {
    const photo=RESET_PHOTOS[room];
    if(photo) attachments.push({filename:photo.filename,type:photo.type,content:await readFile(new URL(photo.path,import.meta.url))});
  }
  return attachments;
}
export function roomResetNote(record) {
  const rooms=record.rooms.includes('Entire Building')?Object.keys(RESET_PHOTOS):record.rooms;
  const available=rooms.filter(room=>RESET_PHOTOS[room]);
  return available.length ? `Room reset reference photos are attached for: ${available.join(', ')}. Return the spaces to the pictured condition. Ask the facilities team for instructions for any other space.` : 'Room and kitchen reference photos have not been supplied yet. Please obtain the required room reset instructions from the facilities team before use.';
}
