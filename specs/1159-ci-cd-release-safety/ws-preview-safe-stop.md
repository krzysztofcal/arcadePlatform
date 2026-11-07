# Superseded WS Preview safe-stop proposal (#1159)

OWNER replaced this proposal with standard Stage hard-kick restarts and one provisioning operation
that performs full preflight, stops only Preview and proves its process group empty before mutation.
No presence counters, empty-table requirement, receipt, standalone safe-stop or bootstrap rollout.
Historical receipt files are audit artifacts, not current authorization. Production safe-stop evidence
and `ws-restart-gate.mjs` are unrelated and unchanged.

Use the [current activation/recovery handoff](ws-preview-access-implementation.md).
