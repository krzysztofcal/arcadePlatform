-- LOCAL FORWARD PROPOSAL ONLY. Apply after wallet-retirement-v2, under separate GO.
-- No retention period, policy, ledger entry, payload hash or receipt is rewritten.
begin;
create function public.chips_retention_user_matches_v2(account public.chips_accounts, owner_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select account.account_type::text = 'USER' and owner_id is not null
    and account.system_key is null and (
      (account.status::text = 'active' and account.user_id = owner_id
        and account.retired_user_id is null and account.retired_at is null)
      or (account.status::text = 'closed' and account.user_id is null
        and account.retired_user_id = owner_id and account.retired_at is not null
        and account.balance = 0)
    ) is true
$$;
revoke all on function public.chips_retention_user_matches_v2(public.chips_accounts,uuid) from public,anon,authenticated;
grant execute on function public.chips_retention_user_matches_v2(public.chips_accounts,uuid) to service_role, chips_ledger_archive_pruner;

-- Patch only the human branch in the CURRENT function, retaining subsequent
-- #981 registry-cleaned retry behavior and all installed policy/receipt guards.
-- Exact matches fail closed on an unexpected definition; no migration is edited.
-- Follow the existing archive-function migration pattern: replace as the
-- established owner, retaining SECURITY DEFINER owner and execution ACLs.
-- CREATE is transaction-local in effect: revoked before COMMIT, never exposed.
do $pruner_access$
declare membership jsonb;
begin
 select to_jsonb(m) into membership from pg_auth_members m
 where m.roleid='chips_ledger_archive_pruner'::regrole and m.member=current_user::regrole
   and m.grantor=current_user::regrole;
 perform set_config('arcade1117.pruner_membership',coalesce(membership::text,'null'),true);
 perform set_config('arcade1117.pruner_create',has_schema_privilege('chips_ledger_archive_pruner','public','CREATE')::text,true);
 execute format('grant chips_ledger_archive_pruner to %I with set true',current_user);
end $pruner_access$;
grant create on schema public to chips_ledger_archive_pruner;
set local role chips_ledger_archive_pruner;
do $retention_patch$
declare
  definition text;
  needle text := $needle$                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')$needle$;
  replacement text := $replacement$                    and public.chips_retention_user_matches_v2(accounts, selected.user_id)
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active'
               or public.chips_retention_user_matches_v2(accounts, selected.user_id))$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
    or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,needle,''))) / pg_catalog.length(needle) <> 1
    or pg_catalog.strpos(definition,'is_closed_human') = 0
    or pg_catalog.strpos(definition,'Archive batch registry identity is incomplete or inconsistent') = 0 then
    raise exception 'Issue #1117 requires the current closed-human-aware archive pruner';
  end if;
  execute pg_catalog.replace(definition,needle,replacement);
end;
$retention_patch$;
reset role;
do $restore_pruner_access$
declare membership jsonb := current_setting('arcade1117.pruner_membership')::jsonb;
begin
 if not current_setting('arcade1117.pruner_create')::boolean then
   revoke create on schema public from chips_ledger_archive_pruner;
 end if;
 if membership='null'::jsonb then
   execute format('revoke chips_ledger_archive_pruner from %I',current_user);
 else
   execute format('grant chips_ledger_archive_pruner to %I with set %s',current_user,membership->>'set_option');
 end if;
end $restore_pruner_access$;
commit;
