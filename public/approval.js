const params = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', '/approval');
const button = document.querySelector('#approve');
button.addEventListener('click', async () => {
  button.disabled = true;
  const result = document.querySelector('#result');
  try {
    const response = await fetch('/api/approve', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:params.get('id'),token:params.get('token')})});
    const body = await response.json();
    if(!response.ok) throw Error(body.error);
    result.textContent = body.status === 'pending' ? `Your approval is recorded. Still waiting for approval covering: ${body.remainingGroups.join(', ')}. Darrell, Mark, and Daija will be notified when all rooms are approved.` : (body.calendarStatus === 'created' ? 'Approved and added to the shared New City Building Calendar. Darrell, Mark, and Daija have been notified.' : `Approved. Darrell, Mark, and Daija have been notified, but the Google Calendar entry is pending. ${body.calendarError || 'Check calendar setup.'}`);
    button.textContent = body.status === 'approved' && body.calendarStatus !== 'created' ? 'Retry calendar entry ↗' : 'Approved ✓';
    if(body.status === 'approved' && body.calendarStatus !== 'created') button.disabled = false;
  } catch(error) {result.textContent = error.message; button.disabled = false;}
});
