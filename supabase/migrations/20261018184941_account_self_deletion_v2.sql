-- #1117 forward-only Stage schema. Production requires separate reviewed GO.
-- Acceptance remains OFF; no cutover/history/Storage approval is seeded.
begin;

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
declare p record; statement text;
begin
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

-- retention
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

do $pruner_access$
declare membership jsonb;
begin
 select to_jsonb(m) into membership from pg_auth_members m
 where m.roleid='chips_ledger_archive_pruner'::regrole and m.member=current_user::regrole
   and m.grantor=current_user::regrole;
 perform set_config('arcade1117.pruner_membership',coalesce(membership::text,'null'),true);
 perform set_config('arcade1117.pruner_create',has_schema_privilege('chips_ledger_archive_pruner','public','CREATE')::text,true);
 execute format('grant chips_ledger_archive_pruner to %I with set true',current_user);
end $pruner_access$;
grant create on schema public to chips_ledger_archive_pruner;
set local role chips_ledger_archive_pruner;
do $retention_patch$
declare
  definition text;
  needle text := $needle$                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')$needle$;
  replacement text := $replacement$                    and public.chips_retention_user_matches_v2(accounts, selected.user_id)
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active'
               or public.chips_retention_user_matches_v2(accounts, selected.user_id))$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
    or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,needle,''))) / pg_catalog.length(needle) <> 1
    or pg_catalog.strpos(definition,'is_closed_human') = 0
    or pg_catalog.strpos(definition,'Archive batch registry identity is incomplete or inconsistent') = 0 then
    raise exception 'Issue #1117 requires the current closed-human-aware archive pruner';
  end if;
  execute pg_catalog.replace(definition,needle,replacement);
end;
$retention_patch$;
reset role;
do $restore_pruner_access$
declare membership jsonb := current_setting('arcade1117.pruner_membership')::jsonb;
begin
 if not current_setting('arcade1117.pruner_create')::boolean then
   revoke create on schema public from chips_ledger_archive_pruner;
 end if;
 if membership='null'::jsonb then
   execute format('revoke chips_ledger_archive_pruner from %I',current_user);
 else
   execute format('grant chips_ledger_archive_pruner to %I with set %s',current_user,membership->>'set_option');
 end if;
end $restore_pruner_access$;

-- reward-identities
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.account_reward_config (
  id boolean primary key default true check (id),
  active_version text not null check (active_version ~ '^[a-zA-Z0-9_-]{1,32}$'),
  key_check text not null check (key_check ~ '^[0-9a-f]{64}$'),
  history_ready boolean not null default false
);
alter table private.account_reward_config enable row level security;
revoke all on private.account_reward_config from public, anon, authenticated;
grant select on private.account_reward_config to service_role;
create table private.account_reward_identities (
  identity_key text primary key
);
create table private.account_reward_payouts (
  identity_key text not null references private.account_reward_identities(identity_key),
  reward_scope text not null,
  period_key text not null,
  transaction_id uuid not null unique,
  paid_at timestamptz not null default clock_timestamp(),
  primary key (identity_key, reward_scope, period_key)
);
create table private.bonus_campaign_paid_totals (
  campaign_id uuid primary key,
  paid_count bigint not null check (paid_count >= 0)
);
insert into private.bonus_campaign_paid_totals (campaign_id, paid_count)
select campaign_id, count(*) from public.bonus_claims group by campaign_id;
alter table private.account_reward_identities enable row level security;
alter table private.account_reward_payouts enable row level security;
alter table private.bonus_campaign_paid_totals enable row level security;
revoke all on private.account_reward_identities, private.account_reward_payouts, private.bonus_campaign_paid_totals from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.account_reward_identities, private.account_reward_payouts, private.bonus_campaign_paid_totals to service_role;

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
commit;
