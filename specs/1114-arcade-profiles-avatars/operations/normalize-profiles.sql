-- Separate cleanup GO after inventory and compatible readers. NOT an automatic migration.
BEGIN;
select pg_advisory_xact_lock(hashtextextended('arcade-profile-normalize-a1',0));
DO $$
declare p record; fresh public.user_profiles; generated record; ids uuid[]; uid uuid;
begin
 if exists(select 1 from private.profile_terms_policy where identity_normalized_at is not null) then return; end if;
 if (select count(*) from public.user_profiles)>1000 then raise exception 'Inventory too large for approved one-shot cleanup; review required'; end if;
 -- Acquire lifecycle locks in UUID order before the policy lock, then profile rows.
 -- The fixed inventory prevents newly created accounts from entering this one-shot batch.
 ids:=array(select user_id from public.user_profiles order by user_id);
 foreach uid in array ids loop
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:'||uid::text,0));
 end loop;
 perform 1 from private.profile_terms_policy where singleton=true for update;
 for p in select * from public.user_profiles where user_id=any(ids) order by user_id loop
  if exists(select 1 from public.account_deletion_requests where old_user_id=p.user_id) then continue; end if;
  select * into fresh from public.user_profiles where user_id=p.user_id for update;
  if fresh.avatar_key is not null then
   insert into private.account_avatar_objects(user_id,output_path) values(p.user_id,fresh.avatar_key) on conflict(user_id,output_path) do nothing;
  end if;
  -- Retain the provisioning vocabulary only with the existing authoritative no-customization marker; inventory must confirm the known writer path.
  -- Unknown/manual handles get a fresh automatic identity; no historical routing.
  if fresh.handle_customized_at is not null or fresh.handle !~ '^(apex|blue|bold|bright|cosmic|echo|ember|neon|nova|pixel|rapid|rocket|solar|swift|turbo|ultra|vivid|zen)-(ace|bolt|comet|falcon|fox|nova|orbit|panda|raven|tiger|wave|wizard)-[1-9][0-9]{5}$' then
   for attempt in 1..16 loop
    begin
     select * into generated from private.arcade_profile_identity();
     update public.user_profiles set handle=generated.handle where user_id=p.user_id returning * into fresh;
     exit;
    exception when unique_violation then if attempt=16 then raise; end if;
    end;
   end loop;
  end if;
  update public.user_profiles set display_name=initcap(replace(fresh.handle,'-',' ')),bio='',avatar_key=null,
    google_photo_suppressed=true,avatar_revision=avatar_revision+1,handle_customized_at=coalesce(handle_customized_at,now()) where user_id=p.user_id;
 end loop;
 update private.profile_terms_policy set identity_normalized_at=now() where singleton=true;
end $$;
COMMIT;
