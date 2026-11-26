-- Prepared only. Exact-file Production GO required; no flags or data cleanup.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
do $contract$
declare expected text[]:=array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104','20261022091126','20261026120000','20261028180000','20261105160500','20261107120000','20261107130000']; actual text[];
 source_hash text; stats_before jsonb; stat record; delta bigint[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('arcade.production_photo_consent_confirmation',true) is distinct from 'INSTALL GOOGLE PHOTO CONSENT otbqfijerkieoxwpxjnm'
 then raise exception 'Production photo consent identity/confirmation mismatch'; end if;
 source_hash:=current_setting('arcade.production_photo_consent_source_sha256',true);
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' then raise exception 'Approved source hash receipt required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production coordination busy'; end if;
 lock table supabase_migrations.schema_migrations in share row exclusive mode nowait;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production photo consent history drift'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261107120000' and statements=array['source_sha256=328ea29e4cd7c661cc9a67b6103c724bce9e16767d9e1e17f077029e6a3844b6'])
 or not exists(select 1 from supabase_migrations.schema_migrations where version='20261107130000' and statements=array['source_sha256=b5b6b7921594e20e7aaae77f5fa49aca89cb0ece35b8c21915d906ef6d1d3412'])
 then raise exception 'UGC moderation source receipt drift'; end if;
 if to_regclass('private.profile_photo_consents') is not null or to_regclass('private.profile_photo_pending_deletions') is not null
 then raise exception 'Unexpected existing photo consent objects'; end if;
 select jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) into stats_before from pg_stat_xact_user_tables;
 execute $schema$create table private.profile_photo_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notice_version text not null check (length(notice_version) between 1 and 64),
  decision text not null check (decision in ('granted','withdrawn')),
  consent_revision integer not null default 1 check (consent_revision between 1 and 2147483646),
  granted_at timestamptz not null,
  withdrawn_at timestamptz,
  imported_avatar_key text check (imported_avatar_key ~ '^[0-9a-f-]{36}[.]webp$'),
  -- After a withdrawal the key stays only until our copy is deleted from Storage (a failed deletion is retried).
  check ((decision = 'withdrawn') = (withdrawn_at is not null))
);

-- A Google copy written to Storage but not (yet) attached or confirmed deleted: listed before the write and removed
-- only by a successful attach or a confirmed deletion, so a withdrawal can always find and delete it.
create table private.profile_photo_pending_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_key text not null check (avatar_key ~ '^[0-9a-f-]{36}[.]webp$'),
  created_at timestamptz not null default now(),
  -- While the write may still land (from listing until its outcome is known, or for a lost or 5xx response) a
  -- confirmed deletion does not unlist it. Same horizon as the avatar manifest capability (2 h).
  uncertain_until timestamptz,
  primary key (user_id, avatar_key)
);

alter table private.profile_photo_consents enable row level security;
alter table private.profile_photo_pending_deletions enable row level security;
revoke all on private.profile_photo_consents, private.profile_photo_pending_deletions from public, anon, authenticated;
grant select, insert, update on private.profile_photo_consents to service_role;
grant select, insert, update, delete on private.profile_photo_pending_deletions to service_role;
$schema$;
 if not exists(select 1 from pg_class where oid='private.profile_photo_consents'::regclass and relowner='postgres'::regrole and relrowsecurity)
 or not exists(select 1 from pg_class where oid='private.profile_photo_pending_deletions'::regclass and relowner='postgres'::regrole and relrowsecurity)
 then raise exception 'Photo consent tables owner/RLS mismatch'; end if;
 if exists(select 1 from private.profile_photo_consents)
 or exists(select 1 from private.profile_photo_pending_deletions)
 then raise exception 'Photo consent tables not empty'; end if;
 if exists(
   select 1 from (values('anon'),('authenticated'),('public')) r(role),
                 (values('private.profile_photo_consents'),('private.profile_photo_pending_deletions')) t(tbl)
   where has_table_privilege(role, tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 or not (
   has_table_privilege('service_role', 'private.profile_photo_consents', 'SELECT') and
   has_table_privilege('service_role', 'private.profile_photo_consents', 'INSERT') and
   has_table_privilege('service_role', 'private.profile_photo_consents', 'UPDATE') and
   not has_table_privilege('service_role', 'private.profile_photo_consents', 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 or not (
   has_table_privilege('service_role', 'private.profile_photo_pending_deletions', 'SELECT') and
   has_table_privilege('service_role', 'private.profile_photo_pending_deletions', 'INSERT') and
   has_table_privilege('service_role', 'private.profile_photo_pending_deletions', 'UPDATE') and
   has_table_privilege('service_role', 'private.profile_photo_pending_deletions', 'DELETE') and
   not has_table_privilege('service_role', 'private.profile_photo_pending_deletions', 'TRUNCATE,REFERENCES,TRIGGER')
 )
 then raise exception 'Photo consent table privileges mismatch'; end if;
 for stat in select * from pg_stat_xact_user_tables where schemaname<>'supabase_migrations' loop
  delta:=array[stat.n_tup_ins-coalesce((stats_before->stat.relid::text->>0)::bigint,0),stat.n_tup_upd-coalesce((stats_before->stat.relid::text->>1)::bigint,0),stat.n_tup_del-coalesce((stats_before->stat.relid::text->>2)::bigint,0)];
  if delta is distinct from (array[0,0,0]::bigint[]) then raise exception 'Unexpected data DML: %.%',stat.schemaname,stat.relname; end if;
 end loop;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261107140000','google_photo_consent',array['source_sha256='||source_hash]);
end $contract$;
commit;
