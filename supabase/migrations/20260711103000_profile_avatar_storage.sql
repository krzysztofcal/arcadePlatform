insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatar-uploads',
  'profile-avatar-uploads',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  262144,
  array['image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.profile_avatar_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_path text not null unique,
  declared_mime_type text not null,
  declared_size integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint profile_avatar_uploads_size check (declared_size between 1 and 1048576),
  constraint profile_avatar_uploads_mime check (declared_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint profile_avatar_uploads_source_path check (source_path ~ '^pending/[0-9a-f-]{36}$')
);

create index if not exists profile_avatar_uploads_user_created_idx
  on public.profile_avatar_uploads (user_id, created_at desc);

create index if not exists profile_avatar_uploads_expiry_idx
  on public.profile_avatar_uploads (expires_at)
  where consumed_at is null;

alter table public.profile_avatar_uploads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profile_avatar_uploads'
      and policyname = 'deny_all_profile_avatar_uploads'
  ) then
    create policy deny_all_profile_avatar_uploads on public.profile_avatar_uploads
      using (false)
      with check (false);
  end if;
end $$;

revoke all on public.profile_avatar_uploads from anon, authenticated;

drop policy if exists profile_avatar_uploads_client_access on storage.objects;
drop policy if exists profile_avatars_client_insert on storage.objects;
drop policy if exists profile_avatars_client_update on storage.objects;
drop policy if exists profile_avatars_client_delete on storage.objects;
