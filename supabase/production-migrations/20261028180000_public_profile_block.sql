-- Prepared only. Exact-file Production GO required; no flags or data cleanup.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
do $contract$
declare expected text[]:=array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104','20261022091126','20261026120000']; actual text[]; uid uuid; pin jsonb;
 before_profiles text; after_profiles text; before_count bigint; source_hash text; stats_before jsonb; stat record; delta bigint[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('arcade.production_profile_confirmation',true) is distinct from 'INSTALL PUBLIC PROFILE BLOCK otbqfijerkieoxwpxjnm'
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
 if not exists(select 1 from pg_proc where oid='public.ensure_user_profile(uuid)'::regprocedure and proowner='postgres'::regrole and prosecdef and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6ca1c1ef540273b9fae6d38dfd1c0e4ee3ed16b9ec0abcb8e9caf1bf675ad6ca') or has_function_privilege('anon','public.ensure_user_profile(uuid)','EXECUTE') or has_function_privilege('authenticated','public.ensure_user_profile(uuid)','EXECUTE') then raise exception 'Phase A provisioning drift'; end if;
 perform 1 from private.profile_terms_policy where singleton for share;
 if not exists(select 1 from private.profile_terms_policy where singleton and version='2026-10-26-a1' and not active and not variants_enabled and identity_normalized_at is null)
 or exists(select 1 from private.profile_terms_receipts) then raise exception 'Unexpected Phase A policy'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261026120000' and statements=array['source_sha256=edf83e55891441213695b8c9f04d72b2ffd34151aa58239179fa60056ff6a862']) then raise exception 'Phase A source receipt drift'; end if;
 lock table public.user_profiles in access exclusive mode nowait;
 if (select array_agg(attname::text order by attnum) from pg_attribute where attrelid='public.user_profiles'::regclass and attnum>0 and not attisdropped)
 is distinct from array['user_id','handle','display_name','bio','avatar_key','avatar_variant','handle_customized_at','created_at','updated_at','leaderboard_visible','avatar_revision','google_photo_suppressed'] then raise exception 'Production profile column drift'; end if;
 if not exists(select 1 from pg_class where oid='public.user_profiles'::regclass and relowner='postgres'::regrole and relrowsecurity) then raise exception 'Profile owner/RLS drift'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by user_id)::text,'[]')) into before_profiles from public.user_profiles p;
 select jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) into stats_before from pg_stat_xact_user_tables;
 execute $schema$alter table public.user_profiles add column public_profile_blocked boolean not null default false;
create function private.guard_public_profile_block() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if (TG_OP='INSERT' and new.public_profile_blocked)
 or (TG_OP='UPDATE' and new.public_profile_blocked is distinct from old.public_profile_blocked) then
  if current_user not in ('postgres','supabase_admin') then
   raise exception 'public profile block requires database administrator' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger user_profiles_block_guard before insert or update on public.user_profiles
for each row execute function private.guard_public_profile_block();
revoke all on function private.guard_public_profile_block() from public;
$schema$;
 select md5(coalesce(jsonb_agg(to_jsonb(p)-'public_profile_blocked' order by user_id)::text,'[]')) into after_profiles from public.user_profiles p;
 if after_profiles is distinct from before_profiles or (select count(*) from public.user_profiles)<>before_count then raise exception 'Protected profile data changed'; end if;
 if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.user_profiles'::regclass and a.attname='public_profile_blocked' and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then raise exception 'Block column contract mismatch'; end if;
 if exists(select 1 from public.user_profiles where public_profile_blocked is distinct from false) then raise exception 'Profile blocks activated'; end if;
 if not exists(select 1 from pg_proc where oid='private.guard_public_profile_block()'::regprocedure and proowner='postgres'::regrole and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'Block guard contract mismatch'; end if;
 if has_function_privilege('anon','private.guard_public_profile_block()','EXECUTE') or has_function_privilege('authenticated','private.guard_public_profile_block()','EXECUTE') then raise exception 'Block guard ACL mismatch'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.user_profiles'::regclass and tgname='user_profiles_block_guard' and tgfoid='private.guard_public_profile_block()'::regprocedure and tgtype=23 and tgenabled='O') then raise exception 'Block trigger contract mismatch'; end if;
 for stat in select * from pg_stat_xact_user_tables where schemaname<>'supabase_migrations' loop
  delta:=array[stat.n_tup_ins-coalesce((stats_before->stat.relid::text->>0)::bigint,0),stat.n_tup_upd-coalesce((stats_before->stat.relid::text->>1)::bigint,0),stat.n_tup_del-coalesce((stats_before->stat.relid::text->>2)::bigint,0)];
  if delta is distinct from (array[0,0,0]::bigint[]) then raise exception 'Unexpected data DML: %.%',stat.schemaname,stat.relname; end if;
 end loop;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261028180000','public_profile_block',array['source_sha256='||source_hash]);
end $contract$;
commit;
