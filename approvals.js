export const CLASSROOMS = ['Upper Elementary', 'Lower Elementary', 'City Students', 'Pre K', 'Nursery'];
export const ROOMS = ['Worship Center', 'City Commons', ...CLASSROOMS, 'Kitchen', 'Entire Building', 'Other'];
const HOPE = 'hope.varwig@newcitystc.church';
export function approvalGroupsFor(rooms) {
  const groups = [];
  if (rooms.some(room => CLASSROOMS.includes(room))) groups.push({name:'Classrooms',approvers:['milyn.farrier@newcitystc.church', HOPE]});
  if (rooms.includes('Worship Center')) groups.push({name:'Worship Center',approvers:['melvin.anaya@newcitystc.church', HOPE]});
  if (rooms.includes('City Commons')) groups.push({name:'City Commons',approvers:['hospitality@newcitystc.church', HOPE]});
  if (rooms.some(room => ['Kitchen','Entire Building','Other'].includes(room))) groups.push({name:'Other rooms',approvers:[HOPE]});
  return groups;
}
export function approvalComplete(record) {
  return record.approvalGroups.every(group => group.approvers.some(email => record.approvals.some(approval => approval.email === email && approval.approvedAt)));
}

export const AV_CONTACT = 'melvin.anaya@newcitystc.church';
export function needsAvNotification(equipment) {
  return equipment.some(item => ['Sound Technician','TV Screens','Sound/Mixer','Microphones','TV/DVD'].includes(item));
}
