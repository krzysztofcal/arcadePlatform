-- #1018 manual FORCE_RESTRICTED override. Forward-only; the applied #1018
-- policy migration remains immutable. Publishing this file invokes DB Stage
-- Apply PR; Production still requires a separately authorized equivalent.

alter table public.chips_accounts
  drop constraint if exists chips_accounts_poker_access_override_chk;

alter table public.chips_accounts
  add constraint chips_accounts_poker_access_override_chk
  check (poker_access_override in ('AUTO', 'FORCE_NORMAL', 'FORCE_SLOW', 'FORCE_RESTRICTED'));
