# GitHub Releases as the release registry (#1159 Addendum B)

## Problem

WWW, WS and Android each have their own release evidence (Netlify deploy id and public `build-info.js`, the WS
deploy run and `release-metadata.json`, Android build receipts), but nothing records which versions run together.
The repository has no tag and no GitHub Release.

## Goal

A GitHub Release is the audited record of the running versions: one approved `main` commit per changed component,
a small `release-manifest.json`, and the unchanged components carried from the previous record. It is a record,
not a deployment engine.

## Requirements

- **R-RECORD.** One record changes exactly one component (`www`, `ws` or `android`) and copies the other two
  unchanged from the previous record, each keeping the tag it was released in. A component never recorded is
  `null`, never guessed.
- **R-EVIDENCE.** Built only from existing evidence, verified before anything is written:
  - WWW: the live `https://play.kcswh.pl/js/build-info.js` names the given Netlify deploy id, `production`
    context, `main` branch and the commit;
  - WS: a successful `WS Server Deploy` `workflow_dispatch` run on `main` whose `deploy` job succeeded, the
    `ws-release-receipt` it uploaded (release SHA = run SHA, run id, `ws-production`, SHA-256 of the
    `ws-server-dist.tgz` uploaded to the VPS), and `latestWsDeploy()` showing this run (not only its commit) is still the latest deploy. This is
    the last confirmed deployment (`evidence: latest-github-deploy`), not a VPS runtime check;
  - Android: until M1 builds the signed AAB in CI, a record attested by the owner only (commit, versionName,
    versionCode, AAB SHA-256, Play track). Stage/debug APKs are never release evidence.
- **R-NO-DEPLOY.** Creating a tag or a release deploys, restarts, migrates and publishes nothing. The record
  workflow has no secret, environment, SSH, Netlify or Play access, and no workflow triggers on tags or releases.
- **R-PUBLIC.** The only asset is `release-manifest.json` with whitelisted fields. No secret, Stage APK, AAB,
  WWW bundle, test identity or private data is attached.
- **R-SAFE.** `main` only, matching actor pairs as the other release workflows, exact confirmation, dry run by
  default, tag target must be on `main`, an existing tag is never reused, records serialized.
- **R-OWNER.** The dry run is read-only and open to the owner and the release agent. Publishing (tag and release,
  the only `contents: write`) and the Android attestation are the owner's own dispatch only.
- **R-PROVENANCE.** Records are published as GitHub Immutable Releases (repository setting; asset and tag locked).
  The release is created by `GITHUB_TOKEN`, so its author is `github-actions[bot]`; owner publication is proven by the
  run instead: the previous record is used only if it is immutable, created and uploaded by `github-actions[bot]`
  with the manifest as its only asset, and the manifest's `recordedBy.runId` is a `Release Record` dispatch on `main`
  by the owner (actor and triggering actor) whose `publish` job succeeded and whose run number the tag carries.
  Anything else, including a release made by the code agent, stops the record.

## Decision gate (Addendum B)

Manifest plus references, no binaries: WWW is identified by its immutable Netlify deploy id (a static bundle would
not carry functions, redirects and headers); the WS archive is identified by its SHA-256 and stays on the VPS and in
the deploy run; the signed AAB stays with Google Play. Publishing binaries would add asset custody and access
questions without improving the record.

## Out of scope

Compatibility constraints between components (schema/protocol versions), automatic recording at the end of each
release path, WS `/healthz` release SHA, signed Android build in CI (M1).
