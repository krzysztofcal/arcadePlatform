alter table public.poker_requests
add column if not exists payload_hash text;
