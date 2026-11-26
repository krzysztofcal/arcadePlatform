-- PREPARED ONLY: not a migration, not authorized to execute. Production only (#1140); separate emergency OWNER GO required.
-- Incident rollback of Terms a3/ON back to a2/ON after enable-terms-a3-production.sql: sets version='2026-10-28-a2'.
-- Keeps every receipt (both a2 and a3); active stays true.
-- Operator must use one connection, stop on first error, ROLLBACK, never retry.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $rollback$
DECLARE
 target_version constant text := '2026-10-28-a2';
 current_expected_version constant text := '2026-11-26-a3';
 policy_before jsonb; receipts_before text; stats_before jsonb; stat record; changed integer;
BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7575202818581710058'
  OR current_setting('arcade.terms_project',true) IS DISTINCT FROM 'otbqfijerkieoxwpxjnm'
  OR current_setting('arcade.terms_confirmation',true) IS DISTINCT FROM 'ROLLBACK TERMS A3 otbqfijerkieoxwpxjnm'
 THEN RAISE EXCEPTION 'Production Terms identity/operator confirmation mismatch'; END IF;
 -- Same lock as enable-terms-a3-production.sql: the two operations never overlap.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('profile-terms-production-activation',0))
 THEN RAISE EXCEPTION 'Concurrent Terms activation'; END IF;
 SELECT to_jsonb(p) INTO policy_before FROM private.profile_terms_policy p WHERE singleton=true FOR UPDATE;
 IF policy_before IS NULL OR (SELECT count(*) FROM private.profile_terms_policy)<>1
  OR policy_before->>'version' IS DISTINCT FROM current_expected_version
  OR policy_before->'active' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'Expected active Terms a3 policy'; END IF;
 LOCK TABLE private.profile_terms_receipts IN SHARE MODE;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text)
 INTO receipts_before FROM private.profile_terms_receipts r;
 SELECT coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)
 INTO stats_before FROM pg_stat_xact_user_tables;
 UPDATE private.profile_terms_policy SET version=target_version
 WHERE singleton=true AND version=current_expected_version AND active=true;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 OR (SELECT to_jsonb(p)-'version' FROM private.profile_terms_policy p WHERE singleton=true) IS DISTINCT FROM policy_before-'version'
  OR (SELECT version FROM private.profile_terms_policy WHERE singleton=true) IS DISTINCT FROM target_version
  OR NOT (SELECT active FROM private.profile_terms_policy WHERE singleton=true)
  OR receipts_before IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text) FROM private.profile_terms_receipts r)
 THEN RAISE EXCEPTION 'Rollback changed unexpected state'; END IF;
 PERFORM pg_stat_clear_snapshot();
 FOR stat IN SELECT * FROM pg_stat_xact_user_tables LOOP
  IF jsonb_build_array(stat.n_tup_ins,stat.n_tup_upd,stat.n_tup_del) IS DISTINCT FROM
   (CASE WHEN stat.relid='private.profile_terms_policy'::regclass THEN
    jsonb_build_array(coalesce((stats_before->stat.relid::text->>0)::bigint,0),coalesce((stats_before->stat.relid::text->>1)::bigint,0)+1,coalesce((stats_before->stat.relid::text->>2)::bigint,0))
   ELSE coalesce(stats_before->stat.relid::text,'[0,0,0]'::jsonb) END)
  THEN RAISE EXCEPTION 'Unexpected transaction data write'; END IF;
 END LOOP;
END $rollback$;
COMMIT;
