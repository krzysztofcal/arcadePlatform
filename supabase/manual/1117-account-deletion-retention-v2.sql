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
commit;
