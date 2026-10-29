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

## Hosted acceptance — 2026-10-29

Draft PR #1166, base main. Application source a1ed1ace02d4dbfa083cd22078f5e566a018af9c, Netlify deploy 6ae3dbf5c040a944431ad43e, review1166/context deploy-preview/site playkcswh. Canonical API origin https://deploy-preview-1166--playkcswh.netlify.app. Existing Supabase Stage krydukthwdvccggbyjfw and WS Preview unchanged. All hosted checks PASS, including CodeQL, CI/actionlint, Tests and WS PR Checks. WS Production deploy/infra apply SKIPPED; no WS Preview dispatch or database operation performed.

Automatic Android run40975904744 SUCCESS: pending→ready continued without Retry/dispatch. Receipt measured 22,779ms prerequisite wait; job 23:51:22–23:53:45 UTC (143s), Gradle 92s. Downloaded artifact12942612396 and independently compared SHA256SUMS, embedded receipt and mobile config. APK SHA256 91fd97e4201279bc3ae6fff9de989ccd4c44f04c22ea45c8c02242b36bb938b1. Verified Android Debug certificate/v2 signature, version0.0.1/code1, CSP/SRI PASS across5 packaged documents and Offline connect-src none. No install/distribution: physical Android NOT TESTED.

Initial run40975505683 also proved pending→ready (44,766ms) and built successfully; its source d11c4a3a was superseded after CodeQL identified case-sensitive HTML tag matching in the new CSP validator. Corrected tag/attribute case handling, preserved the check and rebuilt normally. This necessary corrective build is not classified as redundant compilation.

Read-only stacked reference #1160: source4c75dae1288bbb2d00fb6ad295b0edc89680b76b/deploy6ae3c8f8dfcc32f97a6aba47 accepted by the same verifier, no modification/build of that PR.

Historical baseline: run40744040776 compiled APK for810a77b1 (only tests workflow changed), job158s. The new classifier excludes that change. This is one observed historical redundant build, not a repository-wide estimate. The documentation-only acceptance commit adds no application input; its actual no-build result will be recorded in the Draft PR description without another documentation push. Previous artifact retains its original a1ed1ace receipt even if documentation advances HEAD. Other CI/Preview checks stay active.
