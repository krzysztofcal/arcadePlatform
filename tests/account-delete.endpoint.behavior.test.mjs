import test from 'node:test';
import assert from 'node:assert/strict';
process.env.XP_CORS_ALLOW = 'https://deletion.test';
const {createAccountDeleteHandler} = await import('../netlify/functions/account-delete.mjs');
const OWNER='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const event=(body={confirmation:'DELETE_ACCOUNT',acknowledgeForfeiture:true})=>({httpMethod:'POST',headers:{origin:'https://deletion.test',authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify(body)});
function fixture({release=true,auth=true}={}) {
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
  const handler=createAccountDeleteHandler({env:{ACCOUNT_DELETION_ENABLED:'1'},beginSql:async fn=>fn(tx),verifySupabaseJwt:async()=>({valid:auth,userId:OWNER})});
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
