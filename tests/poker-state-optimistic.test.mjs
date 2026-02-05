import assert from "node:assert/strict";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "table-1";

const run = async () => {
  const nextState = { tableId, phase: "INIT", seats: [], stacks: {}, pot: 0 };
  const tx = {
    unsafe: async (query) => {
      const text = String(query).toLowerCase();
      if (text.includes("update public.poker_state set version = version + 1")) {
        return [];
      }
      if (text.includes("select version, state from public.poker_state")) {
        return [{ version: 7, state: JSON.stringify(nextState) }];
      }
      return [];
    },
  };
  const result = await updatePokerStateOptimistic(tx, { tableId, expectedVersion: 1, nextState });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.newVersion, 7);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
