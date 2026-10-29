-- Prepared only. Exact-file Production GO required; no flags or data cleanup.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
do $contract$
declare expected text[]:=array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104','20261022091126']; actual text[]; uid uuid; pin jsonb;
 before_profiles text; after_profiles text; before_count bigint; source_hash text; stats_before jsonb; stat record; delta bigint[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('arcade.production_profile_confirmation',true) is distinct from 'INSTALL PROFILE PHASE A otbqfijerkieoxwpxjnm'
 then raise exception 'Production profile identity/confirmation mismatch'; end if;
 source_hash:=current_setting('arcade.production_profile_source_sha256',true);
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' then raise exception 'Approved source hash receipt required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production coordination busy'; end if;
 lock table supabase_migrations.schema_migrations in share row exclusive mode nowait;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production profile history drift'; end if;
 select count(*) into before_count from public.user_profiles;
 if before_count>1000 then raise exception 'Profile inventory exceeds reviewed bound'; end if;
 for uid in select user_id from public.user_profiles order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:'||uid::text,0));
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef and p.prokind='f' and (p.prosrc ~* 'user_profiles|ensure_user_profile' or p.prorettype='public.user_profiles'::regtype) and p.oid not in ('public.ensure_user_profile(uuid)'::regprocedure,'public.create_user_profile_after_signup()'::regprocedure)) then raise exception 'Unexpected related SECURITY DEFINER path'; end if;
 if to_regclass('private.profile_terms_policy') is not null or to_regclass('private.profile_terms_receipts') is not null
 or to_regprocedure('private.arcade_profile_identity()') is not null then raise exception 'Unexpected existing Phase A objects'; end if;
 for pin in select value from jsonb_array_elements($pins$[{"signature":"ensure_user_profile(uuid)","hash":"ad59ad3a9177b13be55a4a603cef39f49231f54bea300155c2e0b8c78a8185a0","owner":"postgres","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"},{"signature":"create_user_profile_after_signup()","hash":"5340b801d438c7ae414a22bd2064046976d8f748d61243de7711e3f83a53dae5","owner":"postgres","acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}"}]$pins$::jsonb) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(pin->>'signature') and pg_get_userbyid(p.proowner)=pin->>'owner'
   and p.proacl::text is not distinct from pin->>'acl'
   and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=pin->>'hash') then raise exception 'Provisioning definition/ACL drift'; end if;
 end loop;
 lock table public.user_profiles in access exclusive mode nowait;
 if (select array_agg(attname::text order by attnum) from pg_attribute where attrelid='public.user_profiles'::regclass and attnum>0 and not attisdropped)
 is distinct from array['user_id','handle','display_name','bio','avatar_key','avatar_variant','handle_customized_at','created_at','updated_at','leaderboard_visible'] then raise exception 'Production profile column drift'; end if;
 if not exists(select 1 from pg_class where oid='public.user_profiles'::regclass and relowner='postgres'::regrole and relrowsecurity) then raise exception 'Profile owner/RLS drift'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by user_id)::text,'[]')) into before_profiles from public.user_profiles p;
 select jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) into stats_before from pg_stat_xact_user_tables;
 execute $schema$-- Additive only. No profile cleanup, Storage I/O, activation, or game/ledger writes.
create schema if not exists private;
grant usage on schema private to service_role;
alter table public.user_profiles
 add column avatar_revision integer not null default 1 check (avatar_revision between 1 and 2147483646),
 add column google_photo_suppressed boolean not null default false;
create table private.profile_terms_policy (
 singleton boolean primary key default true check(singleton),
 version text not null check(length(version) between 1 and 64),
 active boolean not null default false,
 variants_enabled boolean not null default false,
 identity_normalized_at timestamptz
);
insert into private.profile_terms_policy(singleton,version) values(true,'2026-10-26-a1');
create table private.profile_terms_receipts (
 subject_kind text not null check(subject_kind in ('account','guest')),
 subject_id text not null check(length(subject_id) between 1 and 128),
 account_user_id uuid references auth.users(id) on delete cascade,
 terms_version text not null check(length(terms_version) between 1 and 64),
 accepted_at timestamptz not null default statement_timestamp(),
 request_id text not null check(length(request_id) between 8 and 96),
 expires_at timestamptz,
 primary key(subject_kind,subject_id,terms_version),
 unique(subject_kind,subject_id,request_id),
 check((subject_kind='account' and account_user_id is not null and subject_id=account_user_id::text and expires_at is null)
   or (subject_kind='guest' and account_user_id is null and expires_at is not null))
);
create index profile_terms_guest_expiry on private.profile_terms_receipts(expires_at) where expires_at is not null;
alter table private.profile_terms_policy enable row level security;
alter table private.profile_terms_receipts enable row level security;
revoke all on private.profile_terms_policy,private.profile_terms_receipts from public,anon,authenticated,service_role;
grant select on private.profile_terms_policy to service_role;
grant select,insert,delete on private.profile_terms_receipts to service_role;
-- Policy remains OFF until independent legal, reader compatibility and owner gates.

create or replace function private.arcade_profile_identity()
returns table(handle text,display_name text) language plpgsql set search_path='' as $$
declare adjectives text[] := array['Apex', 'Blue', 'Bold', 'Bright', 'Cosmic', 'Echo', 'Ember', 'Neon', 'Nova', 'Pixel', 'Rapid', 'Rocket', 'Solar', 'Swift', 'Turbo', 'Ultra', 'Vivid', 'Zen']; nouns text[] := array['Ace', 'Bolt', 'Comet', 'Falcon', 'Fox', 'Nova', 'Orbit', 'Panda', 'Raven', 'Tiger', 'Wave', 'Wizard']; entropy bytea; adjective text; noun text; suffix integer;
begin
 entropy:=pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
 adjective:=adjectives[1+((get_byte(entropy,0)*256+get_byte(entropy,1))%array_length(adjectives,1))];
 noun:=nouns[1+((get_byte(entropy,2)*256+get_byte(entropy,3))%array_length(nouns,1))];
 suffix:=100000+((get_byte(entropy,4)::bigint*16777216+get_byte(entropy,5)::bigint*65536+get_byte(entropy,6)::bigint*256+get_byte(entropy,7)::bigint)%900000)::integer;
 return query select lower(adjective||'-'||noun||'-'||suffix::text),adjective||' '||noun||' '||suffix::text;
end $$;
revoke all on function private.arcade_profile_identity() from public,anon,authenticated;
grant execute on function private.arcade_profile_identity() to service_role;

create or replace function public.ensure_user_profile(target_user_id uuid)
returns public.user_profiles language plpgsql security definer set search_path='' as $$
declare profile_row public.user_profiles; generated record; variants text[]:=ARRAY['comet-blue','falcon-orange','fox-blue','nova-purple','orbit-green','panda-pink','raven-violet','tiger-gold','wave-cyan','wizard-indigo','bolt-yellow','rocket-red','ace-silver','ember-coral','pixel-teal','zen-lime'];
begin
 if target_user_id is null then raise exception 'target_user_id is required' using errcode='22023'; end if;
 select * into profile_row from public.user_profiles p where p.user_id=target_user_id;
 if found then return profile_row; end if;
 if not coalesce((select variants_enabled from private.profile_terms_policy where singleton=true),false) then variants:=variants[1:6]; end if;
 for attempt in 1..16 loop
  select * into generated from private.arcade_profile_identity();
  insert into public.user_profiles(user_id,handle,display_name,avatar_variant)
  values(target_user_id,generated.handle,generated.display_name,variants[1+floor(random()*array_length(variants,1))::int]) on conflict do nothing returning * into profile_row;
  if profile_row.user_id is not null then return profile_row; end if;
  select * into profile_row from public.user_profiles p where p.user_id=target_user_id;
  if found then return profile_row; end if;
 end loop;
 raise exception 'profile_generation_exhausted';
end $$;
revoke all on function public.ensure_user_profile(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_profile(uuid) to service_role;

revoke all on function public.create_user_profile_after_signup() from public,anon,authenticated;
grant execute on function public.create_user_profile_after_signup() to service_role;
$schema$;
 select md5(coalesce(jsonb_agg(to_jsonb(p)-'avatar_revision'-'google_photo_suppressed' order by user_id)::text,'[]')) into after_profiles from public.user_profiles p;
 if after_profiles is distinct from before_profiles or (select count(*) from public.user_profiles)<>before_count then raise exception 'Protected profile data changed'; end if;
 if not exists(select 1 from private.profile_terms_policy where singleton and version='2026-10-26-a1' and not active and not variants_enabled and identity_normalized_at is null)
 or exists(select 1 from private.profile_terms_receipts) then raise exception 'Policy/receipt activation forbidden'; end if;
 if has_table_privilege('service_role','private.profile_terms_policy','INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('service_role','private.profile_terms_receipts','UPDATE,TRUNCATE') then raise exception 'Terms backend ACL drift'; end if;
 if exists(select 1 from (values('anon'),('authenticated')) r(role) where has_function_privilege(role,'public.ensure_user_profile(uuid)','EXECUTE') or has_function_privilege(role,'public.create_user_profile_after_signup()','EXECUTE'))
 or not has_function_privilege('service_role','public.ensure_user_profile(uuid)','EXECUTE') then raise exception 'Provisioning ACL mismatch'; end if;
 for stat in select * from pg_stat_xact_user_tables where schemaname<>'supabase_migrations' loop
  delta:=array[stat.n_tup_ins-coalesce((stats_before->stat.relid::text->>0)::bigint,0),stat.n_tup_upd-coalesce((stats_before->stat.relid::text->>1)::bigint,0),stat.n_tup_del-coalesce((stats_before->stat.relid::text->>2)::bigint,0)];
  if delta is distinct from (case when stat.schemaname='private' and stat.relname='profile_terms_policy' then array[1,0,0]::bigint[] else array[0,0,0]::bigint[] end) then raise exception 'Unexpected data DML: %.%',stat.schemaname,stat.relname; end if;
 end loop;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261026120000','profile_phase_a',array['source_sha256='||source_hash]);
end $contract$;
commit;
