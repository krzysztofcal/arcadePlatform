import test from 'node:test';
import assert from 'node:assert/strict';
process.env.XP_CORS_ALLOW = 'https://deletion.test';
const {createAccountDeleteHandler} = await import('../netlify/functions/account-delete.mjs');
const OWNER='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const event=(body={confirmation:'DELETE_ACCOUNT',acknowledgeForfeiture:true})=>({httpMethod:'POST',headers:{origin:'https://deletion.test',authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify(body)});
function fixture({release=true,auth=true,commitBarrier=null}={}) {
  let row=null; const calls=[];
  const tx={unsafe:async (sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('account_deletion_release'))return [{enabled:release}];
    if(sql.includes('as present'))return [{present:true,deleting:false}];
    if(sql.includes('select * from public.account_deletion_requests'))return row?[row]:[];
    if(sql.includes('insert into public.account_deletion_requests')){row={request_id:REQUEST,old_user_id:params[1],status:'PENDING',phase:'preparing',accepted_at:null};return [row];}
    if(sql.includes('status_token_hash'))return [row];
    return [];
  }};
  const handler=createAccountDeleteHandler({env:{ACCOUNT_DELETION_ENABLED:'1'},beginSql:async fn=>{const result=await fn(tx);if(commitBarrier)await commitBarrier();return result;},verifySupabaseJwt:async()=>({valid:auth,userId:OWNER})});
  return {handler,calls,get row(){return row;}};
}

test('explicit owner request returns durable preparing not false accepted/completed and replays same request',async()=>{
 const f=fixture();const a=await f.handler(event());const b=await f.handler(event());
 assert.equal(a.statusCode,202);const state=JSON.parse(a.body);
 assert.equal(state.requestId,JSON.parse(b.body).requestId);assert.equal(state.accepted,false);assert.equal(state.completed,false);
 assert.match(state.statusToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.row.old_user_id,OWNER);
 assert.equal(f.calls.filter(x=>x.sql.includes('insert into public.account_deletion_requests')).length,1);
});

test('forged target, absent acknowledgement, origin and invalid owner rejected before write',async()=>{
 for(const body of [{confirmation:'DELETE_ACCOUNT',acknowledgeForfeiture:true,userId:REQUEST},{confirmation:'DELETE_ACCOUNT'},{confirmation:'DELETE_ACCOUNT',acknowledgeForfeiture:false}]){
  const f=fixture();assert.equal((await f.handler(event(body))).statusCode,400);assert.equal(f.calls.length,0);
 }
 const f=fixture();const denied=event();delete denied.headers.origin;
 assert.equal((await f.handler(denied)).statusCode,403);assert.equal(f.calls.length,0);
 const noAuth=fixture({auth:false});assert.equal((await noAuth.handler(event())).statusCode,401);assert.equal(noAuth.calls.length,0);
});

test('feature and durable release gates reject before accepting a request',async()=>{
 const disabled=createAccountDeleteHandler({env:{}});assert.equal((await disabled(event())).statusCode,503);
 const f=fixture({release:false});assert.equal((await f.handler(event())).statusCode,503);assert.equal(f.row,null);
});


test('receipt response waits for transaction completion and commit failure is never acknowledged',async()=>{
 let commit,entered;
 const ready=new Promise(resolve=>{entered=resolve;});
 const barrier=new Promise(resolve=>{commit=resolve;});
 const f=fixture({commitBarrier:()=>{entered();return barrier;}});
 let replied=false;
 const response=f.handler(event()).then(value=>{replied=true;return value;});
 await ready;assert.equal(replied,false);
 commit();assert.equal((await response).statusCode,202);
 const failed=fixture({commitBarrier:async()=>{throw new Error('commit outcome uncertain');}});
 assert.equal((await failed.handler(event())).statusCode,503);
});

test('lost POST response recovers durable preparing via owner GET without another confirmation or request',async()=>{
 const f=fixture();
 await f.handler(event()); // Deliberately discard the successful HTTP response.
 const recovered=await f.handler({httpMethod:'GET',headers:event().headers});
 const state=JSON.parse(recovered.body);
 assert.equal(recovered.statusCode,200);assert.equal(state.requestId,REQUEST);
 assert.equal(state.accepted,false);assert.equal(state.completed,false);
 assert.equal('statusToken' in state,false);
 assert.equal(f.calls.filter(x=>x.sql.includes('insert into public.account_deletion_requests')).length,1);
 const replay=await f.handler(event());assert.equal(JSON.parse(replay.body).requestId,REQUEST);
 assert.equal(f.calls.filter(x=>x.sql.includes('insert into public.account_deletion_requests')).length,1);
 const none=fixture();
 assert.equal((await none.handler({httpMethod:'GET',headers:event().headers})).statusCode,404);
});


test('Origin-less owner GET is read-only without CORS grant; mutation and foreign Origin stay denied',async()=>{
 const f=fixture();await f.handler(event());
 const recovered=await f.handler({httpMethod:'GET',headers:{authorization:'Bearer owner'}});
 assert.equal(recovered.statusCode,200);assert.equal(JSON.parse(recovered.body).requestId,REQUEST);
 assert.equal(recovered.headers['access-control-allow-origin'],undefined);
 const denied=await f.handler({httpMethod:'GET',headers:{origin:'https://untrusted.test',authorization:'Bearer owner'}});
 assert.equal(denied.statusCode,403);
 const noAuth=fixture({auth:false});
 assert.equal((await noAuth.handler({httpMethod:'GET',headers:{authorization:'Bearer invalid'}})).statusCode,401);
 const mutation=event();delete mutation.headers.origin;
 assert.equal((await f.handler(mutation)).statusCode,403);
 assert.equal(f.calls.filter(x=>x.sql.includes('insert into public.account_deletion_requests')).length,1);
});
