-- PREPARED ONLY: not a migration, not authorized to execute. Production only (#1140); separate exact-file OWNER GO required.
-- Target: published Terms 2026-11-26-a3 with Privacy 2026-11-21-a5 (see terms-a3-activation.md for pins and evidence).
-- Web-only activation proposal: requires explicit OWNER attestation that no installed Production APK reader exists.
-- One approved activation advances the version on the active row; no receipt conversion.
-- Operator must use one connection, stop on first error, ROLLBACK, never retry.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $activation$
DECLARE
 approved_version constant text := '2026-11-26-a3';
 previous_version constant text := '2026-10-28-a2';
 history_hash constant text := 'f6a26af98255afd27ef743cecd68f923948e9974f4160c7997e45fd1c14863f9';
 policy_before jsonb; receipts_before text; profiles_before text;
 stats_before jsonb; stat record; changed integer; readers jsonb;
 receipts_count bigint; profiles_count bigint;
BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7575202818581710058'
  OR current_setting('arcade.terms_project',true) IS DISTINCT FROM 'otbqfijerkieoxwpxjnm'
  OR current_setting('arcade.terms_confirmation',true) IS DISTINCT FROM 'ENABLE TERMS A3 otbqfijerkieoxwpxjnm'
 THEN RAISE EXCEPTION 'Production Terms identity/operator confirmation mismatch'; END IF;
 IF approved_version='OWNER_LEGAL_VERSION_NOT_APPROVED'
  OR current_setting('arcade.terms_legal_version',true) IS DISTINCT FROM approved_version
 THEN RAISE EXCEPTION 'OWNER/LEGAL version not approved'; END IF;
 -- Reader compatibility is an external preflight attestation, not discoverable by SQL.
 -- Pins are published WWW and running WS at preparation; refresh externally before execution.
 -- No Production APK is inferred from a Stage artifact; OWNER must explicitly approve this web-only scope.
 readers:=nullif(current_setting('arcade.terms_readers',true),'')::jsonb;
 IF readers IS NULL OR readers->>'version' IS DISTINCT FROM approved_version
  OR readers->>'apiSha' IS DISTINCT FROM '08afb53ff34db2e6df6699ce12aa2cec43900711'
  OR readers->>'wsSha' IS DISTINCT FROM 'cddc65befd5c03851fdc5e67a6676c269d85ee03'
  OR readers->>'apkSha' IS DISTINCT FROM 'NO_PRODUCTION_APK'
  OR readers->>'documentsSha256' IS DISTINCT FROM '3e3cc30391acd84f4bb49d12b2958c5763bf41c6ae0e847230ecabeac5cf8750'
  OR current_setting('arcade.terms_apk_confirmation',true) IS DISTINCT FROM 'NO PRODUCTION APK otbqfijerkieoxwpxjnm'
  OR readers->>'apiSha'='API_SHA_NOT_APPROVED'
  OR readers->>'wsSha'='WS_SHA_NOT_APPROVED'
  OR readers->>'apkSha'='APK_SHA_NOT_APPROVED'
  OR readers->>'documentsSha256'='DOCUMENTS_HASH_NOT_APPROVED'
 THEN RAISE EXCEPTION 'Compatible legal/readers preflight not approved'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('profile-terms-production-activation',0))
 THEN RAISE EXCEPTION 'Concurrent Terms activation'; END IF;
 -- Production has no schema_migration_files table. Pin observed version/name history,
 -- not Stage's byte-history fingerprint; manifest/file reconciliation is an external OWNER preflight.
 LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>73
  OR (SELECT encode(sha256(convert_to(string_agg(version||':'||coalesce(name,'<NULL>'),E'\n' ORDER BY version),'UTF8')),'hex')
   FROM supabase_migrations.schema_migrations) IS DISTINCT FROM history_hash
 THEN RAISE EXCEPTION 'Expected exact Production migration version/name history 73'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND state='active'
  AND query ~* '(alter[[:space:]]+table|drop[[:space:]]+column|profile-terms-production-activation)')
 THEN RAISE EXCEPTION 'Concurrent DDL/policy operation'; END IF;
 SELECT to_jsonb(p) INTO policy_before FROM private.profile_terms_policy p WHERE singleton=true FOR UPDATE;
 IF policy_before IS NULL OR (SELECT count(*) FROM private.profile_terms_policy)<>1
  OR policy_before->>'version' IS DISTINCT FROM previous_version
  OR policy_before->'active' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'Expected Production a2/ON policy'; END IF;
 -- No lifecycle/profile lock is acquired after the policy lock. Acceptances wait
 -- on the policy row; SHARE additionally prevents receipt DML during this operation.
 LOCK TABLE private.profile_terms_receipts IN SHARE MODE;
 -- Bound the scan before fingerprinting: growth beyond the reviewed size is a STOP, not a longer scan.
 SELECT count(*) INTO receipts_count FROM private.profile_terms_receipts;
 SELECT count(*) INTO profiles_count FROM public.user_profiles;
 IF receipts_count > 1000 OR profiles_count > 1000 THEN RAISE EXCEPTION 'Read-only inventory drift'; END IF;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text)
 INTO receipts_before FROM private.profile_terms_receipts r;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id),'[]'::jsonb)::text)
 INTO profiles_before FROM public.user_profiles p;
 IF current_setting('arcade.terms_receipts_fingerprint',true) IS DISTINCT FROM receipts_before
  OR current_setting('arcade.terms_profiles_fingerprint',true) IS DISTINCT FROM profiles_before
  OR current_setting('arcade.terms_receipts_count',true) IS DISTINCT FROM receipts_count::text
  OR current_setting('arcade.terms_profiles_count',true) IS DISTINCT FROM profiles_count::text
 THEN RAISE EXCEPTION 'Read-only inventory drift'; END IF;
 SELECT coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)
 INTO stats_before FROM pg_stat_xact_user_tables;
 UPDATE private.profile_terms_policy SET version=approved_version
 WHERE singleton=true AND version=previous_version AND active=true;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 OR (SELECT to_jsonb(p)-'version' FROM private.profile_terms_policy p WHERE singleton=true) IS DISTINCT FROM policy_before-'version'
  OR (SELECT version FROM private.profile_terms_policy WHERE singleton=true) IS DISTINCT FROM approved_version
  OR NOT (SELECT active FROM private.profile_terms_policy WHERE singleton=true)
  OR receipts_before IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text) FROM private.profile_terms_receipts r)
  OR profiles_before IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id),'[]'::jsonb)::text) FROM public.user_profiles p)
 THEN RAISE EXCEPTION 'Activation changed unexpected state'; END IF;
 -- Prove this transaction did not mutate Auth, CH/XP/Poker, Storage, receipts,
 -- migration history or another application table, including trigger side effects.
 PERFORM pg_stat_clear_snapshot();
 FOR stat IN SELECT * FROM pg_stat_xact_user_tables LOOP
  IF jsonb_build_array(stat.n_tup_ins,stat.n_tup_upd,stat.n_tup_del) IS DISTINCT FROM
   (CASE WHEN stat.relid='private.profile_terms_policy'::regclass THEN
    jsonb_build_array(coalesce((stats_before->stat.relid::text->>0)::bigint,0),coalesce((stats_before->stat.relid::text->>1)::bigint,0)+1,coalesce((stats_before->stat.relid::text->>2)::bigint,0))
   ELSE coalesce(stats_before->stat.relid::text,'[0,0,0]'::jsonb) END)
  THEN RAISE EXCEPTION 'Unexpected transaction data write'; END IF;
 END LOOP;
END $activation$;
COMMIT;
