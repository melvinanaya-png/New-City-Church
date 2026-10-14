// Gmail API with server-side OAuth refresh; credentials are never sent to browsers.
export const sender = 'melvin.anaya@newcitystc.church';
export function emailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.PUBLIC_BASE_URL);
}
export async function sendMail(to, subject, text, key, replyTo) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET, refresh_token:process.env.GOOGLE_REFRESH_TOKEN, grant_type:'refresh_token'}).toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!tokenResponse.ok) return {ok:false};
  const token = await tokenResponse.json();
  if (typeof token.access_token !== 'string' || !token.access_token) return {ok:false};
  if (!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(replyTo)) throw Error('Invalid reply address');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const body = Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const message = [
    `From: New City Church <${sender}>`, `To: ${to.join(', ')}`, `Reply-To: ${replyTo}`,
    `Subject: ${encodedSubject}`, `Message-ID: <${key}@newcitystc.church>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body
  ].join('\r\n');
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:'POST', headers:{Authorization:`Bearer ${token.access_token}`, 'Content-Type':'application/json'},
    body: JSON.stringify({raw:Buffer.from(message).toString('base64url')}), signal:AbortSignal.timeout(15000)
  });
}
