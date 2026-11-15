# WWW Production release from GitHub (#1254)

Status: implementation, **not activated or exercised against Production**. This change does not authorize a hook,
publication, Production secret change or first run. OWNER must separately approve configuration and activation.
The existing [manual procedure](../specs/1159-ci-cd-release-safety/pr5-www-production-publish.md) remains supported
until an owner-approved first release proves the replacement. Do not remove its hook/tool or unlock publishing.

## Required configuration (OWNER, separate GO)

Enable Actions and repository **Immutable Releases**. Grant the workflow GITHUB_TOKEN only the per-job permissions
in YAML: contents read, actions read; contents write only for Release Record publication. The code agent needs no
additional privilege. The Environment/approval APIs must be readable by this token; unavailable/unsupported
settings fail closed. Do not weaken protection to work around an API/plan limitation.

Create two GitHub Environments: `www-candidate` and `www-production`. Each requires exactly the user
`krzysztofcal` as required reviewer, `prevent_self_review=false` (OWNER dispatches and approves),
`can_admins_bypass=false`, and custom deployment branch policy: **branch main only**, no tag policy/wildcard.
Protect main with the existing review rules. Candidate approval protects Production credentials and the hook;
publishing still needs a separate dispatch and approval in `www-production`. Secrets are unavailable until approval.

Environment-scoped secrets in **both** environments:

| Secret | Purpose |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Existing authorized site API access for validation/discard; publisher also restores/relocks |
| `WS_PROD_SSH` | Existing read-only SSH evidence target (`user@host`) |
| `WS_PROD_SSH_KEY` | Dedicated evidence-only identity, not `WS_PRODUCTION_SSH_KEY` or an OWNER deployment key |
| `WS_PROD_KNOWN_HOSTS` | Independently verified host-key pin; never runtime `ssh-keyscan` trust |

Only `www-candidate` additionally holds `NETLIFY_BUILD_HOOK`: the existing main Production hook for `playkcswh`.
Do not create a parallel hook or use CLI production deploys. Keep Netlify auto publishing locked and `[build].ignore`
unchanged. Confirm the token can access site `f7e19a84-28f7-41f7-978a-f3b4552a404d`, never another site.

Provision the SSH identity through the existing approved administrative process, separately authorized. It must
support only the existing fixed `VPS_READ` in `scripts/www-production-release.mjs` (current release/metadata,
installation timestamp, service status), with no writes, shell expansion, forwarding or deployment authority.
If that identity is not already available, activation is blocked; implementation grants no provisioning authority.
Use the existing read-only SSH mechanism, not the WS deployment account/key. Ephemeral runner key files are removed.

## Two OWNER actions (mobile GitHub UI is sufficient)

1. Actions → **Create WWW Candidate**, branch `main`, optional full `sha` equal to current main HEAD. Approve
   `www-candidate`. This calls the existing hook once with a unique run/attempt/random title, correlates a *new*
   exact-SHA production deploy through the Netlify API, waits boundedly for ready, then runs the existing complete
   dry-run. Summary provides the permalink and candidate run link/ID. No automatic publication.
2. Within **30 minutes from candidate creation**, Actions → **Publish WWW Production**, branch `main`, input
   `candidate_run_id` from step 1; approve `www-production`. It accepts only a successful owner main candidate run,
   attempt 1, with one immutable `www-candidate-1` artifact and exact provenance. It runs the existing full validation
   and immediate current-main/WS/candidate/current-deploy rechecks before its only restore call. Lock is preserved
   or relocked once by the existing tool. GET-only LIVE verification then automatically calls restricted Release
   Record; no separate dispatch or deploy ID entry.

Both actions share one concurrency group (including approval wait and record); do not enqueue unrelated releases.
GitHub concurrency is not an unbounded FIFO: a later queued request can replace a pending one. Never rerun a run;
attempts beyond 1 fail closed. Avoid merges and WS deployments during release. Reconcile interrupted runs before
starting another release. No lock can prevent an OWNER out-of-band Netlify operation; existing final checks detect drift.

LIVE verification reads only `/`, `/js/build-info.js`, canonical Terms PL/EN, Privacy PL/EN and `/account.html`.
Legal documents and account page must exactly match the approved commit; legal versions are taken from that commit,
and Privacy must contain the account-deletion anchor. Build identity, CSP/HSTS and Netlify locked published deploy
are checked. It never invokes functions, login, deletion, chips, XP, Redis or other mutating API endpoints.

## STOP and cleanup

Candidate permalinks expose Production functions. Do not test mutations there or leave candidates abandoned.
A failed candidate attempts the existing guarded discard. Failed/cancelled jobs also reconcile only their own saved
intent/unique marker and attempt guarded discard; building/unknown/published deploys cannot be deleted. Hard runner
loss or job timeout can prevent cleanup entirely: inspect the artifact/summary and reconcile manually. An unidentified
hook response or an ambiguous title is STOP, never permission to pick the latest deploy. Polling is bounded to about
10 minutes, API requests have deadlines, and the hook POST is never retried.

For an abandoned or expired successful candidate use **Publish WWW Production** with its `candidate_run_id` and
`discard=true`, then approve the environment. Stale/expired candidates encountered by normal publish are discarded
and the job fails asking for a new candidate. Discard still validates trusted provenance and refuses previously
published/current/building deploys. API 404 **and** permalink 404 are required; otherwise `discard_unverified_STOP`.
There is no unattended scheduled deletion. Lost/expired artifacts require the retained manual guarded discard path
with OWNER reconciliation; never bypass identity or delete unknown deploys.

After restore, failures are **published_smoke_failed_STOP** or **uncertain_STOP**, not “no deployment”. No automatic
retry, rollback, historical restore or candidate deletion occurs. A killed execute process can leave an uncertain
receipt: OWNER must inspect the actual site/deploy/lock before any further action. GitHub summaries and sanitized JSON
receipts distinguish candidate failure, discard, publication, LIVE smoke and record outcome. Candidate artifacts last
1 day, publication/cleanup artifacts 7 days; download operational evidence promptly. This retention is not automatic
deploy deletion. An immutable GitHub Release retains WWW deploy/SHA/publication/candidate run references permanently.

If LIVE passes but Release Record fails, **Production is already published**. The parent run is failed, never a
verified full release. Do not rerun publication. OWNER reconciles using the existing direct Release Record procedure.

## Record trust and compatibility

`release-record.yml` retains its existing direct dispatch. Reuse is deliberately narrow: `approved_www=true` requires
`github.workflow_ref` exactly the owner main `www-publish.yml`, OWNER actor and triggering actor, attempt 1,
component WWW, publishing enabled, successful publication job, actual owner Environment approval and immutable LIVE
receipt. Arbitrary callers, agents, PRs and supplied deploy IDs cannot authorize this path. No inherited secrets.

The record uses the existing manifest builder and immutable Release publisher. New WWW chained tags use
`release-<UTC date>-<workflow run ID>` to avoid overlapping workflow run-number namespaces; direct records keep their
existing format. Schema remains 1; chained WWW evidence adds `publicationRunId`, `candidateRunId`, `environment`.
Subsequent records validate the immutable asset plus parent owner run, successful record/publication jobs and GitHub
approval history; they do not depend on expiring artifacts. Old direct records remain valid. Record creation never
publishes Netlify or deploys WS.

No runtime, Netlify routing/build-ignore, WS package, DB schema, browser scripts, CSP configuration or financial
behavior changes. Existing direct release tooling remains supported until validated cutover. New configuration is
additive; missing environments/secrets/approval/API capability blocks the new workflows. No Production configuration
has been changed by implementation. No new service or dependency. No Supabase egress (only bounded GitHub/Netlify
metadata and static GETs at owner release frequency). A future cutover/removal requires measured first-run evidence
and separate OWNER approval.
