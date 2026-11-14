# Agent work directories on the Arcade Platform VPS

New Codex, Claude Code and Antigravity checkout/worktree content belongs under
`/mnt/HC_Volume_107462648/copilot-work`. Existing tasks keep their original
checkout, including those in `/home/copilot/work`, `/tmp` or `.claude/worktrees`.
Check the task handoff and `git worktree list` first; do not allocate another
checkout for a review or follow-up. If the recorded checkout is unavailable,
STOP rather than silently recreating it. This policy applies to agent working
copies on this VPS, not CI runners, release trees or deployed application data.

## Existing mechanisms inspected

As inspected on 2026-11-14 at main `34a6c3ea`:

| Entry point | Current behavior | New-task usage |
|---|---|---|
| Codex `create_worktree` tool | Exposes a ref, but no destination parameter; existing tool attachments and Git worktrees can be listed | Reuse the recorded checkout. For new tasks use Git with the checked destination until the native tool supports selecting it; do not call it and then move the result |
| Claude Code `--worktree` | Creates a worktree automatically; existing examples/worktrees use `.claude/worktrees` | Open Claude from an explicitly prepared Volume worktree, without `--worktree`; resume an existing task in its recorded directory |
| `~/.claude/skills/agy-implement/agy-implement.sh` | Takes an existing `--worktree`, verifies the `agy/*` branch and uses a per-worktree lock; it does not create the worktree | Coordinator creates the worktree on the Volume and passes that exact path; reuse it for worker follow-ups |
| Local `agy-implement/SKILL.md` | Example currently creates `/home/copilot/work/agy-<slug>` | Use the checked Volume path instead; the shared repo rule takes precedence over the example |
| Repo `AGENTS.md`, Claude `CLAUDE.md` | Shared lifecycle policy; `CLAUDE.md` directs Claude to read `AGENTS.md` | Read current shared instructions before allocating a workspace; pass them to delegated workers |

No existing repository checkout manager was found. The change retains Git and
the installed agent launchers. Local launcher/skill settings are outside the
repo: this PR does not install hooks or rewrite them. Agents/coordinators must
follow the shared rule; automatic workspace allocation before instruction loading
is not intercepted by repository instructions. Operators must configure such a
launcher to use an explicit prepared checkout, or STOP that launch path. A stale
checkout or installed skill does not automatically receive new instructions;
coordinators must supply this current rule before starting a new task/worker.

## Allocate with the existing Git mechanism

Run from a trusted checkout containing the reviewed preflight script, after
checking there is no existing checkout for this task. Use a unique directory
name, distinct from other agents' tasks; branch names retain existing conventions.
The preflight only reads mount/path state and prints one destination. It does not
create, chown, chmod, mount, clone or run Git, and it never chooses a fallback.

```bash
# Inspect the task handoff and existing worktrees first.
git worktree list
# Fetch uses the configured arcade-code-agent Git credential helper.
git fetch origin main
agent_task_dir=$(node scripts/ops/agent-workdir-preflight.mjs task-1246) || exit 1
git worktree add -b ops/task-1246 "$agent_task_dir" origin/main
cd "$agent_task_dir"
```

For a genuinely independent clone, use the same preflight immediately before
`git clone https://github.com/krzysztofcal/arcadePlatform.git "$agent_task_dir"`.
Do not create a directory first: the guard refuses any existing destination,
including symlinks, to avoid confusing a fresh allocation with a task resume.
A preflight failure must stop the caller before Git runs; do not ignore its exit
code or use a default value. A creation failure also means STOP, with no retry
in another directory. Do not invoke `git worktree remove`, `prune`, `clean`,
`reset --hard`, or filesystem cleanup to make a name available.

For a new Antigravity worker use a distinct directory such as `agy-task-1246`
and branch `agy/task-1246`, then pass the checked path to the existing wrapper's
`--worktree`. For Claude, `cd` to the prepared checkout before running `claude`.
Keep task ownership and review identities unchanged.

## Preflight and limits

`node scripts/ops/agent-workdir-preflight.mjs <unique-task-name>` requires the
exact `/dev/sdb` EXT4 read-write mount at `/mnt/HC_Volume_107462648`, the fixed
Hetzner by-id link pointing to `/dev/sdb`, and a real `copilot-work` directory
on the same device, owned by the non-root invoking uid/gid with mode `0750`
and write/search access. It rejects redirected paths, missing/unverifiable
mounts, existing destinations and invalid names (including traversal). No root
permission or change to the admin helper is involved.

This check is a point-in-time guard, not a mount lock or a security sandbox for
agents that can run arbitrary commands. Do not unmount/change the Volume while
agents allocate or use worktrees; if mount identity changes, stop allocation
and investigate rather than writing to the root filesystem. The mount directory
is root-owned and not writable by copilot when unmounted; do not change it or
create fallback parents. No script here remounts it or repairs permissions.

A linked worktree keeps Git objects and administrative metadata in its existing
common repository, possibly on the root disk. Only the new worktree content is
on the Volume. An independent clone places its own `.git` on the Volume too.
No existing common Git directory, cache, session, secret, deployment or
Production data is moved. Disk pressure outside checkout content is unchanged.

Fundamental checks run in the existing VPS guard suite:
`node --test ws-tests/infra-vps-workflow.guard.test.mjs ws-tests/infra-vps-caddy.guard.test.mjs`.
They simulate unavailable/wrong/read-only mounts and unsafe paths without root,
mounting, actual agent launches or writes to operational directories.
