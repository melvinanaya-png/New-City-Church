export function legacyRedirectBase(value) {
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw new Error('Invalid LEGACY_REDIRECT_BASE_URL.');}
  if(url.protocol!=='https:' || !url.hostname.endsWith('.run.app') || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash)throw new Error('LEGACY_REDIRECT_BASE_URL must be the HTTPS Cloud Run service origin.');
  return url;
}
export function legacyRedirectLocation(base,requestUrl) {
  const incoming=new URL(requestUrl,'http://localhost');
  const target=new URL(base);
  target.pathname=incoming.pathname;target.search=incoming.search;
  return target.href;
}
