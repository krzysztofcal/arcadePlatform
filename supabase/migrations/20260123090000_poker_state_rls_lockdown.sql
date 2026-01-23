-- Lock down poker_state: no direct client reads/writes.
-- Service role (Netlify functions) bypasses RLS; clients must not access this table.
alter table public.poker_state enable row level security;

-- Remove direct grants for client roles (defense-in-depth).
revoke all on table public.poker_state from anon;
revoke all on table public.poker_state from authenticated;

-- Drop any existing policies (ensures no accidental select policy exists).
do $$
declare
  pol record;
begin
  for pol in
    select polname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'poker_state'
  loop
    execute format('drop policy if exists %I on %I.%I;', pol.polname, 'public', 'poker_state');
  end loop;
end $$;
