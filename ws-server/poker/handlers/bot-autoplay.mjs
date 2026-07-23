const BOT_AUTOPLAY_SAME_STATE_INVARIANT_FAILURES = new Set([
  "showdown_incomplete_community",
  "showdown_missing_hole_cards",
  "not_enough_cards",
  "state_invalid",
]);
const BOT_AUTOPLAY_DEDUPED_FAILURE_LOG_KINDS = new Set([
  "poker_act_bot_autoplay_step_error",
  "ws_bot_autoplay_failed"
]);
const BOT_AUTOPLAY_TERMINAL_LOG_KIND = "ws_bot_timeout_safety_same_state_retry_suppressed";

function asLogValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function failureReason(data) {
  return asLogValue(data?.error) || asLogValue(data?.reason) || "unknown";
}

function failureFingerprint(kind, data) {
  return [
    kind,
    asLogValue(data?.tableId),
    asLogValue(data?.handId),
    Number.isFinite(Number(data?.stateVersion ?? data?.lastKnownStateVersion))
      ? Number(data?.stateVersion ?? data?.lastKnownStateVersion)
      : "",
    asLogValue(data?.turnUserId ?? data?.lastKnownTurnUserId),
    failureReason(data)
  ].join(":");
}

export function createBotAutoplayObservability({
  klog = () => {},
  now = Date.now,
  summaryIntervalMs = 60_000,
  maxFingerprints = 1_000
} = {}) {
  const seenFingerprints = new Set();
  const countsByReason = new Map();
  let windowStartedAt = now();

  const flush = (trigger = "interval") => {
    if (countsByReason.size === 0) return false;
    const counts = {};
    let total = 0;
    let logged = 0;
    let suppressed = 0;
    for (const reason of [...countsByReason.keys()].sort()) {
      const entry = countsByReason.get(reason);
      counts[reason] = { ...entry };
      total += entry.total;
      logged += entry.logged;
      suppressed += entry.suppressed;
    }
    const endedAt = now();
    klog("ws_bot_autoplay_failure_summary", {
      trigger,
      windowMs: Math.max(0, endedAt - windowStartedAt),
      total,
      logged,
      suppressed,
      countsByReason: counts
    });
    countsByReason.clear();
    seenFingerprints.clear();
    windowStartedAt = endedAt;
    return true;
  };

  const log = (kind, data) => {
    const nowMs = now();
    if (nowMs - windowStartedAt >= summaryIntervalMs) {
      flush("interval");
    }
    if (kind === BOT_AUTOPLAY_TERMINAL_LOG_KIND) {
      klog(kind, data);
      flush("terminal");
      return true;
    }
    if (!BOT_AUTOPLAY_DEDUPED_FAILURE_LOG_KINDS.has(kind)) {
      klog(kind, data);
      return true;
    }

    const reason = failureReason(data);
    const fingerprint = failureFingerprint(kind, data);
    const alreadySeen = seenFingerprints.has(fingerprint);
    if (!alreadySeen && seenFingerprints.size >= maxFingerprints) {
      flush("capacity");
    }
    const previous = countsByReason.get(reason) || { total: 0, logged: 0, suppressed: 0 };
    previous.total += 1;
    if (!alreadySeen) {
      seenFingerprints.add(fingerprint);
      previous.logged += 1;
      countsByReason.set(reason, previous);
      klog(kind, data);
      return true;
    }
    previous.suppressed += 1;
    countsByReason.set(reason, previous);
    return false;
  };

  return { flush, log };
}

export function shouldSuppressBotTimeoutSafetyRetry(result) {
  const reason = typeof result?.reason === "string" ? result.reason.trim() : "";
  return result?.ok === false
    && result?.changed !== true
    && BOT_AUTOPLAY_SAME_STATE_INVARIANT_FAILURES.has(reason);
}

export function matchesBotTimeoutSafetySuppression(suppressed, current) {
  if (!suppressed || !current) return false;
  return suppressed.tableId === current.tableId
    && suppressed.handId === current.handId
    && suppressed.stateVersion === current.stateVersion
    && suppressed.turnUserId === current.turnUserId;
}

export function shouldClearBotTimeoutSafetySuppression(result) {
  return result?.ok === true && result?.changed === true;
}

export async function handleBotStepCommand({
  tableId,
  trigger,
  requestId = null,
  frameTs = null,
  runBotStep,
  broadcastStateSnapshots,
  klog = () => {}
}) {
  let botStepResult = { ok: true, changed: false, actionCount: 0, reason: "not_attempted" };
  try {
    botStepResult = await runBotStep({
      tableId,
      trigger,
      requestId,
      frameTs
    });
  } catch (error) {
    botStepResult = {
      ok: false,
      changed: false,
      actionCount: 0,
      reason: error?.message || "autoplay_failed"
    };
    klog("ws_bot_autoplay_command_failed", {
      tableId,
      trigger: trigger || null,
      requestId: requestId || null,
      message: error?.message || "unknown"
    });
  }

  klog("ws_bot_autoplay_finish", {
    tableId,
    trigger: trigger || null,
    requestId: requestId || null,
    ok: botStepResult?.ok !== false,
    changed: botStepResult?.changed === true,
    actionCount: Number(botStepResult?.actionCount || 0),
    reason: botStepResult?.reason || "unknown",
    phase: typeof botStepResult?.phase === "string" ? botStepResult.phase : null,
    turnUserId: typeof botStepResult?.turnUserId === "string" ? botStepResult.turnUserId : null,
    finalStateVersion: Number.isFinite(Number(botStepResult?.finalStateVersion))
      ? Number(botStepResult.finalStateVersion)
      : null,
    shouldContinue: botStepResult?.shouldContinue === true
  });

  const lastBroadcastStateVersion = Number(botStepResult?.lastBroadcastStateVersion);
  const finalStateVersion = Number(botStepResult?.finalStateVersion);
  const finalStateAlreadyBroadcast =
    Number.isFinite(lastBroadcastStateVersion)
    && Number.isFinite(finalStateVersion)
    && lastBroadcastStateVersion === finalStateVersion;
  if (botStepResult?.ok === false || (botStepResult?.changed === true && !finalStateAlreadyBroadcast)) {
    broadcastStateSnapshots(tableId);
  }
  return botStepResult;
}

export const handleBotAutoplayCommand = handleBotStepCommand;
