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
  `RECORD <component> RELEASE`, `publish` default false, component inputs), `permissions: {}` with job
  `contents: write`, `actions: read`; checkout without persisted credentials; collect evidence read-only (latest
  release manifest, WS run/jobs/receipt or live build-info); build; check target on `main` and tag absent; publish
  only with `publish=true` (`gh release create … release-manifest.json`).
- `docs/release-records.md`, `agents.md`.

## Tests (existing files)

- `tests/www-production-release.test.mjs` (registered in `scripts/test-all.mjs`): selective WWW/WS/Android records
  carry unchanged components; evidence refusals; workflow has no deploy reach, one asset, dry-run default, env-only
  inputs; no workflow triggers on tags or releases and every push is `main` only.
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`: receipt steps are last, success-only, bound to `github.sha`,
  digest of the uploaded archive, no secrets.

## Risks

- `contents: write` in the record job: only `main` definition, matching actor pairs, no persisted git credentials,
  only `gh release create` uses it.
- The previous manifest is trusted as a release asset of this repository; a malformed one stops the record.
