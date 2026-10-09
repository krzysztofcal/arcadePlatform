-- #1042 Production equivalent: separate owner GO required. Empty schema only.
begin;
do $$ begin
  if current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
     or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058' then
    raise exception 'Production identity mismatch';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261004222426') then
    raise exception 'Production gift receipt migration already recorded';
  end if;
end $$;
-- #1042: empty backend-only receipt schema. No receipts, ledger writes or CH changes.
create table public.poker_gift_purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_key text not null unique check (length(purchase_key) between 1 and 128),
  payment_source text not null check (payment_source = 'CH'),
  payment_reference text not null check (length(payment_reference) > 0),
  buyer_user_id uuid not null,
  sender_seat_no int not null check (sender_seat_no > 0),
  sender_joined_at timestamptz not null,
  recipient_user_id uuid not null,
  recipient_seat_no int not null check (recipient_seat_no > 0),
  recipient_joined_at timestamptz not null,
  table_id uuid not null,
  gift_key text not null check (gift_key in ('coffee','beer','whisky','pizza','cake','diamond')),
  amount_ch bigint not null check (amount_ch > 0 and amount_ch <= 9007199254740991),
  created_at timestamptz not null default now()
);
alter table public.poker_gift_purchases enable row level security;
revoke all on public.poker_gift_purchases from public, anon, authenticated;
grant select, insert on public.poker_gift_purchases to service_role;
create index poker_gift_purchases_cooldown_idx on public.poker_gift_purchases (table_id, buyer_user_id, created_at desc);
create index poker_gift_purchases_participation_idx on public.poker_gift_purchases (table_id, recipient_user_id, recipient_seat_no, recipient_joined_at);

insert into supabase_migrations.schema_migrations(version) values ('20261004222426');
commit;
