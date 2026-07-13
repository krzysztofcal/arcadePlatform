alter table public.user_profiles
  add column if not exists leaderboard_visible boolean not null default true;

create or replace function public.ensure_user_profile(target_user_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.user_profiles%rowtype;
  adjectives constant text[] := array['Apex', 'Blue', 'Bold', 'Bright', 'Cosmic', 'Echo', 'Ember', 'Neon', 'Nova', 'Pixel', 'Rapid', 'Rocket', 'Solar', 'Swift', 'Turbo', 'Ultra', 'Vivid', 'Zen'];
  nouns constant text[] := array['Ace', 'Bolt', 'Comet', 'Falcon', 'Fox', 'Nova', 'Orbit', 'Panda', 'Raven', 'Tiger', 'Wave', 'Wizard'];
  avatar_variants constant text[] := array['comet-blue', 'falcon-orange', 'fox-blue', 'nova-purple', 'orbit-green', 'panda-pink'];
  adjective text;
  noun text;
  suffix integer;
  entropy bytea;
  random_value bigint;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required' using errcode = '22023';
  end if;

  select profile.* into profile_row
  from public.user_profiles as profile
  where profile.user_id = target_user_id;
  if found then return profile_row; end if;

  for attempt in 1..16 loop
    entropy := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    adjective := adjectives[1 + ((get_byte(entropy, 0) * 256 + get_byte(entropy, 1)) % array_length(adjectives, 1))];
    noun := nouns[1 + ((get_byte(entropy, 2) * 256 + get_byte(entropy, 3)) % array_length(nouns, 1))];
    random_value := get_byte(entropy, 4)::bigint * 16777216 + get_byte(entropy, 5)::bigint * 65536 + get_byte(entropy, 6)::bigint * 256 + get_byte(entropy, 7)::bigint;
    suffix := 100000 + (random_value % 900000)::integer;
    profile_row := null;

    insert into public.user_profiles (user_id, handle, display_name, avatar_variant)
    values (
      target_user_id,
      lower(adjective || '-' || noun || '-' || suffix::text),
      adjective || ' ' || noun || ' ' || suffix::text,
      avatar_variants[1 + ((get_byte(entropy, 8) * 256 + get_byte(entropy, 9)) % array_length(avatar_variants, 1))]
    )
    on conflict do nothing
    returning * into profile_row;

    if profile_row.user_id is not null then return profile_row; end if;

    select profile.* into profile_row
    from public.user_profiles as profile
    where profile.user_id = target_user_id;
    if found then return profile_row; end if;
  end loop;

  raise exception 'profile_generation_exhausted' using errcode = 'P0001';
end;
$$;

revoke all on function public.ensure_user_profile(uuid) from public;
grant execute on function public.ensure_user_profile(uuid) to service_role;

create or replace function public.create_user_profile_after_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_user_profile(new.id);
  return new;
end;
$$;

revoke all on function public.create_user_profile_after_signup() from public;

drop trigger if exists create_user_profile_after_signup_trg on auth.users;
create trigger create_user_profile_after_signup_trg
after insert on auth.users
for each row execute function public.create_user_profile_after_signup();

do $$
declare
  account record;
begin
  for account in
    select users.id
    from auth.users as users
    left join public.user_profiles as profiles on profiles.user_id = users.id
    where profiles.user_id is null
  loop
    perform public.ensure_user_profile(account.id);
  end loop;
end;
$$;
