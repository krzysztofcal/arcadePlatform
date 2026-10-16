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
