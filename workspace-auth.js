import {GoogleAuth} from 'google-auth-library';

const scopes=['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events'];
const adc=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
export function workspaceDelegationConfigured(env=process.env) {
  return Boolean(env.GOOGLE_AUTH_MODE==='workspace-delegation' && /^[a-z0-9-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '') && /^[^\s@]+@newcitystc\.church$/i.test(env.GOOGLE_WORKSPACE_USER || ''));
}
function safeFailure(stage) {
  // Never log response bodies, JWT assertions, access tokens, or account data.
  throw new Error(`Workspace service authorization failed at ${stage}. Check domain-wide delegation scopes, the Workspace user, IAM Credentials API and service account signing permission.`);
}
export function createWorkspaceTokenProvider({getServiceToken=()=>adc.getAccessToken(),fetchImpl=fetch,now=()=>Date.now()}={}) {
  let tokenCache=null,pending=null;
  return async function getToken(env=process.env) {
    if(!workspaceDelegationConfigured(env))throw new Error('Workspace service authorization settings are missing or invalid.');
    const cacheKey=`${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}:${env.GOOGLE_WORKSPACE_USER}`;
    if(tokenCache?.key===cacheKey && tokenCache.until>now()+60000)return tokenCache.token;
    if(pending?.key===cacheKey)return pending.promise;
    const promise=(async()=>{
      const serviceToken=await getServiceToken();
      if(!serviceToken)safeFailure('attached service identity');
      const issued=Math.floor(now()/1000);
      const payload={iss:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,sub:env.GOOGLE_WORKSPACE_USER,scope:scopes.join(' '),aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600};
      const signed=await fetchImpl(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)}:signJwt`,{
        method:'POST',headers:{Authorization:`Bearer ${serviceToken}`,'Content-Type':'application/json'},body:JSON.stringify({payload:JSON.stringify(payload)}),signal:AbortSignal.timeout(15000)
      });
      if(!signed.ok)safeFailure('service account signing');
      const assertion=await signed.json();
      if(typeof assertion.signedJwt!=='string' || !assertion.signedJwt)safeFailure('service account signing response');
      const response=await fetchImpl('https://oauth2.googleapis.com/token',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion.signedJwt}).toString(),signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)safeFailure('Workspace delegation');
      const result=await response.json();
      if(typeof result.access_token!=='string' || !result.access_token || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in)<=0)safeFailure('Workspace token response');
      tokenCache={key:cacheKey,token:result.access_token,until:now()+Math.min(Number(result.expires_in),3600)*1000};
      return tokenCache.token;
    })();
    pending={key:cacheKey,promise};
    try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
  };
}
export const workspaceAccessToken=createWorkspaceTokenProvider();
