ALTER TABLE public.poker_hole_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.poker_hole_cards FROM anon, authenticated;
REVOKE ALL ON TABLE public.poker_hole_cards FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.poker_hole_cards TO service_role;
