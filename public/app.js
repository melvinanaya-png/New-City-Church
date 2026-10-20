const embedded = new URLSearchParams(location.search).get('embed') === '1';
if (embedded) {
  document.documentElement.classList.add('embedded');
  const updateHeight = () => {
    const message = {type:'newcity-form-height',height:Math.ceil(document.body.getBoundingClientRect().height)};
    for (const origin of ['https://newcitystc.church','https://www.newcitystc.church']) window.parent.postMessage(message,origin);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateHeight).observe(document.body);
  window.addEventListener('load', updateHeight);
}
const form = document.querySelector('#request-form');
const result = document.querySelector('#result');
const submit = document.querySelector('#submit');
const connection = document.querySelector('#connection');
const groups = [...form.querySelectorAll('[data-required-group]')];
const availabilityStatus = document.querySelector('#availability-status');
const availabilityRetry = document.querySelector('#availability-retry');
availabilityRetry.addEventListener('click',queueAvailability);
const roomInputs = [...form.querySelectorAll('input[name="rooms"]')];
let availabilityVersion = 0, availabilityTimer;
for(const input of roomInputs) {
  const note=document.createElement('small');note.className='room-availability';
  input.parentElement.append(note);
}
function showRoomConflicts(conflicts) {
  for(const input of roomInputs) {
    const conflict=conflicts.find(item=>item.room===input.value);
    input.disabled=Boolean(conflict);
    if(conflict)input.checked=false;
    input.parentElement.querySelector('.room-availability').textContent=conflict?'Already booked for this time':'';
    input.parentElement.title=conflict?`Booked on ${conflict.firstConflictDate}${conflict.occurrences>1?` (${conflict.occurrences} dates in this series)`:''}`:'';
  }
  updateSelections();
}
function currentSchedule() {
  const date=form.elements.date,start=form.elements.start,end=form.elements.end;
  if(!date.value || !date.validity.valid || !start.value || !end.value || end.value<=start.value)return null;
  const repeat=form.elements.repeat.value;
  if(repeat!=='none' && !form.elements.occurrences.validity.valid)return null;
  return {date:date.value,start:start.value,end:end.value,recurrence:repeat==='none'?null:{frequency:repeat==='monthly'?'monthly':'weekly',interval:repeat==='biweekly'?2:1,count:Number(form.elements.occurrences.value)}};
}
function queueAvailability() {
  clearTimeout(availabilityTimer);
  availabilityRetry.hidden=true;
  const version=++availabilityVersion,schedule=currentSchedule();
  showRoomConflicts([]);
  if(!schedule) {availabilityStatus.textContent='Choose valid dates and times to check room availability.';submit.disabled=false;return;}
  submit.disabled=true;availabilityStatus.textContent='Checking room availability…';
  availabilityTimer=setTimeout(async()=>{
    try {
      const response=await fetch('/api/availability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(schedule)});
      const body=await response.json();
      if(version!==availabilityVersion)return;
      if(!response.ok)throw Error(body.error || 'Availability could not be checked. Please try again.');
      showRoomConflicts(body.conflicts);
      availabilityStatus.textContent=roomInputs.every(input=>input.disabled)?'All rooms are booked for this schedule. Choose another date or time.':body.conflicts.length?'Booked rooms are unavailable for this schedule. Choose another room or change the dates.':'Rooms are available for this schedule. Availability is checked again before approval.';
      submit.disabled=roomInputs.every(input=>input.disabled);
    }catch(error){if(version===availabilityVersion){availabilityStatus.textContent=error.message;submit.disabled=true;availabilityRetry.hidden=false;}}
  },350);
}
form.addEventListener('input', event=>{if(['date','start','end','repeat','occurrences'].includes(event.target.name))queueAvailability();});
form.addEventListener('change', event=>{if(['date','start','end','repeat','occurrences'].includes(event.target.name))queueAvailability();});
function updateRecurrence() {
  const repeat = form.elements.repeat.value;
  const repeating = repeat !== 'none';
  document.querySelector('#repeat-details').hidden = !repeating;
  form.elements.occurrences.disabled = !repeating;
  form.elements.occurrences.required = repeating;
  const summary = document.querySelector('#recurrence-summary');
  if (!repeating) {summary.textContent = ''; return;}
  const date = form.elements.date.value;
  if (!date) {summary.textContent = 'Choose the first event date to preview the schedule.'; return;}
  const day = new Intl.DateTimeFormat('en-US', {weekday:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const schedule = repeat === 'monthly' ? `Monthly on day ${Number(date.slice(8,10))}` : `${repeat === 'biweekly' ? 'Every other' : 'Every'} ${day}`;
  const count = Number(form.elements.occurrences.value);
  summary.textContent = `${schedule} · ${count || 'Choose number of'} total occurrences, including the first.${repeat === 'monthly' && Number(date.slice(8,10)) > 28 ? ' Months without this day are skipped.' : ''}`;
}
form.elements.occurrences.addEventListener('input', updateRecurrence);
function updateSelections() {
  updateRecurrence();
  for (const group of groups) {
    const name = group.dataset.requiredGroup;
    const checks = [...group.querySelectorAll(`input[name="${name}"]`)];
    checks.forEach(input=>input.setCustomValidity(''));
    const target=checks.find(input=>!input.disabled);
    if(target)target.setCustomValidity(checks.some(input => input.checked && !input.disabled) ? '' : 'Select at least one available option in this group.');
    const detail = group.querySelector('.other-detail');
    if (detail) {
      const selected = checks.some(input => input.value === 'Other' && input.checked);
      detail.hidden = !selected;
      const input = detail.querySelector('input');
      input.disabled = !selected; input.required = selected;
    }
  }
  for (const checkbox of form.querySelectorAll('[data-quantity]')) {
    const input = form.elements[checkbox.dataset.quantity];
    input.disabled = !checkbox.checked; input.required = checkbox.checked;
  }
}
form.addEventListener('change', updateSelections);
updateSelections();
fetch('/api/status').then(r => {if(!r.ok) throw Error(); return r.json();}).then(s => {if (!s.emailConfigured) connection.textContent = 'Preview mode · Email delivery is not connected yet. You can explore the form, but requests cannot be sent until setup is complete.';}).catch(() => {connection.textContent = 'We could not check delivery availability. Please contact the facilities team if you need help.';});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(form);
  const data = Object.fromEntries(fields);
  data.rooms = fields.getAll('rooms'); data.equipment = fields.getAll('equipment'); data.setup = fields.getAll('setup');
  data.quantities = Object.fromEntries(['roundTables', 'rectangularTables', 'chairs'].filter(key => fields.has(key)).map(key => [key, Number(fields.get(key))]));
  data.roomsOther = fields.get('roomsOther') || ''; data.equipmentOther = fields.get('equipmentOther') || '';
  data.agree = fields.has('agree');
  data.signatureConsent = fields.has('signatureConsent');
  data.recurrence = fields.get('repeat') === 'none' ? null : {frequency:fields.get('repeat') === 'monthly' ? 'monthly' : 'weekly',interval:fields.get('repeat') === 'biweekly' ? 2 : 1,count:Number(fields.get('occurrences'))};
  if(data.end <= data.start) {result.textContent = 'Please choose an end time after the start time.'; result.focus(); return;}
  submit.disabled = true; submit.textContent = 'Sending your request…'; result.textContent = ''; result.className = '';
  try {
    const response = await fetch('/api/requests', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body = await response.json();
    if(!response.ok) throw new Error(body.error || 'We could not send your request.');
    result.className = 'success'; result.textContent = `Request sent to your room approvers! Your reference is ${body.id}. A copy of your signed agreement and fee sheet has been sent to your email. ${data.eventType === 'internal' ? 'The church will arrange setup help separately.' : 'Your group is responsible for setup and cleanup.'} The team will review your plans. Your event is not yet confirmed or added to the calendar.`;
    form.reset(); updateSelections(); queueAvailability();
  } catch(error) {result.textContent = error.message === 'Failed to fetch' ? 'Connection interrupted. Please contact the facilities team before retrying to avoid a duplicate request.' : error.message;}
  finally {submit.disabled = false; submit.innerHTML = 'Send my request <span>↗</span>';result.focus();}
});
