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
  "ws-preview-safe-stop": {
    title: "Stop the Stage WS Preview service after proving it is empty, and issue a 15-minute provisioning receipt",
    readOnly: false,
    changes: "Requires an operator DRAIN that already exists, then two authenticated runtime and Stage database proofs: no human member or connected human tables, no loaded hands, queued commands, state writes or financial inconsistencies, no OPEN tables and bots disabled. Then stops only ws-server-preview.service once, checks it is inactive with an empty cgroup and writes a root-only, single-use receipt valid for 15 minutes.",
    risk: "WS Preview (Stage) is down from the stop until a separately approved deploy; DRAIN stays in place, so Stage gameplay stays unavailable. Production WS is not touched. An uncertain stop is ADMIN_FAILED and keeps DRAIN for the owner.",
    sideEffects: "Read-only Stage database queries (four aggregate rows per proof). The receipt expires after 15 minutes; isolation preflight and provision must both be approved within that window.",
    rollback: "No automatic restart, retry or DRAIN removal. Starting Preview again is a separately approved Preview deploy or recovery; an existing receipt blocks another stop.",
  },
  "ws-preview-isolation-preflight": {
    title: "Check, without changes, that WS Preview can be moved to its own deploy and runtime accounts",
    readOnly: true,
    changes: "None. Verifies the safe-stop receipt, the stopped Preview unit, accounts, SSH policy, sudo rules, environment files and application trees that provision would change.",
    risk: "None; nothing on the VPS is changed and the receipt is not consumed.",
    sideEffects: "Journal entries and one read-only Stage database proof. Time spent waiting for approval counts against the 15-minute receipt.",
    rollback: "Not needed: read-only.",
  },
  "ws-preview-isolation-provision": {
    title: "Move the stopped WS Preview to separate deploy and runtime accounts (one-shot)",
    readOnly: false,
    changes: "Consumes the safe-stop receipt, creates arcade-preview-deploy and arcade-preview, installs the owner public key for the deploy account only, a two-command Preview sudo rule and the Preview unit hardening drop-in, and replaces the four Preview application trees with new copies; the originals are kept in root-only backup.",
    risk: "WS Preview stays stopped (result provisioned_runtime_not_started). Preview deploy access is temporarily lost until the separately approved environment binding for the new deploy account. One-shot: a failure needs owner recovery. Production is not touched.",
    sideEffects: "New accounts and a root-only manifest and backup under /var/lib/arcade-admin/ws-preview-isolation. The receipt is consumed even if provisioning fails.",
    rollback: "ws-preview-isolation-rollback while Preview is stopped. The new accounts stay inert and block a second provision; a new attempt needs a reviewed recovery change.",
  },
  "ws-preview-isolation-rollback": {
    title: "Undo WS Preview isolation while Preview is stopped",
    readOnly: false,
    changes: "Validates the protected manifest, withdraws the new deploy key, restores the original Preview application trees and removes only its own unchanged drop-in, policy and sudo file, then reloads systemd metadata.",
    risk: "WS Preview stays stopped; blocks if any process of the new accounts runs or the state does not match the manifest. Production is not touched.",
    sideEffects: "The new accounts remain, inert and without a key; original and replaced trees stay in the backup. A later provision is still refused.",
    rollback: "None for the rollback itself; starting Preview again is a separately approved Preview deploy or recovery.",
  },
});

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
