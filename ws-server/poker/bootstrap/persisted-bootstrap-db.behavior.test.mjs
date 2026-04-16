import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beginSqlWs } from "./persisted-bootstrap-db.mjs";

test("file-backed beginSqlWs leaves persisted file untouched for read-only queries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-begin-sql-readonly-"));
  const filePath = path.join(dir, "persisted-state.json");
  const rawBefore = `{
  "tables": {
    "table_read_only": {
      "tableRow": { "id": "table_read_only", "status": "OPEN", "max_players": 6 },
      "seatRows": [],
      "stateRow": { "version": 1, "state": { "phase": "TURN" } }
    }
  }
}
`;

  try {
    await fs.writeFile(filePath, rawBefore, "utf8");
    const rows = await beginSqlWs(
      (tx) => tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", ["table_read_only"]),
      { env: { WS_PERSISTED_STATE_FILE: filePath } }
    );

    assert.equal(rows?.[0]?.version, 1);
    assert.equal(await fs.readFile(filePath, "utf8"), rawBefore);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("file-backed beginSqlWs persists table mutations back to the store", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-begin-sql-write-"));
  const filePath = path.join(dir, "persisted-state.json");

  try {
    await fs.writeFile(filePath, JSON.stringify({
      tables: {
        table_mutation: {
          tableRow: { id: "table_mutation", status: "OPEN", max_players: 6 },
          seatRows: [],
          stateRow: { version: 3, state: { phase: "TURN" } }
        }
      }
    }, null, 2), "utf8");

    const rows = await beginSqlWs(
      (tx) => tx.unsafe(
        "update public.poker_state set version = version + 1, state = $3::jsonb where table_id = $1 and version = $2 returning version;",
        ["table_mutation", 3, { phase: "RIVER", handId: "hand_4" }]
      ),
      { env: { WS_PERSISTED_STATE_FILE: filePath } }
    );

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(rows?.[0]?.version, 4);
    assert.equal(persisted.tables.table_mutation.stateRow.version, 4);
    assert.deepEqual(persisted.tables.table_mutation.stateRow.state, {
      phase: "RIVER",
      handId: "hand_4"
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
