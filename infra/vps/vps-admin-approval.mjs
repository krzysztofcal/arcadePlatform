#!/usr/bin/env node

// Approval summary of a "VPS Admin Operation" request (#1159). The unprivileged request job renders it before the
// owner approves the vps-admin environment, so the owner sees what the operation changes, its risk, side effects and
// way back. The description is reviewed code next to the helper catalog (infra/vps/vps-admin.mjs), never the
// requester's free-text reason. Every catalog operation must have exactly one description: a missing or extra entry
// fails the request job, so the root helper itself is unchanged and needs no reinstall.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { OPERATIONS } from "./vps-admin.mjs";

const TARGET = "VPS account arcade-admin, root helper /usr/local/sbin/arcade-vps-admin, environment vps-admin";
const TIMERS = "arcade-chips-ledger-dispatch.timer (Stage) and arcade-chips-ledger-production-dispatch.timer (Production)";
const SLOTS = "Timer slots missed while the timers are stopped are not replayed (Persistent is not set).";

export const APPROVAL = Object.freeze({
  "ledger-dispatchers-status": {
    title: "Read the state of both ledger dispatchers",
    readOnly: true,
    changes: "None. Reads User and ActiveState of both dispatcher services, the ActiveState of both timers and NeedDaemonReload with systemctl show.",
    risk: "None. No service, timer or file is changed; no downtime.",
    sideEffects: "Start and end entries in the VPS journal (tag arcade-vps-admin).",
    rollback: "Not needed: read-only.",
  },
  "npm-cache-1240-check": {
    title: "Verify exactly three public npm cache archives for incident 1240",
    readOnly: true,
    changes: "None. Hashes only the three fixed SHA-512 blobs for public claude-code-linux-x64 versions 2.1.318, 2.1.319 and 2.1.322 in the copilot npm content cache. Checks owner, regular single-link files, root device, expected size, age of 48 hours to one year and PID/fd/mmap use. Reports current allocated bytes. No staging, deletion or service control.",
    risk: "Bounded file hashing of at most 512 MiB; no downtime. Missing files, ambiguous process inventory, changed identity, digest, age or active references block. A check is not deletion approval and execution repeats validation.",
    sideEffects: "Normal admin lock and audit entries; count and byte totals in Actions logs. Does not inspect cache index, credentials, package installations or agent sessions.",
    rollback: "Not needed: read-only. npm-cache-1240-cleanup is a distinct OWNER-approved request.",
  },
  "npm-cache-1240-cleanup": {
    title: "Delete only three verified public npm archive cache copies for incident 1240",
    readOnly: false,
    changes: "Repeats npm-cache-1240-check, then reuses protected descriptor-based custody to rename only those three files into /var/lib/arcade-admin/npm-cache-1240/runId on the same filesystem. Revalidates every inode and SHA-512 and scans processes again before unlinking only the three regular files in root-only custody. Retains a durable MANIFEST and reports deletion counts, not an asserted df improvement.",
    risk: "Irreversible cache eviction; a future reinstall may need a network download. No installed Claude, active session, ledger evidence, backup, Production data or service is changed. Validation failure before custody deletes nothing. Failed or partial custody/deletion requires OWNER manifest inspection; no automatic retry or restore.",
    sideEffects: "Creates root-only custody metadata; no second archive copy. A failure can leave archives in protected custody. Cache index is retained and npm can refetch missing content. Audit and Actions record counts, byte totals and manifest path; no file contents. No scheduled purge or restart.",
    rollback: "Deleted public tarballs can only be fetched again using the normal non-root package path and pinned integrity. Do not copy protected files back into a copilot-owned tree as root. Verify actual root df and service health separately after execution.",
  },
  "ledger-dispatchers-pause": {
    title: "Stop both ledger dispatcher timers and wait until no dispatcher runs",
    readOnly: false,
    changes: `systemctl stop ${TIMERS}, then waits up to 5 minutes until both dispatcher services are inactive or failed.`,
    risk: `Scheduled chips ledger automation stops on Stage and Production, including the Production retention-12m slot. ${SLOTS} On a timeout the timers stay stopped for the owner's decision.`,
    sideEffects: "No running dispatcher is killed; the operation waits for it. Journal entries as for every request.",
    rollback: "ledger-dispatchers-resume, a separate request with its own approval.",
  },
  "ledger-dispatchers-resume": {
    title: "Start both ledger dispatcher timers again",
    readOnly: false,
    changes: `Blocks while any of the two services or two timers needs daemon-reload; otherwise systemctl start ${TIMERS} and checks both are active.`,
    risk: "Scheduled chips ledger automation runs again from the next timer slot on Stage and Production, including Production retention-12m.",
    sideEffects: "The next slots dispatch the scheduled ledger workflows in GitHub Actions. Missed slots are not replayed.",
    rollback: "ledger-dispatchers-pause, a separate request with its own approval.",
  },
  "systemd-daemon-reload": {
    title: "Reload all systemd unit files on the VPS",
    readOnly: false,
    changes: "systemctl daemon-reload: systemd re-reads every unit file on the VPS, not only the ledger dispatchers.",
    risk: "Every unit file changed on disk since the last reload takes effect at once. The reload restarts no service by itself.",
    sideEffects: "Changed timer schedules and service definitions apply from now on.",
    rollback: "No undo. A previous unit file comes back only by a reviewed change, followed by another daemon-reload.",
  },
  "copilot-secret-snapshots-quarantine": {
    title: "Move the listed copilot credential snapshots into root-only quarantine",
    readOnly: false,
    changes: "Moves the fixed file list HOST.quarantine.files of infra/vps/vps-admin.mjs from /home/copilot into a new directory named after the run id under /var/lib/arcade-admin/quarantine (root:root 0700) with rename(2). Blocks if a file is missing, in use or not a single-link file of copilot.",
    risk: "Tools of the copilot account that still read these files lose them. Partial custody is reported as ADMIN_FAILED with the MANIFEST path.",
    sideEffects: "copilot can no longer read the files. Their contents still count as exposed: rotating the credentials stays required.",
    rollback: "There is no restore operation. The owner reads a file as root in the quarantine directory; returning one to copilot is a separate reviewed operation.",
  },
  "ledger-production-dispatcher-install": {
    title: "Install the reviewed Production ledger dispatcher script from this run's main commit",
    readOnly: false,
    changes: "Pauses both timers as ledger-dispatchers-pause, then replaces /usr/local/bin/arcade-chips-ledger-production-dispatch.sh (root:root 0755) with infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh at the run commit. Blocks if main advanced or the downloaded bytes do not match that commit.",
    risk: `Both ledger dispatcher timers (Stage and Production) are stopped and stay stopped, also after a failure, until a separate ledger-dispatchers-resume. ${SLOTS}`,
    sideEffects: "The result and the journal record the commit and the new and previous SHA-256 of the script.",
    rollback: "Merge the previous script to main through a reviewed PR and request this operation again, then ledger-dispatchers-resume.",
  },
  "ws-restart-gate-install": {
    title: "Install the reviewed WS restart gate helper from this run's main commit",
    readOnly: false,
    changes: "Replaces /usr/local/sbin/arcade-ws-restart-gate (root:root 0755) with infra/vps/ws-restart-gate.mjs at the run commit. Blocks if main advanced or the downloaded bytes do not match that commit. Verifies syntax, required modes and gate decision immediately after installation.",
    risk: "No service is restarted; WS Production remains on its existing process and release. The gate takes effect at the next WS Production deployment.",
    sideEffects: "The result and the journal record the commit and the new and previous SHA-256 of the helper.",
    rollback: "Merge the previous helper to main through a reviewed PR and request this operation again.",
  },
  "github-app-token-prepare": {
    title: "Prepare an isolated non-root GitHub App signer without moving a key",
    readOnly: false,
    changes: "Creates only arcade-github-token with no login, its protected empty key directory, a root-owned fixed token issuer and a copilot run-as rule limited to this non-root signer. Records a protected manifest. Does not read or copy any private key, issue a token or switch clients.",
    risk: "Partial installation requires manifest inspection and no automatic retry. The old GitHub path remains unchanged. After a separate OWNER key import, copilot can obtain repository-limited one-hour tokens, including Actions write, but cannot choose token scope or run a shell as the signer.",
    sideEffects: "Dedicated account, fixed executable, sudoers policy and manifest only. No service, Poker, Production, Environment or key changes.",
    rollback: "Separate OWNER maintenance decision can disable only the new fixed sudoers rule. Keep trusted OWNER recovery access and current client path until acceptance.",
  },
  "github-app-key-quarantine": {
    title: "Quarantine only the old copilot GitHub App private key after replacement acceptance",
    readOnly: false,
    changes: "First calls the isolated signer info mode, which mints and discards one scoped token without printing it, then reuses the protected descriptor-based quarantine for only .arcade-code-agent/app.pem. No other snapshot is moved. OWNER must first accept new gh and Git behavior.",
    risk: "The old local signer loses key access. Existing open references block before moving; uncertain custody after a move requires protected-manifest inspection. Quarantine does not invalidate copies or existing tokens; OWNER must revoke the old App key after acceptance.",
    sideEffects: "One token issuance and one key inode move to root-only quarantine with audit. No key content in logs, no automatic deletion, rotation, client switch or service operation.",
    rollback: "No automatic restore into copilot custody. OWNER recovers through the protected signer or trusted Termux channel. Use existing quarantine manifest procedure for any incomplete move.",
  },
  "ws-preview-isolation-provision": {
    title: "Provision the reviewed Preview deploy and runtime isolation",
    readOnly: false,
    changes: "Completes read-only preflight, stops only ws-server-preview.service and confirms its process group is empty, then creates the dedicated identities, copies and switches trusted Preview trees, installs the fixed dedicated key and isolation policies, and runs daemon-reload. Keeps Preview stopped after provisioning; occupied test tables do not block the stop.",
    risk: "Disconnects all Stage players, potentially interrupts a hand and may require manual Stage ledger recovery; hard kick does not guarantee chip settlement. Changes Preview ownership, files, SSH and sudo policy and the service identity. WS remains stopped; partial failure requires inspection of the protected backup manifest. daemon-reload re-reads all changed VPS unit files, not only Preview.",
    sideEffects: "Protected backup and journal entries; dedicated accounts and authorization are installed. No automatic WS start or restart, Production deployment or DRAIN removal.",
    rollback: "Separate ws-preview-isolation-rollback request with OWNER approval, while Preview is stopped and protected backup checks pass. No automatic retry or restart.",
  },
  "ws-preview-isolation-rollback": {
    title: "Restore the protected pre-isolation Preview files while WS stays stopped",
    readOnly: false,
    changes: "Checks the protected backup manifest and installed identities, revokes the dedicated key, restores the saved Preview trees, removes isolation policies and runs daemon-reload. Requires Preview stopped and no dedicated-user processes.",
    risk: "Restores the previous shared Preview identity and files. Unexpected or changed paths block recovery for inspection. daemon-reload re-reads all changed VPS unit files. WS remains unavailable.",
    sideEffects: "Updates the protected backup manifest and journal; dedicated accounts remain inert. No automatic WS start, restart or DRAIN removal.",
    rollback: "No automatic undo or retry. Inspect the protected recovery state and obtain a separate reviewed recovery decision from OWNER.",
  },
  "volume-workdir-prepare": {
    title: "Prepare the fixed copilot work directory on the Hetzner volume",
    readOnly: false,
    changes: "Verifies /mnt/HC_Volume_107462648 is the writable EXT4 mount of /dev/sdb and /dev/disk/by-id/scsi-0HC_Volume_107462648 resolves to that device. Creates only copilot-work with copilot:copilot 0750 through a pinned root-owned parent. Accepts an already correct directory; refuses conflicting paths without repair.",
    risk: "Grants copilot write access only inside the new directory. No service downtime, mount, fstab, formatting or data migration. An uncertain failure may leave a partial directory; inspect before any new request.",
    sideEffects: "One directory and the existing admin journal records only. No helper installation, service, restart, database or financial operation.",
    rollback: "No automatic deletion or retry. OWNER inspects the directory; removal or repair requires a separate approved procedure.",
  },
  "codex-bwrap-apparmor-check": {
    title: "Read active AppArmor policy and inspect bubblewrap attachment conflicts",
    readOnly: true,
    changes: "Reads Ubuntu identity, the unchanged userns restriction, the complete kernel profile tree and flat list, attachments and hashes, source files and process thread labels. Blocks on unknown attachments, policy namespaces, conflicts or incomplete inspection. No profile or state file is written.",
    risk: "No application downtime or policy change. Conservative matching can block on unrelated complex policy. A successful check is a point-in-time observation, not authorization for install or proof the sandbox works.",
    sideEffects: "Only the existing admin lock, journal and Actions audit. No namespace probe, CLI smoke, service or signal.",
    rollback: "No mutation to roll back. Install is a separate operation requiring its own OWNER approval.",
  },
  "codex-bwrap-apparmor-install": {
    title: "Install only the byte-pinned Ubuntu noble bubblewrap AppArmor profile",
    readOnly: false,
    changes: "Repeats full conflict and process inspection, verifies the trusted staged Ubuntu profile hash, compiles without loading, loads and verifies two profiles from protected custody using parser ADD, then publishes only an absent /etc/apparmor.d/bwrap-userns-restrict with no-clobber hardlink. Keeps a root-only manifest and profile custody under /var/lib/arcade-admin/codex-bwrap-apparmor.",
    risk: "Affects future /usr/bin/bwrap callers including other tools, not only Codex. Nested sandboxes may be restricted. OWNER must arrange a quiet launch window; the admin lock does not serialize independent agent launches. Any partial failure needs protected-manifest inspection, never automatic retry.",
    sideEffects: "No packages, sysctl, global Codex settings, restarts or smoke. The global userns restriction must remain 1. Active users or uninspectable state block; no process is stopped. Two kernel profiles and one policy file are added only after checks pass.",
    rollback: "Separate codex-bwrap-apparmor-rollback approval, only after a complete own install with matching inode, file hash, kernel policy hashes, baseline and no active dependents. Partial or uncertain installs block rollback for OWNER recovery review.",
  },
  "codex-bwrap-apparmor-rollback": {
    title: "Retire only the verified own bubblewrap profile and restore its absent baseline",
    readOnly: false,
    changes: "Requires the protected successful-install manifest, exact file identity and policy hashes, unchanged baseline and complete process inspection. Moves only the owned profile to protected custody and removes only its two kernel profiles; retains every byte and the audit trail.",
    risk: "Refuses active users, drift or partial state. OWNER must arrange a quiet launch window. Rollback restores the previous sandbox failure as well as the previous policy state. Unloading a profile in use could change protection, so any uncertain dependency blocks.",
    sideEffects: "No service, signal, restart, package removal, sysctl or Codex configuration change. No automatic retry or smoke. Evidence remains in root-only custody.",
    rollback: "No automatic reinstallation. A completed rollback retains its manifest and blocks another install at that state path; any later repair or partial recovery needs a separately reviewed OWNER decision.",
  },
});

const REPOSITORY = "https://github.com/krzysztofcal/arcadePlatform";
const PREVIEW_IMPLEMENTATION = ["infra/vps/ws-preview-isolation.py", "infra/vps/prepare-ws-preview-v3.py", "infra/vps/ws-server-preview.service.d/99-preview-isolation.conf"];
const IMPLEMENTATION_FILES = {
  ...Object.fromEntries(["check", "install", "rollback"].map((action) => [
    `codex-bwrap-apparmor-${action}`, ["infra/vps/codex-bwrap-apparmor.py", "infra/vps/bwrap-userns-restrict", "infra/vps/stage-vps-admin.sh"],
  ])),
  "ledger-production-dispatcher-install": ["infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh"],
  "ws-restart-gate-install": ["infra/vps/ws-restart-gate.mjs"],
  "github-app-token-prepare": ["infra/vps/github-app-token.py"],
  "github-app-key-quarantine": ["infra/vps/github-app-token.py"],
  "ws-preview-isolation-provision": PREVIEW_IMPLEMENTATION,
  "ws-preview-isolation-rollback": PREVIEW_IMPLEMENTATION,
};

const SHA = /^[0-9a-f]{40}$/;
const OPERATION = /^[a-z0-9-]{1,64}$/;
const REASON = /^[A-Za-z0-9 .,:;()/+=_-]{10,200}$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
const RUN = /^[1-9][0-9]{0,19}$/;

// Refuses unless the description catalog is exactly the helper catalog, in the same order.
export function checkCatalog(operations = OPERATIONS, approval = APPROVAL) {
  const a = Object.keys(operations);
  const b = Object.keys(approval);
  if (a.length !== b.length || a.some((name, i) => name !== b[i])) throw new Error("approval_catalog_mismatch");
  for (const name of b) {
    const d = approval[name];
    if (typeof d.readOnly !== "boolean" || ["title", "changes", "risk", "sideEffects", "rollback"].some((k) => typeof d[k] !== "string" || !d[k].trim() || /[`\n<>|]/.test(d[k]))) {
      throw new Error(`approval_description_invalid_${name}`);
    }
  }
}

// Every value is validated before it reaches the markdown, so no input can shape the summary.
export function approvalSummary({ operation, reason, sha, actor, triggeringActor, runId, attempt }) {
  checkCatalog();
  if (!OPERATION.test(String(operation)) || !Object.hasOwn(APPROVAL, operation)) throw new Error("unknown_operation");
  if (!REASON.test(String(reason))) throw new Error("invalid_reason");
  if (!SHA.test(String(sha))) throw new Error("invalid_sha");
  if (!LOGIN.test(String(actor)) || !LOGIN.test(String(triggeringActor))) throw new Error("invalid_actor");
  if (!RUN.test(String(runId)) || !RUN.test(String(attempt))) throw new Error("invalid_run");
  const d = APPROVAL[operation];
  return [
    `## Approve only if expected: ${operation}`,
    "",
    `**${d.title}** (${d.readOnly ? "read-only" : "CHANGES THE VPS"})`,
    "",
    "| | |",
    "|---|---|",
    `| Operation | \`${operation}\` |`,
    `| Target | ${TARGET} |`,
    `| Revision | \`${sha}\` (main) |`,
    `| Requested by | \`${actor}\`, triggered by \`${triggeringActor}\` |`,
    `| Run | ${runId}, attempt ${attempt} |`,
    `| Changes | ${d.changes} |`,
    `| Risk and downtime | ${d.risk} |`,
    `| Side effects | ${d.sideEffects} |`,
    `| Way back | ${d.rollback} |`,
    "",
    `Requester's reason (free text, not part of the reviewed description): \`${reason}\``,
    "",
    "### Review implementation",
    "",
    "These links show repository code at this run's SHA. They do not confirm the version of `/usr/local/sbin/arcade-vps-admin` or its supporting files installed on the VPS. Matching the installed helper to this source requires separate verification before approval.",
    "",
    ...["infra/vps/vps-admin.mjs", ".github/workflows/vps-admin-operation.yml", ...(IMPLEMENTATION_FILES[operation] || [])]
      .map((file) => `- [\`${file}\`](${REPOSITORY}/blob/${sha}/${file})`),
    "",
    "Checked before approval: the operation is in the reviewed catalog, the confirmation phrase matches and the run is a main dispatch of the owner or the release agent. Nothing has run on the VPS yet; the result (ADMIN_OK, ADMIN_BLOCKED or ADMIN_FAILED) appears only after approval in the operate job.",
    "",
  ].join("\n");
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  const e = process.env;
  const text = approvalSummary({ operation: e.OPERATION, reason: e.REASON, sha: e.GITHUB_SHA, actor: e.GITHUB_ACTOR,
    triggeringActor: e.GITHUB_TRIGGERING_ACTOR, runId: e.GITHUB_RUN_ID, attempt: e.GITHUB_RUN_ATTEMPT });
  fs.appendFileSync(e.GITHUB_STEP_SUMMARY, text);
  const d = APPROVAL[e.OPERATION];
  process.stdout.write(`::notice title=VPS admin request ${e.OPERATION}::${d.readOnly ? "Read-only" : "Changes the VPS"}: ${d.title}. Read the request job summary before approving vps-admin.\n`);
}
