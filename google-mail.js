import { randomUUID } from 'node:crypto';
// Gmail API with server-side OAuth refresh; credentials are never sent to browsers.
export const sender = 'melvin.anaya@newcitystc.church';
export function emailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.PUBLIC_BASE_URL);
}
const reportedAuthFailures = new Set();
function reportTokenFailure(code, status) {
  const explanations = {
    invalid_grant:'The Google refresh token expired, was revoked, or is no longer valid. Reauthorize the same Google OAuth client for Gmail send, Calendar events and datastore, then replace GOOGLE_REFRESH_TOKEN. Check whether the consent app is External and in Testing, which can limit refresh tokens to seven days.',
    invalid_client:'Google rejected the OAuth client. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET match the client used to obtain GOOGLE_REFRESH_TOKEN.',
    unauthorized_client:'This OAuth client is not permitted to refresh this authorization. Check the Google OAuth client configuration.',
    access_denied:'Google denied authorization. Check the authorizing account and Google Workspace API access controls.',
    invalid_scope:'Google rejected the requested permissions. Check the Google authorization scopes.'
  };
  const known = Object.hasOwn(explanations,code) ? code : 'unrecognized';
  const key = `${status}:${known}`;
  if(reportedAuthFailures.has(key))return;
  reportedAuthFailures.add(key);
  console.warn(`Google authorization: ${explanations[known] || 'Token refresh failed. Check the matching OAuth credentials and Google authorization.'} (HTTP ${status}; ${known})`);
}
export async function googleAccessToken() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET, refresh_token:process.env.GOOGLE_REFRESH_TOKEN, grant_type:'refresh_token'}).toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!tokenResponse.ok) {
    let payload;try{payload=await tokenResponse.json();}catch{}
    // Only recognized error codes are logged. Never log tokens or provider bodies.
    reportTokenFailure(payload?.error,tokenResponse.status);
    return null;
  }
  const token = await tokenResponse.json();
  return typeof token.access_token === 'string' && token.access_token ? token.access_token : null;
}
export async function sendMail(to, subject, text, key, replyTo, html, attachments = []) {
  const accessToken = await googleAccessToken();
  if (!accessToken) return {ok:false};
  if (!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(replyTo)) throw Error('Invalid reply address');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const encode = value => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  const boundary = `newcity-${randomUUID()}`;
  let body = html ? [
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encode(html), `--${boundary}--`
  ].join('\r\n') : encode(text);
  let contentHeaders=html ? [`Content-Type: multipart/alternative; boundary="${boundary}"`] : ['Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64'];
  if(attachments.length) {
    const mixed=`newcity-mixed-${randomUUID()}`;
    const parts=[`--${mixed}`,...contentHeaders,'',body];
    for(const attachment of attachments) {
      const filename=attachment.filename.replace(/[^A-Za-z0-9._-]/g,'_');
      if(!/^[a-z]+\/[a-z0-9.+-]+$/i.test(attachment.type))throw Error('Invalid attachment type');
      parts.push(`--${mixed}`,`Content-Type: ${attachment.type}; name="${filename}"`,`Content-Disposition: attachment; filename="${filename}"`,'Content-Transfer-Encoding: base64','',encode(attachment.content));
    }
    parts.push(`--${mixed}--`);body=parts.join('\r\n');
    contentHeaders=[`Content-Type: multipart/mixed; boundary="${mixed}"`];
  }
  const message = [
    `From: New City Church <${sender}>`, `To: ${to.join(', ')}`, `Reply-To: ${replyTo}`,
    `Subject: ${encodedSubject}`, `Message-ID: <${key}@newcitystc.church>`,
    'MIME-Version: 1.0',
    ...contentHeaders, '', body
  ].join('\r\n');
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:'POST', headers:{Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json'},
    body: JSON.stringify({raw:Buffer.from(message).toString('base64url')}), signal:AbortSignal.timeout(15000)
  });
}
