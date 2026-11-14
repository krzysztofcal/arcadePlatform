-- Additive. Apply schema before readers; no flag is activated by this migration.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
alter table public.user_profiles add column public_profile_blocked boolean not null default false;
create function private.guard_public_profile_block() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if (TG_OP='INSERT' and new.public_profile_blocked)
 or (TG_OP='UPDATE' and new.public_profile_blocked is distinct from old.public_profile_blocked) then
  if current_user not in ('postgres','supabase_admin') then
   raise exception 'public profile block requires database administrator' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger user_profiles_block_guard before insert or update on public.user_profiles
for each row execute function private.guard_public_profile_block();
revoke all on function private.guard_public_profile_block() from public;
commit;
