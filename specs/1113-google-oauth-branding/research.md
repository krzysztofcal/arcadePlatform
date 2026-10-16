> **Current result (supersedes historical blockers):** Google branding is verified/published, desktop Google display and existing-user identity checks PASS. The apparent missing button was in the blue Information and summary side panel. Physical-phone smoke remains pending; see final record below.

# #1113 read-only audit — 2026-10-16 UTC

Reviewed current agents.md/skills.md on main846b2993f3d9cd95d11c1061d9a1175e33464b76, issue#1113 and completed#1100, specs/1100-google-login/production-audit.md and production-rollout.md. Historical preparation statements in those files do not override #1100's final owner-accepted completion record. No #1100 implementation or accepted auth limitation is silently reopened.

## Actual observations

- Authenticated Google Console, exact project `arcade-hub-prod-1100` / Arcade Hub Production: Branding name **Arcade Hub**, no logo, existing eligible owner support email (private/redacted), developer contactcontact@kcswh.pl. Homepage/play privacy/play terms and authorized domains are listed in plan.md. No edit/save/upload/publication/verification button clicked.
- Fresh Audience read: **External / In production**. Data Access: exactly openid, userinfo.email, userinfo.profile; sensitive and restricted lists empty.
- Fresh Verification Center: **branding is not shown to users**; data-access verification is not required because no sensitive/restricted scopes. The page does not prove a verified/published display brand. Its status, combined with the configured name and default callback, explains the technical presentation; no new OAuth consent attempt was started in this audit.
- Existing client list has **Arcade Hub Production Web** (Web application). Live client detail read at2026-10-16T21:13:55.991Z confirms sole origin `https://play.kcswh.pl` and sole redirect `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/callback`. Its client ID matches live Supabase provider via in-memory SHA equality; no secret was displayed/downloaded or rotated.
- Production official Supabase Management API GET at21:05:32.550540Z: Google enabled, client/secret configured, site URLhttps://play.kcswh.pl, signup enabled, manual linking disabled. Existing redirect allowlist remains account.html, play.kcswh.pl/* and *.netlify.app. The preexisting wildcard is an accepted #1100 exposure, not a branding fix; do not broaden or remove it here.
- Search Console Settings: property **sc-domain:kcswh.pl**, verified owner confirmed in the current authenticated session. This proves kcswh.pl, not ownership of the Supabase callback host. No TXT change or verification challenge submission.
- Public GETs: play homepage/privacy/terms all200, public generated Production configGoogle=true and correct project. Privacy contains the optional Google login/access/use/storage/sharing paragraph published by#1102. Public contactcontact@kcswh.pl exists. No need to rewrite legal content merely for this audit.
- Homepage branding detail: play homepage visibly says Arcade Hub; kcswh.pl landing says **Arcade Hub by KCSWH** and explains the service. Possible Google exact-name consistency finding remains untested until authorized branding verification. Do not claim automatic acceptance.
- Landing fallback is not currently equivalent: kcswh.pl/legal/privacy.en.html200 has no Google-specific paragraph and kcswh.pl/legal/terms.en.html404. Preserve working play URLs; do not expand scope into landing repairs or swap URLs speculatively.

## Cause and chosen approach

Audience publication does not publish a verified OAuth brand. The configured name is still shorter than requested and Google explicitly reports that branding is not displayed. Supabase uses the existing project-hosted callback, so that technical host can be shown as the destination/service identity. Supabase documents verified Google Branding as a way to show an app name/logo; custom Auth domain is another, separate mechanism. Therefore choose Google-only name/verification/publication first, without modifying callback, client, Auth implementation or purchasing a custom domain. Technical destination text might remain in some Google screens; final acceptance is actual device presentation, not an assertion that every supabase.co string disappears.

## Access / limits / owner participation

Read-only Cloud/Supabase/Search Console access succeeded. Write/submit permissions were not tested. Owner must approve exact changes and submission/publication, choose/provide artwork only if a logo is desired, handle 2FA/policy/owner-only prompts and select/consent to real device login tests after GO. No credentials should be pasted into chat. No fresh login, UUID, password or mobile/desktop consent check was run: all remain NOT TESTED for this change, with historical #1100 acceptance retained separately.

Multiple fresh Console tabs initially caused local memory pressure and incomplete page rendering. Closed only tabs created by this audit, then completed fresh Audience/Data Access/Verification/client reads in one audit tab. No active service/configuration was changed. Partial navigation-only reads were not accepted as evidence.

Private redacted diagnostic files remain under /tmp/1113-branding-audit, outside the repository. Only this summarized configuration evidence is intended for review; no sessions, tokens, personal support email or raw user data in SpecKit.

## Official references (checked 2026-10-16)

- https://supabase.com/docs/guides/auth/social-login/auth-google — default project identity, brand verification and custom-domain alternatives.
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification — Draft/Verify/Publish workflow, domain ownership, homepage/privacy checks, automated/manual timing and publication validity.
- https://support.google.com/cloud/answer/15549049?hl=en — brand fields, logo formats/size and publication.
- https://support.google.com/cloud/answer/13804963?hl=en — name/logo consistency requirements.
- https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains — current$0.0137/hour (~$10/month) optional add-on, not selected.

Supabase changelog index fetch was unavailable; no Supabase feature, SDK, API contract or configuration was modified based on an unverified update. Current official Google-provider/Management API documentation and real GET behavior were used.

## Owner GO / attachment preflight — 2026-10-16

Owner approved name **Arcade Hub by KCSWH**, the exact supplied KCSWH artwork, preserving appearance/proportions/transparency, unchanged existing URLs/domains/client/callback/scopes, Verify Branding, and Publish only after PASS. Real device/auth/UUID verification follows successful publication. No alternate logo, OAuth client, paid domain, DNS or application change is allowed.

PNG header and file-byte inspection:1254x1254, bitdepth8/color type6(RGBA with alpha),1,389,582bytes, SHA-2563173da777671b9962732e8808afd02d767a0ce43c70a954181c280415076cd29. Thus it is not the described120x120 input and exceeds the1MB maximum confirmed in the Google Branding UI and official [Branding requirements](https://support.google.com/cloud/answer/15549049?hl=en). A memory-only lossless IDAT recompression assessment did not reduce it below the limit; no derivative file was written and original bytes were untouched. No resampling or visual modification was attempted.

**STOP / input blocked:** requested upload-compliant same-logo input (or explicit deterministic resizing instruction) before configuration changes. No app-name save, logo upload, verification submission or publication occurred; this is not a rejection by Google. Mobile/desktop branded consent and auth/UUID regression remain NOT TESTED. Existing owner GO is retained; no new general configuration authorization is required after resolving the asset constraint.

## Authorized name/logo saved — verification UI blocked

The new supplied PNG resolves the earlier blocker:120x120,8-bit RGBA,25,519bytes, SHA-256e3c972a22ad46db47991459ffa4c188ba7fb5177e1f9fa04252b3b0426777b51. Source copied byte-exact to assets/kcswh-oauth-120.png for review. No editing or alternate artwork.

At2026-10-16T21:52:15.159Z, after exact-project and unchanged URL/domain checks, selected the new source file and changed only app name to Arcade Hub by KCSWH. Browser File SHA matched attachment; single explicit Save click received Google's saved-branding confirmation. Subsequent independent navigation reads persisted the name and120x120 current-logo preview. Google-hosted PNG is27,482bytes with different compression; decoding both non-interlaced RGBA PNGs proves exact pixel/alpha equality, SHA-256 of decoded RGBA2bbcbcca65ce01911e0af81ccb94a4c65725e840d987f20095fb476218f080cf. This is an inspection, not a transformation.

At21:54:13.924152Z official Supabase Management API GET confirms Google remains enabled; client ID equality, secret presence, Site URL, redirect allowlist, signup and manual linking unchanged. No Supabase write or secret disclosure. Existing live Google client origin/callback/scopes were not edited.

Read-only Google Console OAUTH_GRAPHQL responses (observed through the UI, not replayed/mutated) confirm displayName/name, existing URLs/domains, External/PRODUCTION and `verificationState=UNVERIFIED`, `verificationRequirements=UNVERIFIED_LOGO`, `verificationDisplayStatus=NEED_VERIFICATION`, compliance `COMPLIANCE_STATUS_UNSPECIFIED`. Verified-brand name/icon remain empty. Thus saved branding is not verified/published and the image is not reported rejected.

**UI blocker:** after saved-name/logo reload, no Verify Branding button or verification-status card is rendered on Branding. Confirmed full DOM, scroll/viewport and accessibility, PL and EN. Verification Center says brand not shown and links to Branding; overview says verification required and links to Verification Center. The official older consent-page URL redirects to overview, not an alternative submission screen. Ordinary read requests complete; unrelated optional console-preference404s are not treated as proof of the cause. Do not assert a permission/Google policy denial without evidence. No unsupported write API or extra setting change attempted.

One browser-automation transport timed out before changes; direct existing browser diagnostics then performed the approved Save. No repeated Save, no Verify/Submit/Publish clicks. No Google login attempt, consent/grant reset, account/UUID mutation, app/Stage/DNS/custom-domain change, deployment or paid service. New phone/desktop branded-consent and authentication regression remain NOT TESTED. #1113 must remain open.

Historical proposed owner action (superseded by the resolved blue-icon path below): open https://console.cloud.google.com/auth/branding?project=arcade-hub-prod-1100 in the owner session. If Verify Branding is present, run the already-approved verification and provide its actual status/issues; if absent, provide a sanitized bottom-of-page screenshot for diagnosing the Console discrepancy. Do not publish without PASS. No new general authorization is needed; owner/Console access is the current dependency.

## Owner screenshot follow-up / corrected cause — 2026-10-16

Owner's phone screenshot independently showed the saved name/logo and no Verify control in the main form. A [firsthand community reply](https://discuss.google.dev/t/verification-center-prepare-for-verification-permanently-disabled-branding-page-has-no-verify-branding-button/381088) pointed to the blue icon at the right of Branding. This was treated as a hypothesis and verified locally, not as an official Google bug diagnosis. Its accessible label is **Information and summary**; clicking it immediately revealed the real Verification status / Verify branding side panel. Earlier main-form/verification-center/English/legacy-route scans did not inspect that closed panel. The earlier unavailable-control inference was premature; no Google incident/escalation or configuration workaround was needed. Owner screenshot is private and is not committed because it includes personal contact data.

## Actual verification and publication

- Verify branding request:one click at2026-10-16T22:10:08.811Z. Google showed Verification in progress (up to5minutes), then explicitly confirmed branding verified with Publish branding available (7-day validity).
- The local read watcher initially recognized only the literal Ready to publish label, so classified Google's equivalent verified-message wording as UNKNOWN. This was a reader classification issue, not a Google failure; the actual text and enabled Publish control were inspected and preserved before publishing. No re-verification was issued.
- Publish branding:one click at22:11:45.695Z, only after positive verification. Readback22:12:46.298Z: **Your branding has been verified and is being shown to users.**
- Independent subsequent Console read metadata:verifiedBrand.displayName=Arcade Hub by KCSWH; visibilityEXTERNAL/publishStatePRODUCTION; verificationStateVERIFIED; verificationDisplayStatusVERIFIED; complianceStatusCOMPLIANT. Current published logo is the approved asset. Google's normal policy bookkeeping distinguishes reviewed/unreviewed domains after approval; effective configured domain inputs and OAuth origin/callback are preserved, not edited by the agent.
- No name/logo/domain rejection. No Google client/secret rotation, scopes/Audience/DNS/Supabase/app/Stage/infra/deployment changes. No unsupported write API.

## Desktop actual Google auth evidence

Before login, a read-only Auth admin lookup of exactly the previously owner-accepted#1100 test user's UUID confirmed it still exists in Production with the expected verified Google email. No user enumeration, new account, deletion, linking, password read or financial operation. Private identity values are not included here.

1. Normal existing public Google button, initiated2026-10-16T22:15:24Z. Google real desktop account chooser22:15:25.357Z: **Arcade Hub by KCSWH visible**, approved KCSWH logo visible, technical project-host text not visible. Selected only the known existing Google identity. Callback and session-after-reload22:16:40.209Z PASS, same pre-existing UUID. An intermediate local read crossed a navigation boundary; current app/session read confirmed successful completion instead of retrying the OAuth flow.
2. Separate test-only existing SDK flow requested prompt=consent with exactly openid/email/profile and the same client/callback; no application code/config or OAuth grants were reset. Actual Google returning-user re-confirmation22:18:22.280Z showed the approved name/logo and **Zalogujesz się ponownie w usłudze Arcade Hub by KCSWH**. This is not claimed as new-user consent/signup or a new-permission grant. The re-confirmation did not independently list email/profile details; basic-scope equality is supplied by request/config readback, not inferred from absent text. Completed22:18:27.416Z: same UUID, clean callback, profileHTTP200.
3. Token audit booleans:provider token absent from app KLog/non-SDK storage; SDK-managed provider token remains present, the accepted#1100 limitation, not a new zero-token-persistence claim. No session/access/provider tokens in report, source or public artifacts.
4. Private diagnostic crops are incomplete and not published as comprehensive device-screen evidence. Actual name/logo checks use the live Google DOM/asset identity; no fabricated screenshot or mobile-emulation claim.

| Final verification item | Result |
|---|---|
| Exact owner logo120x120/RGBA/alpha and name | PASS |
| Google brand verification and publication | PASS |
| Desktop Google visible name/logo and normal login | PASS |
| Same existing UUID, repeat/reconfirmation, callback, reload/profile | PASS |
| No extra OAuth scopes / no app/provider/client/callback/DNS change | PASS |
| Physical phone Google display/login | PENDING — owner device needed |
| Current password login/logout regression | NOT TESTED; historical#1100 result retained |
| Production new-user signup | NOT TESTED; no new account created |

Physical-phone acceptance is required before calling#1113 complete. Existing GO covers the owner's normal smoke; no configuration or publication action remains.

The current scope does not manufacture a new password-testing blocker for a Google-branding-only configuration change. Password auth settings/source were not changed; historical#1100 acceptance is retained and the absence of a fresh password smoke is disclosed. Remaining required real-device evidence is the physical phone Google display/login/return/reload result under existing GO. No issue closure or PR merge until owner acceptance.
