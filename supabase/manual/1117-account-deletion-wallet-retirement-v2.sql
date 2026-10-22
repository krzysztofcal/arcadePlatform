-- Local proposal only; not a canonical migration and not applied to any shared environment.
-- Apply only after the request/progress proposal. Preserve the existing live Auth FK.
begin;
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
-- Historical USER remains USER: existing escrow/bot-only retirement classifiers
-- must continue rejecting it. The separate forward retention proposal permits
-- only verified closed-zero retired USER in the existing closed-human branch,
-- preserving all policy/receipt guards. No entry/hash rewriting.
commit;
