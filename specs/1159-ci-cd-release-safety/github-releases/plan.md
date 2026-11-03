# Plan — GitHub Releases (#1159 Addendum B)

## Reused mechanisms

| Need | Existing mechanism |
|---|---|
| WWW identity | public `js/build-info.js` (`scripts/generate-build-info.js`), `parseBuildInfo()` from `scripts/www-production-release.mjs` |
| WS identity | `WS Server Deploy` dispatch run and its `ws-server-dist.tgz` (T004) |
| Android identity | Android build receipt pattern; Play upload attested until M1 |
| Identity / main-only | the actor-pair `if:` of `ws-server-deploy.yml` job `deploy` |
| Release object | GitHub Releases via `gh release` on the hosted runner |

## Files

- `.github/workflows/ws-server-deploy.yml` job `deploy`: two last steps, `if: success()` only, after resume and
  abort: `Record the WS release receipt` (`sha256sum` of the uploaded archive, JSON with release SHA, run id,
  `ws-production`, digest) and `Upload the WS release receipt` (artifact `ws-release-receipt`, 90 days).
- `scripts/release-manifest.mjs`: pure `wwwEvidence()`, `wsEvidence()`, `androidEvidence()`, `buildManifest()`,
  `releaseNotes()`; CLI reads the collected files and inputs from env and writes `release-manifest.json` and
  `release-notes.md` (no network, no process spawning).
- `.github/workflows/release-record.yml`: `workflow_dispatch` (component, confirmation
  `RECORD <component> RELEASE`, `publish` default false, component inputs), `permissions: {}`.
  - Job `record` (owner or release agent; `contents: read`, `actions: read`; checkout without persisted
    credentials): refuses `publish=true` and `android` unless owner/owner; collects evidence read-only (latest
    release manifest; WS run, jobs, receipt and the recent main dispatches with their jobs, or live build-info);
    builds; checks target on `main` and tag absent; keeps manifest and notes as a run artifact.
  - Job `publish` (`needs: record`, only `inputs.publish` with owner/owner; `contents: write`): rechecks target on
    `main` (compare API) and tag absent, then `gh release create … release-manifest.json`.
- `docs/release-records.md`, `agents.md`.

## Tests (existing files)

- `tests/www-production-release.test.mjs` (registered in `scripts/test-all.mjs`): selective WWW/WS/Android records
  carry unchanged components; evidence refusals, including a historical WS deploy (newer, unfinished or later
  failed deploy) and an Android attestation by anyone but the owner; workflow has no deploy reach, one asset,
  dry-run default, env-only inputs, a read-only record job and an owner-only publish job; no workflow triggers on tags
  or releases and every push is `main` only.
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`: receipt steps are last, success-only, bound to `github.sha`,
  digest of the uploaded archive, no secrets.

## Risks

- `contents: write` exists only in the `publish` job, which only the owner's own `publish=true` dispatch runs; the
  release agent can prepare but never publish.
- A WS entry is the last confirmed GitHub deployment, not a VPS runtime read; documented and stated in the notes.
- The previous manifest is trusted as a release asset of this repository; a malformed one stops the record.
