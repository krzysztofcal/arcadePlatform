-- Prepared only. Exact-file Production GO required; no flags or data cleanup.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
do $contract$
declare expected text[]:=array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104','20261022091126','20261026120000','20261028180000','20261105160500']; actual text[];
 source_hash text; stats_before jsonb; stat record; delta bigint[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('arcade.production_ugc_reports_confirmation',true) is distinct from 'INSTALL UGC REPORTS BLOCKS otbqfijerkieoxwpxjnm'
 then raise exception 'Production UGC reports/blocks identity/confirmation mismatch'; end if;
 source_hash:=current_setting('arcade.production_ugc_reports_source_sha256',true);
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' then raise exception 'Approved source hash receipt required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production coordination busy'; end if;
 lock table supabase_migrations.schema_migrations in share row exclusive mode nowait;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production UGC reports/blocks history drift'; end if;
 if to_regclass('private.user_blocks') is not null or to_regclass('private.ugc_reports') is not null then raise exception 'Unexpected existing UGC reports/blocks objects'; end if;
 select jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) into stats_before from pg_stat_xact_user_tables;
 execute $schema$-- A block is the blocker's private filter. It never changes seats, turns, cards, chips, escrow, settlement or
-- reconnect: those are not read from this table.
create table private.user_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

-- Reasons are fixed codes; there is no free text, so a report cannot carry new user-generated content.
-- evidence is a server-made snapshot of the target's public identity at report time (handle, display name,
-- avatar projection inputs), never client input. Moderation (phase C) sets status, resolved_* and resolution.
create table private.ugc_reports (
  id bigint generated always as identity primary key,
  reporter_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('inappropriate_avatar','inappropriate_name','harassment','cheating','spam','other')),
  context text not null check (context in ('profile','table')),
  table_id uuid,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text check (resolution is null or resolution in ('no_action','avatar_hidden','profile_restricted')),
  check (reporter_user_id is null or reporter_user_id <> target_user_id),
  check ((context = 'table') = (table_id is not null)),
  check ((status = 'pending') = (resolved_at is null))
);
-- One open report per reporter and target: a repeated report is answered as already reported.
create unique index ugc_reports_one_pending_per_pair on private.ugc_reports (reporter_user_id, target_user_id)
  where status = 'pending';
create index ugc_reports_queue on private.ugc_reports (status, created_at);
create index ugc_reports_target on private.ugc_reports (target_user_id);

alter table private.user_blocks enable row level security;
alter table private.ugc_reports enable row level security;
revoke all on private.user_blocks, private.ugc_reports from public, anon, authenticated;
grant select, insert, delete on private.user_blocks to service_role;
grant select, insert, update on private.ugc_reports to service_role;
$schema$;
 if not exists(select 1 from pg_class where oid='private.user_blocks'::regclass and relowner='postgres'::regrole and relrowsecurity)
 or not exists(select 1 from pg_class where oid='private.ugc_reports'::regclass and relowner='postgres'::regrole and relrowsecurity)
 then raise exception 'UGC reports/blocks owner/RLS mismatch'; end if;
 if exists(select 1 from private.user_blocks) or exists(select 1 from private.ugc_reports) then raise exception 'UGC reports/blocks tables not empty'; end if;
 if exists(
   select 1 from (values('anon'),('authenticated'),('public')) r(role),
                 (values('private.user_blocks'),('private.ugc_reports')) t(tbl)
   where has_table_privilege(role, tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 or not (
   has_table_privilege('service_role', 'private.user_blocks', 'SELECT') and
   has_table_privilege('service_role', 'private.user_blocks', 'INSERT') and
   has_table_privilege('service_role', 'private.user_blocks', 'DELETE') and
   not has_table_privilege('service_role', 'private.user_blocks', 'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
 )
 or not (
   has_table_privilege('service_role', 'private.ugc_reports', 'SELECT') and
   has_table_privilege('service_role', 'private.ugc_reports', 'INSERT') and
   has_table_privilege('service_role', 'private.ugc_reports', 'UPDATE') and
   not has_table_privilege('service_role', 'private.ugc_reports', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 then raise exception 'UGC reports/blocks table privileges mismatch'; end if;
 for stat in select * from pg_stat_xact_user_tables where schemaname<>'supabase_migrations' loop
  delta:=array[stat.n_tup_ins-coalesce((stats_before->stat.relid::text->>0)::bigint,0),stat.n_tup_upd-coalesce((stats_before->stat.relid::text->>1)::bigint,0),stat.n_tup_del-coalesce((stats_before->stat.relid::text->>2)::bigint,0)];
  if delta is distinct from (array[0,0,0]::bigint[]) then raise exception 'Unexpected data DML: %.%',stat.schemaname,stat.relname; end if;
 end loop;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261107120000','ugc_reports_blocks',array['source_sha256='||source_hash]);
end $contract$;
commit;
