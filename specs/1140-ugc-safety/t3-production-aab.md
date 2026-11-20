# #1140 T3 / #1291 — Unsigned Production AAB Build Path

## Goal
Establish a reproducible, secure, GitHub-hosted build and verification path for an **unsigned** production Android App Bundle (`.aab`) for Google Play (`pl.kcswh.arcadepoker`), without embedding secrets or signing keys on CI.

## Implementation Summary
- **App Identity**: `mobile/poker/capacitor.production.json` pins `appId: "pl.kcswh.arcadepoker"` and `appName: "Arcade Poker"`.
- **Channel Configuration**:
  - `mobile/poker/configure-android.mjs`: `APPROVED_PRODUCTION_APP_ID = 'pl.kcswh.arcadepoker'` (OWNER-approved in #1291).
  - `releaseVersion(channel, env)` enforces semantic `versionName` and numeric `versionCode` (≤ 2100000000) for production before writes; rewrites `PokerAudioPlugin.java` package declaration to match the target `appId`.
- **Web Packaging**:
  - `mobile/poker/package-web.mjs` verifies `assertChannelIdentity` against `capacitor.config.json` before creating `www`.
  - Disallows preview bindings for production; pins production Supabase and WebSocket endpoints.
  - Bundles licensed lobby music in CI (fails closed if missing).
- **CI Workflow**:
  - `.github/workflows/android-release-aab.yml`: gated on `workflow_dispatch` (exact current `main` HEAD) and same-repo Draft PRs.
  - Runs on hosted `ubuntu-24.04`, builds unsigned release AAB via `./gradlew bundleRelease`.
  - Verifies bundle via `bundletool-all-1.18.3.jar` (SHA-pinned), checks manifest, single `INTERNET` permission, production assets, and verifies unsigned state via `jarsigner`.
  - Produces immutable artifacts with receipts and SHA256 checksums.

## Constitution Check
- **Principle I (Simplicity & Existing Mechanisms)**: Extends existing `configure-android.mjs`, `package-web.mjs`, and pattern from `android-poc.yml`. No extra abstractions or new dependencies.
- **Principle II (Authoritative Runtime Boundaries)**: Mobile bundle connects to authoritative WebSocket server; config endpoints pinned to production.
- **Principle III (Fail-Closed Safety & Environment Separation)**: Strict channel checks ensure Stage and Production configs cannot mix. CI fails closed if required keys, music, or configurations are missing. No automatic deploy or merge.
- **Principle IV (Platform Compatibility & Style)**: Plain JS web assets, JSP-compatible, logs copyable.
- **Principle V (Fundamental Tests)**: Deterministic unit tests in `tests/mobile-poker-channel.test.mjs` covering identity, versioning, packager guards, and configure writes.
- **Deployment & Safety Gates**: Build artifact is unsigned. No signing keys on GitHub. No merge, deploy, or workflow dispatch performed by agents.

## Dependencies & Blockers
1. **T2a (#1276 / #1286)**: Production mobile client runtime and security checks.
2. **T2d**: Production Netlify CORS allowlist (`https://localhost`) and Supabase OAuth redirect URL allowlist for `https://play.kcswh.pl/app/auth/callback`.
3. **WWW Release**: Production web assets published to `play.kcswh.pl`.
4. **OWNER Upload Key**: Physical signing key remains exclusively in OWNER custody.

## Signing Procedure (Placeholder for OWNER)
The CI artifact is an unsigned AAB. The OWNER performs local release signing:
1. Download `arcade-poker-production-<versionName>-<versionCode>-<SOURCE_SHA>-unsigned.aab` from the successful Actions run.
2. Verify SHA256 against `SHA256SUMS`.
3. Sign using `jarsigner` with the private Play Console upload keystore:
   ```bash
   jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
     -keystore /path/to/upload-keystore.jks \
     arcade-poker-production-<versionName>-<versionCode>-<SOURCE_SHA>-unsigned.aab \
     <upload-key-alias>
   ```
4. Verify signature:
   ```bash
   jarsigner -verify -verbose arcade-poker-production-...-unsigned.aab
   ```
5. Upload the signed `.aab` to Google Play Console (internal testing / closed testing / production track).
