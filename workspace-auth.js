import {GoogleAuth} from 'google-auth-library';

const scopes=['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events'];
const adc=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
export function workspaceDelegationConfigured(env=process.env) {
  return Boolean(env.GOOGLE_AUTH_MODE==='workspace-delegation' && /^[a-z0-9-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '') && /^[^\s@]+@newcitystc\.church$/i.test(env.GOOGLE_WORKSPACE_USER || ''));
}
class WorkspaceAuthorizationError extends Error {}
export function workspaceAuthorizationMessage(error) {
  return error instanceof WorkspaceAuthorizationError ? error.message : null;
}
function safeFailure(stage,status,reason) {
  const guidance = {
    SERVICE_DISABLED:'Enable IAM Service Account Credentials API in the runtime project.',
    IAM_PERMISSION_DENIED:'Check Service Account Token Creator on the signing service account for the actual Cloud Run runtime identity.',
    ACCESS_TOKEN_SCOPE_INSUFFICIENT:'The runtime token lacks required Google API permission.',
    unauthorized_client:'Check the service account numeric OAuth client ID and both scopes in Workspace domain-wide delegation. Authorization changes may need time to propagate.',
    invalid_grant:'Check the delegated Workspace user, service account identity and organization policies for service-account delegation.',
    invalid_scope:'Authorize exactly Gmail send and Calendar events for the service account in Workspace Admin.',
    access_denied:'Check Workspace administrator API access controls.'
  };
  const hint=Object.hasOwn(guidance,reason)?guidance[reason]:'Check Workspace delegation, runtime service account, IAM Credentials API and signing permission.';
  const http=Number.isInteger(status)&&status>=100&&status<=599?` HTTP ${status}.`:'';
  // Only fixed stage names and allowlisted hints; never provider messages or tokens.
  throw new WorkspaceAuthorizationError(`Workspace service authorization failed at ${stage}.${http} ${hint}`);
}
async function failureReason(response) {
  let payload;try{payload=await response.json();}catch{return;}
  return typeof payload?.error==='string'?payload.error:payload?.error?.details?.find?.(item=>item.reason)?.reason;
}
async function authFetch(fetchImpl,stage,...args) {
  try{return await fetchImpl(...args);}catch{safeFailure(`${stage} connectivity`);}
}
export function createWorkspaceTokenProvider({getServiceToken=()=>adc.getAccessToken(),fetchImpl=fetch,now=()=>Date.now()}={}) {
  let tokenCache=null,pending=null;
  return async function getToken(env=process.env) {
    if(!workspaceDelegationConfigured(env))safeFailure('configuration (settings are missing or invalid)');
    const cacheKey=`${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}:${env.GOOGLE_WORKSPACE_USER}`;
    if(tokenCache?.key===cacheKey && tokenCache.until>now()+60000)return tokenCache.token;
    if(pending?.key===cacheKey)return pending.promise;
    const promise=(async()=>{
      let serviceToken;try{serviceToken=await getServiceToken();}catch{safeFailure('attached service identity');}
      if(!serviceToken)safeFailure('attached service identity');
      const issued=Math.floor(now()/1000);
      const payload={iss:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,sub:env.GOOGLE_WORKSPACE_USER,scope:scopes.join(' '),aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3600};
      const signed=await authFetch(fetchImpl,'service account signing',`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)}:signJwt`,{
        method:'POST',headers:{Authorization:`Bearer ${serviceToken}`,'Content-Type':'application/json'},body:JSON.stringify({payload:JSON.stringify(payload)}),signal:AbortSignal.timeout(15000)
      });
      if(!signed.ok)safeFailure('service account signing',signed.status,await failureReason(signed));
      let assertion;try{assertion=await signed.json();}catch{safeFailure('service account signing response');}
      if(typeof assertion.signedJwt!=='string' || !assertion.signedJwt)safeFailure('service account signing response');
      const response=await authFetch(fetchImpl,'Workspace delegation','https://oauth2.googleapis.com/token',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion.signedJwt}).toString(),signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)safeFailure('Workspace delegation',response.status,await failureReason(response));
      let result;try{result=await response.json();}catch{safeFailure('Workspace token response');}
      if(typeof result.access_token!=='string' || !result.access_token || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in)<=0)safeFailure('Workspace token response');
      tokenCache={key:cacheKey,token:result.access_token,until:now()+Math.min(Number(result.expires_in),3600)*1000};
      return tokenCache.token;
    })();
    pending={key:cacheKey,promise};
    try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
  };
}
export const workspaceAccessToken=createWorkspaceTokenProvider();
