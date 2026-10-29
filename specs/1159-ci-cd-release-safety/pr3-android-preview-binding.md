# PR3 — exact-PR Android debug binding

## Approved scope / design

Main baseline 1e6a2ae42ecaa7b79772053303319ea9104c1be3. A same-repository open Draft PR supplies its actual head SHA. Existing Android workflow waits read-only up to10min/20s polling for its own successful native Netlify status, validates public build metadata and Netlify deployment site/review/context/SHA, and rechecks the PR head. No Netlify credential, setting change, deploy, WS or SQL operation. Static Stage API origin remains local-only; CI requires a verified binding file.

## Implementation

- mobile/poker/preview-preflight.mjs: bounded wait, before/after changed-file classification for synchronize, immediate verification before packaging/artifact publication. Existing GitHub statuses/PR API and public Netlify deploy API only. Minimal read permissions; no token forwarded to Netlify.
- security.cjs: pure binding validation and exact own-PR origin selection, preserving Stage Supabase/WS constraints and browser IIFE compatibility.
- package-web.mjs: consume binding, verify exact checkout, package shared UI once, check packaged CSP/SRI and enrich existing build receipt. No UI/gameplay changes.
- android-poc.yml: early prerequisite before dependency/Gradle costs; dispatch requires PR number+exact source; skip compile on known docs/test-only synchronize; normal checks/Preview unaffected. Existing hosted toolchain/signature/SHA256SUMS/artifact handling retained.
- Existing mobile security tests plus one fundamental preflight test; no new library or UI framework. Fundamental negative cases include parent/foreign/Production origin, stale/mismatched source/context/site, failed/timeout, pending→ready and no-build classification.

## Acceptance / impacts

Draft PR on current main, actual automatic debug APK only after matching READY Preview. Inspect receipt, packaged origin/config, debug signature and APK checksum. #1160 is read-only stacked reference only. No physical install required; mark NOT TESTED. Old static APKs keep old endpoints. Dispatch becomes intentionally stricter: open same-repo Draft and explicit current SHA; old branch-only dispatch unsupported. Docs/test-only skip produces no new artifact and never relabels an older receipt as the latest source. Changes in packaged input bytes, including code comments, conservatively rebuild. Uncertain classification builds rather than suppressing validation. Existing PR2 runtime/Production controls remain untouched. No Production release, Stage mutation, Terms, APK publication or merge.
