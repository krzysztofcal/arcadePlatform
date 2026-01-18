with ranked_requests as (
  select
    ctid,
    row_number() over (
      partition by table_id, request_id
      order by created_at desc nulls last, ctid desc
    ) as rn
  from public.poker_requests
  where table_id is not null and request_id is not null
)
delete from public.poker_requests
where ctid in (select ctid from ranked_requests where rn > 1);

create unique index if not exists poker_requests_table_id_request_id_key
  on public.poker_requests (table_id, request_id);
