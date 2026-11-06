# Android M1: isolated a2 document delivery

This patch is based on #1160 source `419f1185dd472b26b90374a13e3f94d16c1d4267`. It implements only the separately approved packaging/link scope, not a fifth review of #1155/#1160. No policy activation, release, SQL, WS, permissions or #1157 changes.

## Content and routing

- Four a2 Markdown files retain the exact OWNER-accepted content. Terms are byte-identical to the base; Privacy includes only the previously accepted operator-block paragraphs. Manifest SHA256: `0c189280ca1c74fc1e770ac9c90f8b18a33ab1588b54c9467f88810ec3af6651`. Privacy publication is still conditional on final Production/#1157 consistency.
- Script-free versioned a2 HTML preserves that text. Only markup and email links are added. Current aliases and immutable a1 Terms are not replaced. Versioned a1 Privacy snapshots capture the current legacy policy text so existing active a1 onboarding remains resolvable.
- Onboarding uses the version returned by the existing policy for BOTH Terms and Privacy; the API's `privacyUrl` now points to the corresponding versioned file. No active version or acceptance behavior is changed. Adding a2 files to an APK does not activate a2.
- The APK includes aliases plus both a1/a2 document pairs in PL/EN. Legal documents retain “Arcade Hub” and the full approved service scope; the existing Poker branding substitution remains only on nonlegal pages. Static Account links still use current aliases, not a silently activated a2.

## Prepared external deletion-request URL

After separately approved WWW publication, the existing policy can be linked directly:

- `https://play.kcswh.pl/legal/privacy.pl.html#account-deletion`
- `https://play.kcswh.pl/legal/privacy.en.html#account-deletion`

Only a stable anchor is added to the already existing deletion section. The existing Account link and contact email remain the request paths. No new page, API, form or deletion executor. The same anchor is available in versioned a2 Privacy for later publication. These are prepared addresses, NOT a claim that the new anchor/a2 is already served or accepted by Play. The actual public destination must be checked before entering it in Console; when a2 is authorized, align the chosen policy/URL with the final app identity and backend behavior.

## Validation and impact

The fundamental integration test runs the actual web packager in a disposable local copy. It checks accepted source hashes, visible HTML text, identical `<main>` content after packaging, a1/a2 availability, deletion anchors/contact and the packager's executable CSP/SRI checks. Its inert SDK fixture tests composition only, not authentication or a real APK. No dependency, permission or build configuration changed. Existing onboarding tests check the paired version URLs; existing mobile/security and CSP checks remain applicable.

WWW impact: additive static files and deletion anchors, plus versioned Privacy links in onboarding/API. Old aliases and a1 receipt contracts remain. The returned `privacyUrl` value changes but remains a valid same-site resource. No intentional breaking change; callers must follow the returned URL rather than assume the old alias. Deploy HTML and the WWW link change together so the new paths exist.

Android impact: new bundled documents require a new APK to reach installed devices. Existing installed APKs keep their bundled UI/assets; they are not upgraded by WWW publication. Static/current aliases continue to expose their current content until separately authorized. A later legal-version rollout needs an approved coherent WWW/API/WS/APK tuple; this patch does not make old installed APKs a2-ready. Stage pinning, signing, app identity and external-browser login behavior are unchanged.

No WS/protocol, database, financial, deletion-lifecycle or retention behavior changes. No extra SQL/Redis/HTTP calls are added by the links or documents; database egress is unchanged. Static bundle size increases by six small documents. New document paths are additive; no intentional breaking change.

## Handoff gates

Keep this as a separate local branch/diff; do not push it into #1155/#1160 or publish the HTML without the appropriate GO. Independently review this complete new diff under the repository Claude Code gate, recording its own maximum-three-round budget outside the committed diff. Earlier four review rounds for #1155/#1160 remain unchanged.

Still required: safe separately approved WS path #1197/#1199 and exact-release integration; final Production/#1157 evidence from Claude Code and Privacy publication approval; matching authorized APK/AAB/phone acceptance, actual IARC, #1140/#1146 and Play Console/privacy/deletion/Data safety/signing/testing gates. No activation, deployment, restart, final signing, merge or publication occurs in this patch.
