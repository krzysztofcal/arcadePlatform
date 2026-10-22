-- Install only. Enable the protocol trigger separately AFTER supported writers
-- run tracking v3 with deletion OFF. Draft PRs must never auto-apply to Stage.
begin;
alter table private.avatar_tracking_cutover
  add column provider_max_token_seconds integer check(provider_max_token_seconds between 1 and 7200),
  add column provider_max_completion_seconds integer check(provider_max_completion_seconds >= 0),
  add column provider_evidence text check(length(provider_evidence) between 1 and 2000);
-- NULL means UNKNOWN, not an implicit grace/approval. No evidence is seeded.

create function public.account_avatar_manifest_guard_v3() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; req public.account_deletion_requests;
begin
 owner := case when tg_op='DELETE' then old.user_id else new.user_id end;
 if owner is null then raise exception using errcode='42501',message='Avatar owner required'; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||owner::text,0)) then
   raise exception using errcode='40001',message='Account lifecycle busy';
 end if;
 if tg_op='DELETE' then
   -- Only the authorized Auth FK cascade may purge manifests. A plain legacy
   -- DELETE cannot satisfy parent absence + nested trigger + durable lease proof.
   select * into req from public.account_deletion_requests where old_user_id=owner;
   if pg_trigger_depth()<2 or exists(select 1 from auth.users where id=owner)
      or req.request_id is null or req.status<>'PROCESSING' or req.phase<>'auth'
      or req.lease_until is null or req.lease_until<=clock_timestamp()
      or req.progress->'cleanup'->>'done' is distinct from 'true'
      or req.progress->>'authIntent' is distinct from 'true'
      or req.progress->'avatarPurge'->>'requestId' is distinct from req.request_id::text
      or req.progress->'avatarPurge'->>'owner' is distinct from owner::text
      or old.tracking_version is distinct from 3 or old.signing_finished_at is null
      or old.capability_until is null or old.source_deleted_at is null
      or (old.output_path is not null and (old.output_write_finished_at is null or old.output_deleted_at is null)) then
     raise exception using errcode='42501',message='Avatar manifest purge not authorized';
   end if;
   return old;
 end if;
 if tg_op='INSERT' then
   if new.tracking_version is distinct from 3 or new.source_path is distinct from 'pending/'||new.id::text
      or new.consumed_at is not null or new.signing_finished_at is not null or new.capability_until is not null
      or new.output_path is not null or new.output_write_started_at is not null or new.output_write_finished_at is not null
      or new.source_deleted_at is not null or new.output_deleted_at is not null then
     raise exception using errcode='42501',message='Avatar tracking protocol required';
   end if;
 else
   if new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.source_path is distinct from old.source_path or new.tracking_version is distinct from old.tracking_version
      or new.declared_mime_type is distinct from old.declared_mime_type or new.declared_size is distinct from old.declared_size
      or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
      or old.tracking_version is distinct from 3
      or (old.signing_finished_at is not null and new.signing_finished_at is distinct from old.signing_finished_at)
      or (old.capability_until is not null and new.capability_until is distinct from old.capability_until)
      or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
      or (old.output_path is not null and new.output_path is distinct from old.output_path)
      or (old.output_write_started_at is not null and new.output_write_started_at is distinct from old.output_write_started_at)
      or (old.output_write_finished_at is not null and new.output_write_finished_at is distinct from old.output_write_finished_at)
      or (old.source_deleted_at is not null and new.source_deleted_at is distinct from old.source_deleted_at)
      or (old.output_deleted_at is not null and new.output_deleted_at is distinct from old.output_deleted_at) then
     raise exception using errcode='42501',message='Avatar manifest evidence is immutable';
   end if;
   if new.consumed_at is distinct from old.consumed_at then
     if new.consumed_at is null or new.output_path is null or new.output_path !~ '^[0-9a-f-]{36}\.webp$'
        or new.output_write_started_at is null or new.signing_finished_at is null then
       raise exception using errcode='42501',message='Avatar finalize intent required';
     end if;
     if not exists(select 1 from auth.users where id=owner)
        or exists(select 1 from public.account_deletion_requests where old_user_id=owner) then
       raise exception using errcode='42501',message='Account is not active';
     end if;
   elsif new.output_path is distinct from old.output_path or new.output_write_started_at is distinct from old.output_write_started_at then
     raise exception using errcode='42501',message='Avatar finalize intent must be atomic';
   end if;
 end if;
 if (new.signing_finished_at is null) <> (new.capability_until is null)
    or new.capability_until < new.signing_finished_at+interval '7200 seconds'
    or (new.output_write_finished_at is not null and new.output_write_started_at is null) then
   raise exception using errcode='42501',message='Avatar receipt invalid';
 end if;
 return new;
end $$;
create trigger account_avatar_manifest_guard_v3 before insert or update or delete
on public.profile_avatar_uploads for each row execute function public.account_avatar_manifest_guard_v3();
alter table public.profile_avatar_uploads disable trigger account_avatar_manifest_guard_v3;

create function private.account_avatar_guards_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from pg_catalog.pg_trigger t
 where t.tgrelid='public.profile_avatar_uploads'::regclass
 and t.tgname='account_avatar_manifest_guard_v3' and t.tgenabled='O' and t.tgtype=31
 and t.tgfoid='public.account_avatar_manifest_guard_v3()'::regprocedure)
 and exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.profile_avatar_uploads'::regclass
 and t.tgname='account_upload_intent_v2' and t.tgenabled='O' and t.tgtype=7
 and t.tgfoid='public.account_guard_owned_write_v2()'::regprocedure);
$$;
create function private.account_avatar_prepare_purge(uid uuid,rid uuid,generation bigint,marker_key text) returns void
language plpgsql security definer set search_path='' as $$
declare req public.account_deletion_requests; cut private.avatar_tracking_cutover;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-lifecycle:'||uid::text,0));
 select * into req from public.account_deletion_requests where request_id=rid for update;
 if req.old_user_id is distinct from uid or req.status<>'PROCESSING' or req.phase<>'cleanup'
    or req.lease_generation is distinct from generation or req.lease_until is null or req.lease_until<=clock_timestamp()
    or not private.account_avatar_guards_ready() then
   raise exception using errcode='42501',message='Avatar purge lease invalid';
 end if;
 select * into cut from private.avatar_tracking_cutover where marker=marker_key for share;
 if cut.marker is null or not cut.legacy_inventory_verified or cut.provider_max_completion_seconds is null
    or cut.provider_max_token_seconds is null or cut.provider_evidence is null or cut.upload_bucket<>'profile-avatar-uploads' or cut.public_bucket<>'profile-avatars'
    or cut.cutover_at+((7200+cut.provider_max_completion_seconds)*interval '1 second')>clock_timestamp()
    or exists(select 1 from public.profile_avatar_uploads where user_id=uid and
      (tracking_version is distinct from 3 or signing_finished_at is null or capability_until is null
       or capability_until+(cut.provider_max_completion_seconds*interval '1 second')>clock_timestamp()
       or source_deleted_at is null or (output_path is not null and
         (output_write_finished_at is null or output_deleted_at is null))))
    or exists(select 1 from private.account_avatar_objects where user_id=uid and deleted_at is null) then
   raise exception using errcode='42501',message='Avatar closure unconfirmed';
 end if;
 update public.account_deletion_requests set progress=jsonb_set(progress,'{avatarPurge}',
   jsonb_build_object('requestId',rid,'owner',uid,'generation',generation,'marker',marker_key)) where request_id=rid;
 -- Keep public manifests until the authorized Auth cascade. This avoids any
 -- session boolean/GUC or role-name bypass for legacy DELETE statements.
end $$;
revoke all on function public.account_avatar_manifest_guard_v3() from public,anon,authenticated;
revoke all on function private.account_avatar_guards_ready() from public,anon,authenticated;
revoke all on function private.account_avatar_prepare_purge(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function private.account_avatar_guards_ready() to service_role;
grant execute on function private.account_avatar_prepare_purge(uuid,uuid,bigint,text) to service_role;
commit;
