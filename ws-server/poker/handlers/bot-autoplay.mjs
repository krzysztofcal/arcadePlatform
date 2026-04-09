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

  if (botStepResult?.ok === false || botStepResult?.changed === true) {
    broadcastStateSnapshots(tableId);
  }
  return botStepResult;
}

export const handleBotAutoplayCommand = handleBotStepCommand;
