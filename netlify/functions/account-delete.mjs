import { baseHeaders, corsHeaders, extractBearerToken, verifySupabaseJwt, beginSql } from './_shared/supabase-admin.mjs';
import { accountDeletionEnabled, requestDeletion, getDeletionStatus, issueDeletionStatusAccess, readDeletionStatusAccess } from '../../shared/account-deletion.mjs';

export function createAccountDeleteHandler(deps = {}) {
  const env = deps.env || process.env;
  const transact = deps.beginSql || beginSql;
  const verify = deps.verifySupabaseJwt || verifySupabaseJwt;
  const respond = (statusCode,headers,body) => ({statusCode,headers,body:JSON.stringify(body)});
  return async (event) => {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = origin && corsHeaders(origin);
    if (!cors) return respond(403,baseHeaders(),{error:'forbidden_origin'});
    const headers = {...cors,'access-control-allow-methods':'POST,GET,OPTIONS'};
    if (event.httpMethod === 'OPTIONS') return {statusCode:204,headers,body:''};
    if (!['POST','GET'].includes(event.httpMethod)) return respond(405,headers,{error:'method_not_allowed'});
    if (!accountDeletionEnabled(env)) return respond(503,headers,{error:'account_deletion_unavailable'});
    try {
      const authorization = event.headers?.authorization || event.headers?.Authorization || '';
      if (event.httpMethod === 'GET' && authorization.startsWith('Deletion ')) {
        const state = await transact((tx) => readDeletionStatusAccess(tx,event.queryStringParameters?.requestId,authorization.slice(9)));
        return respond(state ? 200 : 404,headers,state || {error:'not_found'});
      }
      const auth = await verify(extractBearerToken(event.headers),{allowDeleting:true});
      if (!auth.valid || !auth.userId) return respond(401,headers,{error:'unauthorized'});
      if (event.httpMethod === 'GET') {
        const state = await transact((tx) => getDeletionStatus(tx,auth.userId));
        return respond(state ? 200 : 404,headers,state || {error:'not_found'});
      }
      const type = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
      if (!/^application\/json(?:;|$)/i.test(type)) return respond(415,headers,{error:'json_required'});
      let body;
      try { body = JSON.parse(event.body); } catch { return respond(400,headers,{error:'invalid_request'}); }
      if (!body || Array.isArray(body) || typeof body !== 'object'
        || Object.keys(body).some((key) => !['confirmation','acknowledgeForfeiture'].includes(key))
        || body.confirmation !== 'DELETE_ACCOUNT' || body.acknowledgeForfeiture !== true) return respond(400,headers,{error:'confirmation_required'});
      const state = await transact(async (tx) => {
        const [release] = await tx.unsafe('select enabled from public.account_deletion_release where id=true for share;');
        if (release?.enabled !== true) throw new Error('release_not_ready');
        await requestDeletion(tx,auth.userId);
        return issueDeletionStatusAccess(tx,auth.userId);
      });
      // Durable preparing intent blocks SQL now; existing WS tick confirms Redis
      // and completes acceptance without requiring this browser to stay logged in.
      return respond(202,headers,state);
    } catch (error) {
      return respond(error?.code === 'account_not_active' ? 403 : 503,headers,{error:'account_deletion_unavailable'});
    }
  };
}
export const handler = createAccountDeleteHandler();
