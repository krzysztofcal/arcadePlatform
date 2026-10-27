-- Separate normalization GO after inventory. No Storage purge or financial/game writes.
BEGIN;
set local lock_timeout='2s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(hashtextextended('arcade-profile-normalize-a1',0));
DO $$
declare fresh public.user_profiles; generated record; ids uuid[]; uid uuid; needs_handle boolean; final_handle text; final_name text;
begin
 if not exists(select 1 from private.profile_terms_policy where singleton=true and version='2026-10-26-a1') then raise exception 'Profile policy unavailable or version mismatch'; end if;
 if exists(select 1 from private.profile_terms_policy where singleton=true and identity_normalized_at is not null) then return; end if;
 if (select count(*) from public.user_profiles)>1000 then raise exception 'Inventory too large for approved one-shot cleanup; review required'; end if;
 -- Legacy API stamps handle_customized_at on every actual handle change (not on display-name edits).
 -- NULL marker plus the exact provisioning vocabulary/range is retained; appearance alone is insufficient.
 ids:=array(select p.user_id from public.user_profiles p
  where not exists(select 1 from public.account_deletion_requests d where d.old_user_id=p.user_id)
   and (p.handle_customized_at is not null
    or p.handle !~ '^(apex|blue|bold|bright|cosmic|echo|ember|neon|nova|pixel|rapid|rocket|solar|swift|turbo|ultra|vivid|zen)-(ace|bolt|comet|falcon|fox|nova|orbit|panda|raven|tiger|wave|wizard)-[1-9][0-9]{5}$'
    or p.display_name is distinct from initcap(replace(p.handle,'-',' ')) or p.bio<>'' or p.avatar_key is not null)
  order by p.user_id);
 -- Fixed candidates, lifecycle locks in UUID order, then policy, then fresh profile rows.
 foreach uid in array ids loop
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:'||uid::text,0));
 end loop;
 perform 1 from private.profile_terms_policy where singleton=true for update;
 foreach uid in array ids loop
  if exists(select 1 from public.account_deletion_requests where old_user_id=uid) then continue; end if;
  select * into fresh from public.user_profiles where user_id=uid for update;
  if not found then continue; end if;
  needs_handle:=fresh.handle_customized_at is not null or fresh.handle !~ '^(apex|blue|bold|bright|cosmic|echo|ember|neon|nova|pixel|rapid|rocket|solar|swift|turbo|ultra|vivid|zen)-(ace|bolt|comet|falcon|fox|nova|orbit|panda|raven|tiger|wave|wizard)-[1-9][0-9]{5}$';
  if not needs_handle and fresh.display_name=initcap(replace(fresh.handle,'-',' ')) and fresh.bio='' and fresh.avatar_key is null then continue; end if;
  if fresh.avatar_key is not null then
   insert into private.account_avatar_objects(user_id,output_path) values(uid,fresh.avatar_key) on conflict(user_id,output_path) do nothing;
  end if;
  for attempt in 1..16 loop
   final_handle:=fresh.handle;
   final_name:=initcap(replace(fresh.handle,'-',' '));
   if needs_handle then
    select * into generated from private.arcade_profile_identity();
    final_handle:=generated.handle; final_name:=generated.display_name;
   end if;
   begin
    update public.user_profiles set handle=final_handle,display_name=final_name,bio='',avatar_key=null,
     google_photo_suppressed=case when fresh.avatar_key is not null then true else fresh.google_photo_suppressed end,
     avatar_revision=fresh.avatar_revision+case when fresh.avatar_key is not null then 1 else 0 end
     where user_id=uid;
    exit;
   exception when unique_violation then if not needs_handle or attempt=16 then raise; end if;
   end;
  end loop;
 end loop;
 update private.profile_terms_policy set identity_normalized_at=now() where singleton=true;
end $$;
COMMIT;
