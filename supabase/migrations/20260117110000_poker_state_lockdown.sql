ALTER TABLE public.poker_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.poker_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.poker_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.poker_state TO service_role;
