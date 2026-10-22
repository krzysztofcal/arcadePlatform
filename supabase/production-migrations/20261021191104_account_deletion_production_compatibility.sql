-- #1117 Production equivalent: final disabled schema; separate exact-file GO required.
-- Derived from the six immutable Stage sources recorded in manifest.json.
-- No Auth/Storage/ledger mutations, activation, history repair or anti-farming.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $identity$
declare expected text[] := array['20251218213520','20251218230000','20251218234500','20251219000000','20251219000500','20251219001000','20251219002000','20251219003000','20251220000000','20251221000000','20251223000000','20251224000000','20251224213000','20260115000000','20260116000000','20260116120000','20260117090000','20260117100000','20260117110000','20260117111000','20260117120001','20260117130000','20260118000000','20260207000000','20260210000000','20260212000000','20260213000000','20260423160000','20260702000000','20260707090000','20260707113000','20260710130000','20260710133000','20260711103000','20260713090000','20260718090000','20260724212000','20260729100000','20260730160000','20260730160001','20260731000000','20260802130000','20260804160000','20260808130000','20260809224000','20260810100000','20260810120000','20260811150000','20260811170000','20260811173000','20260812100000','20260812103000','20260812110000','20260813090000','20260914090000','20260914091000','20260914092000','20260929201500','20260930211624','20261003183626','20261004114411','20261004222426','20261011200000','20261012095657','20261016120000']; actual text[];
begin
 if current_user<>'postgres' or current_setting('chips.production_project_ref',true) is distinct from 'otbqfijerkieoxwpxjnm'
 or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058'
 or current_setting('chips.production_deletion_compatibility_confirmation',true) is distinct from
 'INSTALL ACCOUNT DELETION COMPATIBILITY otbqfijerkieoxwpxjnm' then raise exception 'Production compatibility identity/confirmation mismatch'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then raise exception 'Production retention coordination busy'; end if;
 select array_agg(version order by version) into actual from supabase_migrations.schema_migrations;
 if actual is distinct from expected then raise exception 'Production compatibility migration history drift'; end if;
 if to_regclass('public.account_deletion_requests') is not null or to_regclass('public.account_deletion_release') is not null
 or to_regclass('private.bonus_campaign_paid_totals') is not null or to_regclass('private.account_avatar_objects') is not null
 or to_regclass('private.avatar_tracking_cutover') is not null or to_regclass('private.account_reward_config') is not null
 or to_regclass('private.account_reward_identities') is not null or to_regclass('private.account_reward_payouts') is not null then raise exception 'Production compatibility target objects already exist'; end if;
 if exists(select 1 from public.poker_seats where is_bot=false and status='ACTIVE')
 or exists(select 1 from public.poker_requests where result_json is null) then raise exception 'Production compatibility requires no unsafe human/pending Poker operation'; end if;
end;
$identity$;
-- Acquire financial/catalog locks before checking source definitions or seeding quotas.
-- Failure rolls back everything; never wait indefinitely on active settlement.
lock table public.chips_accounts, public.chips_entries, public.chips_transactions,
 public.chips_transaction_idempotency, public.bonus_campaigns, public.bonus_claims,
 public.bonus_campaign_eligible_users, public.profile_avatar_uploads, public.user_profiles,
 public.favorites, public.poker_seats, public.poker_requests, public.poker_tables in share row exclusive mode;
do $catalog$
declare signature text; expected text; definition text;
begin
 for signature,expected in select key,value from jsonb_each_text($pins${"chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)":"a5497552e591a85f1ebf52629de47989cbeac2203cf2d21ca4fd3492b6ce1bb0","chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)":"cfb3ffc70146ddd5ad5b8961c173e9ef7c51a59ae2a4d38bffce2d69682ce140","chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)":"a4a7163894489080a5da77339c71a81d650e79fabf82a50b87d0db6903a69079"}$pins$::jsonb) loop
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  if definition is null or encode(extensions.digest(convert_to(replace(definition,'7575202818581710058','<production-system-identifier>'),'UTF8'),'sha256'),'hex')<>expected then raise exception 'Production compatibility routine drift: %',signature; end if;
 end loop;
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.chips_accounts'::regclass and conname='chips_accounts_user_or_system_key') is distinct from $constraint$CHECK ((((account_type = 'USER'::chips_account_type) AND (user_id IS NOT NULL) AND (system_key IS NULL)) OR ((account_type <> 'USER'::chips_account_type) AND (user_id IS NULL) AND (system_key IS NOT NULL))))$constraint$ then raise exception 'Production USER constraint drift'; end if;
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.chips_accounts'::regclass and conname='chips_accounts_user_system_exclusive') is distinct from $constraint$CHECK ((((account_type = 'USER'::chips_account_type) AND (user_id IS NOT NULL) AND (system_key IS NULL)) OR ((account_type <> 'USER'::chips_account_type) AND (user_id IS NULL) AND (system_key IS NOT NULL))))$constraint$ then raise exception 'Production USER constraint drift'; end if;
 for signature,expected in select key,value::text from jsonb_each($acl${"chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)":{"owner":"chips_ledger_archive_pruner","acl":"{chips_ledger_archive_pruner=X/chips_ledger_archive_pruner}"},"chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)":{"owner":"chips_ledger_archive_pruner","acl":"{chips_ledger_archive_pruner=X/chips_ledger_archive_pruner}"},"chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)":{"owner":"chips_ledger_archive_pruner","acl":"{chips_ledger_archive_pruner=X/chips_ledger_archive_pruner,postgres=X/chips_ledger_archive_pruner}"}}$acl$::jsonb) loop
 if (select jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text) from pg_proc where oid=to_regprocedure(signature)) is distinct from expected::jsonb then raise exception 'Production compatibility routine ACL/owner drift'; end if;
 end loop;
 if (select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'type',tgtype,'function',tgfoid::regprocedure::text) order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal and tgrelid in ('public.chips_accounts'::regclass,'public.chips_entries'::regclass,'public.chips_transactions'::regclass,'public.profile_avatar_uploads'::regclass,'auth.users'::regclass)) is distinct from $triggers$[{"table":"auth.users","name":"create_user_profile_after_signup_trg","enabled":"O","type":5,"function":"create_user_profile_after_signup()"},{"table":"chips_accounts","name":"chips_accounts_block_negative_balance_trg","enabled":"O","type":19,"function":"chips_accounts_block_negative_balance()"},{"table":"chips_accounts","name":"chips_accounts_non_negative_user_balance","enabled":"O","type":21,"function":"chips_enforce_user_balance_non_negative()"},{"table":"chips_accounts","name":"chips_accounts_production_escrow_retirement_guard","enabled":"O","type":11,"function":"chips_guard_escrow_account_delete()"},{"table":"chips_entries","name":"chips_entries_assign_sequence_trg","enabled":"O","type":7,"function":"chips_entries_assign_sequence()"},{"table":"chips_entries","name":"chips_entries_balanced_transaction","enabled":"O","type":29,"function":"chips_assert_balanced_transaction()"},{"table":"chips_entries","name":"chips_entries_block_deletes","enabled":"O","type":11,"function":"chips_reject_ledger_mutations()"},{"table":"chips_entries","name":"chips_entries_block_updates","enabled":"O","type":19,"function":"chips_reject_ledger_mutations()"},{"table":"chips_entries","name":"chips_entries_table_binding","enabled":"O","type":29,"function":"chips_validate_table_transaction_binding()"},{"table":"chips_transactions","name":"chips_transactions_block_deletes","enabled":"O","type":11,"function":"chips_reject_ledger_mutations()"},{"table":"chips_transactions","name":"chips_transactions_block_updates","enabled":"O","type":19,"function":"chips_reject_ledger_mutations()"},{"table":"chips_transactions","name":"chips_transactions_capture_idempotency","enabled":"O","type":5,"function":"chips_capture_transaction_idempotency()"},{"table":"chips_transactions","name":"chips_transactions_table_binding","enabled":"O","type":29,"function":"chips_validate_table_transaction_binding()"},{"table":"chips_transactions","name":"chips_transactions_table_fence","enabled":"O","type":7,"function":"chips_table_transaction_before_insert()"}]$triggers$::jsonb then raise exception 'Production financial/Auth/upload trigger drift'; end if;
 if exists(select 1 from public.poker_seats where is_bot=false and status='ACTIVE') or exists(select 1 from public.poker_requests where result_json is null) then raise exception 'Production Poker operation appeared during locking'; end if;
 if (select jsonb_agg(jsonb_build_object('schemaname',schemaname,'tablename',tablename,'policyname',policyname,'roles',roles::text,'cmd',cmd,'qual',qual,'with_check',with_check) order by tablename,policyname) from pg_policies where schemaname='public' and (coalesce(qual,'') like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%')) is distinct from $policies$[{"schemaname":"public","tablename":"chips_accounts","policyname":"chips_accounts_select_own_user","roles":"{public}","cmd":"SELECT","qual":"((account_type = 'USER'::chips_account_type) AND (user_id = auth.uid()))","with_check":null},{"schemaname":"public","tablename":"chips_entries","policyname":"chips_entries_select_own_user","roles":"{public}","cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM chips_accounts a\n  WHERE ((a.id = chips_entries.account_id) AND (a.account_type = 'USER'::chips_account_type) AND (a.user_id = auth.uid()))))","with_check":null},{"schemaname":"public","tablename":"favorites","policyname":"favorites_delete_own","roles":"{public}","cmd":"DELETE","qual":"(auth.uid() = user_id)","with_check":null},{"schemaname":"public","tablename":"favorites","policyname":"favorites_insert_own","roles":"{public}","cmd":"INSERT","qual":null,"with_check":"(auth.uid() = user_id)"},{"schemaname":"public","tablename":"favorites","policyname":"favorites_select_own","roles":"{public}","cmd":"SELECT","qual":"(auth.uid() = user_id)","with_check":null},{"schemaname":"public","tablename":"poker_actions","policyname":"poker_actions_read_if_seated","roles":"{public}","cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM poker_seats s\n  WHERE ((s.table_id = poker_actions.table_id) AND (s.user_id = auth.uid()))))","with_check":null},{"schemaname":"public","tablename":"poker_requests","policyname":"poker_requests_read_if_seated","roles":"{public}","cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM poker_seats s\n  WHERE ((s.table_id = poker_requests.table_id) AND (s.user_id = auth.uid()))))","with_check":null},{"schemaname":"public","tablename":"poker_seats","policyname":"poker_seats_read_own","roles":"{public}","cmd":"SELECT","qual":"(auth.uid() = user_id)","with_check":null},{"schemaname":"public","tablename":"poker_tables","policyname":"poker_tables_read_if_seated","roles":"{public}","cmd":"SELECT","qual":"(EXISTS ( SELECT 1\n   FROM poker_seats s\n  WHERE ((s.table_id = poker_tables.id) AND (s.user_id = auth.uid()))))","with_check":null}]$policies$::jsonb then raise exception 'Production lifecycle policy definition drift'; end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='profile_avatar_uploads')<>8
 or exists(select 1 from information_schema.columns where table_schema='public' and table_name='chips_accounts' and column_name in ('retired_user_id','retired_at')) then raise exception 'Production avatar/wallet column drift'; end if;
 if exists(select 1 from public.chips_accounts where account_type='USER' and (user_id is null or system_key is not null))
 or coalesce((select sum(balance) from public.chips_accounts),0)<>0
 or exists(select 1 from public.chips_entries group by transaction_id having sum(amount)<>0) then raise exception 'Production financial invariant mismatch'; end if;
end;
$catalog$;
-- requests
create table public.account_deletion_requests (
  request_id uuid primary key,
  old_user_id uuid not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','RETRY','ERROR','COMPLETED')),
  phase text not null default 'preparing' check (phase in ('preparing','poker','burn','cleanup','auth','completed')),
  accepted_at timestamptz,
  progress jsonb not null default '{}'::jsonb,
  status_token_hash text,
  status_token_expires_at timestamptz,
  actionable_since timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  progress_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_until timestamptz,
  error_code text check (error_code is null or error_code in ('dependency_unavailable','financial_mismatch','progress_overdue')),
  incident boolean not null default false,
  check ((status = 'COMPLETED') = (phase = 'completed')),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check (accepted_at is null or phase <> 'preparing'),
  check (status <> 'COMPLETED' or accepted_at is not null)
);
create index account_deletion_requests_due_idx on public.account_deletion_requests(next_attempt_at)
  where status in ('PENDING','PROCESSING','RETRY');
alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant select, insert, update on public.account_deletion_requests to service_role;

create table public.account_deletion_release (id boolean primary key default true check(id), enabled boolean not null default false, redis_cutover jsonb not null default '{}'::jsonb);
insert into public.account_deletion_release(id,enabled) values(true,false);
alter table public.account_deletion_release enable row level security;
revoke all on table public.account_deletion_release from public,anon,authenticated;
grant select on table public.account_deletion_release to service_role;

create function public.account_is_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid())
 and not exists(select 1 from public.account_deletion_requests where old_user_id=auth.uid());
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated;
alter table public.bonus_campaigns alter column created_by drop not null;
alter table public.bonus_campaign_eligible_users alter column created_by drop not null;
do $$
declare p record; statement text; expected text[]:=array['chips_accounts.chips_accounts_select_own_user','chips_entries.chips_entries_select_own_user','favorites.favorites_delete_own','favorites.favorites_insert_own','favorites.favorites_select_own','poker_actions.poker_actions_read_if_seated','poker_requests.poker_requests_read_if_seated','poker_seats.poker_seats_read_own','poker_tables.poker_tables_read_if_seated']; actual text[];
begin
 select array_agg(tablename||'.'||policyname order by tablename,policyname) into actual from pg_policies where schemaname='public' and (coalesce(qual,'') like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%');
 if actual is distinct from expected then raise exception 'Production lifecycle policy inventory drift'; end if;
 for p in select * from pg_policies where schemaname='public'
   and (coalesce(qual,'') like '%auth.uid()%' or coalesce(with_check,'') like '%auth.uid()%')
 loop
  statement := format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  if p.qual is not null then statement := statement || format(' using ((%s) and public.account_is_active())',p.qual); end if;
  if p.with_check is not null then statement := statement || format(' with check ((%s) and public.account_is_active())',p.with_check); end if;
  execute statement;
 end loop;
end $$;

create function public.account_guard_owned_write_v2() returns trigger
language plpgsql security definer set search_path='' as $$
declare column_name text; owner_id uuid; owners uuid[] := '{}'::uuid[];
begin
  foreach column_name in array tg_argv loop
    if column_name='created_by' and tg_op='UPDATE'
      and (to_jsonb(new)->>column_name) is not distinct from (to_jsonb(old)->>column_name) then continue; end if;
    owner_id := (to_jsonb(new)->>column_name)::uuid;
    if owner_id is not null then owners := array_append(owners,owner_id); end if;
  end loop;
  for owner_id in select distinct x from unnest(owners) x order by x loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||owner_id::text,0)) then
      raise exception using errcode='40001', message='Account lifecycle busy';
    end if;
    if not exists(select 1 from auth.users where id=owner_id)
      or exists(select 1 from public.account_deletion_requests where old_user_id=owner_id) then
      raise exception using errcode='42501', message='Account is not active';
    end if;
  end loop;
  return new;
end$$;
revoke all on function public.account_guard_owned_write_v2() from public,anon,authenticated;
do $$
declare t text;
begin
  foreach t in array array['favorites','user_profiles','bonus_claims','bonus_campaign_eligible_users'] loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='user_id') then
      execute format('create trigger account_owned_write_v2 before insert or update on public.%I for each row execute function public.account_guard_owned_write_v2(''user_id'')',t);
    end if;
  end loop;
  if to_regclass('public.profile_avatar_uploads') is not null then
    -- Existing in-flight signing/output receipts MUST still finish after deletion
    -- starts, so cleanup can prove the real external capability horizon.
    execute 'create trigger account_upload_intent_v2 before insert on public.profile_avatar_uploads for each row execute function public.account_guard_owned_write_v2(''user_id'')';
  end if;
  if to_regclass('public.bonus_campaigns') is not null then
    execute 'create trigger account_creator_write_v2 before insert or update on public.bonus_campaigns for each row execute function public.account_guard_owned_write_v2(''created_by'')';
  end if;
end$$;

-- wallet-retirement
alter table public.chips_accounts add column retired_user_id uuid, add column retired_at timestamptz;
alter table public.chips_accounts drop constraint chips_accounts_user_or_system_key,
  drop constraint chips_accounts_user_system_exclusive;
alter table public.chips_accounts add constraint chips_accounts_user_or_system_key check (
  (account_type='USER' and system_key is null and (
    (user_id is not null and retired_user_id is null and retired_at is null) or
    (user_id is null and retired_user_id is not null and retired_at is not null and status='closed' and balance=0))) or
  (account_type<>'USER' and user_id is null and system_key is not null and retired_user_id is null and retired_at is null));
alter table public.chips_accounts add constraint chips_accounts_user_system_exclusive check (
  (account_type='USER' and system_key is null and (
    (user_id is not null and retired_user_id is null and retired_at is null) or
    (user_id is null and retired_user_id is not null and retired_at is not null and status='closed' and balance=0))) or
  (account_type<>'USER' and user_id is null and system_key is not null and retired_user_id is null and retired_at is null));
create unique index chips_accounts_historical_user_unique on public.chips_accounts((coalesce(user_id,retired_user_id))) where account_type='USER';
create function public.chips_guard_user_retirement_v2() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' and old.retired_user_id is not null then
    raise exception using errcode='23514', message='Retired financial account is immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='INSERT' and new.retired_user_id is not null then
    raise exception using errcode='23514', message='Retirement must preserve an existing USER account';
  end if;
  if tg_op='UPDATE' and old.account_type='USER' then
    if new.account_type<>'USER' or new.id<>old.id then
      raise exception using errcode='23514', message='USER financial identity is immutable';
    end if;
    if new.retired_user_id is not null then
      if old.user_id is distinct from new.retired_user_id or new.user_id is not null or old.balance<>0
        or new.balance<>0 or new.status<>'closed' or new.retired_at is null
        or not exists(select 1 from public.account_deletion_requests r where r.old_user_id=old.user_id
          and r.phase='burn' and r.status='PROCESSING' and r.lease_until>clock_timestamp()
          and r.progress->'poker'->>'done'='true'
          and r.progress->'walletRetirement'->>'accountId'=old.id::text
          and ((r.progress->'walletRetirement'->>'noBurn'='true'
            and r.progress->'walletRetirement'->>'amount'='0') or
            exists(select 1 from public.chips_transactions t
              where t.id::text=r.progress->'walletRetirement'->>'burnTransactionId'
                and t.user_id=old.user_id and t.tx_type::text='BURN'
                and t.idempotency_key='account-delete:'||r.request_id::text||':burn:v1'
                and (select count(*) from public.chips_entries e where e.transaction_id=t.id)=2
                and exists(select 1 from public.chips_entries e where e.transaction_id=t.id
                  and e.account_id=old.id and e.amount<0
                  and -e.amount=(r.progress->'walletRetirement'->>'amount')::bigint)
                and exists(select 1 from public.chips_entries e join public.chips_accounts a on a.id=e.account_id
                  where e.transaction_id=t.id and a.account_type='SYSTEM' and a.system_key='GENESIS'
                    and e.amount=(r.progress->'walletRetirement'->>'amount')::bigint)))) then
        raise exception using errcode='23514', message='Authorized closed-zero retirement is required';
      end if;
    elsif new.user_id is distinct from old.user_id then
      raise exception using errcode='23514', message='Live financial ownership is immutable';
    end if;
  end if;
  return new;
end$$;
create trigger chips_accounts_user_retirement_v2 before insert or update or delete on public.chips_accounts
  for each row execute function public.chips_guard_user_retirement_v2();
create function public.chips_guard_retired_entry_v2() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.chips_accounts where id=new.account_id and retired_user_id is not null) then
    raise exception using errcode='23514', message='Retired financial account cannot receive entries';
  end if;
  return new;
end$$;
create trigger chips_entries_retired_user_v2 before insert on public.chips_entries
  for each row execute function public.chips_guard_retired_entry_v2();
revoke all on function public.chips_guard_user_retirement_v2(),public.chips_guard_retired_entry_v2() from public,anon,authenticated;

create function public.chips_retention_user_matches_v2(account public.chips_accounts, owner_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select account.account_type::text = 'USER' and owner_id is not null
    and account.system_key is null and (
      (account.status::text = 'active' and account.user_id = owner_id
        and account.retired_user_id is null and account.retired_at is null)
      or (account.status::text = 'closed' and account.user_id is null
        and account.retired_user_id = owner_id and account.retired_at is not null
        and account.balance = 0)
    ) is true
$$;
revoke all on function public.chips_retention_user_matches_v2(public.chips_accounts,uuid) from public,anon,authenticated;
grant execute on function public.chips_retention_user_matches_v2(public.chips_accounts,uuid) to service_role, chips_ledger_archive_pruner;

do $ddl_delegation$
begin
 if not pg_catalog.has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION')
 or not pg_catalog.has_schema_privilege('chips_ledger_archive_pruner','public','USAGE')
 or pg_catalog.has_schema_privilege('chips_ledger_archive_pruner','public','CREATE')
 or exists(select 1 from pg_catalog.pg_auth_members where roleid='chips_ledger_archive_pruner'::regrole and member='postgres'::regrole and grantor='postgres'::regrole) then
  raise exception 'E3 unexpected DDL delegation baseline';
 end if;
end;
$ddl_delegation$;
grant chips_ledger_archive_pruner to postgres with admin false, inherit true, set true granted by postgres;
grant create on schema public to chips_ledger_archive_pruner;

set local role chips_ledger_archive_pruner;
do $retention_compatibility$
declare definition text;
 needle text := $needle$                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')$needle$;
 replacement text := $replacement$                    and public.chips_retention_user_matches_v2(accounts, selected.user_id)
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active'
               or public.chips_retention_user_matches_v2(accounts, selected.user_id))$replacement$;
begin
 select pg_get_functiondef('public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean,boolean)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Production closed-human pruner contract drift'; end if;
 execute replace(definition,needle,replacement);
end;
$retention_compatibility$;
do $escrow_compatibility$
declare definition text;
 needle text := $needle$and triggers.tgname not in ('chips_accounts_escrow_retirement_guard','chips_accounts_production_escrow_retirement_guard')$needle$;
 replacement text := $replacement$and triggers.tgname not in ('chips_accounts_escrow_retirement_guard','chips_accounts_production_escrow_retirement_guard')
 and not (triggers.tgname='chips_accounts_user_retirement_v2'
 and triggers.tgfoid='public.chips_guard_user_retirement_v2()'::regprocedure
 and triggers.tgtype=31 and triggers.tgenabled='O' and triggers.tgnargs=0
 and pg_catalog.md5(pg_catalog.pg_get_functiondef(triggers.tgfoid))='e81dd98b27bcd958bcef70db54767d4e')$replacement$;
begin
 select pg_get_functiondef('public.chips_retire_production_escrow_accounts(bigint,uuid[],text,text,text,boolean,text)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then raise exception 'Production ESCROW dependency contract drift'; end if;
 execute replace(definition,needle,replacement);
end;
$escrow_compatibility$;
reset role;
-- Revoke ONLY this transaction's edge, preserving managed grantor/options.
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres granted by postgres;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to service_role;
create table private.bonus_campaign_paid_totals(campaign_id uuid primary key,paid_count bigint not null check(paid_count>=0));
alter table private.bonus_campaign_paid_totals enable row level security;
revoke all on private.bonus_campaign_paid_totals from public,anon,authenticated;
grant select,insert,update on private.bonus_campaign_paid_totals to service_role;
-- avatar-tracking
alter table public.profile_avatar_uploads
  add column tracking_version integer,
  add column signing_finished_at timestamptz,
  add column capability_until timestamptz,
  add column output_path text,
  add column output_write_started_at timestamptz,
  add column output_write_finished_at timestamptz,
  add column source_deleted_at timestamptz,
  add column output_deleted_at timestamptz;
create schema if not exists private;
create table private.account_avatar_objects (
  user_id uuid not null,
  output_path text not null check (output_path ~ '^[0-9a-f-]{36}\.webp$'),
  deleted_at timestamptz,
  primary key (user_id, output_path)
);
alter table private.account_avatar_objects enable row level security;
revoke all on private.account_avatar_objects from public, anon, authenticated;
grant select, insert, update on private.account_avatar_objects to service_role;
create table private.avatar_tracking_cutover (
  marker text primary key,
  cutover_at timestamptz not null,
  legacy_inventory_verified boolean not null default false,
  upload_bucket text not null check (upload_bucket = 'profile-avatar-uploads'),
  public_bucket text not null check (public_bucket = 'profile-avatars')
);
alter table private.avatar_tracking_cutover enable row level security;
revoke all on private.avatar_tracking_cutover from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on private.avatar_tracking_cutover to service_role;
alter table private.avatar_tracking_cutover
  add column provider_max_token_seconds integer check(provider_max_token_seconds between 1 and 7200),
  add column provider_max_completion_seconds integer check(provider_max_completion_seconds >= 0),
  add column provider_evidence text check(length(provider_evidence) between 1 and 2000);
alter table private.avatar_tracking_cutover add column reconciliation_inventory jsonb not null default '{}'::jsonb check(jsonb_typeof(reconciliation_inventory)='object');

-- Original rows/acknowledgements are never rewritten. Only a canonical worker
-- may record a NEW deletion observation under a real owner/request/lease.
create function private.account_avatar_manifest_reconciled(uid uuid,rid uuid,mid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(exists(select 1 from public.profile_avatar_uploads u
 join public.account_deletion_requests r on r.request_id=rid and r.old_user_id=uid
 join private.avatar_tracking_cutover c on c.marker=r.progress->'avatarReconciliations'->mid::text->>'marker'
 where u.id=mid and u.user_id=uid and c.legacy_inventory_verified
 and c.upload_bucket='profile-avatar-uploads' and c.public_bucket='profile-avatars'
 and c.cutover_at+interval '7200 seconds'<=clock_timestamp()
 and r.progress->'avatarReconciliations'->mid::text->>'owner'=uid::text
 and r.progress->'avatarReconciliations'->mid::text->>'requestId'=rid::text
 and r.progress->'avatarReconciliations'->mid::text->>'snapshotDigest'=md5(to_jsonb(u)::text)
 and r.progress->'avatarReconciliations'->mid::text->>'deletedAt' is not null
 and r.progress->'avatarReconciliations'->mid::text->'inventory'=c.reconciliation_inventory->mid::text),false);
$$;

create function private.account_avatar_reconciliation_plan(uid uuid,rid uuid,generation bigint,marker_key text)
returns table(id uuid,source_path text,output_path text,snapshot_digest text,inventory_digest text)
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover; u public.profile_avatar_uploads; e jsonb;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0)) then
 raise exception using errcode='40001',message='Account lifecycle busy'; end if;
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
 or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
 or not private.account_avatar_guards_ready() then raise exception using errcode='42501',message='Avatar reconciliation lease invalid'; end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
 or cut.cutover_at+interval '7200 seconds'>clock_timestamp() then raise exception using errcode='42501',message='Avatar inventory not ready'; end if;
 -- Validate ALL uncertain rows before any external removal, not only first batch.
 for u in select * from public.profile_avatar_uploads p where p.user_id=uid
 and (p.tracking_version is distinct from 3 or p.signing_finished_at is null or p.capability_until is null
 or (p.output_write_started_at is not null and p.output_write_finished_at is null))
 and not private.account_avatar_manifest_reconciled(uid,rid,p.id) order by p.id loop
  e:=cut.reconciliation_inventory->u.id::text;
  if (u.tracking_version is not null and u.tracking_version<>3)
  or (u.tracking_version is null and (u.consumed_at is not null or u.output_path is not null))
  or e is null or e->>'owner' is distinct from uid::text or e->>'sourcePath' is distinct from u.source_path
  or e->>'outputPath' is distinct from u.output_path or e->>'snapshotDigest' is distinct from md5(to_jsonb(u)::text)
  or coalesce(length(e->>'ownershipEvidence'),0) not between 1 and 1000
  or coalesce(length(e->>'terminalEvidence'),0) not between 1 and 1000
  or u.source_path is distinct from 'pending/'||u.id::text
  or (u.output_path is not null and u.output_path !~ '^[0-9a-f-]{36}\.webp$')
  or u.capability_until>clock_timestamp() then raise exception using errcode='42501',message='Avatar reconciliation evidence missing'; end if;
 end loop;
 return query select p.id,p.source_path,p.output_path,md5(to_jsonb(p)::text),md5((cut.reconciliation_inventory->p.id::text)::text)
 from public.profile_avatar_uploads p where p.user_id=uid
 and (p.tracking_version is distinct from 3 or p.signing_finished_at is null or p.capability_until is null
 or (p.output_write_started_at is not null and p.output_write_finished_at is null))
 and not private.account_avatar_manifest_reconciled(uid,rid,p.id) order by p.id limit 1;
end $$;

create function private.account_avatar_record_reconciliation(uid uuid,rid uuid,generation bigint,marker_key text,mid uuid,snapshot_hash text,inventory_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare candidate record; entry jsonb;
begin
 select * into candidate from private.account_avatar_reconciliation_plan(uid,rid,generation,marker_key) p where p.id=mid;
 if candidate.id is null or candidate.snapshot_digest is distinct from snapshot_hash or candidate.inventory_digest is distinct from inventory_hash then
 raise exception using errcode='42501',message='Avatar reconciliation changed'; end if;
 select reconciliation_inventory->mid::text into entry from private.avatar_tracking_cutover where marker=marker_key;
 update public.account_deletion_requests set progress_at=clock_timestamp(),actionable_since=clock_timestamp(),progress=progress||jsonb_build_object('avatarReconciliations',
 coalesce(progress->'avatarReconciliations','{}'::jsonb)||jsonb_build_object(mid::text,jsonb_build_object(
 'owner',uid,'requestId',rid,'generation',generation,'marker',marker_key,'snapshotDigest',snapshot_hash,'inventory',entry,'deletedAt',clock_timestamp())))
 where request_id=rid and status='PROCESSING' and phase='cleanup' and lease_generation=generation and lease_until>clock_timestamp();
 if not found then raise exception using errcode='42501',message='Avatar reconciliation lease invalid'; end if;
end $$;
create or replace function public.account_avatar_manifest_guard_v3() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; req public.account_deletion_requests;
begin
 owner := case when tg_op='DELETE' then old.user_id else new.user_id end;
 if owner is null then raise exception using errcode='42501',message='Avatar owner required'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||owner::text,0)) then
   raise exception using errcode='40001',message='Account lifecycle busy';
 end if;
 if tg_op='DELETE' then
   -- Only the authorized Auth FK cascade may purge manifests. A plain legacy
   -- DELETE cannot satisfy parent absence + nested trigger + durable lease proof.
   select * into req from public.account_deletion_requests where old_user_id=owner;
   if pg_trigger_depth()<2 or exists(select 1 from auth.users where id=owner)
      or req.request_id is null or req.status<>'PROCESSING' or req.phase<>'auth'
      or req.lease_until is null or req.lease_until<=clock_timestamp()
      or req.progress->'cleanup'->>'done' is distinct from 'true'
      or req.progress->>'authIntent' is distinct from 'true'
      or req.progress->'avatarPurge'->>'requestId' is distinct from req.request_id::text
      or req.progress->'avatarPurge'->>'owner' is distinct from owner::text
      or ((old.tracking_version is distinct from 3 or old.signing_finished_at is null
      or old.capability_until is null or old.source_deleted_at is null
      or (old.output_path is not null and (old.output_write_finished_at is null or old.output_deleted_at is null)))
         and not private.account_avatar_manifest_reconciled(owner,req.request_id,old.id)) then
     raise exception using errcode='42501',message='Avatar manifest purge not authorized';
   end if;
   return old;
 end if;
 if tg_op='INSERT' then
   if new.tracking_version is distinct from 3 or new.source_path is distinct from 'pending/'||new.id::text
      or new.consumed_at is not null or new.signing_finished_at is not null or new.capability_until is not null
      or new.output_path is not null or new.output_write_started_at is not null or new.output_write_finished_at is not null
      or new.source_deleted_at is not null or new.output_deleted_at is not null then
     raise exception using errcode='42501',message='Avatar tracking protocol required';
   end if;
 else
   if new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.source_path is distinct from old.source_path or new.tracking_version is distinct from old.tracking_version
      or new.declared_mime_type is distinct from old.declared_mime_type or new.declared_size is distinct from old.declared_size
      or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
      or old.tracking_version is distinct from 3
      or (old.signing_finished_at is not null and new.signing_finished_at is distinct from old.signing_finished_at)
      or (old.capability_until is not null and new.capability_until is distinct from old.capability_until)
      or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
      or (old.output_path is not null and new.output_path is distinct from old.output_path)
      or (old.output_write_started_at is not null and new.output_write_started_at is distinct from old.output_write_started_at)
      or (old.output_write_finished_at is not null and new.output_write_finished_at is distinct from old.output_write_finished_at)
      or (old.source_deleted_at is not null and new.source_deleted_at is distinct from old.source_deleted_at)
      or (old.output_deleted_at is not null and new.output_deleted_at is distinct from old.output_deleted_at) then
     raise exception using errcode='42501',message='Avatar manifest evidence is immutable';
   end if;
   if new.consumed_at is distinct from old.consumed_at then
     if new.consumed_at is null or new.output_path is null or new.output_path !~ '^[0-9a-f-]{36}\.webp$'
        or new.output_write_started_at is null or new.signing_finished_at is null then
       raise exception using errcode='42501',message='Avatar finalize intent required';
     end if;
     if not exists(select 1 from auth.users where id=owner)
        or exists(select 1 from public.account_deletion_requests where old_user_id=owner) then
       raise exception using errcode='42501',message='Account is not active';
     end if;
   elsif new.output_path is distinct from old.output_path or new.output_write_started_at is distinct from old.output_write_started_at then
     raise exception using errcode='42501',message='Avatar finalize intent must be atomic';
   end if;
 end if;
 if (new.signing_finished_at is null) <> (new.capability_until is null)
    or new.capability_until < new.signing_finished_at+interval '7200 seconds'
    or (new.output_write_finished_at is not null and new.output_write_started_at is null) then
   raise exception using errcode='42501',message='Avatar receipt invalid';
 end if;
 return new;
end $$;
create or replace function private.account_avatar_prepare_purge(uid uuid,rid uuid,generation bigint,marker_key text) returns void
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover;
begin
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0)) then
 raise exception using errcode='40001',message='Account lifecycle busy'; end if;
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
    or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
    or not private.account_avatar_guards_ready() then
   raise exception using errcode='42501',message='Avatar purge lease invalid';
 end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
    or cut.cutover_at+interval '7200 seconds'>clock_timestamp()
    or exists(select 1 from public.profile_avatar_uploads where user_id=uid and not private.account_avatar_manifest_reconciled(uid,rid,id) and
      (tracking_version is distinct from 3 or signing_finished_at is null or capability_until is null
       or capability_until>clock_timestamp()
       or source_deleted_at is null or (output_path is not null and
         (output_write_finished_at is null or output_deleted_at is null))))
    or exists(select 1 from private.account_avatar_objects where user_id=uid and deleted_at is null) then
   raise exception using errcode='42501',message='Avatar closure unconfirmed';
 end if;
 update public.account_deletion_requests set progress=jsonb_set(progress,'{avatarPurge}',
   jsonb_build_object('requestId',rid,'owner',uid,'generation',generation,'marker',marker_key)) where request_id=rid and status='PROCESSING' and phase='cleanup' and lease_generation=generation and lease_until>clock_timestamp();
 if not found then raise exception using errcode='42501',message='Avatar purge lease invalid'; end if;
 -- Keep public manifests until the authorized Auth cascade. This avoids any
 -- session boolean/GUC or role-name bypass for legacy DELETE statements.
end $$;
revoke all on function private.account_avatar_manifest_reconciled(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.account_avatar_manifest_reconciled(uuid,uuid,uuid) to service_role;
revoke all on function private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text) to service_role;
revoke all on function private.account_avatar_record_reconciliation(uuid,uuid,bigint,text,uuid,text,text) from public,anon,authenticated;
grant execute on function private.account_avatar_record_reconciliation(uuid,uuid,bigint,text,uuid,text,text) to service_role;
create function private.account_avatar_guards_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from pg_catalog.pg_trigger t
 where t.tgrelid='public.profile_avatar_uploads'::regclass
 and t.tgname='account_avatar_manifest_guard_v3' and t.tgenabled='O' and t.tgtype=31
 and t.tgfoid='public.account_avatar_manifest_guard_v3()'::regprocedure)
 and exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.profile_avatar_uploads'::regclass
 and t.tgname='account_upload_intent_v2' and t.tgenabled='O' and t.tgtype=7
 and t.tgfoid='public.account_guard_owned_write_v2()'::regprocedure);
$$;
create trigger account_avatar_manifest_guard_v3 before insert or update or delete
 on public.profile_avatar_uploads for each row execute function public.account_avatar_manifest_guard_v3();
alter table public.profile_avatar_uploads disable trigger account_avatar_manifest_guard_v3;
revoke all on function public.account_avatar_manifest_guard_v3(),private.account_avatar_guards_ready(),private.account_avatar_prepare_purge(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.account_avatar_guards_ready(),private.account_avatar_prepare_purge(uuid,uuid,bigint,text) to service_role;
-- Bind each paid transaction to one real campaign; no invented historical proof.
do $promo_history$
begin
 if exists(with bindings as (select campaign_id::text campaign,transaction_id from public.bonus_claims union select metadata->>'campaign_id',id from public.chips_transactions where tx_type::text='PROMO_BONUS' union select replay_transaction->'metadata'->>'campaign_id',transaction_id from public.chips_transaction_idempotency where tx_type::text='PROMO_BONUS') select 1 from bindings where campaign is not null group by transaction_id having count(distinct campaign)<>1 or not bool_and(exists(select 1 from public.bonus_campaigns c where c.id::text=campaign))) then raise exception 'Historical PROMO campaign binding mismatch'; end if;
 if exists(select 1 from public.chips_transaction_idempotency r where r.tx_type::text='PROMO_BONUS'
 and not exists(select 1 from public.bonus_claims c where c.transaction_id=r.transaction_id)
 and not exists(select 1 from public.chips_transactions t where t.id=r.transaction_id and t.metadata->>'campaign_id' is not null)
 and r.replay_transaction->'metadata'->>'campaign_id' is null) then raise exception 'Unassignable historical PROMO receipt'; end if;
end;
$promo_history$;
-- Union real transaction IDs, not email guesses or surviving claims alone.
-- Never decrease an existing retained total. No balance/ledger/history mutation.
insert into private.bonus_campaign_paid_totals(campaign_id,paid_count)
select c.id,count(distinct p.transaction_id)
from public.bonus_campaigns c left join (
 select campaign_id::text as campaign_id,transaction_id from public.bonus_claims
 union
 select metadata->>'campaign_id',id from public.chips_transactions where tx_type::text='PROMO_BONUS'
 union
 select replay_transaction->'metadata'->>'campaign_id',transaction_id
 from public.chips_transaction_idempotency where tx_type::text='PROMO_BONUS'
) p on p.campaign_id=c.id::text group by c.id
on conflict(campaign_id) do update set paid_count=greatest(private.bonus_campaign_paid_totals.paid_count,excluded.paid_count);

create function private.account_campaign_quota_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare campaign uuid; maximum bigint; paid bigint;
begin
 -- Restoring an already paid, immutable registry receipt is not a new reward.
 -- The registry identity predates this transaction and must match the exact
 -- ledger identity/payload; a freshly created registry row cannot take this path.
 if exists(select 1 from public.chips_transaction_idempotency r
 where r.idempotency_key=new.idempotency_key and r.transaction_id=new.id
 and r.payload_hash=new.payload_hash and r.tx_type=new.tx_type
 and r.user_id is not distinct from new.user_id and r.transaction_created_at=new.created_at
 and r.created_at<transaction_timestamp() and r.replay_completed_at is not null
 and r.replay_transaction->>'id'=new.id::text
 and r.replay_transaction->'metadata'=new.metadata) then return new; end if;


 select c.campaign_id into campaign from public.bonus_claims c where c.transaction_id=new.id and c.user_id=new.user_id;
 if campaign is null then raise exception using errcode='42501',message='Atomic bonus claim required'; end if;
 select max_total_claims into maximum from public.bonus_campaigns where id=campaign;
 update private.bonus_campaign_paid_totals set paid_count=paid_count+1
 where campaign_id=campaign and (maximum is null or paid_count<maximum) returning paid_count into paid;
 if paid is null then raise exception using errcode='42501',message='Campaign quota unavailable or exhausted'; end if;
 return new;
end $$;
revoke all on function private.account_campaign_quota_guard() from public,anon,authenticated;
create constraint trigger account_campaign_quota_guard after insert on public.chips_transactions
 deferrable initially deferred for each row when (new.tx_type::text='PROMO_BONUS') execute function private.account_campaign_quota_guard();

create function private.account_campaign_initial_total() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.bonus_campaign_paid_totals(campaign_id,paid_count) values(new.id,0) on conflict do nothing;
 return new;
end $$;
revoke all on function private.account_campaign_initial_total() from public,anon,authenticated;
create trigger account_campaign_initial_total after insert on public.bonus_campaigns
for each row execute function private.account_campaign_initial_total();
-- Exactly one Production history version, never six source versions or readiness markers.
insert into supabase_migrations.schema_migrations(version) values('20261021191104');
commit;
