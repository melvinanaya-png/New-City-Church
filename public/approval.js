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
    result.textContent = 'Approved. Darrell and Mark have been notified. Planning Center entry is still pending.';
    button.textContent = 'Approved ✓';
  } catch(error) {result.textContent = error.message; button.disabled = false;}
});
