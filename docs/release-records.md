# Release records (GitHub Releases, #1159)

A GitHub Release records which WWW, WS and Android versions run together. It is a record only: creating it deploys
nothing, restarts nothing, migrates nothing and publishes nothing to Netlify or Google Play. Deployments stay with
their own owner-approved paths (WS: `WS Server Deploy` with the `ws-production` approval; WWW:
`scripts/www-production-release.mjs`; Android: Google Play's own gates).

## Record

Each record changes one component and carries the other two from the previous record:

| Component | Evidence checked by `Release Record` |
|---|---|
| `www` | `https://play.kcswh.pl/js/build-info.js` names the given Netlify deploy id, context `production`, branch `main`; the record takes its commit |
| `ws` | the given run is a successful `WS Server Deploy` dispatch on `main` with a successful `deploy` job, its `ws-release-receipt` names the same commit, run, `ws-production` and the SHA-256 of the archive uploaded to the VPS, and GitHub shows it is still the latest deploy (`githubWsRelease()`: newest `deploy` job on `main` succeeded for that commit, no dispatch unfinished). Recorded as `evidence: latest-github-deploy` |
| `android` | attested by the owner only (never by the release agent) until M1 builds the signed AAB: commit, versionName, versionCode, AAB SHA-256, Play track |

1. After a component is released and verified through its own path, dispatch `Release Record` from `main` with
   `component`, its inputs and `confirmation` exactly `RECORD <component> RELEASE`. `publish` defaults to false: the
   run only shows the manifest in its summary. The owner or the release agent may run this dry run (`android`:
   owner only).
2. The owner reviews the manifest and dispatches again with `publish=true`. Only the owner's own dispatch (actor
   and triggering actor) runs the `publish` job; a `publish=true` request by anyone else fails. The release is tagged
   `release-<UTC date>-<run number>` at the changed component's commit (which must be on `main`); an existing tag
   is never reused.

The release has one asset, `release-manifest.json` (schema 1): `tag`, `recordedAt`, `recordedBy`, `changed`,
`previous` and `components.www|ws|android`, each `null` until first recorded, otherwise its commit, evidence
references and `releasedIn` (the record where it last changed).

## Provenance of a record

Enable **Immutable Releases** (Settings → General → Releases) before the first publication: GitHub then locks a
published record's asset and tag. The publish job fails if the new release is not immutable. The release is created
with `GITHUB_TOKEN`, so GitHub shows `github-actions[bot]` as its author; the owner's publication is proven by the
run. Before reusing the previous record, `Release Record` checks that it is immutable, created and uploaded by
`github-actions[bot]` with only `release-manifest.json`, and that the run named in `recordedBy.runId` is a
`Release Record` dispatch on `main` by the owner (actor and triggering actor) with a successful `publish` job and the
run number carried by the tag. A release created by anyone else (including the code agent, which can write releases)
stops the next record until the owner deletes it.

## What a WS entry does and does not prove

`Release Record` does not read the VPS (no SSH or secret). A WS entry therefore states the **last confirmed
deployment**: the latest successful `deploy` job on GitHub when the record was made. It does not prove which
release the VPS is running at that moment; that runtime check is the VPS `current` release read by
`scripts/www-production-release.mjs` (SSH) before a WWW release. The release notes say so. WWW entries are
runtime-checked against the live `build-info.js`.

## What is never attached

Secrets, environment files, Stage or debug APKs, the signed AAB, WWW bundles, test identities or player data. WWW is
identified by its immutable Netlify deploy id, WS by the archive SHA-256 (the archive stays on the VPS), Android by
the AAB SHA-256 (the AAB stays with Google Play).

## Safety

- `Release Record` runs only from `main` for the owner or the release agent (`vars.WS_RELEASE_AGENT`), with the same
  identity on dispatch and re-run. The `record` job is read-only (`contents: read`, `actions: read`, no persisted git
  credentials). Only the `publish` job has `contents: write`, and it runs only for the owner's own `publish=true`
  dispatch. There is no secret, environment, SSH, Netlify or Play access.
- A tag or release created with `GITHUB_TOKEN` starts no workflow, and no workflow triggers on tags or releases;
  every `push` trigger is limited to `main` (guarded by `tests/www-production-release.test.mjs`).
