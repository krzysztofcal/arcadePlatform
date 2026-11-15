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

1. Actions → **Create WWW Candidate** → **Run workflow**, branch `main`, leave optional `sha` blank.
2. Approve **`www-candidate`**. The existing hook is called once; complete dry-run and static candidate smoke run.
3. Open the clickable immutable Netlify candidate permalink in that run's **Summary**. Inspect read-only only:
   candidate functions use Production data; this is not an isolated Stage preview.
4. Within **30 minutes from candidate creation**, Actions → **Publish WWW Production** → **Run workflow**, branch
   `main`, leave `candidate_run_id` blank and `discard=false`.
5. Approve **`www-production`**. Empty ID selects only the unique fully eligible candidate, using the existing
   complete safety dry-run before the normal execute path and its immediate rechecks.
6. Automatic GET-only LIVE verification and immutable Release Record follow publication; no separate dispatch.

Automatic selection reads **at most five successful OWNER/main candidate runs for the exact current main SHA**,
then requires the API's total count to match the complete returned list. It deliberately does not filter by run
creation time: a long Environment approval wait must not hide a fresh candidate. Reruns are excluded. Each candidate
needs an authentic unexpired artifact, matching `candidate_ready` provenance and dry-run/static-check receipts,
age at most 30 minutes (rechecked after validation), and the existing Netlify identity/unpublished/lock/function/
header/WS checks. Proven stale or already-published candidates are ineligible. No eligible candidate, multiple eligible
candidates, more than five matching runs, missing/incomplete evidence, or other validation errors mean **STOP before
restore or discard**. There is no latest-run/latest-deploy fallback and no unbounded pagination. A long-lived main
revision can hit the five-run bound; reconcile candidates and supply an explicit ID instead of guessing.

A nonempty `candidate_run_id` retains the existing explicit-ID validation and recovery/discard path. In particular,
`discard=true` should use that explicit run ID for an abandoned/expired candidate; blank-ID discovery only accepts
fresh eligible unpublished candidates. Existing safe discard, lock, uncertain-execute STOP and no automatic rollback
remain unchanged.

OWNER self-approval is intentionally accepted **only for the two new WWW Environments** (`prevent_self_review=false`).
Keep them separate; do not reuse or modify `ws-production`, `vps-admin`, or other existing Environments. Their
policies and authorities remain distinct. Activation and all Environment/secret/SSH configuration still need
separate OWNER GO and remain BLOCKED until configured.

Both actions share one concurrency group (including approval wait and record); do not enqueue unrelated releases.
GitHub concurrency is not an unbounded FIFO: a later queued request can replace a pending one. Never rerun a run;
attempts beyond 1 cannot operate; source/previous evidence is pinned to original attempt 1. Avoid merges and WS deployments during release. Reconcile interrupted runs before
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
hook response or an ambiguous title is STOP, never permission to pick the latest deploy. Polling is bounded by a wall-clock deadline of about
10 minutes (plus an in-flight bounded API request), API requests have deadlines, and the hook POST is never retried.

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

Additional operational compatibility notes: direct Release Record publication also requires a fresh attempt-1
dispatch; failed runs must not be rerun to publish. The retained manual tool now bounds each Netlify API call to
20 seconds, including restore: a slow/timeout restore becomes `uncertain`, requiring OWNER observation instead
of waiting indefinitely. A candidate still building after cancellation/timeout needs the retained manual guarded
discard once ready/error; the GitHub publisher accepts only successful validated candidates, so it cannot clean up
that failed-run case. Never delete or edit a published immutable record to work around provenance failure.
