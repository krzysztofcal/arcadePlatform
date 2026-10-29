-- Operator-only psql script. Set target_uuid and blocked (true/false) explicitly.
-- Keep UUID and output in a restricted operational record, never a public PR.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='2s';
set local statement_timeout='5s';
select set_config('arcade.operator_profile_uuid', :'target_uuid', true);
select set_config('arcade.operator_profile_block', :'blocked', true);
do $$
declare target uuid:=current_setting('arcade.operator_profile_uuid')::uuid;
 desired boolean:=current_setting('arcade.operator_profile_block')::boolean;
 actual boolean;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'administrator required'; end if;
 -- Serialize with deletion/provisioning before locking the profile.
 perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:'||target::text,0));
 select public_profile_blocked into actual from public.user_profiles where user_id=target for update;
 if not found then raise exception 'profile not found'; end if;
 if actual is distinct from desired then
  update public.user_profiles set public_profile_blocked=desired where user_id=target;
 end if;
end $$;
select public_profile_blocked from public.user_profiles
where user_id=current_setting('arcade.operator_profile_uuid')::uuid;
commit;
