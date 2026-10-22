-- Owner accepts the risk of unobserved previously issued upload links.
-- No waiver is enabled by this migration; default behavior remains unchanged.
begin;
alter table private.avatar_tracking_cutover
  add column unobserved_capability_risk_accepted_at timestamptz,
  add constraint avatar_unobserved_risk_after_cutoff check
    (unobserved_capability_risk_accepted_at is null or unobserved_capability_risk_accepted_at>=cutover_at);

create function private.account_avatar_safe_after(marker_key text) returns timestamptz
language sql stable security definer set search_path='' as $$
 select case when c.unobserved_capability_risk_accepted_at between c.cutover_at and clock_timestamp()
   then c.cutover_at else c.cutover_at+interval '7200 seconds' end
 from private.avatar_tracking_cutover c
 where c.marker=marker_key and c.legacy_inventory_verified
   and c.upload_bucket='profile-avatar-uploads' and c.public_bucket='profile-avatars';
$$;
revoke all on function private.account_avatar_safe_after(text) from public,anon,authenticated;
grant execute on function private.account_avatar_safe_after(text) to service_role;

-- Patch only the mandatory global waiting predicate; owner/request/lease,
-- known capability expiry, receipts and ownership checks stay byte-identical.
do $patch$
declare signature text; definition text; needle text; replacement text;
begin
 for signature,needle,replacement in values
 ('private.account_avatar_manifest_reconciled(uuid,uuid,uuid)',
  'c.cutover_at+interval ''7200 seconds''<=clock_timestamp()',
  'private.account_avatar_safe_after(c.marker)<=clock_timestamp()'),
 ('private.account_avatar_reconciliation_plan(uuid,uuid,bigint,text)',
  'cut.cutover_at+interval ''7200 seconds''>clock_timestamp()',
  'coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)'),
 ('private.account_avatar_prepare_purge(uuid,uuid,bigint,text)',
  'cut.cutover_at+interval ''7200 seconds''>clock_timestamp()',
  'coalesce(private.account_avatar_safe_after(marker_key)>clock_timestamp(),true)')
 loop
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  if definition is null or (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Avatar capability policy function drift: %',signature;
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end;
$patch$;
commit;
