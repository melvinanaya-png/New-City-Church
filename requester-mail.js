import { emailTimeRange } from './time-format.js';
import { setupResponsibility } from './setup-policy.js';
import { sendMail } from './google-mail.js';
import { contractAttachments, roomResetNote } from './agreement.js';
import { recurrenceSummary } from './recurrence.js';
export async function sendRequesterCopy(record, stage, attachments) {
  const approved=stage==='approved';
  const title=record.title.replace(/[\r\n]/g,' ');
  const text = `${approved ? 'Your building use request has received all required room approvals.' : 'We received your signed building use request. It is still pending approval; this email does not confirm a booking.'}\n\nEvent: ${record.title}\nReference: ${record.id}\nFirst date: ${record.date}\nTime: ${emailTimeRange(record.start,record.end)}\nSchedule: ${recurrenceSummary(record.date,record.recurrence)}\nRooms: ${record.rooms.join(', ')}\nSigned by: ${record.agreement.signedName}\nSignature recorded: ${record.agreement.signedAt}\n\nYour signed agreement and Building Usage Fees are attached. The church will confirm applicable charges; no payment has been collected by this form. ${setupResponsibility(record)} A $50 lost-key fee applies; damage charges are determined based on repair or replacement costs.\n\n${roomResetNote(record)}\n\n${approved ? (record.calendarStatus==='created' ? 'Your event was added to the shared Google Calendar.' : 'Calendar entry is still pending; contact the facilities team for confirmation.') : 'Do not enter the building based on this receipt; approval is required.'}\nAccess and key-return instructions will be provided separately by the church. No lockbox code is included in this agreement.\n\nQuestions: facilities@newcitystc.church`;
  return sendMail([record.email],`${approved?'Approved — agreement and room instructions':'Your signed building use request'}: ${title}`,text,`${stage}-copy-${record.id}`,'facilities@newcitystc.church',undefined,attachments || await contractAttachments(record));
}
