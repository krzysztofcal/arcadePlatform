-- #1140 UGC phase D: voluntary Google profile photo. Additive and dark (the endpoint and the readers act only with
-- GOOGLE_PHOTO_IMPORT_ENABLED=1). One row per account: the current decision with its notice version and times.
-- No row means no consent. The photo is imported once into the existing public avatar bucket (no hot-linking) and
-- shown only while the decision is "granted" and the imported key is still the profile's avatar_key.
-- No job, scheduler or notification. The row follows account deletion.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

create table private.profile_photo_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notice_version text not null check (length(notice_version) between 1 and 64),
  decision text not null check (decision in ('granted','withdrawn')),
  consent_revision integer not null default 1 check (consent_revision between 1 and 2147483646),
  granted_at timestamptz not null,
  withdrawn_at timestamptz,
  imported_avatar_key text check (imported_avatar_key ~ '^[0-9a-f-]{36}\.webp$'),
  -- After a withdrawal the key stays only until our copy is deleted from Storage (a failed deletion is retried).
  check ((decision = 'withdrawn') = (withdrawn_at is not null))
);

-- A Google copy written to Storage but not (yet) attached or confirmed deleted: listed before the write and removed
-- only by a successful attach or a confirmed deletion, so a withdrawal can always find and delete it.
create table private.profile_photo_pending_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_key text not null check (avatar_key ~ '^[0-9a-f-]{36}\.webp$'),
  created_at timestamptz not null default now(),
  -- While the write may still land (from listing until its outcome is known, or for a lost or 5xx response) a
  -- confirmed deletion does not unlist it. Same horizon as the avatar manifest capability (2 h).
  uncertain_until timestamptz,
  primary key (user_id, avatar_key)
);

alter table private.profile_photo_consents enable row level security;
alter table private.profile_photo_pending_deletions enable row level security;
revoke all on private.profile_photo_consents, private.profile_photo_pending_deletions from public, anon, authenticated;
grant select, insert, update on private.profile_photo_consents to service_role;
grant select, insert, update, delete on private.profile_photo_pending_deletions to service_role;
commit;
