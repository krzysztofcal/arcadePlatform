import test from "node:test";
import assert from "node:assert/strict";
import { createPokerTableHarness } from "./helpers/poker-ui-table-harness.mjs";

test("same-version snapshots preserve and upgrade stack maps instead of dropping seated stack", async () => {
  const harness = createPokerTableHarness({
    initialToken: "aaa." + Buffer.from(JSON.stringify({ sub: "u-seat" })).toString("base64") + ".zzz"
  });
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.wsCreates[0].options;
  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 9,
      hand: { handId: "h9", status: "PREFLOP" },
      authoritativeMembers: [{ userId: "u-seat", seat: 0 }, { userId: "u-bot", seat: 1 }],
      stacks: { "u-seat": 125 }
    }
  });
  await harness.flush();
  assert.match(harness.elements.pokerYourStack.textContent, /125/, "baseline same-version table_state should render seated user stack");

  ws.onSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table-1", members: [{ userId: "u-seat", seat: 0 }, { userId: "u-bot", seat: 1 }] },
      version: 9,
      you: { seat: 0 },
      public: {
        hand: { handId: "h9", status: "PREFLOP" },
        stacks: {}
      }
    }
  });
  await harness.flush();
  assert.match(harness.elements.pokerYourStack.textContent, /125/, "equal-version stateSnapshot with empty stacks must not wipe known seated stack");

  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 9,
      authoritativeMembers: [{ userId: "u-seat", seat: 0 }, { userId: "u-bot", seat: 1 }],
      stacks: { "u-seat": 130 }
    }
  });
  await harness.flush();
  assert.match(harness.elements.pokerYourStack.textContent, /130/, "same-version table_state with same keys but changed seated stack value should apply");

  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 9,
      authoritativeMembers: [{ userId: "u-seat", seat: 0 }, { userId: "u-bot", seat: 1 }],
      stacks: { "u-seat": 130, "u-bot": 138 }
    }
  });
  await harness.flush();
  assert.match(harness.elements.pokerYourStack.textContent, /130/, "same-version richer stack map should still apply after same-key stack upgrade");

  const seatedStackMissingLogs = harness.logs.filter((entry) => entry.kind === "poker_stack_missing_for_seated_user");
  assert.equal(seatedStackMissingLogs.length, 0, "no seated-user stack-missing warning expected after same-version merge");
});
