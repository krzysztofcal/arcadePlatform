# WS Preview access isolation — preparation for OWNER review

Status: proposed design, not an installed configuration or permission to activate it.
Related: #1159; reuse the Environment binding pattern from #1193.

## Purpose and boundary

Give the existing `WS Preview Deploy` workflow credentials that can deploy Preview without granting
Production deployment authority. Keep the existing workflow, artifact, five scoped rsync operations,
Redis preflight, restart and health checks. No new service, deployment framework or dependency.

The owner approved preparation of a dedicated Preview account and key. This document specifies that
change for review; it does not implement the accounts, provision keys, bind a workflow, or change live
settings. Merge of this document has no activation effect.

## Why an SSH account alone is insufficient

Read-only systemd inspection on 2026-11-05 found `User=arcade` for both `ws-server-preview.service`
and `ws-server.service`. The Preview unit reports `ProtectHome=no`, `ProtectSystem=no` and
`NoNewPrivileges=no`. A Preview deployer controls the code subsequently run by that shared identity.
Changing only the SSH username would leave this second route into shared authority.

The existing workflow key cannot be recovered from GitHub. A locally available key does not prove
equality with that secret. Neither recovering nor reusing it is a prerequisite for this design.

## Chosen design

Names below are proposed, not evidence that these identities exist.

| Identity | Allowed scope | Excluded scope |
|---|---|---|
| `arcade-preview-deploy` | SSH/SCP upload; write the existing Preview application trees; the two fixed sudo commands below | Production trees, Caddy writes/reload, Production helpers, general agent credentials and system/Production journals |
| `arcade-preview` | Run the existing Preview service on port 3001; read Preview code and receive its Stage environment from systemd | Login, sudo, Production credentials/state and shared `arcade` process identity |

Use a dedicated Preview deployment group. Neither identity joins `arcade-deploy`, `arcade-release`,
`arcade-admin`, `adm`, `systemd-journal` or `wslogs`, or any other group giving Production authority.
The runtime cannot modify deployed executable code. The SSH identity cannot modify the systemd unit,
sudoers, root-owned helpers, `.env.preview`, or its server-side SSH authorization policy.

The deployer's complete sudo allowlist is:

```text
/usr/local/sbin/arcade-ws-preview-env-preflight ""
/usr/bin/systemctl restart ws-server-preview.service
```

There is no Caddy operation, Production operation, interpreter, wildcard argument or arbitrary unit.
Audit effective sudo rights, filesystem ACLs and group memberships rather than trusting this list alone.

Keep the existing `/opt/arcade-ws-preview` layout and root-only `.env.preview`. Give the deployer
write authority only to the existing deploy destinations; the base and all authorization/configuration
files remain root-controlled. Preserve runtime-required writable state separately from executable
code, after inventorying it. Do not recursively change ownership of a live, user-writable tree or
follow deployment-controlled symlinks as root. The implementation must refuse unexpected accounts,
groups, paths or metadata, and specify safe handling of existing files before any mutation.

Use a new key generated on OWNER's Termux. Only its public part/fingerprint enters server setup.
Private material remains on OWNER's device and is uploaded directly to GitHub by OWNER; never place
it in a PR, agent session, command argument or artifact. Root controls the authorized key policy;
disable forwarding, agent forwarding, PTY and user SSH startup hooks while retaining compatibility
with the existing SCP and noninteractive SSH actions. Verify the effective SSH policy before use.

Alternatives rejected: reusing the broad `copilot` key preserves its existing authority; adding a new
key to the same account does not separate that authority; creating only a deployment account leaves
the shared runtime identity. A new deployment service or generic root command interface is unnecessary.

## Bounded implementation and activation order

1. Prepare the account/runtime isolation implementation for review. Reuse the existing
   [VPS Admin Operation](../../docs/vps-admin-operations.md) approval and fixed catalog. The current
   catalog has no Preview account provisioning operation: adding a narrowly bounded operation and
   installing that reviewed helper requires a separately approved administrative activation path.
   Do not claim the existing workflow can install its own new operation. Do not use manual SSH,
   root/sudo, the full fresh-host bootstrap or release-agent activation as an alternative.
2. Review the complete implementation with Claude Code (at most three rounds, zero P0/P1/P2 for
   handoff), and run fundamental tests for scope, unexpected identity/path refusal and preservation
   of current deployment gates. No provisioning or service change during preparation.
3. Before OWNER-approved activation, record the current Preview SHA, unit, metadata and recovery
   procedure without copying secrets into agent-readable files. Check for active Preview runs and
   establish a safe Preview restart window, including active users and financial/recovery state.
   Runtime-user activation requires a Preview restart and may interrupt connections; do not restart
   Production. On failure report STOP and recover only by the reviewed, separately approved path;
   never silently fall back to the broad `copilot` credential.
4. After authorized provisioning, independently verify both identities' effective SSH, filesystem,
   process and sudo boundaries. Confirm Stage configuration without printing values. Keep the old
   workflow credential intact until replacement acceptance; do not remove or change OWNER's key.
5. Only after isolation PASS, OWNER creates `ws-preview`, selected branches/tags: exactly `main`,
   no tags, with `WS_PREVIEW_HOST`, `WS_PREVIEW_USER=arcade-preview-deploy` and the new
   `WS_PREVIEW_SSH_KEY`. Upload the private key locally from Termux without exposing it to the agent.
6. Prepare the small binding PR: `environment: ws-preview` on both `validate` and `deploy` in
   `.github/workflows/ws-preview-deploy.yml`, extend the existing
   `ws-tests/ws-preview-deploy.workflow.guard.test.mjs`, and minimally update deployment instructions.
   Preserve OWNER/main and triggering-actor guards, serialization, Redis checks and all current
   artifact/restart/health logic. Obtain independent Claude review and required CI before handoff.
7. After separate merge/deploy GO, use the existing main-definition workflow with the approved exact
   application SHA. Verify actual SSH identity, Stage preflight, installed SHA and local/public health.
   Then inventory old branches/reruns and remove obsolete repository-level Preview credentials only
   with separate OWNER approval. Historical workflow definitions do not gain Environment binding
   retroactively; do not rely on Environment rules to restrict secrets still stored at repository level.

## Completion evidence

An Environment name or green CI alone is not acceptance. Record the provisioning revision and
approval, effective identity/policy checks, exact-SHA Preview run, Stage identity and health results.
Production settings, services, secrets and existing OWNER access stay unchanged. No deployment,
root operation, secret mutation or workflow dispatch is authorized by this preparation document.
