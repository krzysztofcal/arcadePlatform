# #1159 — WS Preview isolation and safe stop: activation order

Integration of Drafts #1197 (isolation) and #1199 (safe stop) onto `main` `1d7fc4f1`. Their helper code is
unchanged (byte-identical to the reviewed heads `312aba2a` and `01bcb623`; only the catalog lists were merged
main-first). Details stay in `ws-preview-access-implementation.md` and `ws-preview-safe-stop.md`; this page fixes
the order. Every step is a separate OWNER GO; an approval of the `vps-admin` environment is the GO for its
catalog operation. No step touches Production WS, the Production ledger or retention #1157.

State read on 2026-11-06 (read-only): Preview runs `b0d81cd3` (an integration commit, not on `main`), as
`arcade`, since 2026-11-04 15:03 UTC; its protected hold file holds `drain` since 2026-11-02 16:10 UTC, so new
Stage hands are already blocked.

Standing rules for the whole sequence:

- **Requester and approver.** Every catalog operation is requested by `arcade-code-agent[bot]` and approved by the
  owner; `vps-admin` is `main` only, owner required reviewer, prevent self-review (verified on runs 42223180928,
  42225018370, 42226390939 and 42261822727: the App cannot approve). If that separation is not available, STOP; never
  weaken the protection or let the owner both request and approve.
- **Freeze.** From step 2 until step 9 is accepted: no other WS Preview Deploy dispatch or re-run, no re-run of an
  old branch definition, no direct restart of `ws-server-preview.service` by any account, and the agent does not
  touch Preview. Any such event is STOP and a read-only state review before the next step.
- **No retry.** A blocked, failed or uncertain result is never retried by the agent; the owner decides.

| # | Step (mechanism) | Risk | Active games | Way back | GO |
|---|---|---|---|---|---|
| 0 | Owner push of the four catalog choice lines, CI, review, merge; pin the merge SHA `M` | Merging changes `ws-server/server.mjs`, the packaged WS surface: a WWW publish is refused (`ws_release_incompatible`) until WS Production runs a `main` SHA that includes it | None | Revert PR | Owner push, merge |
| 1 | Install helper, sudoers and libexec bundle of `M` with `infra/vps/stage-vps-admin.sh` as root from a root-trusted checkout, after a root-only backup (no catalog operation can install the helper) | A bad install breaks every VPS Admin operation, including the ledger dispatcher operations; services are not restarted | None | Restore the backup, `visudo -c`; then `ledger-dispatchers-status` as a check | Owner root step |
| 2 | WS Preview Deploy of exact SHA `M`, dispatched by the owner (the workflow admits only owner/owner), with the existing Preview credentials: the runtime that reports the two Preview presence counters | Restarts `ws-server-preview.service` without a gate: Stage connections drop. DRAIN stays (hold file outside the release), so no new hands start | Stage only. Precondition: read-only evidence of a safe restart window (zero human and reconnectable seats, no hand in progress, queued commands or state writes, no financial inconsistency or unresolved request, no recovery in progress), from the runtime maintenance status and the restart gate's aggregate Stage queries; DRAIN alone is no proof. The step 3 confirmations are made before this restart. Missing evidence is STOP and an owner-approved bootstrap plan | WS Preview Deploy of `b0d81cd3` | Owner dispatch |
| 3 | Confirm the existing DRAIN is intended, no other Preview maintenance, no OPEN Stage tables, bots disabled (`CONTINUOUS_BOT_DEFAULT` disabled, desired count 0) | Changing Stage tables or bot profiles is a Stage data write, outside this sequence | None | — | Owner confirmation; any Stage write is its own GO |
| 4 | VPS Admin `ws-preview-safe-stop` | Preview is down until step 9. An uncertain stop is `ADMIN_FAILED` and keeps DRAIN; old runtime or missing evidence is `ADMIN_BLOCKED` before the stop | Stage gameplay stays unavailable | No automatic restart; restart only by WS Preview Deploy (step 2 path) | `vps-admin` approval |
| 5 | Only after `ADMIN_OK ws-preview-safe-stop stopped_receipt_ready` and an independent read-only check (inactive, MainPID 0, empty cgroup, receipt phase ready and age); `stopped_pending_audit`, a failed audit or finalization, or any doubt is STOP and owner recovery, with no new stop and no receipt refresh. Then within the 15-minute receipt: `ws-preview-isolation-preflight` (read-only); the owner inspects its result, and only after `ADMIN_OK` of the preflight is `ws-preview-isolation-provision` requested as a separate request | Provision is one-shot and consumes the receipt even on failure; Preview stays stopped; deploy access is lost until step 8. An expired receipt is STOP (no refresh) | Preview down | `ws-preview-isolation-rollback` while stopped; accounts stay inert and block re-provision | Two separate `vps-admin` approvals; the provision request waits for the inspected preflight result |
| 6 | Isolation acceptance while stopped: owner read-only SSH as `arcade-preview-deploy` with the dedicated key; identities, sudo listing, file ownership and unit properties | A failed check is STOP for a reviewed recovery | Preview down | Step 5 rollback | Owner check |
| 7 | Owner creates environment `ws-preview` (`main` only, no tags): `WS_PREVIEW_HOST`, `WS_PREVIEW_USER=arcade-preview-deploy`, the new `WS_PREVIEW_SSH_KEY` uploaded by the owner; the old repository-level Preview secrets stay until step 10 | Secrets are visible only to jobs bound to `ws-preview` | None | Delete the environment | Settings GO |
| 8 | Binding PR: `environment: ws-preview` on `validate` and `deploy` of `ws-preview-deploy.yml`, guard test; owner push (workflows) | Without it the workflow keeps using the old repository-level credential | None | Revert PR | Owner push, merge |
| 9 | Owner-dispatched WS Preview Deploy of `M` through `ws-preview`: verify SSH identity, Stage preflight, installed SHA, process user `arcade-preview`, local and public health | Preview restarts under the new identity; DRAIN still holds new hands | Stage only | Rollback needs Preview stopped again with no process of the new accounts, but the consumed receipt blocks another safe stop: an owner recovery | Owner dispatch |
| 10 | Remove the old repository-level Preview secrets after an inventory of old branches and reruns | An old branch definition could otherwise still use them | None | Re-add from owner custody | Settings GO |

Lifting the Preview DRAIN (writing the root-owned hold file) is not part of this sequence and has no catalog
operation; it stays a separate owner decision after step 9.
