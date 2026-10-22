-- LOCAL PROPOSAL ONLY. Apply only after draining legacy avatar writers.
-- No marker is inserted automatically: operator must inventory historical output
-- orphans, prove ownership, remove/track them, and attest exact bucket provenance.
begin;
alter table public.profile_avatar_uploads
  add column tracking_version integer,
  add column signing_finished_at timestamptz,
  add column capability_until timestamptz,
  add column output_path text,
  add column output_write_started_at timestamptz,
  add column output_write_finished_at timestamptz,
  add column source_deleted_at timestamptz,
  add column output_deleted_at timestamptz;
-- Existing rows remain unknown legacy rows, never silently upgraded as safe.
create schema if not exists private;
create table private.account_avatar_objects (
  user_id uuid not null,
  output_path text not null check (output_path ~ '^[0-9a-f-]{36}\.webp$'),
  deleted_at timestamptz,
  primary key (user_id, output_path)
);
alter table private.account_avatar_objects enable row level security;
revoke all on private.account_avatar_objects from public, anon, authenticated;
grant select, insert, update on private.account_avatar_objects to service_role;
create table private.avatar_tracking_cutover (
  marker text primary key,
  cutover_at timestamptz not null,
  legacy_inventory_verified boolean not null default false,
  upload_bucket text not null check (upload_bucket = 'profile-avatar-uploads'),
  public_bucket text not null check (public_bucket = 'profile-avatars')
);
alter table private.avatar_tracking_cutover enable row level security;
revoke all on private.avatar_tracking_cutover from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on private.avatar_tracking_cutover to service_role;
commit;
