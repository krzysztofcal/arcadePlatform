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

## Local Antigravity skill update (separate GO required)

Read-only inspection on 2026-11-14 confirmed that the installed
`~/.claude/skills/agy-implement/SKILL.md` still uses
`/home/copilot/work/agy-<slug>` in steps 2 and 3. This documentation does not
update that local skill or authorize local launcher/configuration changes.

After a separate explicit GO, minimally update those two examples: run the
existing preflight from a trusted current checkout immediately before
`git worktree add`, stop on any failure, use its stdout as the explicit
destination, and pass that same path to `agy-implement.sh --worktree`.
State that existing task checkouts are reused in place and reference AGENTS.md
as the policy source. Review the local diff for stale root-disk allocation
examples; no wrapper changes, new manager or migration are needed.

Codex automatic `create_worktree` and Claude Code automatic `--worktree`
launch paths still require separate operator configuration to open an
explicitly prepared Volume checkout (or must remain unused). Updating the
Antigravity skill examples is also a separate local step; repository policy
does not configure these launchers automatically.

## Allocate with the existing Git mechanism

Run from a trusted checkout containing the reviewed preflight script, after
checking there is no existing checkout for this task. Use a unique directory
name, distinct from other agents' tasks; branch names retain existing conventions.
The preflight only reads mount/path/capacity state and prints one destination. It does not
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
Production data is moved. Agent session/configuration stores remain on root; use the task-scoped recipe below for reproducible writes.

Fundamental checks run in the existing VPS guard suite:
`node --test ws-tests/infra-vps-workflow.guard.test.mjs ws-tests/infra-vps-caddy.guard.test.mjs`.
They simulate unavailable/wrong/read-only mounts and unsafe paths without root,
mounting, actual agent launches or writes to operational directories.

## Heavy-task guard and task-scoped environment

Before each heavy agent launch, dependency install, build or test batch (including
legacy task resumes), run the reviewed current preflight, not a stale task copy:

```bash
node /path/to/trusted-current-checkout/scripts/ops/agent-workdir-preflight.mjs --check || exit 1
```

`--check` verifies the same fixed Volume identity/ownership/access without
allocating a name, and prints root/Volume capacity as JSON. New allocations also
perform this check. Root usage follows `df` (used / (used + available), rounded
up): WARN on stderr at **85%**, STOP at **90%** or **less than 4 GiB available**.
Volume must also have at least 4 GiB available. Missing/invalid capacity data is
STOP. Stdout for a successful name allocation remains exactly one path. This is
a point-in-time check, not a quota: rerun between heavy steps; stop scheduling
new heavy work on failure. Do not kill or reconfigure existing processes.

Use the existing launchers inside a subshell with a fresh, separately checked
runtime directory. This works for a new Volume checkout or a legacy checkout
without moving it. Replace `task-unique-runtime` with a unique task identifier;
keep its returned path in the handoff and reuse it for follow-ups after checking
canonical path, ownership, permissions, device and absence of symlinked children.
Do not allocate a fresh runtime directory for each review round.

```bash
# Run from the task checkout; preflight is from a trusted current checkout.
(
  set -eu
  preflight=/path/to/trusted-current-checkout/scripts/ops/agent-workdir-preflight.mjs
  agent_runtime=$(node "$preflight" task-unique-runtime) || exit 1
  mkdir -m 700 -- "$agent_runtime" || exit 1
  mkdir -m 700 -- "$agent_runtime/tmp" "$agent_runtime/cache" "$agent_runtime/artifacts"
  export TMPDIR="$agent_runtime/tmp"
  export XDG_CACHE_HOME="$agent_runtime/cache"
  export npm_config_cache="$agent_runtime/cache/npm"
  export PLAYWRIGHT_BROWSERS_PATH="$agent_runtime/cache/ms-playwright"
  export GRADLE_USER_HOME="$agent_runtime/cache/gradle"
  node "$preflight" --check || exit 1
  # Choose the existing launcher for this task, e.g.:
  claude
  # Or: codex (explicit prepared cwd; no automatic worktree allocation)
  # Or: ~/.claude/skills/agy-implement/agy-implement.sh \
  #   --worktree "$agent_task_dir" --task /path/to/task.md \
  #   --out "$agent_runtime/artifacts/agy"
)
```

The subshell leaves the parent's HOME/TMPDIR untouched. Do not set CODEX_HOME,
CLAUDE_CONFIG_DIR or redirect HOME: those mix sessions, identity, credentials,
settings and databases with disposable data. TMPDIR controls cooperating child
processes, not hardcoded `/tmp` writes or agent-private state. XDG_CACHE_HOME
alone does not redirect npm, Playwright, Gradle or agent session stores; the
explicit variables above cover these tools. Gradle's task cache can contain
user properties: do not copy the existing ~/.gradle or secrets into it.
Set output paths explicitly for each invoked tool (Playwright `--output`, build
output options, screenshot destinations, shell redirects). `artifacts` is a
convention, not an environment variable that redirects all tools. Do not route
financial/audit evidence into disposable artifacts. Relative build outputs in
a Volume checkout (node_modules, dist, test-results) already stay on Volume;
a legacy checkout's relative outputs still use root unless explicitly redirected.
Do not run tools with unsupported output overrides: retain/report that root
write or postpone the heavy step. Tools that ignore these settings need their
own verified task setting before claiming coverage.

## VPS inspection and activation status (2026-11-14)

Read-only inventory after #1247/#1248, based on current main and installed
launchers, `findmnt`, `df`, `du` and readable `/proc` cwd/environment:

| Writer / path | Actual filesystem and observation | Activation still needed |
|---|---|---|
| New prepared checkouts under `/mnt/HC_Volume_107462648/copilot-work` | `/dev/sdb`, EXT4 rw; existing follow-up checkout and this task checkout on Volume | Coordinators must call preflight; automatic Codex worktree / Claude `--worktree` paths remain unused |
| Linked worktree common `.git` | `/home/copilot/work/arcadePlatform/.git`, root | Remains here; independent future clones can place Git objects on Volume |
| Codex executable | NVM global package; active readable Codex cwd is `/home/copilot/work/arcadePlatform`, with no task TMPDIR/cache overrides | Launch future tasks from prepared cwd with scoped environment |
| `~/.codex` | Root, ~5.3 GiB; sessions ~3.2 GiB, packages ~996 MiB, `.tmp` ~87 MiB, generated_images ~73 MiB | Retain sessions, SQLite state, auth, locks and installed packages; TMPDIR does not relocate these stores |
| Claude executable | NVM `@anthropic-ai/claude-code/bin/claude.exe`; active readable cwd `/home/copilot/work/arcadePlatform2`, no task TMPDIR/cache overrides | Future explicit cwd and scoped environment; no active-session changes |
| `~/.claude`, `/tmp/claude-1001` | Root, ~129 MiB and ~1.9 GiB respectively; projects ~98 MiB | Keep session/file-history/config stores; use task TMPDIR for future cooperating temporary writes, verify actual CLI behavior |
| Antigravity `~/.local/bin/agy` and `agy-implement.sh` | Binary on root; wrapper inherits environment and accepts arbitrary `--out`; no readable active agy process observed | Separate OWNER GO to update installed skill's two stale root allocation examples and add scoped launch recipe/pre-heavy check; pass Volume `--out` |
| `~/.gemini/antigravity-cli` | Root, ~745 MiB; conversations ~387 MiB, brain ~323 MiB | Keep brain/conversations/config/identity; use scoped TMPDIR and explicit wrapper outputs; optional `agy --log-file` only for new disposable diagnostic logs |
| `/tmp`, `~/.cache`, `~/.npm` | Root, ~6.4 GiB, ~1.4 GiB, ~375 MiB; Playwright ~924 MiB, arcadeplatform cache ~412 MiB | Future task settings above; no cache/session migration authorized |

At inspection root was 82% used (~6.7 GiB available); Volume 1% used (~47 GiB
available). Sizes are approximate snapshots, not growth attribution. `/proc`
visibility is incomplete for some processes; absence of a readable environment
is not evidence that a process is stopped. Existing running shells/agents keep
their original environment. Repo instructions cannot intercept launches before
they read those instructions. No installed launcher/config was changed by this PR.

Task-scoped verification in this task used the separate
`copilot-work/agent-disk-guard-runtime` directory: Node temporary-file creation
reported device 2064, equal to the mounted Volume; Python selected the same
Volume TMPDIR; npm resolved its cache to that runtime directory. Guard test
fixtures and their redirected report were also run there (37 passing tests).
This verifies these cooperating tools, not every private write of all agents.
Claude review uses this environment and an explicit Volume output; automatic
session persistence is disabled for that fresh review only. No new agy
implementation task was launched just to test storage.

## Completed artifacts and monitoring (separate OWNER GO)

No existing data was moved, removed or selected as safe by age/name alone.
The large `/tmp` fixtures/build directories, Playwright downloads and generated
images are candidates for **per-task assessment**, not an approved move list.
Moving completed artifacts from a live agent is possible only when the producing
subprocess has exited and the owner confirms no task/resume/dependency still
needs the path. Check cwd/open files/process trees plus task handoff, tracked,
untracked and ignored files; inability to inspect any relevant process is STOP.
Exclude active sessions, auth/secrets, SQLite/other databases, locks, Antigravity
brain/conversations, financial records and audit/recovery evidence. A merged PR
does not establish these conditions. Cross-filesystem `mv` copies then deletes;
it is outside this task. A later approved transfer needs an exact source list,
verified Volume destination, integrity verification and retained source until
separate deletion authorization. Copying alone does not reclaim root space.

No VPS disk alert collector was found among visible services, timers or copilot
cron. Existing `sysstat` timers measure system activity; weekly
`arcadeplatform-vps-maintenance` handles narrowly scoped release/temp cleanup,
not agent stores or disk alerts. Keep both unchanged. The Stage Supabase resource
health workflow measures another host and cannot monitor this VPS filesystem.

Simplest initial detection: run this same read-only `--check` at task start and
between heavy steps; compare its capacity JSON and bounded `du -sx` snapshots of
`/tmp`, `~/.codex`, `~/.claude`, `~/.gemini`, `~/.cache`, `~/.npm` when free space
falls. For unattended detection, OWNER may connect these capacity metrics to an
existing external VPS monitor if available (not verified here), or approve a
small copilot user timer invoking `--check` every 15 minutes with bounded
journald output and a warning/STOP notification route. No automatic cleanup,
new workspace manager, Production timer change or monitoring activation is in
this PR. A timer that only logs is not an alert until notification delivery is
configured and tested.
