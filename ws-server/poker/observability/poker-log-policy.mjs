const POKER_LOG_SEVERITIES = Object.freeze(["DEBUG", "INFO", "WARN", "ERROR"]);
const POKER_LOG_CATEGORIES = Object.freeze([
  "runtime",
  "transport",
  "session",
  "table_lifecycle",
  "gameplay",
  "autoplay",
  "persistence",
  "recovery",
  "janitor",
  "settlement",
  "accounting",
  "ledger",
  "http",
  "admin",
  "deployment"
]);

const severitySet = new Set(POKER_LOG_SEVERITIES);
const categorySet = new Set(POKER_LOG_CATEGORIES);
const policyByEventName = new Map();

function register(severity, category, eventNames) {
  if (!severitySet.has(severity) || !categorySet.has(category)) {
    throw new Error("invalid_poker_log_policy");
  }
  for (const eventName of eventNames) {
    if (policyByEventName.has(eventName)) {
      throw new Error(`duplicate_poker_log_policy:${eventName}`);
    }
    policyByEventName.set(eventName, Object.freeze({ severity, category, classified: true }));
  }
}

register("DEBUG", "autoplay", [
  "poker_leave_bot_autoplay_loop",
  "ws_bot_autoplay_action_chosen",
  "ws_bot_autoplay_apply_result",
  "ws_bot_autoplay_apply_start",
  "ws_bot_autoplay_decision",
  "ws_bot_autoplay_loop_start",
  "ws_bot_autoplay_loop_stop",
  "ws_bot_autoplay_persist_result",
  "ws_bot_autoplay_persist_start",
  "ws_bot_autoplay_reaction_delay",
  "ws_bot_autoplay_showdown_preflight",
  "ws_bot_autoplay_state_after_step",
  "ws_bot_autoplay_turn_snapshot",
  "ws_observed_bot_turn_autoplay_scheduled"
]);

register("DEBUG", "janitor", [
  "ws_open_table_reconciler_batch_selected",
  "ws_table_janitor_evaluation_coalesced"
]);

register("DEBUG", "persistence", [
  "ws_state_persist_result",
  "ws_state_persist_start",
  "ws_state_update_result",
  "ws_state_update_start"
]);

register("DEBUG", "recovery", [
  "ws_restore_outcome",
  "ws_restore_start"
]);

register("DEBUG", "settlement", [
  "ws_settled_reveal_pending_check",
  "ws_settled_rollover_outcome",
  "ws_settled_rollover_scheduled",
  "ws_settled_rollover_start"
]);

register("DEBUG", "table_lifecycle", [
  "poker_leave_already_left_noop",
  "poker_leave_autoplay_skipped",
  "poker_rebuy_replayed",
  "ws_guest_table_cleanup_cancelled",
  "ws_guest_table_cleanup_scheduled",
  "ws_join_authoritative_result",
  "ws_join_authoritative_start"
]);

register("INFO", "accounting", [
  "poker_leave_cashout",
  "poker_terminal_accounting_closed"
]);

register("INFO", "admin", [
  "ws_bot_claims_recovery_outcome",
  "ws_preview_bot_reaction_updated"
]);

register("INFO", "deployment", [
  "ws_artifact_start",
  "ws_listening"
]);

register("INFO", "persistence", [
  "ws_hand_settlement_audit_written",
  "ws_hole_cards_persist_written"
]);

register("INFO", "session", [
  "ws_invalidated_prior_socket",
  "ws_session_rebound"
]);

register("INFO", "settlement", [
  "poker_hand_settled"
]);

register("INFO", "table_lifecycle", [
  "poker_deferred_leaves_finalized",
  "poker_leave_advanced",
  "poker_leave_retained_live_hand",
  "poker_rebuy_committed",
  "ws_guest_table_evicted"
]);

register("WARN", "autoplay", [
  "ws_bot_autoplay_failure_summary",
  "ws_bot_autoplay_fallback_action",
  "ws_bot_timeout_safety_autoplay"
]);

register("WARN", "janitor", [
  "poker_inactive_cleanup_live_hand_preserved",
  "poker_inactive_cleanup_stale_live_hand_closing",
  "poker_inactive_cleanup_table_close_skipped_human_presence",
  "ws_disconnect_cleanup_deferred",
  "ws_disconnect_cleanup_protected",
  "ws_disconnect_cleanup_retry",
  "ws_table_janitor_terminal_failure_suppression_activated",
  "ws_table_janitor_terminal_failure_suppression_summary"
]);

register("WARN", "persistence", [
  "ws_hole_cards_persist_skipped"
]);

register("WARN", "recovery", [
  "poker_settlement_backfilled",
  "ws_join_authoritative_ledger_fallback",
  "ws_turn_timeout_quarantine_force_hand_done_skipped",
  "ws_turn_timeout_quarantine_recovered",
  "ws_turn_timeout_table_quarantined"
]);

register("WARN", "session", [
  "ws_invalidate_before_close",
  "ws_invalidating_stale_socket",
  "ws_stale_session_socket_rejected",
  "ws_transport_watchdog_terminated"
]);

register("WARN", "settlement", [
  "ws_settled_rollover_close_skipped_human_presence"
]);

register("WARN", "table_lifecycle", [
  "poker_leave_conflict",
  "poker_leave_request_retained",
  "poker_leave_table_close_skipped_human_presence",
  "shared_join_reclaimed_inactive_seat_conflict",
  "shared_join_seat_retry",
  "ws_join_authoritative_buyin_duplicate_idempotency"
]);

register("ERROR", "accounting", [
  "poker_terminal_accounting_invariant_failed"
]);

register("ERROR", "autoplay", [
  "poker_act_bot_autoplay_step_error",
  "ws_act_bot_autoplay_failed",
  "ws_bot_autoplay_command_failed",
  "ws_bot_autoplay_executor_unavailable",
  "ws_bot_autoplay_failed",
  "ws_bot_autoplay_no_fallback_action",
  "ws_bot_autoplay_showdown_input_missing",
  "ws_bot_autoplay_step_broadcast_failed",
  "ws_bot_autoplay_unavailable",
  "ws_join_bootstrap_bot_autoplay_failed",
  "ws_leave_schedule_bot_step_failed",
  "ws_observed_bot_turn_autoplay_failed",
  "ws_rebuy_schedule_bot_step_failed",
  "ws_settled_rollover_bot_autoplay_failed",
  "ws_start_hand_bot_autoplay_failed",
  "ws_timeout_bot_autoplay_failed"
]);

register("ERROR", "janitor", [
  "poker_inactive_cleanup_stack_ambiguous",
  "ws_inactive_cleanup_failed",
  "ws_inactive_cleanup_unavailable",
  "ws_open_table_reconciler_list_failed",
  "ws_stale_seat_cleanup_list_failed",
  "ws_table_janitor_snapshot_failed",
  "ws_zombie_cleanup_list_failed"
]);

register("ERROR", "ledger", [
  "chips_apply_mismatch"
]);

register("ERROR", "persistence", [
  "ws_accepted_action_audit_failed",
  "ws_durable_action_read_error",
  "ws_hand_settlement_audit_failed",
  "ws_hole_cards_persist_failed",
  "ws_persisted_state_write_error",
  "ws_state_persist_failed",
  "ws_state_update_invalid",
  "ws_touch_persisted_seat_failed"
]);

register("ERROR", "recovery", [
  "ws_bot_claims_recovery_failed",
  "ws_deferred_leave_finalization_failed",
  "ws_join_restore_invalid",
  "ws_leave_restore_rejected",
  "ws_persisted_bootstrap_live_hand_rejected",
  "ws_rebuy_runtime_restore_failed",
  "ws_restore_failed",
  "ws_state_restore_failed",
  "ws_turn_timeout_quarantine_cleanup_failed",
  "ws_turn_timeout_quarantine_force_hand_done_failed",
  "ws_turn_timeout_quarantine_restore_failed"
]);

register("ERROR", "runtime", [
  "ws_error",
  "ws_message_processing_error",
  "ws_table_command_failed",
  "ws_table_command_queue_unhandled",
  "ws_uncaught_exception",
  "ws_unhandled_rejection"
]);

register("ERROR", "http", [
  "ws_http_request_failed"
]);

register("ERROR", "admin", [
  "ws_preview_bot_reaction_failed"
]);

register("ERROR", "session", [
  "ws_invalidated_prior_socket_error"
]);

register("ERROR", "settlement", [
  "poker_showdown_no_eligible",
  "ws_settled_reveal_pending_check_failed",
  "ws_settled_rollover_deferred_leave_failed",
  "ws_settled_rollover_persist_failed"
]);

register("ERROR", "table_lifecycle", [
  "poker_join_bot_seed_failed",
  "poker_join_bot_seed_skip_invalid_stakes",
  "poker_leave_invalid_reducer_state",
  "poker_leave_post_hand_stack_ambiguous",
  "poker_leave_reducer_throw",
  "poker_leave_stack_ambiguous",
  "poker_leave_stack_missing",
  "poker_leave_stack_negative",
  "ws_join_attach_failed",
  "ws_join_authoritative_failed",
  "ws_join_authoritative_unavailable",
  "ws_leave_authoritative_failed",
  "ws_leave_authoritative_unavailable",
  "ws_rebuy_authoritative_failed",
  "ws_rebuy_authoritative_unavailable"
]);

register("ERROR", "transport", [
  "ws_transport_watchdog_terminate_failed"
]);

register("WARN", "gameplay", [
  "ws_table_snapshot_empty_legal_actions",
  "ws_table_snapshot_timeout_apply_skipped"
]);

register("ERROR", "gameplay", [
  "ws_table_snapshot_error"
]);

const cleanupPrefixCategories = Object.freeze({
  ws_bot_claims_recovery: "recovery",
  ws_disconnect_cleanup: "janitor",
  ws_settled_rollover_close: "janitor",
  ws_settled_rollover_deferred_leave: "janitor",
  ws_stale_seat_cleanup: "janitor",
  ws_table_inactive_cleanup: "janitor",
  ws_turn_timeout_quarantine_cleanup: "recovery",
  ws_zombie_cleanup: "janitor"
});

const cleanupSuffixSeverities = Object.freeze({
  evict_closed_success: "INFO",
  retry: "WARN",
  schedule_bot_step_failed: "ERROR",
  settled_reveal_deferred: "WARN"
});

function resolveDynamicCleanupPolicy(eventName) {
  for (const [prefix, category] of Object.entries(cleanupPrefixCategories)) {
    const marker = `${prefix}_`;
    if (!eventName.startsWith(marker)) continue;
    const suffix = eventName.slice(marker.length);
    const severity = cleanupSuffixSeverities[suffix];
    if (severity) return { severity, category, classified: true };
  }
  return null;
}

function resolveJanitorResultPolicy(data) {
  if (data?.ok !== true) return { severity: "ERROR", category: "janitor", classified: true };
  if (data?.changed === true || data?.closed === true) {
    return { severity: "INFO", category: "janitor", classified: true };
  }
  if (data?.status === "healthy_noop" || data?.status === "seat_missing") {
    return { severity: "DEBUG", category: "janitor", classified: true };
  }
  return { severity: "WARN", category: "janitor", classified: true };
}

function normalizeEventName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePokerLogPolicy(eventName, data = null) {
  const normalizedEventName = normalizeEventName(eventName);
  if (normalizedEventName === "ws_table_janitor_result") {
    return resolveJanitorResultPolicy(data);
  }
  return policyByEventName.get(normalizedEventName)
    || resolveDynamicCleanupPolicy(normalizedEventName)
    || { severity: "UNSPECIFIED", category: null, classified: false };
}

export function buildPokerLogPayload(eventName, data = null) {
  const context = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const policy = resolvePokerLogPolicy(eventName, context);
  return {
    ...context,
    severity: policy.severity,
    category: policy.category
  };
}

export function listClassifiedPokerLogEvents() {
  return [...policyByEventName.keys()].sort();
}

export {
  POKER_LOG_CATEGORIES,
  POKER_LOG_SEVERITIES
};
