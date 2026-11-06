-- #1140 UGC phase B: user reports and private blocks for WWW and the Android app. Additive and dark: the
-- endpoints answer only when UGC_SAFETY_ENABLED=1 (deploy previews on by default), so applying this creates
-- empty tables and changes no existing row. Both tables are private: only the service connection reads them.
-- Account deletion removes the auth user through the Admin API; the foreign keys cascade (blocks, reports about the
-- user) or forget the reporter (set null), so they never block a deletion and keep no identity of a deleted user.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- A block is the blocker's private filter. It never changes seats, turns, cards, chips, escrow, settlement or
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
commit;
