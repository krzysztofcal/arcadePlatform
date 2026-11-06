# Account Deletion V2: Stage acceptance prerequisites

This is a read-only acceptance checklist, not activation authorization. Recorded
baseline: physical APK #1208, source 9b3af751, OWNER-confirmed diagnosis on
2026-11-06. Revalidate mutable facts immediately before any future activation.
No account identifiers, credentials or configuration values belong in evidence.

## Current blockers

- Preview #1208 has no matching enabled `ACCOUNT_DELETION_ENABLED` context;
  initial GET returns 503. CORS preflight for `https://localhost` passed.
- Stage SQL `account_deletion_release.enabled` is false. The tested account has
  no deletion request and remains active (OWNER-confirmed).
- The installed WS Preview release was b0d81cd3. Its effective deletion-worker
  flag/readiness has not been established through a trusted read-only mechanism.
  WS Preview is in DRAIN; preserve it. DRAIN explains Online behavior but is not
  proof that the deletion worker can safely process a request.

## Evidence needed before asking for activation GO

- [ ] **Netlify:** identify exact native review_id, deploy SHA, deploy-preview
  context and Stage target. Inspect only the effective deletion feature flag and
  relevant nonsecret release metadata. Verify Origin `https://localhost` and WWW
  CORS permissions for GET/POST, Authorization and Content-Type. Successful
  OPTIONS alone does not prove an authenticated GET or POST can succeed.
- [ ] **SQL:** confirm Stage identity, compatible deletion schema/migrations,
  singleton release gate and actual WWW/WS role privileges through the existing
  trusted read-only mechanism. Check for pending requests/incidents that would
  resume when enabled. The Stage gate is shared: inventory other enabled Stage
  callers before proposing changes. Do not enable it or run trial INSERT/UPDATE.
- [ ] **WS worker:** establish the actual active service/release SHA, Stage DB
  identity, effective deletion flag, worker tick/lease health and relevant errors
  using existing trusted metadata/logs. Confirm that this release contains the
  expected preparing/poker/burn/cleanup/Auth-last protocol and financial guards.
  An active service or passing WWW CI alone is insufficient. If effective worker
  readiness cannot be safely observed, report that specific evidence gap.
- [ ] **Release compatibility:** compare WWW functions, SQL contract, worker and
  embedded APK build receipt/Preview. Different SHAs need explicit evidence of
  compatible deletion protocol and guards; do not infer compatibility from dates.
  Any necessary WS deployment/restart or configuration change needs separate GO
  and the established deployment path, never a bypass.
- [ ] **Legal/operations:** confirm actual deletion/forfeiture disclosures and
  supported status/contact path. Privacy publication remains gated on Production
  verification and Claude Code's #1157. This patch changes neither retention nor
  active Terms; it does not establish Production readiness.

## Conditions for a future destructive end-to-end test

Obtain separate OWNER GO identifying a disposable approved Stage account and
explicitly accepting irreversible deletion/forfeiture. Record its starting status
without exposing identity or user data; resolve any existing request first.
Require verified Stage-only targets, compatible ready worker and approved gates.
Preserve HOLD/DRAIN unless separately authorized; stop if they prevent safe worker
completion. No funded JOIN or other financial smoke is implied.

After that GO only: verify authenticated GET, explicit confirmation, POST 202 with
persisted request, status progression and worker completion with Auth deletion
last. A lost POST response means UNKNOWN: inspect status, do not blindly resend.
Do not treat UI acknowledgement as completion. Capture sanitized release/status
proof and stop on incident, lease failure or target mismatch. No test was run by
preparing this checklist.

## Isolated UI patch integration

Prepared locally from exact #1208 source 9b3af751, without pushing to #1208 or
creating another stacked PR. Scope: shared Account visibility/hash navigation,
GET-versus-POST error wording, fundamental regression checks and this checklist.
No API, worker, SQL, legal document or configuration changes.

After OWNER chooses the integration point, cherry-pick the standalone patch onto
the branch containing the accepted #1155/#1160/#1208 content; use one normal PR
against that branch rather than another stacked Preview dependency. Run standard
CI and exact-SHA WWW/Android verification there. The independent review applies
only to this new diff; the exhausted #1208 review is not reopened or reset.

WWW: signed-out instructions retain `/account.html#account-deletion`; an existing
signed-in session follows that same link to the single Danger Zone action without
submitting anything. APK: instruction hidden, existing action unchanged. The
section starts hidden pending auth resolution to prevent a signed-in/APK flash.
No API/protocol breaking changes. An APK rebuild is required to receive the UI fix;
this source-only preparation does not change the already installed APK.
