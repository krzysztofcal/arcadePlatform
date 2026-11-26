-- Prepared only. Exact-file Production GO required; no flags or data cleanup.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
do $contract$
declare expected text[]:=array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104','20261022091126','20261026120000','20261028180000','20261105160500','20261107120000']; actual text[];
 source_hash text; stats_before jsonb; stat record; delta bigint[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('arcade.production_ugc_moderation_confirmation',true) is distinct from 'INSTALL UGC MODERATION otbqfijerkieoxwpxjnm'
 then raise exception 'Production UGC moderation identity/confirmation mismatch'; end if;
 source_hash:=current_setting('arcade.production_ugc_moderation_source_sha256',true);
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' then raise exception 'Approved source hash receipt required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production coordination busy'; end if;
 lock table supabase_migrations.schema_migrations in share row exclusive mode nowait;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production UGC moderation history drift'; end if;
 if not exists(
   select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='public.user_profiles'::regclass and a.attname='public_profile_blocked'
     and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false'
 ) then raise exception 'public_profile_blocked preflight mismatch'; end if;
 if not exists(
   select 1 from pg_trigger t
   where t.tgrelid='public.user_profiles'::regclass and t.tgname='user_profiles_block_guard'
     and not t.tgisinternal and t.tgenabled in ('O','A')
 ) then raise exception 'user_profiles_block_guard preflight mismatch'; end if;
 if to_regclass('private.ugc_moderation_actions') is not null or to_regclass('private.ugc_avatar_holds') is not null
 or to_regclass('private.ugc_moderation_counters') is not null
 or to_regprocedure('private.ugc_count_removed_pending_report()') is not null
 or to_regprocedure('private.ugc_set_profile_blocked(uuid,boolean)') is not null
 then raise exception 'Unexpected existing UGC moderation objects'; end if;
 select jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) into stats_before from pg_stat_xact_user_tables;
 execute $schema$-- Audit of every moderation decision and target action, kept with the report.
create table private.ugc_moderation_actions (
  id bigint generated always as identity primary key,
  report_id bigint references private.ugc_reports(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null,
  action text not null check (action in ('resolve','dismiss','hide_avatar','restrict_profile','unrestrict_profile')),
  created_at timestamptz not null default now()
);
create index ugc_moderation_actions_report on private.ugc_moderation_actions (report_id);
create index ugc_moderation_actions_target on private.ugc_moderation_actions (target_user_id);

-- A moderator's avatar hide. Phase D (Google photo import) must not publish a photo for a user listed here.
create table private.ugc_avatar_holds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  admin_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table private.ugc_moderation_actions enable row level security;
alter table private.ugc_avatar_holds enable row level security;
revoke all on private.ugc_moderation_actions, private.ugc_avatar_holds from public, anon, authenticated;
grant select, insert on private.ugc_moderation_actions to service_role;
grant select, insert, delete on private.ugc_avatar_holds to service_role;

-- Anonymous counter: no user id, report content, time per report or identity hash; only a running total.
create table private.ugc_moderation_counters (
  key text primary key check (key in ('pending_removed_with_deleted_account')),
  value bigint not null default 0 check (value >= 0)
);
insert into private.ugc_moderation_counters (key, value) values ('pending_removed_with_deleted_account', 0);
alter table private.ugc_moderation_counters enable row level security;
revoke all on private.ugc_moderation_counters from public, anon, authenticated;
grant select on private.ugc_moderation_counters to service_role;

-- Counts a pending report deleted while its reported account no longer exists, i.e. by the account-deletion cascade
-- (the cascade runs after the auth.users row is gone). Any other deletion of a report is not counted.
create function private.ugc_count_removed_pending_report()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if old.status = 'pending' and not exists (select 1 from auth.users u where u.id = old.target_user_id) then
    insert into private.ugc_moderation_counters (key, value) values ('pending_removed_with_deleted_account', 1)
    on conflict (key) do update set value = private.ugc_moderation_counters.value + 1;
  end if;
  return old;
end $$;
revoke all on function private.ugc_count_removed_pending_report() from public, anon, authenticated;
create trigger ugc_reports_count_removed_pending after delete on private.ugc_reports
for each row execute function private.ugc_count_removed_pending_report();

-- The phase A profile block (#1155, public.user_profiles.public_profile_blocked) may be changed only by a database
-- administrator (trigger user_profiles_block_guard). This definer function is the one audited path for moderators;
-- it runs as its owner (the migration role) and fails closed where the column is missing or the guard trigger is
-- missing or does not fire in normal sessions (disabled or replica only), so the block can never be set through
-- a path the phase A guard does not protect.
create function private.ugc_set_profile_blocked(p_user_id uuid, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare
  changed integer;
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.user_profiles'::regclass and t.tgname = 'user_profiles_block_guard'
      and not t.tgisinternal and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'public profile block guard is not active' using errcode = '55000';
  end if;
  update public.user_profiles set public_profile_blocked = p_blocked where user_id = p_user_id;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function private.ugc_set_profile_blocked(uuid, boolean) from public, anon, authenticated;
grant execute on function private.ugc_set_profile_blocked(uuid, boolean) to service_role;
$schema$;
 if not exists(select 1 from pg_class where oid='private.ugc_moderation_actions'::regclass and relowner='postgres'::regrole and relrowsecurity)
 or not exists(select 1 from pg_class where oid='private.ugc_avatar_holds'::regclass and relowner='postgres'::regrole and relrowsecurity)
 or not exists(select 1 from pg_class where oid='private.ugc_moderation_counters'::regclass and relowner='postgres'::regrole and relrowsecurity)
 then raise exception 'UGC moderation tables owner/RLS mismatch'; end if;
 if exists(select 1 from private.ugc_moderation_actions) or exists(select 1 from private.ugc_avatar_holds)
 then raise exception 'UGC moderation tables not empty'; end if;
 if (select count(*) from private.ugc_moderation_counters) <> 1
 or not exists(select 1 from private.ugc_moderation_counters where key='pending_removed_with_deleted_account' and value=0)
 then raise exception 'UGC moderation counter seed mismatch'; end if;
 if not exists(
   select 1 from pg_proc
   where oid='private.ugc_count_removed_pending_report()'::regprocedure
     and proowner='postgres'::regrole and prosecdef
     and proconfig=array['search_path=pg_catalog']
 ) or has_function_privilege('anon','private.ugc_count_removed_pending_report()','EXECUTE')
   or has_function_privilege('authenticated','private.ugc_count_removed_pending_report()','EXECUTE')
 then raise exception 'ugc_count_removed_pending_report contract mismatch'; end if;
 if not exists(
   select 1 from pg_proc
   where oid='private.ugc_set_profile_blocked(uuid,boolean)'::regprocedure
     and proowner='postgres'::regrole and prosecdef
     and proconfig=array['search_path=pg_catalog']
 ) or has_function_privilege('anon','private.ugc_set_profile_blocked(uuid,boolean)','EXECUTE')
   or has_function_privilege('authenticated','private.ugc_set_profile_blocked(uuid,boolean)','EXECUTE')
   or not has_function_privilege('service_role','private.ugc_set_profile_blocked(uuid,boolean)','EXECUTE')
 then raise exception 'ugc_set_profile_blocked contract mismatch'; end if;
 for stat in select * from pg_stat_xact_user_tables where schemaname<>'supabase_migrations' loop
  delta:=array[stat.n_tup_ins-coalesce((stats_before->stat.relid::text->>0)::bigint,0),stat.n_tup_upd-coalesce((stats_before->stat.relid::text->>1)::bigint,0),stat.n_tup_del-coalesce((stats_before->stat.relid::text->>2)::bigint,0)];
  if delta is distinct from (case when stat.schemaname='private' and stat.relname='ugc_moderation_counters' then array[1,0,0]::bigint[] else array[0,0,0]::bigint[] end) then raise exception 'Unexpected data DML: %.%',stat.schemaname,stat.relname; end if;
 end loop;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261107130000','ugc_moderation',array['source_sha256='||source_hash]);
end $contract$;
commit;
