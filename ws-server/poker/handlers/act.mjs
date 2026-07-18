import { recoverFromPersistConflict } from "../runtime/persist-conflict-recovery.mjs";
import { hashActionCommand, normalizeActionCommand, projectDurableActionResult } from "../idempotency/action-command.mjs";

function mapActReason(reason) {
  if (reason === "illegal_action") return "action_not_allowed";
  if (reason === "hand_mismatch") return "state_invalid";
  if (reason === "not_seated") return "state_invalid";
  return reason;
}

export async function handleActCommand({ frame, ws, connState, tableManager, ensureTableLoadedErrorMapper, sendError, sendCommandResult, persistMutatedState, restoreTableFromPersisted, broadcastResyncRequired, broadcastStateSnapshots, durableActionRequired = false, durableActionStore = null, scheduleSettledRollover = () => {}, scheduleBotStep = () => {}, klog = () => {} }) {
  const tableId = frame.__resolvedTableId;
  const handId = typeof frame.payload?.handId === "string" ? frame.payload.handId.trim() : "";
  const action = typeof frame.payload?.action === "string" ? frame.payload.action.trim().toUpperCase() : "";
  const amount = frame.payload?.amount;

  if (!handId) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires payload.handId",
      requestId: frame.requestId ?? null
    });
    return;
  }

  if (!["FOLD", "CHECK", "CALL", "BET", "RAISE"].includes(action)) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires payload.action of fold/check/call/bet/raise",
      requestId: frame.requestId ?? null
    });
    return;
  }

  if ((action === "BET" || action === "RAISE") && !Number.isInteger(amount)) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires numeric payload.amount for bet/raise",
      requestId: frame.requestId ?? null
    });
    return;
  }

  const ensured = await tableManager.ensureTableLoaded(tableId);
  if (!ensured.ok) {
    const loadError = ensureTableLoadedErrorMapper(ensured);
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: loadError.code || "table_load_failed"
    });
    return;
  }

  const userId = connState.session.userId;
  let payloadHash = null;
  if (durableActionRequired) {
    if (!durableActionStore || typeof durableActionStore.readDurableActionRequest !== "function") {
      sendCommandResult(ws, connState, { requestId: frame.requestId ?? null, tableId, status: "rejected", reason: "durable_action_store_unavailable" });
      return;
    }
    const normalizedCommand = normalizeActionCommand({ tableId, userId, handId, action, amount });
    payloadHash = normalizedCommand ? hashActionCommand(normalizedCommand) : null;
    if (!payloadHash) {
      sendError(ws, connState, { code: "INVALID_COMMAND", message: "act payload cannot be normalized", requestId: frame.requestId ?? null });
      return;
    }
    const durableLookup = await durableActionStore.readDurableActionRequest({ tableId, userId, requestId: frame.requestId, payloadHash });
    if (durableLookup?.outcome === "durable_replay") {
      sendCommandResult(ws, connState, { requestId: frame.requestId ?? null, tableId, ...durableLookup.durableResult });
      return;
    }
    if (durableLookup?.outcome !== "missing") {
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: durableLookup?.reason || durableLookup?.outcome || "durable_action_read_failed"
      });
      return;
    }
  }

  const result = tableManager.applyAction({
    tableId,
    handId,
    userId,
    requestId: frame.requestId,
    action,
    amount,
    nowIso: frame.ts,
    useActionReplayCache: !durableActionRequired
  });

  if (result.accepted && !result.replayed && result.changed) {
    const durableResult = durableActionRequired
      ? projectDurableActionResult({ status: "accepted", reason: mapActReason(result.reason), handId: result.handId || handId, stateVersion: result.stateVersion })
      : null;
    if (durableActionRequired && !durableResult) {
      await restoreTableFromPersisted(tableId);
      sendCommandResult(ws, connState, { requestId: frame.requestId ?? null, tableId, status: "rejected", reason: "durable_action_result_invalid" });
      return;
    }
    const persisted = await persistMutatedState({
      tableId,
      expectedVersion: Number(result.stateVersion) - 1,
      mutationKind: "act",
      acceptedActionAudit: result.acceptedActionAudit
        ? { ...result.acceptedActionAudit, source: "human" }
        : null,
      durableActionRequest: durableActionRequired
        ? { userId, requestId: frame.requestId, payloadHash, result: durableResult }
        : null
    });
    if (durableActionRequired && ["durable_replay", "idempotency_conflict", "invalid"].includes(persisted?.outcome)) {
      const restored = await restoreTableFromPersisted(tableId);
      if (!restored?.ok) {
        if (typeof broadcastResyncRequired === "function") broadcastResyncRequired(tableId, "durable_action_restore_failed");
        sendCommandResult(ws, connState, { requestId: frame.requestId ?? null, tableId, status: "rejected", reason: "durable_action_restore_failed" });
        return;
      }
      const replay = persisted.outcome === "durable_replay" ? persisted.durableResult : null;
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        ...(replay || { status: "rejected", reason: persisted.reason || persisted.outcome })
      });
      return;
    }
    if (!persisted?.ok) {
      await recoverFromPersistConflict({
        tableId,
        restoreTableFromPersisted,
        broadcastStateSnapshots,
        broadcastResyncRequired
      });
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: persisted?.reason || "persist_failed"
      });
      return;
    }
    if (durableActionRequired && persisted.outcome !== "committed") {
      await restoreTableFromPersisted(tableId);
      sendCommandResult(ws, connState, { requestId: frame.requestId ?? null, tableId, status: "rejected", reason: "durable_action_outcome_invalid" });
      return;
    }
  }

  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: result.accepted ? "accepted" : "rejected",
    reason: mapActReason(result.reason)
  });

  if (result.accepted && !result.replayed && result.changed) {
    broadcastStateSnapshots(tableId);
    scheduleSettledRollover(tableId);
    try {
      scheduleBotStep({
        tableId,
        trigger: "act",
        requestId: frame.requestId ?? null,
        frameTs: frame.ts
      });
    } catch (error) {
      klog("ws_act_bot_autoplay_failed", {
        tableId,
        requestId: frame.requestId ?? null,
        message: error?.message || "unknown"
      });
    }
  }
}
