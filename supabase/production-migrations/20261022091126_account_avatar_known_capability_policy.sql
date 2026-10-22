-- #1132 Production equivalent after reviewed history 66. Separate exact-file GO required.
-- Schema-only: does not insert acceptance, cutover evidence or enable deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $identity$
declare expected text[] := array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000','20261021191104']; actual text[]; pin jsonb;
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('chips.production_avatar_risk_confirmation',true) is distinct from
 'INSTALL AVATAR KNOWN CAPABILITY POLICY otbqfijerkieoxwpxjnm' then raise exception 'Production avatar policy identity/confirmation mismatch'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production retention coordination busy'; end if;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production avatar policy history drift'; end if;
 -- Only the pinned Production target may acquire writer/release locks.
 lock table public.profile_avatar_uploads in share row exclusive mode;
 perform 1 from public.account_deletion_release for update;
 if (select enabled from public.account_deletion_release) is distinct from false
 or exists(select 1 from public.account_deletion_requests where status not in ('COMPLETED'))
 or (select tgenabled from pg_trigger where tgrelid='public.profile_avatar_uploads'::regclass and tgname='account_avatar_manifest_guard_v3') is distinct from 'D'
 then raise exception 'Production avatar policy requires deletion OFF and v3 disabled'; end if;
 if not exists(select 1 from pg_class where oid='private.avatar_tracking_cutover'::regclass and relrowsecurity and relowner='postgres'::regrole)
 or exists(select 1 from pg_policy where polrelid='private.avatar_tracking_cutover'::regclass)
 or exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role) where has_table_privilege(role,'private.avatar_tracking_cutover','INSERT,UPDATE,DELETE,TRUNCATE'))
 then raise exception 'Production cutover authority drift'; end if;
 for pin in select value from jsonb_array_elements($pins$[{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","sha256":"b30f6eda974a97891bccd0f057e10b9863420fddda2717a3674c76af07aacc29","signature":"private.account_avatar_manifest_reconciled(uuid,uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","sha256":"922bed99b917f83c49bab243a68eb660e41097683f34bdceb5abcb4c6ac5b6b1","signature":"private.account_avatar_prepare_purge(uuid,uuid,bigint,text)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","sha256":"1cb995b833fd59961a0e32e41d3939f7c750a26e2f3c4f08dcf87eeff32638ff","signature":"private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text)"}]$pins$::jsonb) loop
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(pin->>'signature')
 and pg_get_userbyid(p.proowner)=pin->>'owner' and p.proacl::text is not distinct from pin->>'acl'
 and encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex')=pin->>'sha256')
 then raise exception 'Production avatar function drift: %',pin->>'signature'; end if;
 end loop;
end;
$identity$;

alter table private.avatar_tracking_cutover
  add column unobserved_capability_risk_accepted_at timestamptz,
  add constraint avatar_unobserved_risk_after_cutoff check
    (unobserved_capability_risk_accepted_at is null or unobserved_capability_risk_accepted_at>=cutover_at);

create function private.account_avatar_safe_after(marker_key text) returns timestamptz
language sql stable security definer set search_path='' as $$
 select case when c.unobserved_capability_risk_accepted_at between c.cutover_at and clock_timestamp()
   then c.cutover_at else c.cutover_at+interval '7200 seconds' end
 from private.avatar_tracking_cutover c
 where c.marker=marker_key and c.legacy_inventory_verified
   and c.upload_bucket='profile-avatar-uploads' and c.public_bucket='profile-avatars';
$$;
revoke all on function private.account_avatar_safe_after(text) from public,anon,authenticated;
grant execute on function private.account_avatar_safe_after(text) to service_role;

-- Patch only the mandatory global waiting predicate; owner/request/lease,
-- known capability expiry, receipts and ownership checks stay byte-identical.
do $patch$
declare signature text; definition text; needle text; replacement text;
begin
 for signature,needle,replacement in values
 ('private.account_avatar_manifest_reconciled(uuid,uuid,uuid)',
  'c.cutover_at+interval ''7200 seconds''<=clock_timestamp()',
  'private.account_avatar_safe_after(c.marker)<=clock_timestamp()'),
 ('private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text)',
  'cut.cutover_at+interval ''7200 seconds''>clock_timestamp()',
  'coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)'),
 ('private.account_avatar_prepare_purge(uuid,uuid,bigint,text)',
  'cut.cutover_at+interval ''7200 seconds''>clock_timestamp()',
  'coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)')
 loop
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  if definition is null or (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Avatar capability policy function drift: %',signature;
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end;
$patch$;

insert into supabase_migrations.schema_migrations(version) values('20261022091126');
commit;
