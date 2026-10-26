-- Separate owner GO after compatible active WS/readers. NOT an automatic migration.
BEGIN;
create or replace function public.ensure_user_profile(target_user_id uuid)
returns public.user_profiles language plpgsql security definer set search_path='' as $$
declare profile_row public.user_profiles; generated record; variants text[]:=ARRAY['comet-blue','falcon-orange','fox-blue','nova-purple','orbit-green','panda-pink','raven-violet','tiger-gold','wave-cyan','wizard-indigo','bolt-yellow','rocket-red','ace-silver','ember-coral','pixel-teal','zen-lime'];
begin
 if target_user_id is null then raise exception 'target_user_id is required' using errcode='22023'; end if;
 select * into profile_row from public.user_profiles p where p.user_id=target_user_id;
 if found then return profile_row; end if;
 if not coalesce((select variants_enabled from private.profile_terms_policy where singleton=true),false) then variants:=variants[1:6]; end if;
 for attempt in 1..16 loop
  select * into generated from private.arcade_profile_identity();
  insert into public.user_profiles(user_id,handle,display_name,avatar_variant)
  values(target_user_id,generated.handle,generated.display_name,variants[1+floor(random()*array_length(variants,1))::int]) on conflict do nothing returning * into profile_row;
  if profile_row.user_id is not null then return profile_row; end if;
  select * into profile_row from public.user_profiles p where p.user_id=target_user_id;
  if found then return profile_row; end if;
 end loop;
 raise exception 'profile_generation_exhausted';
end $$;
revoke all on function public.ensure_user_profile(uuid) from public,anon,authenticated;
grant execute on function public.ensure_user_profile(uuid) to service_role;

update private.profile_terms_policy set variants_enabled=true where singleton=true;
COMMIT;
