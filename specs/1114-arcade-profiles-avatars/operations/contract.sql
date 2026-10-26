-- Separate GO after normalization and verification that every active SQL reader is compatible.
BEGIN;
DO $$ BEGIN if not exists(select 1 from private.profile_terms_policy where identity_normalized_at is not null) then raise exception 'Normalization not completed'; end if; END $$;
alter table public.user_profiles drop column bio,drop column handle_customized_at;
COMMIT;
