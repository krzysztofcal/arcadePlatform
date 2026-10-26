-- NOT an automatic migration. LEGAL + owner GO, immutable text/URLs and current client/WS required.
BEGIN;
DO $$ BEGIN
 if not exists(select 1 from private.profile_terms_policy where singleton=true and version='2026-10-26-a1') then raise exception 'Terms version mismatch'; end if;
END $$;
update private.profile_terms_policy set active=true where singleton=true;
COMMIT;
