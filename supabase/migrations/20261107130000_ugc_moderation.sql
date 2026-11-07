-- #1140 UGC phase C: admin moderation of reports. Additive and dark (the admin endpoint answers only with
-- UGC_SAFETY_ENABLED=1). No notification, scheduler or background job: the admin panel reads the queue when opened.
-- A report leaves "pending" only through an audited admin decision; nothing expires or deletes pending reports.
-- The only removal is the account-deletion cascade of the reported user (phase B), which also removes its audit rows.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- Audit of every moderation decision and target action, kept with the report.
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
commit;
