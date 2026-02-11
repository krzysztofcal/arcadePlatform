export const createPokerTableWithState = async (tx, { userId, maxPlayers, stakesJson }) => {
  const tableRows = await tx.unsafe(
    `
insert into public.poker_tables (stakes, max_players, status, created_by, updated_at, last_activity_at)
values ($1::jsonb, $2, 'OPEN', $3, now(), now())
returning id;
    `,
    [stakesJson, maxPlayers, userId]
  );
  const tableId = tableRows?.[0]?.id || null;
  if (!tableId) {
    throw new Error("poker_table_insert_failed");
  }

  const state = {
    tableId,
    phase: "INIT",
    seats: [],
    stacks: {},
    pot: 0,
    community: [],
    communityDealt: 0,
    dealerSeatNo: 0,
    turnUserId: null,
    handId: "",
    handSeed: "",
    toCallByUserId: {},
    betThisRoundByUserId: {},
    actedThisRoundByUserId: {},
    foldedByUserId: {},
    contributionsByUserId: {},
    lastAggressorUserId: null,
    lastActionRequestIdByUserId: {},
    showdown: null,
    sidePots: null,
    turnNo: 0,
  };
  await tx.unsafe(
    "insert into public.poker_state (table_id, version, state) values ($1, 0, $2::jsonb);",
    [tableId, JSON.stringify(state)]
  );

  const escrowSystemKey = `POKER_TABLE:${tableId}`;
  const escrowRows = await tx.unsafe(
    `
with inserted as (
  insert into public.chips_accounts (account_type, system_key, status)
  values ('ESCROW', $1, 'active')
  on conflict (system_key) do nothing
  returning id
)
select id from inserted
union all
select id from public.chips_accounts where system_key = $1
limit 1;
    `,
    [escrowSystemKey]
  );
  const escrowId = escrowRows?.[0]?.id || null;
  if (!escrowId) {
    throw new Error("poker_escrow_missing");
  }

  return { tableId };
};
