-- Preparation only: this migration has not been applied to Stage/Production.
-- No Auth FK: the durable request must outlive hard deletion of its owner.
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
-- Trusted backend SQL only. No client RLS policy or public SECURITY DEFINER API.
grant select, insert, update on public.account_deletion_requests to service_role;

-- Operator enables only after all implementation/privacy/Storage/recovery gates pass.
create table public.account_deletion_release (id boolean primary key default true check(id), enabled boolean not null default false, redis_cutover jsonb not null default '{}'::jsonb);
insert into public.account_deletion_release(id,enabled) values(true,false);
alter table public.account_deletion_release enable row level security;
revoke all on table public.account_deletion_release from public,anon,authenticated;
grant select on table public.account_deletion_release to service_role;

-- Narrow self-only status used by the dependency-light WS token mint function.
-- SECURITY DEFINER is required to read the private lifecycle table; no target argument.
create function public.account_is_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid())
 and not exists(select 1 from public.account_deletion_requests where old_user_id=auth.uid());
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated;
alter table public.bonus_campaigns alter column created_by drop not null;
alter table public.bonus_campaign_eligible_users alter column created_by drop not null;
-- Fence direct authenticated Supabase access as well as backend API calls.
-- Preserve each existing self-owner predicate; do not widen role/table grants.
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

-- Guard privileged profile/favorite/claim helpers too, not only HTTP ingress.
-- Try-lock avoids row->lifecycle waits deadlocking with lifecycle-first writers.
-- Cleanup DELETE remains possible; unchanged campaign creator is historical data.
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
