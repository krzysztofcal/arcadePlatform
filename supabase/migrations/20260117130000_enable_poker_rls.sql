ALTER TABLE public.poker_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poker_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poker_seats_read_own"
  ON public.poker_seats
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "poker_tables_read_if_seated"
  ON public.poker_tables
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.poker_seats s
      WHERE s.table_id = poker_tables.id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "poker_actions_read_if_seated"
  ON public.poker_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.poker_seats s
      WHERE s.table_id = poker_actions.table_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "poker_requests_read_if_seated"
  ON public.poker_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.poker_seats s
      WHERE s.table_id = poker_requests.table_id
        AND s.user_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.poker_tables FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.poker_seats FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.poker_actions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.poker_requests FROM anon, authenticated;
