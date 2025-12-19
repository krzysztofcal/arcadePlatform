create or replace function public.raise_insufficient_funds()
returns void
language plpgsql
as $$
begin
  raise exception 'insufficient_funds';
end;
$$;
