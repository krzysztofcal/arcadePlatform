# WWW Production release from GitHub (#1254)

Status: the OWNER path has completed Candidate [43873170221](https://github.com/krzysztofcal/arcadePlatform/actions/runs/43873170221)
and Publish/LIVE/Record [43875913487](https://github.com/krzysztofcal/arcadePlatform/actions/runs/43875913487), recorded by immutable
[release-20261116-43875913487](https://github.com/krzysztofcal/arcadePlatform/releases/tag/release-20261116-43875913487).
T007 agent Candidate is implemented but **not activated/tested**; merge is not activation or hook authorization.
Retain the existing [OWNER manual recovery](../specs/1159-ci-cd-release-safety/pr5-www-production-publish.md); no cleanup
or removal of that procedure is authorized. Publish remains exclusively OWNER-triggered and OWNER-approved.

## Required configuration (OWNER, separate GO)

Enable Actions and repository **Immutable Releases**. Grant the workflow GITHUB_TOKEN only the per-job permissions
in YAML: contents read, actions read; contents write only for Release Record publication. The code agent needs no
additional privilege. The Environment/approval APIs must be readable by this token; unavailable/unsupported
settings fail closed. Do not weaken protection to work around an API/plan limitation.

For the legacy OWNER path create two GitHub Environments: `www-candidate` and `www-production`. Each requires exactly the user
`krzysztofcal` as required reviewer, `prevent_self_review=false` (OWNER dispatches and approves),
`can_admins_bypass=false`, and custom deployment branch policy: **branch main only**, no tag policy/wildcard.
Protect main with the existing review rules. Candidate approval protects Production credentials and the hook;
publishing still needs a separate OWNER dispatch and approval in `www-production`. Secrets are unavailable until approval.

Environment-scoped secrets in **both** environments:

| Secret | Purpose |
|---|---|
| `NETLIFY_AUTH_TOKEN` | Existing authorized site API access for validation/discard; publisher also restores/relocks |
| `WS_PROD_SSH` | Existing read-only SSH evidence target (`user@host`) |
| `WS_PROD_SSH_KEY` | Dedicated evidence-only identity, not `WS_PRODUCTION_SSH_KEY` or an OWNER deployment key |
| `WS_PROD_KNOWN_HOSTS` | Independently verified host-key pin, or the explicitly approved one-time Hetzner exception below; never runtime `ssh-keyscan` trust |

For the legacy OWNER path only `www-candidate` additionally holds `NETLIFY_BUILD_HOOK`; the separately activated
T007 agent Environment also needs the same approved capability: the existing main Production hook for `playkcswh`.
Do not create a parallel hook or use CLI production deploys. Keep Netlify auto publishing locked and `[build].ignore`
unchanged. Confirm the token can access site `f7e19a84-28f7-41f7-978a-f3b4552a404d`, never another site.

Provision the SSH identity through the dedicated two-step VPS Admin process below, separately authorized. It must
support only the existing fixed `VPS_READ` in `scripts/www-production-release.mjs` (current release/metadata,
installation timestamp, service status), with no writes, shell expansion, forwarding or deployment authority.
If that identity is not already available, activation is blocked; implementation grants no provisioning authority.
Use the existing read-only SSH mechanism, not the WS deployment account/key. Ephemeral runner key files are removed.

## Legacy OWNER Candidate and OWNER Publish (mobile GitHub UI is sufficient)

1. Actions → **Create WWW Candidate** → **Run workflow**, branch `main`, leave optional `sha` blank.
2. Approve **`www-candidate`**. The existing hook is called once; complete dry-run and static candidate smoke run.
3. Open the clickable immutable Netlify candidate permalink in that run's **Summary**. Inspect read-only only:
   candidate functions use Production data; this is not an isolated Stage preview.
4. Within **48 hours from candidate creation**, Actions → **Publish WWW Production** → **Run workflow**, branch
   `main`, leave `candidate_run_id` blank and `discard=false`. Finish approval/publication before expiry;
   dispatching before the deadline does not reserve the candidate.
5. Approve **`www-production`**. Empty ID selects only the unique fully eligible candidate, using the existing
   complete safety dry-run before the normal execute path and its immediate rechecks.
6. Automatic GET-only LIVE verification and immutable Release Record follow publication; no separate dispatch.

Automatic selection reads **at most five successful trusted OWNER/App main candidate runs in total (two bounded actor queries) for the exact current main SHA**,
then requires the API's total count to match the complete returned list. It deliberately does not filter by run
creation time: a long Environment approval wait must not hide a fresh candidate. Reruns are excluded. Each candidate
needs an authentic unexpired artifact, matching `candidate_ready` provenance and dry-run/static-check receipts,
age at most 48 hours from provenance `createdAt` (before the build hook, not approval or build completion;
exactly 48 hours is accepted, greater age is expired, and age is rechecked after validation), and the existing
Netlify identity/unpublished/lock/function/header/WS checks. Proven stale or already-published candidates are ineligible. No eligible candidate, multiple eligible
candidates, more than five matching runs, missing/incomplete evidence, or other validation errors mean **STOP before
restore or discard**. There is no latest-run/latest-deploy fallback and no unbounded pagination. A long-lived main
revision can hit the five-run bound; reconcile candidates and supply an explicit ID instead of guessing.

A nonempty `candidate_run_id` retains the existing explicit-ID validation and recovery/discard path. In particular,
`discard=true` should use that explicit run ID for an abandoned/expired candidate; blank-ID discovery only accepts
fresh eligible unpublished candidates. Existing safe discard, lock, uncertain-execute STOP and no automatic rollback
remain unchanged. Returning the next day works only while the candidate SHA is still the exact current
`main` and all current Production checks (including WS compatibility and the published Netlify lock) pass.
The longer lifetime never freezes or bypasses those checks. More successful runs can accumulate over 48 hours;
the existing five-run completeness bound and ambiguity STOP remain unchanged.

This policy applies to new candidates created after this change is merged. Run `43863728077` was started
with the old code and retention; do not modify, rerun or reuse it as a new 48-hour candidate. Its cleanup,
if needed, requires the existing separately approved guarded discard. Create a fresh candidate from the
then-current main under separate OWNER GO; this PR starts no build or publication.

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

The root `netlify.toml` disables Pretty URLs HTML post-processing so Netlify does not rewrite anchor
URLs/serialization after the build. Legal/account comparison remains exact; version and deletion-anchor
checks are not relaxed. This affects newly built HTML only, not existing deploys. Preserve explicit
`.html` links and the configured redirects; do not enable HTML rewriting to work around a smoke failure.

## STOP and cleanup

Candidate permalinks expose Production functions. Do not test mutations there or leave candidates abandoned.
A failed candidate attempts the existing guarded discard. Failed/cancelled jobs also reconcile only their own saved
intent/unique marker and attempt guarded discard; building/unknown/published deploys cannot be deleted. Hard runner
loss or job timeout can prevent cleanup entirely: inspect the artifact/summary and reconcile manually. An unidentified
hook response or an ambiguous title is STOP, never permission to pick the latest deploy. Polling is bounded by a wall-clock deadline of about
10 minutes (plus an in-flight bounded API request), API requests have deadlines, and the hook POST is never retried.

For an abandoned or expired successful candidate use **Publish WWW Production** with its `candidate_run_id` and
`discard=true`, then approve the environment. After 48 hours, blank-ID discovery excludes that candidate;
use its explicit ID for cleanup while its 3-day artifact is still available. Retention does not extend
publish eligibility. Stale/expired candidates encountered by explicit-ID normal publish are discarded
and the job fails asking for a new candidate. Discard still validates trusted provenance and refuses previously
published/current/building deploys. API 404 **and** permalink 404 are required; otherwise `discard_unverified_STOP`.
There is no unattended scheduled deletion. Lost/expired artifacts require the retained manual guarded discard path
with OWNER reconciliation; never bypass identity or delete unknown deploys.

After restore, failures are **published_smoke_failed_STOP** or **uncertain_STOP**, not “no deployment”. No automatic
retry, rollback, historical restore or candidate deletion occurs. A killed execute process can leave an uncertain
receipt: OWNER must inspect the actual site/deploy/lock before any further action. GitHub summaries and sanitized JSON
receipts distinguish candidate failure, discard, publication, LIVE smoke and record outcome. Candidate artifacts last
3 days, publication/cleanup artifacts 7 days; download operational evidence promptly. This retention is not automatic
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

The original automation implementation changed no runtime, Netlify routing/build-ignore, WS package, DB
schema, browser scripts, CSP configuration or financial behavior. The later Pretty URLs setting above
changes HTML link serialization for future builds; explicit redirects and build-ignore remain unchanged. Existing direct release tooling remains supported until validated cutover. New configuration is
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


## Dedicated SSH evidence identity (#1254; OWNER path exercised, T007 configuration separate)

Use only `arcade-www-read` provisioned by `www-ws-read-prepare`, followed by separately approved
`www-ws-read-key-sync`. See [VPS Admin enrollment and recovery](vps-admin-operations.md#dedicated-www-evidence-reader-1254).
The fixed public-key asset starts empty. This code PR neither provisions the account nor installs/generates
any real key. Both actions retain `vps-admin` OWNER approval; WWW's two separate Environments retain their
own OWNER approvals and accepted self-approval policy on the legacy OWNER path. The separately gated T007
agent Candidate Environment is described below. No WS/VPS Environment is reused for WWW publishing.

After successful preparation, reviewed public-key enrollment and explicit read-only SSH acceptance,
OWNER separately configures these three secrets in **both** `www-candidate` and `www-production`:

| Secret | Value source (never print private data) |
|---|---|
| `WS_PROD_SSH` | `arcade-www-read@<verified-current-VPS-host>`; never a deployment or OWNER identity |
| `WS_PROD_SSH_KEY` | Corresponding dedicated private key, entered directly by OWNER from secure off-VPS custody |
| `WS_PROD_KNOWN_HOSTS` | OpenSSH known_hosts entry for that exact hostname/port, verified against host public key/fingerprint through an independent trusted OWNER console, subject only to the one-time Hetzner exception below |

Do not trust runtime `ssh-keyscan`, disable strict checking or pin a Hetzner IP/host key in code. A future
OVH migration repeats trusted provisioning, public-key enrollment and independent host-key verification;
update endpoint/pin only under separate GO. Never copy the private key onto either VPS. The wrapper accepts
only the existing exact `VPS_READ`; interactive sessions, arbitrary commands and forwarding stay disabled.
It returns the existing `vpsWsRelease()` evidence format with only required public metadata fields.

If SSH policy, permissions, identity, manifest or source SHA is unverified, release activation remains BLOCKED.
Unverified host-key provenance also blocks activation unless the scoped exception below is approved and all its conditions hold.
Do not widen WS permissions or borrow the Preview/deployment key. Key revocation
uses a reviewed empty public-key asset plus separately approved key-sync; partial failure requires protected
state inspection without automatic retry. A fresh OWNER-approved empty-asset key-sync can revoke a known
interrupted enrollment slot even when WS/SSH/wrapper health has drifted; it does not resume the failed action. Existing manual WWW release remains available under its own gates.
No breaking change to WWW/WS runtime or existing release workflows; this additive admin path requires separate
installation/configuration/acceptance GO before first use.


## One-time Hetzner host-key provenance exception (#1254)

**Security exception proposal; approval/use status is recorded in issue #1254 as specified below.**
Absent that record, the exception is not approved: **STOP**. Preparing, approving review of, or merging
this documentation alone does not approve the exception or authorize activation. The default remains independent host-key
verification. Only the first WWW SSH activation on the current Hetzner VPS at `91.98.174.191` may use
this exception, bound to this exact ED25519 host-key fingerprint:

`SHA256:X6pvnIIAu6NWMpnsOguE5D+J/bo+94o0hlnDhRYQTAQ`

Evidence reported by OWNER on 2026-11-16 for the proposed first activation:

- An existing historical `known_hosts` entry in OWNER's Termux matches the host public key read on the VPS.
- The matching ED25519 key has the fingerprint above.
- For the dedicated `arcade-www-read` identity, the exact `VPS_READ` request succeeded; shell, PTY and
  forwarding attempts were denied.

These are OWNER-reported results, not tests repeated by this documentation PR. Historical `known_hosts`
and OWNER's statement are **not independent cryptographic verification of host identity**. Reading a key
through the existing VPS connection does not establish an independent trust anchor. Agreement and the
acceptance tests demonstrate continuity and reader restrictions, but cannot exclude an already compromised
client/server or an interception present when trust was first established. A falsely trusted host could
forge WS release evidence and undermine WWW release validation; this residual risk is deliberately accepted
only through the explicit exception approval, not described as equivalent security. Although establishment
of the pin is a one-time action, this residual risk persists for every later candidate/publication using
that pin until independent verification succeeds or the key is replaced under the normal procedure.

Before use, OWNER must post a distinct written exception-approval comment in
[issue #1254](https://github.com/krzysztofcal/arcadePlatform/issues/1254), linking this documentation PR.
An approving PR review or merge alone is insufficient. The comment must explicitly name `91.98.174.191`,
the actual SSH port and fingerprint, accept the ongoing residual risk above, and retain the exact public
OpenSSH `known_hosts` entry and the reported comparison/test results with their provenance. The port is
not established by this documentation; absent its explicit binding in that record means **STOP**.
Use the IP literal in the SSH endpoint and corresponding exact IP/port `known_hosts` entry. Obtain the
pin and comparison from OWNER's own historical entry and retained evidence, never by copying a pin from
this document. Missing or inconsistent evidence means **STOP**; keep private keys and tokens out of the record.

OWNER must append a consumed status to the same issue record once the initial pin is configured, with
the date and a reference to the separate configuration GO. No record means not approved; an approved
record without a consumed entry is not proof that configuration completed. Inspect actual configuration
before further action; never repeat configuration automatically. Initial configuration of this same pin
in both `www-candidate` and `www-production` is covered as one enrollment, not a new exception per
Environment. Later re-entry of the identical pin for the identical host/port remains bound to this
acceptance record and needs separate configuration GO; it does not renew or widen the exception.
Configuration and first activation still require their separate OWNER GO; all VPS/WWW Environment
approvals and other activation gates remain mandatory.

`StrictHostKeyChecking=yes` and the exact public-key pin remain mandatory for every connection, using only
`arcade-www-read` and its dedicated key. A fingerprint mismatch, unavailable pin or unexpected endpoint
means **STOP**, fail closed: no automatic replacement, `accept-new`, runtime `ssh-keyscan` trust, alternative
identity or disabled checking. The one-time exception covers only establishing this initial pin; subsequent
connections must continue to match it. It grants no exception for key rotation, host rebuild/replacement,
a different address/port, OVH migration or any other host. Those require independent host-key verification
and separate OWNER approval under the normal procedure. No SSH code, workflow, secret or VPS configuration
is changed by documenting this exception, and no WWW build or publication is authorized.


## T007 — Agent-initiated Candidate (#1268), activation BLOCKED pending credential audit

Reuse `www-candidate.yml`, `scripts/www-release-actions.mjs` and the existing restricted WS reader. Only matching
`krzysztofcal` or `arcade-code-agent[bot]` actor/triggering_actor on main, attempt 1, can create a Candidate. OWNER
keeps `www-candidate` and its approval. The App uses **only** `www-candidate-agent`, gated by repository variable
`WWW_AGENT_CANDIDATE_ENABLED == true` (unset/other values disable it) in both workflow and script. Do not set it in
this PR. A checked main-only Environment is still required: `can_admins_bypass=false`, custom branch `main` only,
no tag/wildcard, no reviewers/wait timer/custom protection. Unexpected rules returned by the Environment API are STOP, never a bypass. Custom deployment protection
rules use a separate API and require explicit absence verification in the OWNER activation audit; the opt-in
flag is not runtime proof of their absence.
No jobs without the selected Environment receive Candidate secrets. No change to `www-production` or Publish gates.

### Read-only credential/security audit (2026-11-16)

- Existing isolated `ghx` issues App tokens for this selected repository with `actions:write`, `contents:write`,
  `checks:read`, `issues:write`, `pull_requests:write`, `workflows:write`, metadata read. Prior authorized admin
  dispatches and run/artifact reads confirm the existing mechanism; no test dispatch is performed here. Minimum
  GitHub capability for Candidate is `actions:write` plus read access to contents/run/artifacts. The installed
  allowlist has no Variables, Environments or Administration write permission; the App cannot enable/configure
  itself. The encoded App actor filter was verified read-only against its existing VPS Admin runs (15 matches,
  sampled actors all `arcade-code-agent[bot]`). No new grant.
- `www-candidate` is OWNER-reviewed/main-only/no-admin-bypass. `www-candidate-agent` returns 404 (not configured).
  Environment secret-name listing returns 403 to the App. Names required by the workflow are known, **actual secret
  presence, equality between Environments, token issuer/role/site access and denial of restore/unlock are UNKNOWN**.
  No secret values are read, copied or probed; no mutation is used as a permission test.
- Candidate needs Netlify site/deploy/list/functions metadata reads, the existing Production build hook and guarded
  DELETE of an identified unpublished candidate. It needs no restore, unlock, direct production publish, arbitrary
  site/configuration/secret writes. The hook is itself a bearer capability that starts a Production-context build
  with Production build secrets; the permalink can expose Production functions. A lock is not a credential boundary.
- [PAT authentication](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/) documents a token
  tied to a user, not a verified per-operation/site-only credential for this path. [Roles/project access](https://docs.netlify.com/manage/accounts-and-billing/team-management/roles-and-permissions/)
  may restrict a separate identity, but the selected plan/identity's read/DELETE versus restore/lock permissions are
  not verified here. Do not label an ordinary PAT read-only or site-scoped, or assume a differently named token has
  less authority. Successful OWNER Publish proves its credential has publication authority, not that Candidate's
  secret is the same credential. The current WWW code does not cryptographically confine a stolen PAT's API scope.

**NO-GO to unattended activation with the current unaudited credential.** OWNER first supplies an auditable
credential/role capability decision (metadata/policy, never the token): prefer a dedicated identity restricted to
this site and the required operations, with restore/unlock/publish denied. If that cannot be proven, the remaining
option is explicit OWNER acceptance that a privileged credential in an unreviewed-per-run Environment could publish
or change Production if stolen or misused by trusted-main code. A copied OWNER token plus removed reviewers is not
an acceptable implicit default. If hard separation of publication capability is required, keep T007 disabled until
a separately reviewed constrained API mechanism exists; this PR adds no new service or privilege escalation.

The accepted threat model must cover trusted-main workflow/code changes, supply-chain/runner compromise, token
exfiltration, broad site/team scope, hook leakage/build side effects, and the fact that GitHub cannot prove chat GO.
An explicit approval comment in #1268 must name the reviewed credential restrictions or consciously accepted residual
risk. No approval in this implementation is inferred from GO to write code or review/merge.

### Separate OWNER setup and first-run gates

1. OWNER reviews/merges this PR. Re-read exact current main and the audit; existing OWNER Candidate still works.
2. Separate configuration GO only after the credential/risk decision above: create the main-only
   `www-candidate-agent` Environment with dedicated `NETLIFY_AUTH_TOKEN`, `NETLIFY_BUILD_HOOK`, `WS_PROD_SSH`,
   `WS_PROD_SSH_KEY`, `WS_PROD_KNOWN_HOSTS`. Use the same approved hook capability, not a new parallel hook; retain
   only the dedicated read-only SSH identity and verified host pin (the Hetzner exception requires a separate
   OWNER configuration GO for this third Environment). No deployment/OWNER SSH keys. OWNER enters values
   directly; never provide them to the agent. Keep OWNER Candidate/Production Environments and protections unchanged.
3. Verify Environment policy, exact secret names and credential scope through an authorized read-only OWNER path.
   Only a further activation GO sets `WWW_AGENT_CANDIDATE_ENABLED=true`. This flag is deliberate opt-in, **not** a
   proof of credential restrictions. It releases secrets to trusted main jobs without per-run OWNER review.
4. Separate explicit conversation GO for the first exact-main Candidate. Agent uses existing App `ghx`, reads queue
   and successful OWNER/App candidates, and dispatches `www-candidate.yml --ref main -f sha=<exact-main>` once.
   If current main is already LIVE, report it and STOP unless OWNER explicitly requested rebuilding it.
   Both paths now also recheck main immediately before the hook: a stale OWNER run stops with hook not called.
   No merge/CI/scheduled creation. The App path repeats queue checks (the legacy OWNER queue behavior is unchanged); any competing Candidate/Publish or incomplete
   history means STOP. Before a bot calls the hook, complete existing-candidate discovery/safety validation must show
   none eligible. A second bounded Netlify production/main inventory (at most three pages of 100 entries; a full final page is STOP)
   refuses unpublished matching-SHA or `www-candidate:` marker deploys, including failed/expired/building orphans
   from non-successful runs. Non-marker Git builds in `error` with the exact observed no-content-change ignore
   error are not candidates; `skipped` is null on the observed live records. All marker intents still block,
   even if they carry that error. Unknown/error shapes fail closed. Existing/ambiguous/unknown evidence means STOP, never a duplicate build or latest-deploy guess.
5. Agent waits boundedly (up to the workflow deadline; read-only polling), then verifies completed/success attempt 1,
   genuine run metadata, matching App actor/triggering_actor/SHA, unexpired unique `www-candidate-1`, `candidate_ready`,
   policy `t007-agent-candidate-v1`/Environment, matching dry-run/static receipts, current main, actual Netlify site/
   deploy/commit/unpublished/locked identity, and agreeing WS evidence. Static legal/account bytes, versions,
   deletion anchor, CSP/HSTS and current release safety remain mandatory. Only then return the immutable permalink
   derived from the verified deploy ID and concise PASS evidence. No Termux or per-run Candidate approval by OWNER.
6. Failed, uncertain, timed-out or ambiguous evidence means STOP; inspect both Candidate/cleanup artifacts and API +
   permalink 404 proof. No automatic dispatch retry or guessed link. A previous eligible candidate may be reused only
   after full fresh provenance/safety checks and an explicit reuse decision; otherwise OWNER reconciles/discards.
   Never dispatch Publish for cleanup as the agent. OWNER Publish/discard keeps its own dispatch/approval gates.
   A discarded candidate whose API now returns 404, or an expired/missing artifact, can still block App discovery
   on that same SHA: reconciliation does not recreate lost evidence. In that case use the supported OWNER Candidate
   path for that SHA and give OWNER Publish the fresh explicit run ID (automatic discovery can still STOP),
   or wait for a normally reviewed main change. Do not retry/clear evidence or move main just
   to bypass the block. Published/old histories that cannot fit the bounded inventory also mean STOP.

OWNER Publish accepts legacy OWNER artifacts unchanged and new verified App artifacts. New App receipts bind actor,
Environment/policy and both safety results to genuine successful main-run metadata; artifact text alone cannot
change identity. Automatic discovery queries exactly OWNER and App, max five successful runs **combined**, then
requires one eligible candidate after full safety verification. More than five, mixed-actor ambiguity or incomplete
results are STOP. Shared Candidate/Publish concurrency, 48-hour lifetime, three-day candidate evidence, no hook
retry and guarded discard are unchanged. Existing immutable Releases and OWNER-only chained record authority remain
valid; `www-publish.yml` and `release-record.yml` gain no agent publication capability.

Compatibility: the new Environment/activation flag are additive and required only for App execution. OWNER workflow
and old artifacts remain supported. Discovery now makes two bounded actor queries and may hit the same five-run
limit with a mix of identities; extra read traffic is bounded at operator request frequency, with zero Supabase
reads/egress. Disabling the opt-in stops new App execution; existing verified App receipts remain inspectable by
OWNER Publish within normal gates. No unattended Production run is tested by this PR; first activation evidence
remains outstanding.
