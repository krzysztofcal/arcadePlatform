-- Aggregate-only dry run. No personal content. Keep predicates aligned with normalize-profiles.sql.
BEGIN TRANSACTION READ ONLY;
with classified as (
 select p.*,
  exists(select 1 from public.account_deletion_requests d where d.old_user_id=p.user_id) as excluded_deletion,
  p.handle_customized_at is not null as customized_handle,
  p.handle_customized_at is null and p.handle !~ '^(apex|blue|bold|bright|cosmic|echo|ember|neon|nova|pixel|rapid|rocket|solar|swift|turbo|ultra|vivid|zen)-(ace|bolt|comet|falcon|fox|nova|orbit|panda|raven|tiger|wave|wizard)-[1-9][0-9]{5}$' as unknown_handle
 from public.user_profiles p
), candidates as (
 select *, customized_handle or unknown_handle as change_handle,
  customized_handle or unknown_handle or display_name is distinct from initcap(replace(handle,'-',' ')) as change_name,
  bio<>'' as clear_bio,avatar_key is not null as detach_photo
 from classified
), pending as (
 select * from candidates where not excluded_deletion
  and exists(select 1 from private.profile_terms_policy where singleton=true and identity_normalized_at is null)
)
select jsonb_build_object(
 'profiles',(select count(*) from candidates),
 'historicalHandleMarkers',(select count(*) from candidates where customized_handle),
 'unchangedProfiles',(select count(*) from candidates)-(select count(*) from pending where change_handle or change_name or clear_bio or detach_photo),
 'excludedDeletion',(select count(*) from candidates where excluded_deletion),
 'eligible',(select count(*) from pending where change_handle or change_name or clear_bio or detach_photo),
 'customizedHandle',(select count(*) from pending where customized_handle),
 'unknownHandle',(select count(*) from pending where unknown_handle),
 'displayName',(select count(*) from pending where change_name),
 'bio',(select count(*) from pending where clear_bio),
 'detachPhoto',(select count(*) from pending where detach_photo),
 'revisionIncrement',(select count(*) from pending where detach_photo),
 'setSuppression',(select count(*) from pending where detach_photo and not google_photo_suppressed),
 'missingPhotoTracker',(select count(*) from pending p where detach_photo and not exists(select 1 from private.account_avatar_objects a where a.user_id=p.user_id and a.output_path=p.avatar_key)),
 'handleMarkerWrites',0,
 'variants',(select jsonb_object_agg(avatar_variant,n) from (select avatar_variant,count(*) n from candidates group by avatar_variant) v),
 'storageObjects',(select count(*) from storage.objects where bucket_id='profile-avatars'),
 'trackedObjects',(select count(*) from private.account_avatar_objects),
 'policy',(select to_jsonb(p) from private.profile_terms_policy p where singleton=true)
) inventory;
COMMIT;
