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
