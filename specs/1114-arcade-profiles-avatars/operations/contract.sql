-- Prepared G1 only. Separate exact-file G2 GO required; never an unattended pending batch.
BEGIN;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='15s';
DO $target$ BEGIN
 if (select system_identifier::text from pg_control_system()) is distinct from '7656985631720456337'
  or current_setting('arcade.profile_bio_contract_confirmation',true) is distinct from 'DROP EMPTY PROFILE BIO krydukthwdvccggbyjfw' then raise exception 'Stage BIO contract identity/GO mismatch'; end if;
END $target$;
-- BEGIN SHARED BIO CONTRACT
DO $contract$
declare uid uuid; bio_attribute smallint; profile_fingerprint text; columns_before jsonb; table_security jsonb; guards_before text; tracking_before jsonb; triggers_before jsonb; stats_before jsonb; stat record;
begin
 if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'Phase A migration history unavailable'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261026120000') then raise exception 'Phase A schema version not recorded'; end if;
 if not exists(select 1 from private.profile_terms_policy where singleton=true and version='2026-10-26-a1' and active=false and variants_enabled=true and identity_normalized_at is not null and identity_normalized_at<=clock_timestamp()) then raise exception 'Normalization/policy precondition failed'; end if;
 if (select count(*) from public.user_profiles)>1000 then raise exception 'Profile contract requires reviewed bounded inventory'; end if;
 -- Retain the established lifecycle -> policy -> profile lock order.
 for uid in select user_id from public.user_profiles order by user_id loop
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:'||uid::text,0));
 end loop;
 perform 1 from private.profile_terms_policy where singleton=true and version='2026-10-26-a1' and active=false and variants_enabled=true and identity_normalized_at is not null and identity_normalized_at<=clock_timestamp() for share;
 if not found then raise exception 'Locked normalization/policy precondition drift'; end if;
 lock table public.user_profiles in access exclusive mode;
 select attnum into bio_attribute from pg_attribute where attrelid='public.user_profiles'::regclass and attname='bio' and atttypid='text'::regtype and not attisdropped;
 if bio_attribute is null then raise exception 'Expected pre-contract BIO text column'; end if;
 if exists(select 1 from public.user_profiles where bio is distinct from '') then raise exception 'BIO is not empty'; end if;
 if (select count(*) from pg_attribute where attrelid='public.user_profiles'::regclass and not attisdropped and attname=any(array['user_id','handle','display_name','handle_customized_at','avatar_key','avatar_variant','avatar_revision','google_photo_suppressed','leaderboard_visible']))<>9 then raise exception 'Retained Phase A columns unavailable'; end if;
 if to_regclass('public.profile_avatar_uploads') is null or to_regclass('private.account_avatar_objects') is null or to_regclass('private.avatar_tracking_cutover') is null
  or to_regprocedure('private.account_avatar_manifest_reconciled(uuid,uuid,uuid)') is null
  or to_regprocedure('private.account_avatar_prepare_purge(uuid,uuid,bigint,text)') is null then raise exception 'V2/V3 retention dependencies unavailable'; end if;
 -- pg_depend catches views/rules/SQL dependencies; never use CASCADE.
 if exists(select 1 from pg_depend d where d.refclassid='pg_class'::regclass and d.refobjid='public.user_profiles'::regclass and d.refobjsubid=bio_attribute
  and not ((d.classid='pg_attrdef'::regclass and exists(select 1 from pg_attrdef a where a.oid=d.objid and a.adrelid=d.refobjid and a.adnum=bio_attribute))
   or (d.classid='pg_constraint'::regclass and exists(select 1 from pg_constraint c where c.oid=d.objid and c.conrelid=d.refobjid and c.conname='user_profiles_bio_length' and c.contype='c' and c.conkey=array[bio_attribute])))) then raise exception 'Dependent BIO object requires review'; end if;
 -- PL/pgSQL strings are not all represented by per-column pg_depend entries.
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind in ('f','p') and p.prosrc ~* '\mbio\M') then raise exception 'Stored routine BIO reference requires review'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(p)-'bio' order by user_id),'[]'::jsonb)::text) into profile_fingerprint from public.user_profiles p;
 select jsonb_agg(jsonb_build_array(attname,attnum,atttypid,atttypmod,attnotnull,attidentity,attcollation) order by attnum) into columns_before from pg_attribute where attrelid='public.user_profiles'::regclass and attnum>0 and not attisdropped and attname<>'bio';
 select jsonb_build_array(relowner,relacl,relrowsecurity) into table_security from pg_class where oid='public.user_profiles'::regclass;
 select md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosrc) order by p.oid),'[]'::jsonb)::text) into guards_before from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like '%account_%' or p.oid in ('public.ensure_user_profile(uuid)'::regprocedure,'public.create_user_profile_after_signup()'::regprocedure,'public.user_profiles_touch_updated_at()'::regprocedure));
 select jsonb_build_object('uploads',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]'::jsonb) from public.profile_avatar_uploads u),'objects',(select coalesce(jsonb_agg(to_jsonb(o) order by user_id,output_path),'[]'::jsonb) from private.account_avatar_objects o),'cutover',(select coalesce(jsonb_agg(to_jsonb(c) order by marker),'[]'::jsonb) from private.avatar_tracking_cutover c)) into tracking_before;
 select jsonb_agg(jsonb_build_array(tgrelid,tgname,tgenabled,tgfoid,tgtype,encode(tgargs,'hex')) order by tgrelid,tgname) into triggers_before from pg_trigger where not tgisinternal and tgrelid in ('auth.users'::regclass,'public.user_profiles'::regclass,'public.profile_avatar_uploads'::regclass,'private.account_avatar_objects'::regclass);
 select coalesce(jsonb_object_agg(relid::text,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)),'{}'::jsonb) into stats_before from pg_stat_xact_user_tables;
 alter table public.user_profiles drop column bio restrict;
 if profile_fingerprint is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]'::jsonb)::text) from public.user_profiles p) then raise exception 'Profile contract changed retained values'; end if;
 if columns_before is distinct from (select jsonb_agg(jsonb_build_array(attname,attnum,atttypid,atttypmod,attnotnull,attidentity,attcollation) order by attnum) from pg_attribute where attrelid='public.user_profiles'::regclass and attnum>0 and not attisdropped) then raise exception 'Profile contract changed other columns'; end if;
 if table_security is distinct from (select jsonb_build_array(relowner,relacl,relrowsecurity) from pg_class where oid='public.user_profiles'::regclass) then raise exception 'Profile table security changed'; end if;
 if guards_before is distinct from (select md5(coalesce(jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosrc) order by p.oid),'[]'::jsonb)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.proname like '%account_%' or p.oid in ('public.ensure_user_profile(uuid)'::regprocedure,'public.create_user_profile_after_signup()'::regprocedure,'public.user_profiles_touch_updated_at()'::regprocedure))) then raise exception 'Account guards changed'; end if;
 if tracking_before is distinct from (select jsonb_build_object('uploads',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]'::jsonb) from public.profile_avatar_uploads u),'objects',(select coalesce(jsonb_agg(to_jsonb(o) order by user_id,output_path),'[]'::jsonb) from private.account_avatar_objects o),'cutover',(select coalesce(jsonb_agg(to_jsonb(c) order by marker),'[]'::jsonb) from private.avatar_tracking_cutover c))) then raise exception 'Historical capabilities/tracking changed'; end if;
 if triggers_before is distinct from (select jsonb_agg(jsonb_build_array(tgrelid,tgname,tgenabled,tgfoid,tgtype,encode(tgargs,'hex')) order by tgrelid,tgname) from pg_trigger where not tgisinternal and tgrelid in ('auth.users'::regclass,'public.user_profiles'::regclass,'public.profile_avatar_uploads'::regclass,'private.account_avatar_objects'::regclass)) then raise exception 'Provisioning/deletion triggers changed'; end if;
 perform pg_stat_clear_snapshot();
 for stat in select * from pg_stat_xact_user_tables loop
  if jsonb_build_array(stat.n_tup_ins,stat.n_tup_upd,stat.n_tup_del) is distinct from coalesce(stats_before->stat.relid::text,'[0,0,0]'::jsonb) then raise exception 'Unexpected contract data write'; end if;
 end loop;
end $contract$;
-- END SHARED BIO CONTRACT
COMMIT;
