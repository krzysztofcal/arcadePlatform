update public.poker_managed_table_profiles
   set small_blind = 1,
       big_blind = 2,
       updated_at = now()
 where profile_key = 'CONTINUOUS_BOT_DEFAULT'
   and (small_blind, big_blind) is distinct from (1, 2);
