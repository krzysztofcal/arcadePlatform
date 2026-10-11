-- #1077 Single Player vs Bots — dedicated table flag and constraint.
-- Forward-only, additive. Local preparation only; publishing triggers DB Stage Apply PR.

alter table public.poker_tables
  add column if not exists is_single_player boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'poker_tables_single_player_chk'
  ) then
    alter table public.poker_tables
      add constraint poker_tables_single_player_chk check (
        (is_single_player is false)
        or (is_single_player is true and lifecycle_kind = 'STANDARD' and created_by is not null)
      );
  end if;
end $$;
