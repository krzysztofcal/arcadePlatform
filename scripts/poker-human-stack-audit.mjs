import { beginSqlWs } from "../ws-server/poker/bootstrap/persisted-bootstrap-db.mjs";
import { klog } from "../ws-server/poker/persistence/sql-admin.mjs";
import { resolveAuthoritativeHumanStack } from "../shared/poker-domain/human-stack-accounting.mjs";

const MAX_ROWS = 500;

function parseState(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const rows = await beginSqlWs((tx) => tx.unsafe(
  `select t.id as table_id, s.user_id, s.seat_no, s.stack as seat_stack, ps.version as state_version, ps.state
   from public.poker_tables t
   join public.poker_seats s on s.table_id = t.id
   left join public.poker_state ps on ps.table_id = t.id
   where t.status = 'OPEN' and s.status = 'ACTIVE' and s.is_bot = false
   order by t.id, s.seat_no
   limit $1;`,
  [MAX_ROWS]
));

const LIVE_HAND_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);
const findings = [];
let liveProjectionDrift = 0;
for (const row of rows || []) {
  const state = parseState(row.state);
  const evidence = resolveAuthoritativeHumanStack({ state, userId: row.user_id });
  const seatStack = Number(row.seat_stack);
  if (!evidence.ok) {
    findings.push({ tableId: row.table_id, seatNo: Number(row.seat_no), stateVersion: Number(row.state_version) || null, reason: evidence.reason, seatStack: Number.isInteger(seatStack) ? seatStack : null });
    continue;
  }
  if (!Number.isInteger(seatStack) || seatStack !== evidence.amount) {
    const phase = String(state?.phase || state?.status || "").trim().toUpperCase();
    if (LIVE_HAND_PHASES.has(phase)) {
      liveProjectionDrift += 1;
      continue;
    }
    findings.push({ tableId: row.table_id, seatNo: Number(row.seat_no), stateVersion: Number(row.state_version) || null, reason: "seat_projection_mismatch", authoritativeStack: evidence.amount, seatStack: Number.isInteger(seatStack) ? seatStack : null });
  }
}

klog("poker_human_stack_audit", {
  mode: "read_only",
  scanned: Array.isArray(rows) ? rows.length : 0,
  findings: findings.length,
  liveProjectionDrift,
  truncated: Array.isArray(rows) && rows.length >= MAX_ROWS,
  samples: findings.slice(0, 50)
});
