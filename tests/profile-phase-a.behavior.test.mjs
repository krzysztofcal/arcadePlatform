import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { PUBLIC_AVATAR_VARIANTS, projectPublicAvatar } from '../shared/profile-avatar-projection.mjs';
import { readTermsStatus, acceptTerms, requireCurrentTerms } from '../shared/profile-terms.mjs';
import { publicProfile, updateUserProfile } from '../netlify/functions/_shared/user-profile.mjs';
const id='00000000-0000-4000-8000-000000000003';
test('catalog adds ten variants without changing six legacy identifiers; phase A never projects an uploaded image or BIO',()=>{
 assert.equal(PUBLIC_AVATAR_VARIANTS.length,16);
 assert.deepEqual(PUBLIC_AVATAR_VARIANTS.slice(0,6),['comet-blue','falcon-orange','fox-blue','nova-purple','orbit-green','panda-pink']);
 assert.deepEqual(projectPublicAvatar({avatarKey:id+'.webp',avatarVariant:'fox-blue',storageBaseUrl:'https://test.supabase.co'}),{type:'default',variant:'fox-blue'});
 assert.equal('bio' in publicProfile({handle:'blue-fox-123456',displayName:'Blue Fox',bio:'old text',avatarVariant:'fox-blue'}),false);
});
test('manual profile identity writes fail before persistence',async()=>{
 for(const key of ['bio','displayName','handle']) await assert.rejects(updateUserProfile(id,{[key]:'manual'}, {executeSql:async()=>{throw Error('must not read/write');}}),{code:'profile_field_read_only'});
});
test('Terms require current version, preserve one server timestamp on retry and cannot be spoofed by an old receipt',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create schema private; create schema auth; create role anon; create role authenticated; create role service_role; create table auth.users(id uuid primary key); create table public.user_profiles(user_id uuid primary key references auth.users,avatar_variant text); create table public.account_deletion_requests(old_user_id uuid);');
  await db.exec(await readFile(new URL('../supabase/migrations/20261026120000_profile_phase_a.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1)',[id]);
  await db.exec("update private.profile_terms_policy set active=true where singleton=true");
  const tx={unsafe:async(q,p=[]) => (await db.query(q,p)).rows};
  await assert.rejects(requireCurrentTerms(tx,{kind:'account',id}),{code:'terms_required'});
  await assert.rejects(acceptTerms(tx,{kind:'account',id},{version:'old',requestId:'test-terms-request-1'}),{code:'terms_version_changed'});
  const a=await acceptTerms(tx,{kind:'account',id},{version:'2026-10-26-a1',requestId:'test-terms-request-1'});
  const b=await acceptTerms(tx,{kind:'account',id},{version:'2026-10-26-a1',requestId:'test-terms-request-2'});
  assert.equal(String(a.acceptedAt),String(b.acceptedAt));
  assert.equal((await readTermsStatus(tx,{kind:'account',id})).current,true);
  await db.exec("update private.profile_terms_policy set version='next-version'");
  await assert.rejects(acceptTerms(tx,{kind:'account',id},{version:'2026-10-26-a1',requestId:'test-terms-request-1'}),{code:'terms_version_changed'});
  await assert.rejects(requireCurrentTerms(tx,{kind:'account',id}),{code:'terms_required'});
  const guest={kind:'guest',id:'guest_00000000-0000-4000-8000-000000000004'};
  const guestAccepted=await acceptTerms(tx,guest,{version:'next-version',requestId:'guest-terms-request-1'});assert.equal(guestAccepted.current,true);
  await db.exec("update private.profile_terms_receipts set expires_at=now()-interval '1 second' where subject_kind='guest'");
  await assert.rejects(requireCurrentTerms(tx,guest),{code:'terms_required'});
  assert.equal((await acceptTerms(tx,guest,{version:'next-version',requestId:'guest-terms-request-2'})).current,true);
  await db.exec('update private.profile_terms_policy set active=false');
  await requireCurrentTerms(tx,{kind:'account',id});
  await assert.rejects(acceptTerms(tx,{kind:'account',id},{version:'next-version',requestId:'test-terms-request-3'}),{code:'terms_not_active'});
 }finally{await db.close();}
});
test('one-shot normalization preserves UUID, assigned variants and game/CH/XP; repeated execution changes nothing',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema private;create table public.account_deletion_requests(old_user_id uuid);create table private.account_avatar_objects(user_id uuid,output_path text,unique(user_id,output_path));');
  await db.exec(await readFile(new URL('../supabase/migrations/20260710130000_user_profiles.sql',import.meta.url),'utf8'));
  await db.exec('alter table public.user_profiles add column leaderboard_visible boolean not null default true; create table public.phase_a_invariant(user_id uuid,ch integer,xp integer,game jsonb);');
  await db.exec(await readFile(new URL('../supabase/migrations/20261026120000_profile_phase_a.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1)',[id]);
  await db.query("insert into public.user_profiles(user_id,handle,display_name,bio,avatar_variant) values($1,'blue-fox-482731','Private Manual Name','private bio','fox-blue')",[id]);
  await db.query("insert into public.phase_a_invariant values($1,464,200,'{\"handId\":\"same-hand\"}')",[id]);
  const before=(await db.query('select * from public.phase_a_invariant')).rows;
  const cleanup=await readFile(new URL('../specs/1114-arcade-profiles-avatars/operations/normalize-profiles.sql',import.meta.url),'utf8');
  await db.exec(cleanup);
  const after=(await db.query('select * from public.user_profiles')).rows[0];
  assert.equal(after.user_id,id);assert.equal(after.avatar_variant,'fox-blue');assert.equal(after.handle,'blue-fox-482731');assert.equal(after.display_name,'Blue Fox 482731');assert.equal(after.bio,'');assert.equal(after.google_photo_suppressed,true);
  await db.exec(cleanup);assert.deepEqual((await db.query('select * from public.user_profiles')).rows[0],after);
  assert.deepEqual((await db.query('select * from public.phase_a_invariant')).rows,before);
  await db.exec(await readFile(new URL('../specs/1114-arcade-profiles-avatars/operations/enable-catalog.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('select (public.ensure_user_profile($1)).avatar_variant',[id])).rows[0].avatar_variant,'fox-blue');
 }finally{await db.close();}
});
test('chooser uses a revision guard, idempotent retry, persistent variant and suppression without changing identity or balances',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table public.account_deletion_requests(old_user_id uuid);create table private.account_avatar_objects(user_id uuid,output_path text,unique(user_id,output_path));');
  await db.exec(await readFile(new URL('../supabase/migrations/20260710130000_user_profiles.sql',import.meta.url),'utf8'));
  await db.exec('alter table public.user_profiles add column leaderboard_visible boolean default true;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261026120000_profile_phase_a.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../specs/1114-arcade-profiles-avatars/operations/enable-catalog.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1)',[id]);
  const deps={env:{ACCOUNT_DELETION_ENABLED:'1'},executeSql:async(q,p=[])=>(await db.query(q,p)).rows,beginSql:fn=>db.transaction(tx=>fn({unsafe:async(q,p=[])=>(await tx.query(q,p)).rows}))};
  const {ensureUserProfile}=await import('../netlify/functions/_shared/user-profile.mjs');
  const original=await ensureUserProfile(id,deps);
  const oldKey='10000000-0000-4000-8000-000000000001.webp';
  await db.query('update public.user_profiles set avatar_key=$1 where user_id=$2',[oldKey,id]);
  await db.exec('update private.profile_terms_policy set active=true');
  await assert.rejects(updateUserProfile(id,{avatarVariant:'zen-lime',expectedRevision:1},deps),{code:'terms_required'});
  await deps.beginSql(tx=>acceptTerms(tx,{kind:'account',id},{version:'2026-10-26-a1',requestId:'accept-before-chooser'}));
  const selected=await updateUserProfile(id,{avatarVariant:'zen-lime',expectedRevision:1},deps);
  assert.equal(selected.avatarVariant,'zen-lime');assert.equal(selected.avatarRevision,2);assert.equal(selected.googlePhotoSuppressed,true);assert.equal(selected.avatarKey,null);
  assert.equal((await db.query('select output_path from private.account_avatar_objects where user_id=$1',[id])).rows[0].output_path,oldKey);
  assert.equal(selected.handle,original.handle);assert.equal(selected.displayName,original.displayName);
  assert.equal((await updateUserProfile(id,{avatarVariant:'zen-lime',expectedRevision:1},deps)).avatarRevision,2);
  await assert.rejects(updateUserProfile(id,{avatarVariant:'pixel-teal',expectedRevision:1},deps),{code:'stale_avatar_revision'});
  assert.equal((await ensureUserProfile(id,deps)).avatarVariant,'zen-lime');
  await db.query('insert into public.account_deletion_requests values($1)',[id]);
  await assert.rejects(updateUserProfile(id,{avatarVariant:'pixel-teal',expectedRevision:2},deps),{code:'account_not_active'});
 }finally{await db.close();}
});
test('Terms endpoint trusts the verified identity only, rejects client-supplied subjects and leaves public documents independent',async()=>{
 const {createOnboardingHandler}=await import('../netlify/functions/profile-onboarding.mjs');
 let sqlCalls=0;
 const deps={verifyGuest:()=>({ok:false}),verifySupabaseJwt:async()=>({valid:true,userId:id}),beginSql:async fn=>{sqlCalls++;return fn({unsafe:async(q,p)=>{
  if(q.includes('profile_terms_policy'))return [{version:'2026-10-26-a1',active:true,variants_enabled:false}];
  if(q.includes('profile_terms_receipts')){assert.equal(p[0],'account');assert.equal(p[1],id);return [];}
  throw Error('unexpected_query');
 }});}};
 const handler=createOnboardingHandler(deps);
 const event={httpMethod:'GET',headers:{origin:'https://arcade.test',authorization:'Bearer test'}};
 const status=await handler(event);assert.equal(status.statusCode,200);assert.equal(JSON.parse(status.body).avatarVariants.length,6);
 const deny=await handler({...event,httpMethod:'POST',body:JSON.stringify({action:'acceptTerms',version:'2026-10-26-a1',requestId:'terms-12345',userId:'other'})});assert.equal(deny.statusCode,400);assert.equal(sqlCalls,1);
 const unauthorized=createOnboardingHandler({...deps,verifySupabaseJwt:async()=>({valid:false})});
 assert.equal((await unauthorized(event)).statusCode,401);assert.equal(sqlCalls,1);
 assert.equal((await handler({...event,headers:{origin:'https://evil.invalid'}})).statusCode,403);assert.equal(sqlCalls,1);
});
test('WS reaction reuses its lifecycle transaction rather than requesting a second pool connection',async()=>{
 const source=await readFile(new URL('../ws-server/server.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('    if (frame.type === "reaction_send")'),source.indexOf('    if (frame.type === "lobby_subscribe")'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 let active=0,begins=0,checked=0;const results=[],tx={name:'existing-lifecycle-tx'};
 const begin=async fn=>{assert.equal(active,0,'must not acquire nested pool connection');begins++;active++;try{return await fn(tx);}finally{active--;}};
 const globals={frame:{type:'reaction_send',requestId:'reaction-terms-1',payload:{tableId:'table-test',reactionKey:'invalid'}},ws:{},connState:{session:{identityMode:'registered',userId:id}},resolveRoomId:()=>({ok:true,roomId:'table-test'}),tableManager:{connectionTableAssociation:()=>({joinedTableId:'table-test'}),tableSnapshot:()=>({youSeat:1}),isBotUser:()=>false,isTableClosed:()=>false},sendCommandResult:(_ws,_state,r)=>results.push(r),accountDeletionEnabled:()=>true,loadBeginSqlWs:async()=>begin,assertAccountActive:async value=>assert.equal(value,tx),beginTermsSql:begin,requireCurrentTerms:async value=>{assert.equal(value,tx);checked++;},evaluateHumanReactionCommand:()=>({ok:false,reason:'invalid_reaction'})};
 await new AsyncFunction(...Object.keys(globals),body)(...Object.values(globals));
 assert.equal(begins,1);assert.equal(checked,1);assert.equal(results[0].reason,'invalid_reaction');
 globals.requireCurrentTerms=async()=>{throw Object.assign(Error('terms_required'),{code:'terms_required'});};
 globals.evaluateHumanReactionCommand=()=>assert.fail('pending Terms must not publish/evaluate a new reaction');
 await new AsyncFunction(...Object.keys(globals),body)(...Object.values(globals));
 assert.equal(results[1].reason,'terms_required');assert.equal(begins,2);
});
async function termsClientFixture(){
 const vm=await import('node:vm');
 let user=id,serverVersion='2026-10-26-a1',tokenHook=null,rejectOldVersion=false;const posts=[],events={},nodes=[];
 const node=()=>({textContent:'',hidden:false,disabled:false,open:false,fields:{},setAttribute(){},addEventListener(type,fn){this[type]=fn;},querySelector(key){return this.fields[key]||(this.fields[key]=node());},showModal(){this.open=true;},close(){this.open=false;}});
 const doc={readyState:'loading',documentElement:{lang:'en'},head:{appendChild(){}},body:{appendChild(n){nodes.push(n);}},createElement:node,querySelector:()=>({sheet:{}}),addEventListener(type,fn){events[type]=fn;},dispatchEvent(){}};
 let authChanged;
 const token=value=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:value})).toString('base64url')+'.fixture';
 const window={SupabaseAuth:{getCurrentUser:async()=>({id:user}),onAuthChange:fn=>{authChanged=fn;}},SupabaseAuthBridge:{getAccessToken:async()=>{if(tokenHook){const hook=tokenHook;tokenHook=null;return hook();}return token(user);}},crypto:globalThis.crypto};
 const fetch=async(_url,options)=>{
  if(options.method==='POST'){posts.push({body:JSON.parse(options.body),token:options.headers.Authorization});if(rejectOldVersion){rejectOldVersion=false;serverVersion='next-version';return {ok:false,json:async()=>({error:'terms_version_changed'})};}}
  return {ok:true,json:async()=>({required:true,version:serverVersion,current:options.method==='POST'})};
 };
 vm.runInNewContext(await readFile(new URL('../js/profile-onboarding.js',import.meta.url),'utf8'),{window,document:doc,fetch,location:{pathname:'/account.html',search:''},URLSearchParams,sessionStorage:{getItem:()=>null},crypto:globalThis.crypto,atob:globalThis.atob,CustomEvent:class{},setTimeout,clearTimeout});
 const flush=async()=>{await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
 events.DOMContentLoaded();await flush();
 return {window,posts,dialog:()=>nodes.find(n=>n.open),flush,token,setUser:value=>{user=value;authChanged();},holdToken:fn=>{tokenHook=fn;},rejectNextVersion:()=>{rejectOldVersion=true;}};
}
test('Terms acceptance never posts under a replacement identity while credentials are pending',async()=>{
 const h=await termsClientFixture();const dialog=h.dialog();assert.ok(dialog);
 let release;h.holdToken(()=>new Promise(resolve=>{release=resolve;}));
 const accepting=dialog.querySelector('[data-terms-accept]').onclick();await h.flush();
 const other='00000000-0000-4000-8000-000000000004';h.setUser(other);release(h.token(other));await accepting;await h.flush();
 assert.equal(h.posts.length,0,'a stale confirmation must not record replacement-user consent');
});
test('a changed Terms version is displayed with its document before another explicit acceptance',async()=>{
 const h=await termsClientFixture();h.rejectNextVersion();
 await h.dialog().querySelector('[data-terms-accept]').onclick();await h.flush();
 const next=h.dialog();assert.ok(next);assert.match(next.querySelector('[data-terms-copy]').textContent,/next-version/);assert.match(next.querySelector('[data-terms-link]').href,/terms\.next-version\.en\.html/);
 await next.querySelector('[data-terms-accept]').onclick();assert.equal(h.posts.length,2);assert.equal(h.posts[0].body.version,'2026-10-26-a1');assert.equal(h.posts[1].body.version,'next-version');
});
test('human table creation acquires lifecycle before the Terms policy lock',async()=>{
 const {loadPokerHandler}=await import('./helpers/poker-test-helpers.mjs');const order=[];
 const handler=loadPokerHandler('netlify/functions/poker-create-table.mjs',{
  baseHeaders:()=>({}),corsHeaders:()=>({}),extractBearerToken:()=>'',verifySupabaseJwt:async()=>({valid:true,userId:id}),klog:()=>{},beginSql:async fn=>fn({}),accountDeletionEnabled:()=>true,
  assertAccountActive:async()=>{order.push('lifecycle');},requireCurrentTerms:async()=>{order.push('policy');},readPokerTierPolicySnapshot:async()=>({}),resolvePokerEnabledBuyIns:()=>[100],createPokerTableWithState:async()=>{order.push('create');return {tableId:'fixture-table'};},notifyWsLobbyMaterialize:async()=>({ok:true}),checkWsBuyInCapability:async()=>({ok:true})
 });
 const before=process.env.CHIPS_ENABLED;process.env.CHIPS_ENABLED='1';try{
  const result=await handler({httpMethod:'POST',headers:{origin:'https://arcade.test'},body:JSON.stringify({maxPlayers:6,buyIn:100})});assert.equal(result.statusCode,200);assert.deepEqual(order.slice(0,2),['lifecycle','policy']);
 }finally{if(before===undefined)delete process.env.CHIPS_ENABLED;else process.env.CHIPS_ENABLED=before;}
});
