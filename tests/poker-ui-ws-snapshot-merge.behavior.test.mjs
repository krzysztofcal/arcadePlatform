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

test("same-version snapshots refresh legal actions and hide poker actions that no longer fit the street state", async () => {
  const harness = createPokerTableHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.wsCreates[0].options;
  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 12,
      hand: { handId: "h12", status: "TURN" },
      turn: { userId: "user-1" },
      legalActions: ["CHECK", "BET"],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 50 },
      authoritativeMembers: []
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerActBetBtn.hidden, false, "BET should render when the pot is unopened");
  assert.equal(harness.elements.pokerActRaiseBtn.hidden, true, "RAISE should stay hidden when there is nothing to call");
  assert.equal(harness.elements.pokerActCallBtn.hidden, true, "CALL should stay hidden when there is nothing to call");

  ws.onSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table-1", members: [] },
      version: 12,
      public: {
        hand: { handId: "h12", status: "TURN" },
        turn: { userId: "user-1" },
        legalActions: { actions: ["FOLD", "CALL", "RAISE", "BET"] },
        actionConstraints: { toCall: 10, minRaiseTo: 20, maxRaiseTo: 90, maxBetAmount: 50 }
      }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerActBetBtn.hidden, true, "BET must hide once the player is facing a bet");
  assert.equal(harness.elements.pokerActCallBtn.hidden, false, "CALL should render when there is a bet to call");
  assert.equal(harness.elements.pokerActRaiseBtn.hidden, false, "RAISE should render when the player may legally raise");
});

test("stateSnapshot legal actions stay visible on user turn when stale baseline constraints disagree", async () => {
  const harness = createPokerTableHarness();
  harness.fireDomContentLoaded();
  await harness.flush();

  const ws = harness.wsCreates[0].options;
  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 20,
      hand: { handId: "h20", status: "PREFLOP" },
      turn: { userId: "user-1" },
      legalActions: ["FOLD", "CALL", "RAISE"],
      actionConstraints: { toCall: 2, minRaiseTo: 4, maxRaiseTo: 80, maxBetAmount: null },
      authoritativeMembers: []
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerActCallBtn.hidden, false, "baseline PREFLOP should expose CALL");
  assert.equal(harness.elements.pokerActRaiseBtn.hidden, false, "baseline PREFLOP should expose RAISE");

  ws.onSnapshot({
    kind: "stateSnapshot",
    payload: {
      table: { tableId: "table-1", members: [] },
      version: 21,
      public: {
        hand: { handId: "h20", status: "FLOP" },
        turn: { userId: "user-1" },
        legalActions: { actions: ["CHECK", "BET"] }
      }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerActionsRow.hidden, false, "action row should remain visible when server keeps the turn on the user");
  assert.equal(harness.elements.pokerActCheckBtn.hidden, false, "CHECK should render even if baseline constraints still say there was money to call");
  assert.equal(harness.elements.pokerActBetBtn.hidden, false, "BET should render even if baseline constraints still say there was money to call");
  assert.equal(harness.elements.pokerActCallBtn.hidden, true, "CALL should hide once server switches legal actions to CHECK/BET");
  assert.equal(harness.elements.pokerActRaiseBtn.hidden, true, "RAISE should hide once server switches legal actions to CHECK/BET");
});

test("same-version snapshot removes seat/stack immediately when user is no longer at the table", async () => {
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
      stateVersion: 31,
      hand: { handId: "h31", status: "HAND_DONE" },
      authoritativeMembers: [{ userId: "u-seat", seat: 0 }, { userId: "u-bot", seat: 1 }],
      stacks: { "u-seat": 120, "u-bot": 80 }
    }
  });
  await harness.flush();
  assert.match(harness.elements.pokerYourStack.textContent, /120/, "baseline should show seated user stack");

  ws.onSnapshot({
    kind: "table_state",
    payload: {
      tableId: "table-1",
      stateVersion: 31,
      hand: { handId: "h31", status: "HAND_DONE" },
      authoritativeMembers: [{ userId: "u-bot", seat: 1 }],
      stacks: { "u-bot": 80 }
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerYourStack.textContent, "-", "user stack should disappear immediately after seat removal");
  assert.match(
    harness.elements.pokerError.textContent,
    /removed from the table and cashed out/i,
    "user should see explicit removal message"
  );
});
