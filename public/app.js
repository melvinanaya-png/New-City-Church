const form = document.querySelector('#request-form');
const result = document.querySelector('#result');
const submit = document.querySelector('#submit');
const connection = document.querySelector('#connection');
const groups = [...form.querySelectorAll('[data-required-group]')];
function updateSelections() {
  for (const group of groups) {
    const name = group.dataset.requiredGroup;
    const checks = [...group.querySelectorAll(`input[name="${name}"]`)];
    checks[0].setCustomValidity(checks.some(input => input.checked) ? '' : 'Select at least one option in this group.');
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
  if(data.end <= data.start) {result.textContent = 'Please choose an end time after the start time.'; result.focus(); return;}
  submit.disabled = true; submit.textContent = 'Sending your request…'; result.textContent = ''; result.className = '';
  try {
    const response = await fetch('/api/requests', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const body = await response.json();
    if(!response.ok) throw new Error(body.error || 'We could not send your request.');
    result.className = 'success'; result.textContent = `Request sent to your room approvers! Your reference is ${body.id}. The team will review your plans and contact you. Your event is not yet confirmed or added to the calendar.`;
    form.reset(); updateSelections();
  } catch(error) {result.textContent = error.message === 'Failed to fetch' ? 'Connection interrupted. Please contact the facilities team before retrying to avoid a duplicate request.' : error.message;}
  finally {submit.disabled = false; submit.innerHTML = 'Send my request <span>↗</span>';result.focus();}
});
