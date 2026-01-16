-- Fix v_user_chips_entries to use security invoker semantics and add minimal select policies.

-- Recreate view with security invoker semantics.
drop view if exists public.v_user_chips_entries;
create view public.v_user_chips_entries
with (security_invoker = true)
as
select e.*
from public.chips_entries e
join public.chips_accounts a on a.id = e.account_id
where a.account_type = 'USER'
  and a.user_id = auth.uid();

-- Policy: chips_accounts select own user accounts.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chips_accounts'
      and policyname = 'chips_accounts_select_own_user'
  ) then
    create policy chips_accounts_select_own_user
      on public.chips_accounts
      for select
      using (account_type = 'USER' and user_id = auth.uid());
  end if;
end $$;

-- Policy: chips_entries select only entries for own user accounts.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chips_entries'
      and policyname = 'chips_entries_select_own_user'
  ) then
    create policy chips_entries_select_own_user
      on public.chips_entries
      for select
      using (
        exists (
          select 1
          from public.chips_accounts a
          where a.id = chips_entries.account_id
            and a.account_type = 'USER'
            and a.user_id = auth.uid()
        )
      );
  end if;
end $$;

-- Grants required for security-invoker view access.
grant select on public.v_user_chips_entries to authenticated;
grant select on public.chips_accounts to authenticated;
grant select on public.chips_entries to authenticated;
