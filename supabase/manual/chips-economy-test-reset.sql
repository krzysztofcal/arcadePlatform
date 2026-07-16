\set ON_ERROR_STOP on

-- Manual, destructive reset for pre-production CH and poker data.
-- Run only through docs/ch-economy-reset-runbook.md.
-- This file intentionally is not a Supabase migration.

\if :{?reset_target}
\else
  \echo 'ERROR: pass -v reset_target=stage or -v reset_target=prod'
  \quit 3
\endif

\if :{?expected_project_ref}
\else
  \echo 'ERROR: pass -v expected_project_ref=<Supabase project ref>'
  \quit 3
\endif

\if :{?reset_apply}
\else
  \set reset_apply 0
\endif

\if :{?confirm_reset}
\else
  \set confirm_reset NONE
\endif

select :'reset_target' in ('stage', 'prod') as reset_target_valid,
       length(trim(:'expected_project_ref')) > 0 as expected_project_ref_present,
       :'reset_apply' in ('0', '1') as reset_apply_valid
\gset reset_guard_

\if :reset_guard_reset_target_valid
\else
  \echo 'ERROR: reset_target must be stage or prod'
  \quit 3
\endif

\if :reset_guard_expected_project_ref_present
\else
  \echo 'ERROR: expected_project_ref cannot be empty'
  \quit 3
\endif

\if :reset_guard_reset_apply_valid
\else
  \echo 'ERROR: reset_apply must be exactly 0 or 1'
  \quit 3
\endif

\echo 'CH economy reset target:' :reset_target
\echo 'Expected Supabase project ref (validated externally):' :expected_project_ref
\echo 'Apply mode:' :reset_apply

-- Fail before printing counts when the checked-in schema contract is not present.
do $preflight$
declare
  missing_relations text;
  unexpected_fk text;
begin
  select string_agg(relation_name, ', ' order by relation_name)
  into missing_relations
  from (
    values
      ('public.chips_accounts'),
      ('public.chips_transactions'),
      ('public.chips_entries'),
      ('public.chips_account_snapshot'),
      ('public.bonus_campaigns'),
      ('public.bonus_claims'),
      ('public.bonus_campaign_eligible_users'),
      ('public.poker_tables'),
      ('public.poker_seats'),
      ('public.poker_state'),
      ('public.poker_actions'),
      ('public.poker_requests'),
      ('public.poker_hole_cards'),
      ('public.user_profiles'),
      ('auth.users'),
      ('supabase_migrations.schema_migrations')
  ) required(relation_name)
  where to_regclass(relation_name) is null;

  if missing_relations is not null then
    raise exception 'reset_preflight_missing_relations: %', missing_relations;
  end if;

  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '20251221000000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '20251223000000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260117100000'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260707090000'
  ) then
    raise exception 'reset_preflight_required_migration_missing';
  end if;

  if not exists (
    select 1
    from pg_trigger tg
    join pg_class tbl on tbl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public' and tbl.relname = 'chips_entries'
      and tg.tgname = 'chips_entries_block_deletes' and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger tg
    join pg_class tbl on tbl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public' and tbl.relname = 'chips_transactions'
      and tg.tgname = 'chips_transactions_block_deletes' and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger tg
    join pg_class tbl on tbl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public' and tbl.relname = 'chips_entries'
      and tg.tgname = 'chips_entries_assign_sequence_trg' and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger tg
    join pg_class tbl on tbl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public' and tbl.relname = 'chips_accounts'
      and tg.tgname = 'chips_accounts_block_negative_balance_trg' and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) then
    raise exception 'reset_preflight_required_trigger_missing_or_disabled';
  end if;

  select string_agg(format('%I.%I -> %I.%I', src_ns.nspname, src.relname, ref_ns.nspname, ref.relname), ', ')
  into unexpected_fk
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_namespace src_ns on src_ns.oid = src.relnamespace
  join pg_class ref on ref.oid = con.confrelid
  join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
  where con.contype = 'f'
    and ref_ns.nspname = 'public'
    and ref.relname in ('chips_accounts', 'chips_transactions', 'poker_tables')
    and not (
      src_ns.nspname = 'public'
      and src.relname in (
        'chips_entries',
        'chips_account_snapshot',
        'bonus_claims',
        'poker_seats',
        'poker_state',
        'poker_actions',
        'poker_requests',
        'poker_hole_cards'
      )
    );

  if unexpected_fk is not null then
    raise exception 'reset_preflight_unexpected_fk: %', unexpected_fk;
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_namespace src_ns on src_ns.oid = src.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
    where con.contype = 'f'
      and ref_ns.nspname = 'public'
      and ref.relname = 'poker_tables'
      and (src_ns.nspname <> 'public'
        or src.relname not in ('poker_seats', 'poker_state', 'poker_actions', 'poker_requests', 'poker_hole_cards')
        or con.confdeltype <> 'c')
  ) then
    raise exception 'reset_preflight_invalid_poker_cascade';
  end if;
end
$preflight$;

\echo '--- PRE-FLIGHT COUNTS ---'
select 'auth.users' as relation, count(*)::bigint as rows from auth.users
union all select 'public.user_profiles', count(*)::bigint from public.user_profiles
union all select 'public.bonus_campaigns', count(*)::bigint from public.bonus_campaigns
union all select 'public.bonus_campaign_eligible_users', count(*)::bigint from public.bonus_campaign_eligible_users
union all select 'public.bonus_claims', count(*)::bigint from public.bonus_claims
union all select 'public.chips_accounts', count(*)::bigint from public.chips_accounts
union all select 'public.chips_transactions', count(*)::bigint from public.chips_transactions
union all select 'public.chips_entries', count(*)::bigint from public.chips_entries
union all select 'public.chips_account_snapshot', count(*)::bigint from public.chips_account_snapshot
union all select 'public.poker_tables', count(*)::bigint from public.poker_tables
union all select 'public.poker_seats', count(*)::bigint from public.poker_seats
union all select 'public.poker_state', count(*)::bigint from public.poker_state
union all select 'public.poker_actions', count(*)::bigint from public.poker_actions
union all select 'public.poker_requests', count(*)::bigint from public.poker_requests
union all select 'public.poker_hole_cards', count(*)::bigint from public.poker_hole_cards
order by relation;

select account_type, status, count(*)::bigint as accounts, coalesce(sum(balance), 0)::bigint as balance
from public.chips_accounts
group by account_type, status
order by account_type, status;

select
  count(*)::bigint as poker_escrow_accounts,
  count(*) filter (where t.status = 'CLOSED' and a.balance > 0)::bigint as closed_positive_escrow,
  coalesce(sum(a.balance) filter (where t.status = 'CLOSED' and a.balance > 0), 0)::bigint as closed_positive_chips,
  coalesce(max(a.balance) filter (where t.status = 'CLOSED' and a.balance > 0), 0)::bigint as largest_closed_residual
from public.chips_accounts a
left join public.poker_tables t
  on t.id::text = substring(a.system_key from char_length('POKER_TABLE:') + 1)
where a.account_type = 'ESCROW'
  and a.system_key like 'POKER_TABLE:%';

select system_key, account_type, status, balance, next_entry_seq, created_at, updated_at
from public.chips_accounts
where account_type = 'SYSTEM'
order by system_key;

\if :reset_apply
  select :'confirm_reset' = ('RESET_' || upper(:'reset_target') || '_CH_ECONOMY') as confirmation_valid
  \gset reset_confirm_

  \if :reset_confirm_confirmation_valid
  \else
    \echo 'ERROR: apply requires -v confirm_reset=RESET_' :reset_target '_CH_ECONOMY (target upper-case)'
    \quit 3
  \endif

  \echo 'APPLY CONFIRMED. Beginning one-transaction reset for:' :reset_target

  begin;

  lock table
    public.bonus_claims,
    public.poker_hole_cards,
    public.poker_requests,
    public.poker_actions,
    public.poker_state,
    public.poker_seats,
    public.poker_tables,
    public.chips_account_snapshot,
    public.chips_entries,
    public.chips_transactions,
    public.chips_accounts
  in access exclusive mode;

  lock table
    auth.users,
    public.user_profiles,
    public.bonus_campaigns,
    public.bonus_campaign_eligible_users
  in share mode;

  create temporary table reset_preserved_counts (
    relation_name text primary key,
    row_count bigint not null
  ) on commit drop;

  insert into reset_preserved_counts (relation_name, row_count)
  values
    ('auth.users', (select count(*)::bigint from auth.users)),
    ('public.user_profiles', (select count(*)::bigint from public.user_profiles)),
    ('public.bonus_campaigns', (select count(*)::bigint from public.bonus_campaigns)),
    ('public.bonus_campaign_eligible_users', (select count(*)::bigint from public.bonus_campaign_eligible_users));

  delete from public.bonus_claims;
  delete from public.poker_tables;
  delete from public.chips_account_snapshot;

  alter table public.chips_entries disable trigger chips_entries_block_deletes;
  alter table public.chips_transactions disable trigger chips_transactions_block_deletes;

  delete from public.chips_entries;
  delete from public.chips_transactions;
  delete from public.chips_accounts;

  alter table public.chips_entries enable trigger chips_entries_block_deletes;
  alter table public.chips_transactions enable trigger chips_transactions_block_deletes;

  insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
  values
    ('SYSTEM', 'HOUSE', 'active', 0, 1),
    ('SYSTEM', 'GENESIS', 'active', 0, 1),
    ('SYSTEM', 'TREASURY', 'active', 0, 1);

  create temporary table reset_seed_context (
    transaction_id uuid not null,
    genesis_account_id uuid not null,
    treasury_account_id uuid not null
  ) on commit drop;

  with inserted_transaction as (
    insert into public.chips_transactions (
      reference,
      description,
      metadata,
      idempotency_key,
      payload_hash,
      tx_type,
      created_by,
      user_id
    ) values (
      'TREASURY_SEED',
      'Initial treasury funding',
      jsonb_build_object('source', 'GENESIS'),
      'seed:treasury:v1',
      encode(extensions.digest('seed:treasury:v1:1000000'::text, 'sha256'), 'hex'),
      'MINT',
      null,
      null
    )
    returning id
  )
  insert into reset_seed_context (transaction_id, genesis_account_id, treasury_account_id)
  select tx.id, genesis.id, treasury.id
  from inserted_transaction tx
  cross join public.chips_accounts genesis
  cross join public.chips_accounts treasury
  where genesis.account_type = 'SYSTEM' and genesis.system_key = 'GENESIS'
    and treasury.account_type = 'SYSTEM' and treasury.system_key = 'TREASURY';

  update public.chips_accounts
  set balance = case system_key
      when 'GENESIS' then -1000000
      when 'TREASURY' then 1000000
      else balance
    end,
    updated_at = timezone('utc', now())
  where account_type = 'SYSTEM'
    and system_key in ('GENESIS', 'TREASURY');

  insert into public.chips_entries (transaction_id, account_id, amount, metadata)
  select transaction_id, genesis_account_id, -1000000::bigint, jsonb_build_object('source', 'TREASURY_SEED')
  from reset_seed_context
  union all
  select transaction_id, treasury_account_id, 1000000::bigint, jsonb_build_object('source', 'TREASURY_SEED')
  from reset_seed_context;

  set constraints all immediate;

  do $assertions$
  declare
    actual_count bigint;
    changed_relation text;
  begin
    if exists (select 1 from public.poker_tables)
      or exists (select 1 from public.poker_seats)
      or exists (select 1 from public.poker_state)
      or exists (select 1 from public.poker_actions)
      or exists (select 1 from public.poker_requests)
      or exists (select 1 from public.poker_hole_cards) then
      raise exception 'reset_assertion_poker_rows_remain';
    end if;

    if exists (select 1 from public.bonus_claims) then
      raise exception 'reset_assertion_bonus_claims_remain';
    end if;

    select count(*) into actual_count from public.chips_accounts;
    if actual_count <> 3 then
      raise exception 'reset_assertion_account_count: %', actual_count;
    end if;

    if exists (
      select 1 from public.chips_accounts
      where account_type <> 'SYSTEM'
        or status <> 'active'
        or system_key not in ('HOUSE', 'GENESIS', 'TREASURY')
        or user_id is not null
    ) then
      raise exception 'reset_assertion_unexpected_account';
    end if;

    if not exists (
      select 1 from public.chips_accounts
      where system_key = 'HOUSE' and balance = 0 and next_entry_seq = 1
    ) or not exists (
      select 1 from public.chips_accounts
      where system_key = 'GENESIS' and balance = -1000000 and next_entry_seq = 2
    ) or not exists (
      select 1 from public.chips_accounts
      where system_key = 'TREASURY' and balance = 1000000 and next_entry_seq = 2
    ) then
      raise exception 'reset_assertion_system_baseline_invalid';
    end if;

    select count(*) into actual_count from public.chips_transactions;
    if actual_count <> 1 or not exists (
      select 1 from public.chips_transactions
      where idempotency_key = 'seed:treasury:v1'
        and tx_type = 'MINT'
        and reference = 'TREASURY_SEED'
    ) then
      raise exception 'reset_assertion_seed_transaction_invalid';
    end if;

    select count(*) into actual_count from public.chips_entries;
    if actual_count <> 2
      or coalesce((select sum(amount) from public.chips_entries), 1) <> 0 then
      raise exception 'reset_assertion_seed_entries_invalid';
    end if;

    if exists (
      select 1
      from public.chips_accounts a
      left join public.chips_entries e on e.account_id = a.id
      group by a.id, a.balance
      having a.balance <> coalesce(sum(e.amount), 0)
    ) then
      raise exception 'reset_assertion_balance_entry_mismatch';
    end if;

    if (select coalesce(sum(balance), 1) from public.chips_accounts) <> 0 then
      raise exception 'reset_assertion_global_balance_nonzero';
    end if;

    if exists (select 1 from public.chips_account_snapshot) then
      raise exception 'reset_assertion_snapshot_not_empty';
    end if;

    select current_relation
    into changed_relation
    from (
      select 'auth.users' as current_relation,
        (select count(*)::bigint from auth.users) as current_count
      union all select 'public.user_profiles', (select count(*)::bigint from public.user_profiles)
      union all select 'public.bonus_campaigns', (select count(*)::bigint from public.bonus_campaigns)
      union all select 'public.bonus_campaign_eligible_users', (select count(*)::bigint from public.bonus_campaign_eligible_users)
    ) current_counts
    join reset_preserved_counts preserved on preserved.relation_name = current_counts.current_relation
    where preserved.row_count <> current_counts.current_count
    limit 1;

    if changed_relation is not null then
      raise exception 'reset_assertion_preserved_count_changed: %', changed_relation;
    end if;

    if (
      select count(*)
      from pg_trigger tg
      join pg_class tbl on tbl.oid = tg.tgrelid
      join pg_namespace ns on ns.oid = tbl.relnamespace
      where ns.nspname = 'public'
        and not tg.tgisinternal
        and tg.tgenabled <> 'D'
        and (
          (tbl.relname = 'chips_entries' and tg.tgname in (
            'chips_entries_block_updates',
            'chips_entries_block_deletes',
            'chips_entries_assign_sequence_trg'
          ))
          or (tbl.relname = 'chips_transactions' and tg.tgname in (
            'chips_transactions_block_updates',
            'chips_transactions_block_deletes'
          ))
          or (tbl.relname = 'chips_accounts' and tg.tgname = 'chips_accounts_block_negative_balance_trg')
        )
    ) <> 6 then
      raise exception 'reset_assertion_required_trigger_missing_or_disabled';
    end if;
  end
  $assertions$;

  commit;

  -- Post-commit verification deliberately fails the psql command if the committed
  -- baseline is not visible. The runbook then keeps maintenance active and restores backup.
  do $post_commit$
  begin
    if (select count(*) from public.chips_accounts) <> 3
      or (select count(*) from public.chips_transactions) <> 1
      or (select count(*) from public.chips_entries) <> 2
      or exists (select 1 from public.poker_tables)
      or exists (select 1 from public.bonus_claims)
      or (select coalesce(sum(balance), 1) from public.chips_accounts) <> 0 then
      raise exception 'reset_post_commit_verification_failed';
    end if;
  end
  $post_commit$;

  \echo 'RESET COMMITTED AND POST-COMMIT BASELINE VERIFIED FOR:' :reset_target
\else
  \echo 'PRE-FLIGHT ONLY. No rows or schema objects were modified.'
\endif
