// Check on each request/transaction so a separately authorized migration takes effect live.
export async function supportsPokerHourlyRefillCaps(runSql) {
  const rows = await runSql(`
select count(*) = 2 as supported
from information_schema.columns
where table_schema = 'public' and table_name = 'poker_bot_tier_policy'
  and column_name in ('normal_hourly_refill_cap_ch', 'slow_hourly_refill_cap_ch');
`);
  return rows?.[0]?.supported === true;
}
