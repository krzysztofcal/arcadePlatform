# #1159 WS Preview safe stop — implementation, not activation

Depends on #1197 (Preview isolation). This separate change does not update that PR,
WS Preview deploy workflow, credentials, Production restart-gate behavior or database data.
Only the existing VPS Admin Operation catalog gains `ws-preview-safe-stop`.

## Gate and receipt

`ws-preview-safe-stop.mjs` imports only the pure evaluators and SQL from
`ws-restart-gate.mjs`; it never runs the Production CLI. Fixed Stage project:
`krydukthwdvccggbyjfw`; service: `ws-server-preview.service`; authenticated loopback
maintenance endpoint: port 3001. Commands have no caller-supplied unit/path/SQL.
Passwords go only to the psql child environment, never arguments or output.

The operator must already have established protected DRAIN after hands settled.
DRAIN blocks mutating game commands; applying it to a live hand can strand that
hand. This operation neither creates/adopts a release-owned hold nor changes a
profile, closes tables, settles money or removes DRAIN. A foreign release operation
must be resolved by its owner before this maintenance; an existing operator DRAIN
must be confirmed intentional. No generic HOLD/DRAIN/root interface is added.

Two proofs require Stage configuration attestation, unchanged MainPID/unit,
fresh authenticated runtime, zero human member tables (including reconnect grace),
zero connected human tables (including spectators), zero loaded hands, queued
commands, state writes, supervisor sweep, DB hands/version discrepancies and
financial inconsistencies/unresolved requests. SQL additionally requires zero OPEN
tables, exactly one disabled CONTINUOUS_BOT_DEFAULT profile with desired count zero,
and no active human seats or closed-table escrow. Missing evidence blocks; TCP
counts and default-zero counters are never accepted. These are table-presence
counters, not a promise that lobby-only sockets remain connected during maintenance. Each proof is limited to ten
seconds; HTTP timeout is five seconds and SQL statement timeout five seconds.
Configuration and PID are rechecked immediately before the one stop command.

After stop, require loaded/inactive, MainPID=0, successful systemd result, no cgroup
processes (including descendants via `cgroup.events populated=0`, or a removed
cgroup under the verified system.slice), unchanged process start identity and
protected configuration, and another read-only DB proof. An error or timeout
creates no usable receipt, even if the service actually stopped. Pre-stop refusal
reports BLOCKED; an attempted stop with uncertain result reports FAILED. The end
audit records the stop outcome; the workflow also reports receipt finalization
failure (a pending receipt is not usable), so read both records during recovery. No automatic
restart, retry, rollback or HOLD removal follows.

Receipt: `/var/lib/arcade-admin/ws-preview-safe-stop/receipt.json`, root:root 0600
under protected 0700 custody. It binds Stage/service, admin run, previous PID,
process start timestamp, unit, configuration/DRAIN and installed adapter/library
hashes. It expires after 15 minutes. It is pending until the catalog's end-audit
succeeds and a fresh stopped/DB check finalizes it. Isolation preflight verifies
it without mutation; provision re-verifies and consumes it immediately before its
first persistent change. Inactive alone, a stale/replayed receipt, changed config,
an intervening process start or populated cgroup cannot authorize provisioning.
A consumed receipt stays consumed even if provisioning later fails.

## OWNER sequence (each mutation needs separate approval)

**Activation blocker 1 — reviewed catalog installation with backup.** Neither
opening nor merging this PR installs root helpers. After #1197 and this PR merge,
pin the exact resulting main SHA `M`. OWNER must approve installation of that SHA
using the existing `stage-vps-admin.sh` maintenance procedure from a root-trusted
checkout. Never execute an agent-writable checkout as root. Do not run full
`bootstrap.sh` on this live host. Back up current helper, sudoers and the entire
installed libexec bundle with ownership/modes and hashes in root-only custody;
record absence where no previous bundle exists. Preserve the receipt directory
and any existing receipt; do not overwrite or clear it. Record Preview and
Production unit metadata and DRAIN identity before/after. The installer installs
only the fixed reviewed files/directories, validates sudoers and existing account
boundaries; it does not stop/restart/provision. Required existing packages:
Node with built-in fetch, Python 3, psql, systemd, flock, logger and visudo.
No new package, key or service is installed by this change.

**Activation blocker 2 — working requester/approver separation.** Verify `vps-admin`
is main-only, requires OWNER approval, prevents self-review and has no bypass.
A distinct already-authorized requester must initiate the operation; OWNER only
approves. If OWNER is the sole requester and self-review is prevented, STOP.
Do not activate a release agent, copy OWNER credentials or weaken protection to
make this work. Existing workflow actor/main/confirmation gates remain unchanged.

**Runtime prerequisite:** the running Preview must already expose the two new
Preview-only human counters. Their rollout is a separate exact-SHA WS Preview
Deploy approval and relevant smoke, not authorized here. Old runtime intentionally
returns STOP. This PR provides no unsafe bootstrap restart workaround; if the
current runtime cannot be upgraded under an already-safe approved procedure,
activation remains blocked pending an OWNER-approved bootstrap plan. Production
status response and restart behavior retain their existing contract.

Once all prerequisites are proven, OWNER sequence is:

1. Confirm quiescence, no other Preview release/maintenance, no OPEN tables,
   disabled bots and intentional pre-existing protected DRAIN. Otherwise STOP;
   resolving users/hands/financial operations is outside this operation.
2. Request `VPS Admin Operation` from exact current main `M`, operation
   `ws-preview-safe-stop`, confirmation `RUN ws-preview-safe-stop`, explicit reason.
   OWNER approves the separate `operate` job after reviewing SHA and requester.
3. Require `ADMIN_OK ws-preview-safe-stop stopped_receipt_ready`; independently
   inspect inactive/MainPID/cgroup and protected receipt metadata, not secret values.
4. Within the 15-minute receipt window request/approve isolation preflight and
   provision separately. Their combined time must fit the window. If approval
   expires it, STOP; never extend/edit a receipt or start/stop just to refresh it.
   Catalog installation precedes safe stop, not vice versa.
5. Perform #1197 SSH/runtime isolation acceptance while stopped. Only after that
   separately approve future `ws-preview` environment migration, exact-SHA Preview
   deploy and smoke. DRAIN stays in place; gameplay remains unavailable until a
   separately authorized recovery/release plan safely resolves it. Health/hello
   checks do not prove funded gameplay or authorize JOIN/financial smoke.

## STOP, recovery and rollback

No successful receipt after a timeout, lost connection, forced systemd kill,
failed audit, DB error or changed context. Read-only inspect journal/admin run,
unit/MainPID/cgroup, DRAIN, DB aggregate invariants and receipt phase/age. Do not
rerun stop, restart, delete/refresh the receipt, remove DRAIN or undo isolation
automatically. A pending or consumed receipt requires OWNER recovery; there is no
new root recovery catalog operation. An existing receipt blocks another stop.

Catalog rollback is a separate OWNER maintenance approval restoring the backed-up
helper/sudoers/bundle only, with visudo validation and metadata/hash checks. Never
restore old provisioning code to bypass this receipt gate. Preserve records and
DRAIN. After provisioning has begun, use #1197's separately approved isolation
rollback only while stopped and after examining its manifest; rollback does not
start the service or reissue a safe-stop receipt. Service recovery/deploy and hold
resolution remain separate OWNER decisions. Production must be unchanged throughout.

## Validation and cost

Fundamental fixtures run without root, real systemctl/SSH, production services or
live credentials. The existing infra workflow guard runs the adapter fixture suite
and isolation fixture suite; WS PR checks exercise the Preview counters. Actionlint
validates the catalog workflow. Independent Claude review is for this new diff,
not a fifth review round for immutable #1197.

Each DB proof returns four aggregate scalar rows (read-only transaction); no
history/table downloads or background polling. Normal successful stop uses three
DB proofs, finalization one, isolation preflight one and provision two (its
preflight plus consume): seven total. Daily egress depends only on explicitly
approved maintenance runs; no cron is added. Expected result payload is well under
1 KiB/proof (estimate, not measured billed Shared Pooler egress); TLS/protocol and
the existing maintenance endpoint size add overhead. SQL still scans relevant
financial state server-side; the five-second statement timeout fails closed.

## Main integration preparation (#1199)

The integration carrier is Draft #1199, which already contains the accepted
#1197 commit 312aba2a07863d65da29eece3d3bc437ff8f9b86. The #1197 branch and its
exhausted review budget remain unchanged. Reconciliation with main preserves
#1209's request summary, OWNER environment gate and requester checks, and the
Production dispatcher install operation and retention changes already on main.
The workflow choices, helper catalog, sudoers and approval descriptions contain
the same ordered union. All four Preview descriptions mark VPS changes:
preflight writes temporary policy-validation files even without provisioning.

This preparation installs nothing on the VPS. The installed catalog may therefore
lag the repository: separately approved trusted installation and hash/metadata
verification remain required before any operation is requested. The Preview
runtime counters also require their separately approved exact-SHA rollout before
safe-stop proofs can pass. Requester/OWNER separation, existing DRAIN, Stage/DB
identity and receipt gates remain mandatory. No automatic start, retry, recovery
or activation is introduced; Google Play, Privacy and other PR integrations are
outside this change. Existing operation names and inputs are unchanged. A catalog
update must keep the four repository catalogs consistent and does not authorize
any operation merely by merging code.
