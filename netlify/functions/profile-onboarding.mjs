import {baseHeaders,corsHeaders,extractBearerToken,verifySupabaseJwt,beginSql,klog} from './_shared/supabase-admin.mjs';
import {verifyToken} from '../../ws-server/poker/auth/verify-token.mjs';
import {readTermsStatus,acceptTerms} from '../../shared/profile-terms.mjs';
import {PUBLIC_AVATAR_VARIANTS} from '../../shared/profile-avatar-projection.mjs';
export function createOnboardingHandler(deps={}){
 const env=deps.env||process.env;
 return async event=>{
  const headers=corsHeaders(event.headers?.origin||event.headers?.Origin);
  const reply=(status,body)=>({statusCode:status,headers:{...baseHeaders(),...headers,'access-control-allow-methods':'GET, POST, OPTIONS'},body:status===204?'':JSON.stringify(body)});
  if(!headers)return reply(403,{error:'forbidden_origin'});
  if(event.httpMethod==='OPTIONS')return reply(204,{});
  if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'method_not_allowed'});
  try{
   const token=extractBearerToken(event.headers);
   const guest=(deps.verifyGuest||verifyToken)({token,env});
   let principal;
   if(guest.ok&&guest.identityMode==='guest'){
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
    if(!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000) return reply(401,{error:'unauthorized'});
    principal={kind:'guest',id:guest.userId};
   }else{
    const auth=await (deps.verifySupabaseJwt||verifySupabaseJwt)(token);
    if(!auth.valid||!auth.userId)return reply(401,{error:'unauthorized'});
    principal={kind:'account',id:auth.userId};
   }
   let body={};
   if(event.httpMethod==='POST'){
    if(typeof event.body==='string'&&event.body.length>1024)return reply(413,{error:'invalid_request'});
    try{body=JSON.parse(event.body||'{}');}catch{return reply(400,{error:'invalid_json'});}
    if(!body||Array.isArray(body)||typeof body!=='object'||body.action!=='acceptTerms'||Object.keys(body).some(k=>!['action','version','requestId'].includes(k)))return reply(400,{error:'invalid_request'});
   }
   const state=await (deps.beginSql||beginSql)(tx=>event.httpMethod==='GET'?readTermsStatus(tx,principal):acceptTerms(tx,principal,body));
   return reply(200,{...state,avatarVariants:PUBLIC_AVATAR_VARIANTS.slice(0,state.variantsEnabled?16:6),termsUrl:'/legal/terms.'+state.version+'.en.html',privacyUrl:'/legal/privacy.en.html'});
  }catch(error){
   klog('profile_terms_failed',{code:error?.code||'unavailable'});
   const codes=new Set(['terms_required','terms_not_active','terms_version_changed','request_conflict','invalid_request_id','account_not_active','unauthorized']);
   return reply(codes.has(error?.code)?(error.status||409):503,{error:codes.has(error?.code)?error.code:'terms_unavailable'});
  }
 };
}
export const handler=createOnboardingHandler();
