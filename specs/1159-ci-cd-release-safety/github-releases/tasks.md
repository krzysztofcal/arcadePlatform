# Tasks — GitHub Releases (#1159 Addendum B)

Constitution check: fundamental tests only, in existing test files; no new tool or service; no release published,
no deployment and no settings change in the PR.

## PR

- [x] G1 WS release receipt at the end of the approved deploy job.
- [x] G2 `scripts/release-manifest.mjs`: evidence checks, selective manifest, notes.
- [x] G3 `.github/workflows/release-record.yml`: dry run by default, one manifest asset, no deploy reach.
- [x] G4 Tests in `tests/www-production-release.test.mjs` and `ws-tests/ws-server-deploy.workflow.guard.test.mjs`.
- [x] G5 `docs/release-records.md`, `agents.md`.

## After merge (owner, separate GO each)

- [ ] G6 Dry run `component=www` with the current Production deploy id; review the manifest in the summary.
- [ ] G7 First published record (`www`), then `ws` after the first approved T004 release, `android` after the first
  Play upload.
