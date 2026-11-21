# #1140 T3 / #1291 — Production AAB build path (unsigned)

OWNER GO 2026-11-20 (#1291): prepare a Google Play–ready Production AAB. Not authorized: Play upload, signing-key or secret creation, WWW/WS/Supabase changes, merge, Release Record.

## Implementation
- `mobile/poker/capacitor.production.json`: `appId` `pl.kcswh.arcadepoker` (Play Console package observed by the OWNER), `appName` "Arcade Poker". The workflow copies it over `capacitor.config.json` in the CI workspace only. The Stage file and the Stage workflow are unchanged.
- `mobile/poker/configure-android.mjs`:
  - `APPROVED_PRODUCTION_APP_ID = 'pl.kcswh.arcadepoker'`.
  - `releaseVersion(channel, env)`: Stage stays fixed at `0.0.1`/`1`. Production requires `MOBILE_VERSION_NAME` (`x.y.z`) and `MOBILE_VERSION_CODE` (1…2100000000), checked before any write.
  - The `PokerAudioPlugin.java` package line follows the appId. Stage output is byte-identical.
- `mobile/poker/package-web.mjs`:
  - `resolveChannel()` + `assertChannelIdentity()` run before `www` is created.
  - Production uses the pinned `production-public.json` and the anon-key ref/role check. A Preview binding is refused.
  - The Production receipt records `channel`, `versionName` and `versionCode`. The Stage receipt keeps its existing fields.
  - The licensed lobby music remains mandatory in CI.
- `.github/workflows/android-release-aab.yml`: manual `workflow_dispatch` from `main` only, with `sourceSha == github.sha`. There is no pull_request trigger, so code from a PR never receives `MOBILE_LOBBY_MUSIC_KEY` here (OWNER security fix, 2026-11-20). `contents: read` only.
  - Pinned hosted toolchain (same as the Stage APK workflow), then `bundleRelease`.
  - bundletool 1.18.3 (SHA-256 pinned) checks the manifest:
    - package and version;
    - targetSdk ≥ 36;
    - not debuggable;
    - exactly one complete autoVerify App Link callback filter, no Stage scheme;
    - permissions limited to `INTERNET` and the app-scoped AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
  - The bundled `config.js` must equal the pinned Production endpoints and anon key exactly, and carry the source SHA.
  - `jarsigner -verify` must report `jar is unsigned`.
  - Artifact (7 days): AAB, `release-receipt.json`, `build-receipt.json`, `manifest.txt`, `toolchain.txt`, `SHA256SUMS`.

## Constitution Check
- I Simplicity: extends the existing configure/package scripts. One narrowly scoped workflow, no new npm dependency.
- II Runtime boundaries: no WS, engine or DB change.
- III Fail-closed / separation: explicit channel, approved appId, version inputs, pinned endpoints and exact main SHA are all required. The artifact is unsigned and kept by GitHub Actions for 7 days; nothing is signed, uploaded to Google Play or deployed.
- IV Platform: no browser JS, CSS or CSP change in shipped pages.
- V Tests: only `tests/mobile-poker-channel.test.mjs` is extended (identity, version, packager/configure guards).

## Dependencies before an internal-testing build is useful
The AAB builds without these, but online play and sign-in will not work in it yet:
1. **T2a** (not started; follows #1276, which edits `mobile/poker/runtime.js` and `js/auth/supabaseClient.js`):
   - `runtime.js`, `js/api-url.js` and `security.cjs` (`validate`, `redirectTo`, `callbackCode`, `publicProfileUrl`) are still Stage-only.
   - In a Production package the native runtime fails closed at start-up. Poker Offline is the only mode expected to work.
2. **WWW Production release of T2b** (OWNER): Production CORS for `https://localhost` and `/app/auth/callback`. Currently `play.kcswh.pl/app/auth/callback` returns 404.
3. **Supabase Production redirect allowlist**: add `https://play.kcswh.pl/app/auth/callback` (OWNER, separate GO).
4. **T2d**: `/.well-known/assetlinks.json` with the Play App Signing SHA-256 certificate fingerprint. That fingerprint exists only after the first upload with Play App Signing enabled. Until then the App Link is unverified.
5. #1286 (Suppi link): `stageApk()` stays false for the Production config because `validate()` stays Stage-only.

## Future OWNER signing procedure (not authorized by #1291; each step needs its own OWNER GO)
The current task ends with a verified unsigned AAB. After a separate OWNER decision, the OWNER does the following on a trusted computer, and never in a repository, PR, issue or chat:
1. Create the upload key (JDK `keytool`):
   `keytool -genkeypair -v -keystore arcade-poker-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`
2. Record the upload certificate SHA-256 from `keytool -list -v -keystore arcade-poker-upload.jks -alias upload` (public value; store it next to the release notes). Back up `arcade-poker-upload.jks` and both passwords in two offline places (for example, a password manager plus an encrypted USB drive). If it is lost, request an upload-key reset in Play Console (Play App Signing keeps the app signing key).
3. For each build, in the extracted artifact folder. Set `UPLOAD_CERT_SHA256` to the upload certificate SHA-256 recorded in step 2. The `jarsigner` prompt asks for the keystore password.
   ```bash
   (
     set -euo pipefail
     shopt -s nullglob
     : "${UPLOAD_CERT_SHA256:?set the recorded upload certificate SHA-256}"
     files=(arcade-poker-production-*-unsigned.aab)
     [ "${#files[@]}" -eq 1 ] || { echo "expected exactly one unsigned AAB"; exit 1; }
     UNSIGNED="${files[0]}"
     [ "$(wc -l < SHA256SUMS)" -eq 1 ] || { echo "SHA256SUMS must have exactly one entry"; exit 1; }
     [ "$(awk '{print $2}' SHA256SUMS)" = "$UNSIGNED" ] || { echo "SHA256SUMS does not name $UNSIGNED"; exit 1; }
     sha256sum -c SHA256SUMS
     SIGNED="${UNSIGNED%-unsigned.aab}-signed.aab"
     [ ! -e "$SIGNED" ] || { echo "$SIGNED already exists"; exit 1; }
     TMP="$(mktemp ./signing-XXXXXX)"
     trap 'rm -f "$TMP"' EXIT
     cp "$UNSIGNED" "$TMP"
     jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore /path/to/arcade-poker-upload.jks "$TMP" upload
     # Signature integrity; no -strict because the upload certificate is self-signed.
     verify="$(jarsigner -verify -verbose "$TMP")"
     ! printf '%s\n' "$verify" | grep -qi 'unsigned entries' || { echo "AAB contains unsigned entries"; exit 1; }
     signers="$(keytool -printcert -jarfile "$TMP" | awk '$1 == "SHA256:" {print $2}')"
     [ "$(printf '%s\n' "$signers" | grep -c .)" -eq 1 ] || { echo "expected exactly one signer certificate"; exit 1; }
     [ "${signers^^}" = "${UPLOAD_CERT_SHA256^^}" ] || { echo "signer is not the recorded upload certificate"; exit 1; }
     mv "$TMP" "$SIGNED"
     trap - EXIT
     echo "signed with the upload key: $SIGNED"
   )
   ```
4. First upload, to **Internal testing** (separate OWNER GO): accept Play App Signing (Google-managed app signing key). Copy the **app signing** certificate SHA-256 from Play Console → App integrity for T2d. The **upload** certificate is a different value and is not used in assetlinks.
5. `versionCode` must be strictly higher on every upload. A new dispatch before any upload may reuse the same value; record the uploaded value in the release notes.

The manual procedure above stays a fallback. #1302 adds the CI-signed variant below.

## #1302: CI signing in the protected `android-signing` Environment
OWNER GO 2026-11-21 (#1302). Not authorized: creating, rotating or reading the upload key or passwords, provisioning the Environment or secrets, a real signed run, Play upload, merge, deploy.
- Job `sign-aab` (`needs: release-aab`, same `workflow_dispatch`/`main` condition, `environment: android-signing`, `contents: read` + `actions: read`).
- GitHub creates a referenced Environment without protection, so after checkout and the Node/Java setup (no secrets, no artifact yet) the gate step fails closed, before the artifact download and the signing step, unless the API shows: required reviewer only `krzysztofcal`, admin bypass off, deployment branch policy `main` only, and an OWNER approval for this run (shared `environmentFailures`/`ownerApproved` from `scripts/www-release-actions.mjs`). It runs before any secret is read.
- Input: only the unsigned artifact of the same run (`actions/download-artifact`), checked with `SHA256SUMS` and `release-receipt.json` (source SHA, run id/attempt, channel, appId, version, `signed:false`, AAB hash).
- `mobile/poker/sign-release-aab.sh` (the only step with signing secrets): decodes the PKCS#12 into a private temp dir (removed on exit), passwords only via `-storepass:env`/`-keypass:env`, fixed alias `upload`, key password defaults to the store password. Forces English JDK tool messages (parsed output). Checks the key certificate SHA-256 against the pin before signing, signs with SHA256withRSA/SHA-256, then requires `jar verified`, no unsigned entries and exactly one signer whose own (first) certificate equals the pin; issuer certificates in the entry chain are allowed but never satisfy the pin. No `-strict` (self-signed upload certificate).
- Pin `ANDROID_UPLOAD_CERT_SHA256` in the workflow: upload certificate SHA-256 (public). The OWNER confirms it in Play Console → App integrity → Upload key certificate before merge. It is not the app signing certificate in `assetlinks.json`.
- Artifact (7 days): `arcade-poker-production-aab-signed-<versionCode>-<sourceSha>` with the signed AAB, `signed-release-receipt.json`, `SHA256SUMS`. No Play upload in CI.
- One-time OWNER steps before the first dispatch: create `android-signing` with required reviewer `krzysztofcal` only, **Prevent self-review off** (the gate requires it, so the OWNER can approve their own dispatch), admin bypass off, deployment branches `main` only; add the secrets `ANDROID_UPLOAD_KEYSTORE_BASE64` (base64 of the existing PKCS#12 upload keystore), `ANDROID_UPLOAD_STORE_PASSWORD`, optional `ANDROID_UPLOAD_KEY_PASSWORD` as **Environment** secrets only. Never create these names as repository secrets: a missing Environment secret would fall back to a repository secret of the same name, and `GITHUB_TOKEN` cannot list secrets to detect that. The first real signed run is a separate OWNER GO.
- Re-runs: run approvals are not per attempt, so `sign-aab` signs only in the first run attempt and only the build of that attempt. Re-runs skip `sign-aab` (job condition `github.run_attempt == 1`, re-checked in the gate step as `rerun_not_allowed_dispatch_new_run`); dispatch a new run instead (the same `versionCode` is fine while nothing was uploaded).
- Tests: `tests/mobile-poker-channel.test.mjs` checks the job structure and signs a synthetic disposable PKCS#12 (skipped without a JDK).

## Galaxy S24+ internal-testing plan (OWNER, after the gates above)
1. Install from the Play internal-testing link. Stage (`pl.kcswh.arcadepoker.stage`) stays installed side by side with separate data.
2. Cold start, lobby, Poker Offline in airplane mode, sound on/off, back/resume.
3. After T2a/T2b/T2d: Google sign-in returns to the app (verified App Link), email/password sign-in, session survives restart, online table join/leave, reconnect after a network drop.
4. Check that no "Support" link appears and that no Stage or SHA banner is shown.
5. `adb shell pm get-app-links pl.kcswh.arcadepoker` shows `verified` for `play.kcswh.pl` after T2d.

## Breaking impact
- New applicationId: Production is a separate app from Stage. No data, session or settings migration. The Stage APK is unaffected.
- Native signature: Play delivers builds signed by the Google app signing key. Sideloaded Stage/debug builds can never update it.
- Auth callback: Production uses `https://play.kcswh.pl/app/auth/callback`. It does not work until T2a, the Supabase allowlist and T2d are done.
- Persistent data: the template default `android:allowBackup="true"` is unchanged (separate privacy decision).
- #1302: a new signed artifact and receipt; a copy of the upload key lives in the protected Environment (rotation means updating the secrets and the pin).
- `MOBILE_CHANNEL=''` now also fails in `package-web.mjs` (previously it meant Stage). CI never sets it empty.
