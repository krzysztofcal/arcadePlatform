import { baseHeaders, corsHeaders } from './_shared/supabase-admin.mjs';
// Phase A retires public file upload/removal. Existing manifests remain for V2 purge.
function createAvatarUploadUrlHandler(){
 return async function handler(event){
  const headers=corsHeaders(event.headers?.origin||event.headers?.Origin);
  if(!headers)return {statusCode:403,headers:baseHeaders(),body:JSON.stringify({error:'forbidden_origin'})};
  return {statusCode:event.httpMethod==='OPTIONS'?204:410,headers:{...headers,'access-control-allow-methods':'POST, OPTIONS'},body:event.httpMethod==='OPTIONS'?'':JSON.stringify({error:'avatar_upload_retired'})};
 };
}
const handler=createAvatarUploadUrlHandler();
export {handler,createAvatarUploadUrlHandler};
