-- Additive only. No profile cleanup, Storage I/O, activation, or game/ledger writes.
create schema if not exists private;
grant usage on schema private to service_role;
alter table public.user_profiles
 add column avatar_revision integer not null default 1 check (avatar_revision between 1 and 2147483646),
 add column google_photo_suppressed boolean not null default false;
create table private.profile_terms_policy (
 singleton boolean primary key default true check(singleton),
 version text not null check(length(version) between 1 and 64),
 active boolean not null default false,
 variants_enabled boolean not null default false,
 identity_normalized_at timestamptz
);
insert into private.profile_terms_policy(singleton,version) values(true,'2026-10-26-a1');
create table private.profile_terms_receipts (
 subject_kind text not null check(subject_kind in ('account','guest')),
 subject_id text not null check(length(subject_id) between 1 and 128),
 account_user_id uuid references auth.users(id) on delete cascade,
 terms_version text not null check(length(terms_version) between 1 and 64),
 accepted_at timestamptz not null default statement_timestamp(),
 request_id text not null check(length(request_id) between 8 and 96),
 expires_at timestamptz,
 primary key(subject_kind,subject_id,terms_version),
 unique(subject_kind,subject_id,request_id),
 check((subject_kind='account' and account_user_id is not null and subject_id=account_user_id::text and expires_at is null)
   or (subject_kind='guest' and account_user_id is null and expires_at is not null))
);
create index profile_terms_guest_expiry on private.profile_terms_receipts(expires_at) where expires_at is not null;
alter table private.profile_terms_policy enable row level security;
alter table private.profile_terms_receipts enable row level security;
revoke all on private.profile_terms_policy,private.profile_terms_receipts from public,anon,authenticated;
grant select on private.profile_terms_policy to service_role;
grant select,insert,delete on private.profile_terms_receipts to service_role;
-- Policy remains OFF until independent legal, reader compatibility and owner gates.

create or replace function private.arcade_profile_identity()
returns table(handle text,display_name text) language plpgsql set search_path='' as $$
declare adjectives text[] := array['Apex', 'Blue', 'Bold', 'Bright', 'Cosmic', 'Echo', 'Ember', 'Neon', 'Nova', 'Pixel', 'Rapid', 'Rocket', 'Solar', 'Swift', 'Turbo', 'Ultra', 'Vivid', 'Zen']; nouns text[] := array['Ace', 'Bolt', 'Comet', 'Falcon', 'Fox', 'Nova', 'Orbit', 'Panda', 'Raven', 'Tiger', 'Wave', 'Wizard']; entropy bytea; adjective text; noun text; suffix integer;
begin
 entropy:=pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
 adjective:=adjectives[1+((get_byte(entropy,0)*256+get_byte(entropy,1))%array_length(adjectives,1))];
 noun:=nouns[1+((get_byte(entropy,2)*256+get_byte(entropy,3))%array_length(nouns,1))];
 suffix:=100000+((get_byte(entropy,4)::bigint*16777216+get_byte(entropy,5)::bigint*65536+get_byte(entropy,6)::bigint*256+get_byte(entropy,7)::bigint)%900000)::integer;
 return query select lower(adjective||'-'||noun||'-'||suffix::text),adjective||' '||noun||' '||suffix::text;
end $$;
revoke all on function private.arcade_profile_identity() from public,anon,authenticated;
grant execute on function private.arcade_profile_identity() to service_role;
