-- Add has_human_participant marker to poker_tables.
-- One-way flag: false -> true, never reverted.
-- Used by action history retention to distinguish bot-only tables
-- (short retention) from tables with human gameplay (long retention).

alter table public.poker_tables
  add column if not exists has_human_participant boolean not null default false;

-- Backfill 1: current human seats
update public.poker_tables t
   set has_human_participant = true
 where t.has_human_participant = false
   and exists (
     select 1 from public.poker_seats s
      where s.table_id = t.id
        and s.is_bot is not true
   );

-- Backfill 2: historical human gameplay requests.
-- poker_requests with kind IN ('JOIN','LEAVE','ACT','REBUY')
-- are only created by human players; bots bypass the request pipeline.
update public.poker_tables t
   set has_human_participant = true
 where t.has_human_participant = false
   and exists (
     select 1 from public.poker_requests r
      where r.table_id = t.id
        and r.kind in ('JOIN', 'LEAVE', 'ACT', 'REBUY')
      limit 1
   );

-- Backfill 3: table creator who also played (has non-ADMIN actions).
update public.poker_tables t
   set has_human_participant = true
 where t.has_human_participant = false
   and t.created_by is not null
   and exists (
     select 1 from public.poker_actions a
      where a.table_id = t.id
        and a.user_id = t.created_by
        and a.action_type not like 'ADMIN_%'
      limit 1
   );
