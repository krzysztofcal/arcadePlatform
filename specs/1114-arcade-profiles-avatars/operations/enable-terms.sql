-- PREPARED ONLY: not a migration, not authorized to execute.
-- Draft candidate 2026-10-28-a2; legal approval and reader pins remain unapproved.
-- One future approved activation advances the version and active flag on the same row; no receipt conversion.
-- Operator must use one connection, stop on first error, ROLLBACK, never retry.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $activation$
DECLARE
 approved_version constant text := 'OWNER_LEGAL_VERSION_NOT_APPROVED';
 previous_version constant text := '2026-10-26-a1';
 manifest_hash constant text := 'aee0fb222b7040de6b851b258800ecee43aa060db4a6a4a281040777d1f29484';
 policy_before jsonb; receipts_before text; profiles_before text;
 stats_before jsonb; stat record; changed integer; readers jsonb;
BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7656985631720456337'
  OR current_setting('arcade.terms_project',true) IS DISTINCT FROM 'krydukthwdvccggbyjfw'
  OR current_setting('arcade.terms_confirmation',true) IS DISTINCT FROM 'ENABLE TERMS krydukthwdvccggbyjfw'
 THEN RAISE EXCEPTION 'Stage Terms identity/operator confirmation mismatch'; END IF;
 IF approved_version='OWNER_LEGAL_VERSION_NOT_APPROVED'
  OR current_setting('arcade.terms_legal_version',true) IS DISTINCT FROM approved_version
 THEN RAISE EXCEPTION 'OWNER/LEGAL version not approved'; END IF;
 -- Reader compatibility is an external preflight attestation, not discoverable by SQL.
 -- A later reviewed revision must pin the actual approved legal/doc/runtime tuple.
 readers:=nullif(current_setting('arcade.terms_readers',true),'')::jsonb;
 IF readers IS NULL OR readers->>'version' IS DISTINCT FROM approved_version
  OR readers->>'apiSha' IS DISTINCT FROM 'API_SHA_NOT_APPROVED'
  OR readers->>'wsSha' IS DISTINCT FROM 'WS_SHA_NOT_APPROVED'
  OR readers->>'apkSha' IS DISTINCT FROM 'APK_SHA_NOT_APPROVED'
  OR readers->>'documentsSha256' IS DISTINCT FROM 'DOCUMENTS_HASH_NOT_APPROVED'
  OR readers->>'apiSha'='API_SHA_NOT_APPROVED'
  OR readers->>'wsSha'='WS_SHA_NOT_APPROVED'
  OR readers->>'apkSha'='APK_SHA_NOT_APPROVED'
  OR readers->>'documentsSha256'='DOCUMENTS_HASH_NOT_APPROVED'
 THEN RAISE EXCEPTION 'Compatible legal/readers preflight not approved'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('profile-terms-stage-activation',0))
 THEN RAISE EXCEPTION 'Concurrent Terms activation'; END IF;
 LOCK TABLE supabase_migrations.schema_migrations, supabase_migrations.schema_migration_files IN SHARE MODE;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>120
  OR (SELECT count(*) FROM supabase_migrations.schema_migration_files)<>120
  OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations h FULL JOIN supabase_migrations.schema_migration_files f USING(version)
   WHERE h.version IS NULL OR f.version IS NULL OR h.name IS DISTINCT FROM f.name
    OR f.file IS DISTINCT FROM f.version||'_'||f.name||'.sql')
  OR (SELECT encode(sha256(convert_to(string_agg(version||':'||file||':'||sha256,E'\n' ORDER BY version),'UTF8')),'hex')
   FROM supabase_migrations.schema_migration_files) IS DISTINCT FROM manifest_hash
 THEN RAISE EXCEPTION 'Expected exact repository migration/hash history120/120'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND state='active'
  AND query ~* '(alter[[:space:]]+table|drop[[:space:]]+column|profile-terms-stage-activation)')
 THEN RAISE EXCEPTION 'Concurrent DDL/policy operation'; END IF;
 SELECT to_jsonb(p) INTO policy_before FROM private.profile_terms_policy p WHERE singleton=true FOR UPDATE;
 IF policy_before IS NULL OR (SELECT count(*) FROM private.profile_terms_policy)<>1
  OR policy_before->>'version' IS DISTINCT FROM previous_version
  OR policy_before->'active' IS DISTINCT FROM 'false'::jsonb
  OR policy_before->'variants_enabled' IS DISTINCT FROM 'true'::jsonb
  OR nullif(policy_before->>'identity_normalized_at','') IS NULL
  OR (policy_before->>'identity_normalized_at')::timestamptz>clock_timestamp()
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.user_profiles'::regclass AND attname='bio' AND NOT attisdropped)
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.user_profiles'::regclass AND attname='handle_customized_at' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Expected normalized post-contract catalog16 ON/Terms OFF policy'; END IF;
 -- No lifecycle/profile lock is acquired after the policy lock. Acceptances wait
 -- on the policy row; SHARE additionally prevents receipt DML during this operation.
 LOCK TABLE private.profile_terms_receipts IN SHARE MODE;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text)
 INTO receipts_before FROM private.profile_terms_receipts r;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY user_id),'[]'::jsonb)::text)
 INTO profiles_before FROM public.user_profiles p;
 IF current_setting('arcade.terms_receipts_fingerprint',true) IS DISTINCT FROM receipts_before
  OR current_setting('arcade.terms_profiles_fingerprint',true) IS DISTINCT FROM profiles_before
  OR current_setting('arcade.terms_receipts_count',true) IS DISTINCT FROM (SELECT count(*)::text FROM private.profile_terms_receipts)
 THEN RAISE EXCEPTION 'Read-only inventory drift'; END IF;
 SELECT coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)
 INTO stats_before FROM pg_stat_xact_user_tables;
 UPDATE private.profile_terms_policy SET version=approved_version,active=true
 WHERE singleton=true AND version=previous_version AND active=false;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 OR (SELECT to_jsonb(p)-'active'-'version' FROM private.profile_terms_policy p WHERE singleton=true) IS DISTINCT FROM policy_before-'active'-'version'
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
