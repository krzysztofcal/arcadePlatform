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
});

const REPOSITORY = "https://github.com/krzysztofcal/arcadePlatform";
const PREVIEW_IMPLEMENTATION = ["infra/vps/ws-preview-isolation.py", "infra/vps/prepare-ws-preview-v3.py", "infra/vps/ws-server-preview.service.d/99-preview-isolation.conf"];
const IMPLEMENTATION_FILES = {
  "ledger-production-dispatcher-install": ["infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh"],
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
