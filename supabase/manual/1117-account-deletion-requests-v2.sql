-- Preparation only: this migration has not been applied to Stage/Production.
-- No Auth FK: the durable request must outlive hard deletion of its owner.
create table public.account_deletion_requests (
  request_id uuid primary key,
  old_user_id uuid not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','RETRY','ERROR','COMPLETED')),
  phase text not null default 'preparing' check (phase in ('preparing','poker','burn','cleanup','auth','completed')),
  accepted_at timestamptz,
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
