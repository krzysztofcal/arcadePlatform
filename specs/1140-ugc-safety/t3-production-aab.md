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
- `.github/workflows/android-release-aab.yml`: manual `workflow_dispatch` from `main` with `sourceSha == github.sha`, plus a validation build on same-repo Draft PRs that touch release files. `contents: read` only.
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
- III Fail-closed / separation: explicit channel, approved appId, version inputs, pinned endpoints and exact main SHA are all required. The artifact is unsigned, and nothing is uploaded or deployed.
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
2. Back up `arcade-poker-upload.jks` and both passwords in two offline places (for example, a password manager plus an encrypted USB drive). If it is lost, request an upload-key reset in Play Console (Play App Signing keeps the app signing key).
3. For each build, in the extracted artifact folder (the `jarsigner` prompts ask for the keystore password):
   ```bash
   sha256sum -c SHA256SUMS
   UNSIGNED="$(ls arcade-poker-production-*-unsigned.aab)"
   SIGNED="${UNSIGNED%-unsigned.aab}-signed.aab"
   cp "$UNSIGNED" "$SIGNED"
   jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore /path/to/arcade-poker-upload.jks "$SIGNED" upload
   jarsigner -verify -verbose -certs "$SIGNED"   # must show the upload certificate, never "Android Debug"
   ```
4. First upload, to **Internal testing** (separate OWNER GO): accept Play App Signing (Google-managed app signing key). Copy the **app signing** certificate SHA-256 from Play Console → App integrity for T2d. The **upload** certificate is a different value and is not used in assetlinks.
5. `versionCode` must be strictly higher on every upload. Use the next integer for each dispatch and record it in the release notes.

A CI-signed variant (upload key as secrets in a protected Environment with OWNER approval) is possible later. It needs a separate OWNER GO and secret provisioning.

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
- `MOBILE_CHANNEL=''` now also fails in `package-web.mjs` (previously it meant Stage). CI never sets it empty.
