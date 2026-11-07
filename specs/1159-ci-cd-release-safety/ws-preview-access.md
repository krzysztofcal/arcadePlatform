# WS Preview access isolation — preparation for OWNER review

Status: proposed design, not an installed configuration or permission to activate it.
Related: #1159; reuse the Environment binding pattern from #1193.

## Purpose and boundary

Give the existing `WS Preview Deploy` workflow credentials that can deploy Preview without granting
Production deployment authority. Keep the existing workflow, artifact, five scoped rsync operations,
Redis preflight, restart and health checks. No new service, deployment framework or dependency.

The owner approved preparation of a dedicated Preview account and key. This document specifies that
change for review; it does not activate accounts, keys, the workflow Environment or live settings. Merge of this document has no activation effect.

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
The runtime is not a member of the Preview deployment group: it reads code through other-read/search
permissions only. Verify the existing artifact's modes grant that access without granting write access
to any of the five installed sync roots or their executable contents; do not add it to the writable group.

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
pin the public key/fingerprint in the reviewed provisioning change, not a free-form catalog input.
Disable forwarding, agent forwarding, PTY and user SSH startup hooks while retaining compatibility
with the existing SCP and noninteractive SSH actions. Verify the effective SSH policy before use.

Alternatives rejected: reusing the broad `copilot` key preserves its existing authority; adding a new
key to the same account does not separate that authority; creating only a deployment account leaves
the shared runtime identity. A new deployment service or generic root command interface is unnecessary.

## Bounded implementation and activation order

The single follow-up contains catalog simplification, fixed Preview-only stop during provisioning,
removal of presence counters and binding both secret-using deploy jobs to `ws-preview`.
Follow the [implementation/activation handoff](ws-preview-access-implementation.md) for the exact
migration order and recovery. No separate binding PR, safe-stop, receipt, empty-table requirement or
runtime-counter rollout is required. OWNER accepts Stage hard kicks and possible manual ledger recovery;
Production settlement protection is unchanged. Runtime acceptance still needs separate deployment GO.

## Completion evidence

An Environment name or green CI alone is not acceptance. Record the provisioning revision and
approval, effective identity/policy checks, exact-SHA Preview run, Stage identity and health results.
Production settings, services, secrets and existing OWNER access stay unchanged. No deployment,
root operation, secret mutation or workflow dispatch is authorized by this preparation document.
