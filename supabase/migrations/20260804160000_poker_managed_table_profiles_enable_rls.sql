-- Continuous-table profile is a backend-only control record.
-- WS accesses it through the existing direct PostgreSQL connection; no
-- PostgREST policy is required or intended for anon/authenticated clients.
alter table public.poker_managed_table_profiles enable row level security;
