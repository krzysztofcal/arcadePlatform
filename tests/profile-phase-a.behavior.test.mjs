import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { PUBLIC_AVATAR_VARIANTS, projectPublicAvatar } from '../shared/profile-avatar-projection.mjs';
import { readTermsStatus, acceptTerms, requireCurrentTerms, cleanupExpiredGuestReceipts } from '../shared/profile-terms.mjs';
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
  // OFF is a policy value, not a schema bypass. New runtime still requires the policy table/row.
  assert.equal((await readTermsStatus(tx,{kind:'account',id})).required,false);
  await db.exec('alter table private.profile_terms_policy rename to hidden_profile_terms_policy');
  await assert.rejects(requireCurrentTerms(tx,{kind:'account',id}),error=>error.code==='42P01');
  await db.exec('alter table private.hidden_profile_terms_policy rename to profile_terms_policy;delete from private.profile_terms_policy');
  await assert.rejects(requireCurrentTerms(tx,{kind:'account',id}),{code:'terms_unavailable',status:503});

 }finally{await db.close();}
});
test('one-shot normalization touches only dirty profiles, preserves avatar revisions unless detaching a photo and is idempotent',async()=>{
 const url=process.env.PROFILE_NORMALIZATION_TEST_DB_URL;
 let db;
 if(url){
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.match(parsed.pathname,/_test$/);
  const {default:postgres}=await import('postgres');const sql=postgres(url,{max:1,prepare:false});
  db={exec:q=>sql.unsafe(q),query:async(q,p=[])=>( {rows:await sql.unsafe(q,p)} ),close:()=>sql.end()};
 }else db=new PGlite();
 try{
  await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;end$$;
   create schema auth;create schema private;create schema storage;create table storage.objects(bucket_id text);create table auth.users(id uuid primary key,email text);create table public.account_deletion_requests(old_user_id uuid);
   create table private.account_avatar_objects(user_id uuid,output_path text,unique(user_id,output_path));`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260710130000_user_profiles.sql',import.meta.url),'utf8'));
  await db.exec('alter table public.user_profiles add column leaderboard_visible boolean not null default true;create table public.phase_a_invariant(user_id uuid,ch integer,xp integer,escrow integer,ledger jsonb,game jsonb);');
  await db.exec(await readFile(new URL('../supabase/migrations/20261026120000_profile_phase_a.sql',import.meta.url),'utf8'));
  const guardMigration=await readFile(new URL('../supabase/migrations/20261018184941_account_self_deletion_v2.sql',import.meta.url),'utf8');
  const guard=guardMigration.match(/create function public\.account_guard_owned_write_v2\(\)[\s\S]*?end\$\$;/)[0];
  await db.exec(guard+"create trigger account_owned_write_v2 before insert or update on public.user_profiles for each row execute function public.account_guard_owned_write_v2('user_id');");
  const fixture=[
   ['blue-fox-482731','Blue Fox 482731','',null,null,'zen-lime'],
   ['blue-fox-482732','Manual Name','',null,null,'pixel-teal'],
   ['blue-fox-482733','Blue Fox 482733','legacy bio',null,null,'fox-blue'],
   ['blue-fox-482734','Blue Fox 482734','','old-avatar.webp',null,'ace-silver'],
   ['manual-handle','Manual Identity','legacy bio','combined.webp','2026-01-01T00:00:00Z','tiger-gold'],
   ['blue-fox-482736','Blue Fox 482736','',null,'2026-01-01T00:00:00Z','raven-violet'],
   ['unknown-identity','Unknown Identity','',null,null,'wave-cyan'],
   ['deletion-profile','Deletion Name','keep bio','keep.webp','2026-01-01T00:00:00Z','ember-coral']
  ];
  const ids=fixture.map((_,i)=>'00000000-0000-4000-8000-'+String(i+101).padStart(12,'0'));
  for(let i=0;i<fixture.length;i++){
   await db.query('insert into auth.users values($1,$2)',[ids[i],'synthetic-'+i+'@example.test']);
   await db.query('insert into public.user_profiles(user_id,handle,display_name,bio,avatar_key,handle_customized_at,avatar_variant,avatar_revision,leaderboard_visible) values($1,$2,$3,$4,$5,$6,$7,$8,false)',[ids[i],...fixture[i].slice(0,5),fixture[i][5],i+5]);
   await db.query(`insert into public.phase_a_invariant values($1,464,200,300,'{"entries":[-300,300]}','{"handId":"same-hand"}')`,[ids[i]]);
  }
  await db.query('update public.user_profiles set google_photo_suppressed=true where user_id=$1',[ids[0]]);
  await db.query('insert into public.account_deletion_requests values($1)',[ids[7]]);
  const rows=async()=>JSON.parse(JSON.stringify((await db.query('select * from public.user_profiles order by user_id')).rows));
  const preserved=async()=>JSON.parse(JSON.stringify({auth:(await db.query('select * from auth.users order by id')).rows,game:(await db.query('select * from public.phase_a_invariant order by user_id')).rows,deletion:(await db.query('select * from public.account_deletion_requests')).rows}));
  const before=await rows(),invariants=await preserved();
  const cleanup=await readFile(new URL('../specs/1114-arcade-profiles-avatars/operations/normalize-profiles.sql',import.meta.url),'utf8');
  const inventorySql=(await readFile(new URL('../specs/1114-arcade-profiles-avatars/operations/inventory.sql',import.meta.url),'utf8')).replace('BEGIN TRANSACTION READ ONLY;','').replace('COMMIT;','');
  const inventory=(await db.query(inventorySql)).rows[0].inventory;
  for(const [key,value] of Object.entries({profiles:8,eligible:6,excludedDeletion:1,customizedHandle:2,unknownHandle:1,displayName:4,bio:2,detachPhoto:2,revisionIncrement:2,setSuppression:2,missingPhotoTracker:2,handleMarkerWrites:0}))assert.equal(inventory[key],value,key);
  await assert.rejects(db.exec(cleanup.replace(' update private.profile_terms_policy set identity_normalized_at='," raise exception 'synthetic late failure'; update private.profile_terms_policy set identity_normalized_at=")),/synthetic late failure/);
  await db.exec('rollback');assert.deepEqual(await rows(),before);assert.deepEqual(await preserved(),invariants);assert.equal(Number((await db.query('select count(*) n from private.account_avatar_objects')).rows[0].n),0);
  await db.exec(cleanup);const after=await rows();
  assert.deepEqual(after[0],before[0],'already correct new-catalog profile must be byte-for-byte unchanged');
  assert.deepEqual(after[7],before[7],'deletion profile is excluded');
  for(let i=0;i<after.length;i++){
   for(const field of ['user_id','avatar_variant','leaderboard_visible','handle_customized_at','created_at'])assert.deepEqual(after[i][field],before[i][field],field);
   const detach=[3,4].includes(i);assert.equal(after[i].avatar_revision,before[i].avatar_revision+(detach?1:0));
   assert.equal(after[i].google_photo_suppressed,before[i].google_photo_suppressed||detach);
  }
  for(const i of [0,1,2,3])assert.equal(after[i].handle,before[i].handle);
  for(const i of [4,5,6])assert.notEqual(after[i].handle,before[i].handle,'customized/unknown handle gets a generated identity');
  for(let i=1;i<7;i++){assert.equal(after[i].display_name,after[i].handle.split('-').map(v=>v[0].toUpperCase()+v.slice(1)).join(' '));assert.equal(after[i].bio,'');assert.equal(after[i].avatar_key,null);}
  assert.deepEqual((await db.query('select output_path from private.account_avatar_objects order by output_path')).rows.map(r=>r.output_path),['combined.webp','old-avatar.webp']);
  assert.deepEqual(await preserved(),invariants,'Auth/email/CH/XP/escrow/ledger/game/deletion unchanged');
  assert.equal((await db.query(inventorySql)).rows[0].inventory.eligible,0);
  const policy=(await db.query('select * from private.profile_terms_policy')).rows;
  await db.exec(cleanup);assert.deepEqual(await rows(),after);assert.deepEqual(Array.from((await db.query('select * from private.profile_terms_policy')).rows),policy);
  assert.deepEqual(await preserved(),invariants);
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
async function termsClientFixture({autoInit=true,required=true}={}){
 const vm=await import('node:vm');
 let user=id,serverVersion='2026-10-26-a1',tokenHook=null,rejectOldVersion=false,variantsEnabled=false,getHook=null,failGet=false;const posts=[],events={},nodes=[],emitted=[];
 const node=()=>({textContent:'',hidden:false,disabled:false,open:false,fields:{},setAttribute(){},addEventListener(type,fn){this[type]=fn;},querySelector(key){return this.fields[key]||(this.fields[key]=node());},showModal(){this.open=true;},close(){this.open=false;}});
 const doc={readyState:'loading',documentElement:{lang:'en'},head:{appendChild(){}},body:{appendChild(n){nodes.push(n);}},createElement:node,querySelector:()=>({sheet:{}}),addEventListener(type,fn){events[type]=fn;},dispatchEvent(event){emitted.push(event.type);}};
 let authChanged;
 const token=value=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:value})).toString('base64url')+'.fixture';
 const window={SupabaseAuth:{getCurrentUser:async()=>({id:user}),onAuthChange:fn=>{authChanged=fn;}},SupabaseAuthBridge:{getAccessToken:async()=>{if(tokenHook){const hook=tokenHook;tokenHook=null;return hook();}return token(user);}},crypto:globalThis.crypto};
 const fetch=async(_url,options)=>{
  if(options.method==='POST'){posts.push({body:JSON.parse(options.body),token:options.headers.Authorization});if(rejectOldVersion){rejectOldVersion=false;serverVersion='next-version';return {ok:false,json:async()=>({error:'terms_version_changed'})};}}
  const result={required:required,version:serverVersion,current:options.method==='POST',variantsEnabled:variantsEnabled,avatarVariants:PUBLIC_AVATAR_VARIANTS.slice(0,variantsEnabled?16:6)};
  if(options.method==='GET'&&getHook){const hook=getHook;getHook=null;await hook();}
  if(options.method==='GET'&&failGet){failGet=false;throw Error('offline');}
  return {ok:true,json:async()=>result};
 };
 vm.runInNewContext(await readFile(new URL('../js/profile-onboarding.js',import.meta.url),'utf8'),{window,document:doc,fetch,location:{pathname:'/account.html',search:''},URLSearchParams,sessionStorage:{getItem:()=>null},crypto:globalThis.crypto,atob:globalThis.atob,CustomEvent:class{constructor(type){this.type=type;}},setTimeout,clearTimeout});
 const flush=async()=>{await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));};
 if(autoInit){events.DOMContentLoaded();await flush();}
 return {window,posts,emitted,start:()=>events.DOMContentLoaded(),setVariants:value=>{variantsEnabled=value;},holdGet:fn=>{getHook=fn;},failNextGet:()=>{failGet=true;},dialog:()=>nodes.find(n=>n.open),flush,token,setUser:value=>{user=value;authChanged();},holdToken:fn=>{tokenHook=fn;},rejectNextVersion:()=>{rejectOldVersion=true;}};
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

test('avatar permissions fail closed before policy arrives and expose only the backend OFF/ON list',async()=>{
 const h=await termsClientFixture({autoInit:false,required:false});
 const choices=()=>Array.from(h.window.ArcadeTerms.getAvatarVariants(id));
 assert.deepEqual(choices(),[]);
 let release;h.holdGet(()=>new Promise(resolve=>{release=resolve;}));h.start();await h.flush();
 assert.deepEqual(choices(),[],'pending policy must expose no active choices');
 release();await h.flush();assert.deepEqual(choices(),PUBLIC_AVATAR_VARIANTS.slice(0,6));
 h.setVariants(true);await h.window.ArcadeTerms.refresh(false);
 assert.deepEqual(choices(),PUBLIC_AVATAR_VARIANTS);
 const copy=h.window.ArcadeTerms.getAvatarVariants(id);copy.length=0;
 assert.equal(choices().length,16,'callers cannot mutate the shared status');
 h.failNextGet();await h.window.ArcadeTerms.refresh(false);
 assert.deepEqual(choices(),[],'failed revalidation must not retain ON permissions');
 assert.ok(h.emitted.filter(type=>type==='profile:terms-status').length>=4);
});
test('avatar permissions belong to the current identity and ignore a late response after switching accounts',async()=>{
 const h=await termsClientFixture({required:false});h.setVariants(true);
 let release;h.holdGet(()=>new Promise(resolve=>{release=resolve;}));
 const stale=h.window.ArcadeTerms.refresh(false);await h.flush();
 const other='00000000-0000-4000-8000-000000000004';h.setVariants(false);h.setUser(other);
 assert.deepEqual(Array.from(h.window.ArcadeTerms.getAvatarVariants(other)),[]);
 await h.flush();assert.deepEqual(Array.from(h.window.ArcadeTerms.getAvatarVariants(other)),PUBLIC_AVATAR_VARIANTS.slice(0,6));
 release();await stale;await h.flush();
 assert.deepEqual(Array.from(h.window.ArcadeTerms.getAvatarVariants(id)),[]);
 assert.deepEqual(Array.from(h.window.ArcadeTerms.getAvatarVariants(other)),PUBLIC_AVATAR_VARIANTS.slice(0,6));
});

// Same bounded query is exercised on real disposable PostgreSQL when configured.
test('expired guest receipt retention is bounded, repeatable and independent of Terms/deletion flags',async()=>{
 const url=process.env.PROFILE_GUEST_RETENTION_TEST_DB_URL;
 let db,sql;
 if(url){
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.match(target.pathname,/_test$/);
  const {default:postgres}=await import('postgres');sql=postgres(url,{max:1,prepare:false});
  assert.match((await sql`show server_version`)[0].server_version,/^17\./);
  assert.notEqual((await sql`select system_identifier::text id from pg_control_system()`)[0].id,'7656985631720456337');
  assert.equal((await sql`select count(*)::int n from pg_tables where schemaname='private'`)[0].n,0);
  db={exec:q=>sql.unsafe(q),query:async(q,p=[])=>({rows:await sql.unsafe(q,p)}),close:()=>sql.end()};
 }else db=new PGlite();
 try{
  await db.exec(`create schema private;
   create table private.profile_terms_policy(active boolean,variants_enabled boolean);
   insert into private.profile_terms_policy values(false,true);
   create table private.profile_terms_receipts(subject_kind text,subject_id text,terms_version text,expires_at timestamptz,primary key(subject_kind,subject_id,terms_version));
   create table public.protected_retention_fixture(kind text primary key,value text);
   insert into public.protected_retention_fixture values('Auth','same'),('profile','same'),('CH','same'),('XP','same'),('Poker','same'),('Storage','same');
   insert into private.profile_terms_receipts select 'guest','expired_'||n,'a1',now()-interval '1 hour' from generate_series(1,102) n;
   insert into private.profile_terms_receipts values('account','owner','a1',null),('guest','live','a1',now()+interval '1 hour'),('guest','no_expiry','a1',null);`);
  if(sql)await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='profile_retention_fixture') then create role profile_retention_fixture;end if;end$$;
   grant usage on schema private,public to profile_retention_fixture;
   grant select on all tables in schema private,public to profile_retention_fixture;
   grant insert,delete on private.profile_terms_receipts to profile_retention_fixture;
   set role profile_retention_fixture;`);
  const tx={unsafe:async(q,p=[]) => (await db.query(q,p)).rows};
  const before=await db.query('select * from public.protected_retention_fixture order by kind');
  let blocker;
  if(sql){
   const {default:postgres}=await import('postgres');blocker=postgres(url,{max:1,prepare:false});
   await blocker.unsafe('begin');
   await blocker.unsafe("select pg_advisory_xact_lock(hashtextextended('profile-terms:guest-retention',0))");
   assert.equal(await cleanupExpiredGuestReceipts(tx),0,'another sweep owns retention; do not wait or mutate');
   await blocker.unsafe('rollback');await blocker.unsafe('begin');await blocker.unsafe("select pg_advisory_xact_lock(hashtextextended('profile-terms:guest:expired_1',0))");await blocker.unsafe("select * from private.profile_terms_receipts where subject_id='expired_1' for update");
  }
  try{
   assert.equal(await cleanupExpiredGuestReceipts(tx),sql?99:100);
   assert.equal(await cleanupExpiredGuestReceipts(tx),2);
   assert.equal(await cleanupExpiredGuestReceipts(tx),0);
   if(blocker){
    // Concurrent acceptance/renewal owns this row: sweep skips it, then keeps it live.
    await blocker.unsafe("update private.profile_terms_receipts set expires_at=now()+interval '1 hour' where subject_id='expired_1'");
    await blocker.unsafe('commit');assert.equal(await cleanupExpiredGuestReceipts(tx),0);
   }
  }finally{if(blocker)await blocker.end();}
  const kept=(await db.query('select subject_id from private.profile_terms_receipts order by subject_id')).rows.map(r=>r.subject_id);
  assert.deepEqual(kept,sql?['expired_1','live','no_expiry','owner']:['live','no_expiry','owner']);
  assert.deepEqual(await db.query('select * from public.protected_retention_fixture order by kind'),before);
  assert.deepEqual(Array.from((await db.query('select * from private.profile_terms_policy')).rows),[{active:false,variants_enabled:true}]);
 }finally{await db.close();}
});

test('WS guest retention uses the existing cadence, serializes ticks and recovers after failure',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('../ws-server/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('let guestReceiptCleanupRunning=false;'),end=source.indexOf('const pokerAccessRefreshTimer =',start);
 let release,calls=0,fail=false;const statements=[];
 const context={loadBeginSqlWs:async()=>async fn=>{calls++;if(fail)throw Error('unavailable');return fn({unsafe:async q=>{statements.push(q);}});},cleanupExpiredGuestReceipts:async()=>new Promise(resolve=>{release=resolve;})};
 runInNewContext(source.slice(start,end)+';this.tick=runGuestReceiptCleanupTick;',context);
 const first=context.tick();await new Promise(resolve=>setImmediate(resolve));await context.tick();assert.equal(calls,1);
 assert.deepEqual(statements,["set local lock_timeout='250ms';","set local statement_timeout='2s';"]);
 release(0);await first;fail=true;await assert.rejects(context.tick(),/unavailable/);
 fail=false;const recovered=context.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);release(0);await recovered;
 const timer=source.slice(end,source.indexOf('pokerAccessRefreshTimer.unref();',end));
 assert.match(timer,/void runGuestReceiptCleanupTick\(\)\.catch/);assert.doesNotMatch(timer,/if\s*\(/);
});
