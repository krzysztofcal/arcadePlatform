-- Read-only inventory. No personal content or live credentials in evidence.
select count(*) profiles,count(*) filter(where handle_customized_at is not null) customized_handles,count(*) filter(where avatar_key is not null) uploaded,count(*) filter(where bio<>'') bios from public.user_profiles;
select avatar_variant,count(*) from public.user_profiles group by avatar_variant;
select count(*) pending_deletions from public.account_deletion_requests where status<>'COMPLETED';
select active,variants_enabled,version,identity_normalized_at from private.profile_terms_policy;
