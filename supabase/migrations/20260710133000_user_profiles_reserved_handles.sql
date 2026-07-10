do $$
begin
  if exists (
    select 1
    from public.user_profiles
    where handle in (
      'admin', 'admin-api', 'about', 'account', 'api', 'assets', 'auth', 'contact', 'game', 'games',
      'help', 'leaderboard', 'legal', 'login', 'logout', 'me', 'poker', 'privacy', 'profile', 'register',
      'settings', 'signup', 'static', 'support', 'terms', 'user', 'users', 'xp'
    )
  ) then
    raise exception 'Cannot add user_profiles reserved-handle constraint while reserved handles exist';
  end if;
end $$;

alter table public.user_profiles
  add constraint user_profiles_handle_not_reserved check (handle not in (
    'admin', 'admin-api', 'about', 'account', 'api', 'assets', 'auth', 'contact', 'game', 'games',
    'help', 'leaderboard', 'legal', 'login', 'logout', 'me', 'poker', 'privacy', 'profile', 'register',
    'settings', 'signup', 'static', 'support', 'terms', 'user', 'users', 'xp'
  ));
