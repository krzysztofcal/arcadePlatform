begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

create table private.poker_table_photo_consents (
  user_id uuid primary key references private.profile_photo_consents(user_id) on delete cascade,
  avatar_key text not null check (avatar_key ~ '^[0-9a-f-]{36}[.]webp$'),
  notice_version text not null check (length(notice_version) between 1 and 64),
  granted_at timestamptz not null default now()
);

alter table private.poker_table_photo_consents enable row level security;
revoke all on private.poker_table_photo_consents from public, anon, authenticated;
grant select, insert, update, delete on private.poker_table_photo_consents to service_role;
create function private.clear_poker_table_photo_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from private.poker_table_photo_consents where user_id = old.user_id;
  return new;
end;
$$;

revoke all on function private.clear_poker_table_photo_consent() from public, anon, authenticated;
create trigger clear_poker_table_photo_consent
after update of decision, imported_avatar_key on private.profile_photo_consents
for each row when (old.decision is distinct from new.decision
  or old.imported_avatar_key is distinct from new.imported_avatar_key)
execute function private.clear_poker_table_photo_consent();

commit;
