-- PREPARED ONLY: not a migration, not authorized to execute. Stage only (#1140).
-- Emergency switch-off of the Terms requirement after enable-terms.sql: sets active=false only.
-- Keeps version 2026-10-28-a2 and every receipt; re-enabling later uses a reviewed operation.
-- Operator must use one connection, stop on first error, ROLLBACK, never retry.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='15s';
DO $deactivation$
DECLARE
 active_version constant text := '2026-10-28-a2';
 policy_before jsonb; receipts_before text; stats_before jsonb; stat record; changed integer;
BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7656985631720456337'
  OR current_setting('arcade.terms_project',true) IS DISTINCT FROM 'krydukthwdvccggbyjfw'
  OR current_setting('arcade.terms_confirmation',true) IS DISTINCT FROM 'DISABLE TERMS krydukthwdvccggbyjfw'
 THEN RAISE EXCEPTION 'Stage Terms identity/operator confirmation mismatch'; END IF;
 -- Same lock as enable-terms.sql: the two operations never overlap.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('profile-terms-stage-activation',0))
 THEN RAISE EXCEPTION 'Concurrent Terms activation'; END IF;
 SELECT to_jsonb(p) INTO policy_before FROM private.profile_terms_policy p WHERE singleton=true FOR UPDATE;
 IF policy_before IS NULL OR (SELECT count(*) FROM private.profile_terms_policy)<>1
  OR policy_before->>'version' IS DISTINCT FROM active_version
  OR policy_before->'active' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'Expected active Terms a2 policy'; END IF;
 LOCK TABLE private.profile_terms_receipts IN SHARE MODE;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text)
 INTO receipts_before FROM private.profile_terms_receipts r;
 SELECT coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb)
 INTO stats_before FROM pg_stat_xact_user_tables;
 UPDATE private.profile_terms_policy SET active=false
 WHERE singleton=true AND version=active_version AND active=true;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 OR (SELECT to_jsonb(p)-'active' FROM private.profile_terms_policy p WHERE singleton=true) IS DISTINCT FROM policy_before-'active'
  OR (SELECT active FROM private.profile_terms_policy WHERE singleton=true)
  OR receipts_before IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY subject_kind,subject_id,terms_version),'[]'::jsonb)::text) FROM private.profile_terms_receipts r)
 THEN RAISE EXCEPTION 'Deactivation changed unexpected state'; END IF;
 PERFORM pg_stat_clear_snapshot();
 FOR stat IN SELECT * FROM pg_stat_xact_user_tables LOOP
  IF jsonb_build_array(stat.n_tup_ins,stat.n_tup_upd,stat.n_tup_del) IS DISTINCT FROM
   (CASE WHEN stat.relid='private.profile_terms_policy'::regclass THEN
    jsonb_build_array(coalesce((stats_before->stat.relid::text->>0)::bigint,0),coalesce((stats_before->stat.relid::text->>1)::bigint,0)+1,coalesce((stats_before->stat.relid::text->>2)::bigint,0))
   ELSE coalesce(stats_before->stat.relid::text,'[0,0,0]'::jsonb) END)
  THEN RAISE EXCEPTION 'Unexpected transaction data write'; END IF;
 END LOOP;
END $deactivation$;
COMMIT;
