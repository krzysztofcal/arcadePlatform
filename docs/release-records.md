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
| `ws` | the given run is a successful `WS Server Deploy` dispatch on `main` with a successful `deploy` job, and its `ws-release-receipt` names the same commit, run, `ws-production` and the SHA-256 of the archive uploaded to the VPS |
| `android` | attested by the dispatcher until M1 builds the signed AAB: commit, versionName, versionCode, AAB SHA-256, Play track |

1. After a component is released and verified through its own path, dispatch `Release Record` from `main` with
   `component`, its inputs and `confirmation` exactly `RECORD <component> RELEASE`. `publish` defaults to false: the
   run only shows the manifest in its summary.
2. Review the manifest, then dispatch again with `publish=true`. The release is tagged
   `release-<UTC date>-<run number>` at the changed component's commit (which must be on `main`); an existing tag
   is never reused.

The release has one asset, `release-manifest.json` (schema 1): `tag`, `recordedAt`, `recordedBy`, `changed`,
`previous` and `components.www|ws|android`, each `null` until first recorded, otherwise its commit, evidence
references and `releasedIn` (the record where it last changed).

## What is never attached

Secrets, environment files, Stage or debug APKs, the signed AAB, WWW bundles, test identities or player data. WWW is
identified by its immutable Netlify deploy id, WS by the archive SHA-256 (the archive stays on the VPS), Android by
the AAB SHA-256 (the AAB stays with Google Play).

## Safety

- `Release Record` runs only from `main` for the owner or the release agent (`vars.WS_RELEASE_AGENT`), with the same
  identity on dispatch and re-run. It has no secret, environment, SSH, Netlify or Play access; only its publish step
  uses `contents: write`, and git credentials are not persisted.
- A tag or release created with `GITHUB_TOKEN` starts no workflow, and no workflow triggers on tags or releases;
  every `push` trigger is limited to `main` (guarded by `tests/www-production-release.test.mjs`).
