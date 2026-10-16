# #1113 minimal implementation plan — review only

## Constitution / scope

KISS/YAGNI: existing Google project, client, Supabase provider, public legal pages and Google Login V1. No new package/framework/infrastructure. No auth/WS/Stage change. No code is justified by this audit; no tests/deploys are added for configuration planning. If a later necessary code change is approved, extend only fundamental critical tests, preserve JSP-compatible JS/klog/CSP rules and normal PR/owner merge gates. No Git commands in this plan.

## Minimal proposed configuration delta (after explicit GO)

| Setting | Observed | Proposal |
|---|---|---|
| App name | Arcade Hub | Arcade Hub by KCSWH |
| Logo | None | Keep absent for smallest first submission; optional owner-approved existing-mark PNG/JPG/BMP, square120x120, <=1MB, only if approved |
| Support email | Existing eligible owner address | Preserve; do not invent/change it to an arbitrary mailbox |
| Developer contact | contact@kcswh.pl | Preserve |
| Homepage | https://play.kcswh.pl/ | Preserve initially; review Google's exact identity/homepage findings before publishing |
| Privacy | https://play.kcswh.pl/legal/privacy.en.html | Preserve, public200 and Google-data disclosure verified |
| Terms | https://play.kcswh.pl/legal/terms.en.html | Preserve, public200 |
| Authorized domains | kcswh.pl and otbqfijerkieoxwpxjnm.supabase.co | Preserve; verified ownership of kcswh.pl is established, not ownership of Supabase infrastructure |
| Audience / scopes / Web client | External/In production; basic3; existing exact origin/callback | No changes |

1. Re-read exact Production project/client and proposed fields immediately before editing; take only redacted configuration baseline. Do not export secrets.
2. After owner GO, change only the approved name (and optional approved logo), save Draft Branding. No client rotation, Supabase or DNS operation.
3. If covered by GO, run **Verify Branding**, inspect the complete result. No clicks were performed in this audit. Google may flag app-name/homepage consistency or hosted callback-domain ownership. Table absence of blockers has not been established because verification has not been submitted. If findings require extra edits, STOP with concrete proposal; do not remove the working callback/domain or claim ownership of supabase.co.
4. Only after verified/Ready to publish and owner authorization for publication, **Publish branding**. Audience already In production is not equivalent to published verified branding. Google documents a7-day valid verification result; publish in the approved window or re-review as required, never infer approval.
5. After propagation and separately authorized nonfinancial smoke with an owner-selected consenting existing account: capture sanitized name/logo/domain display on phone and desktop, Google basic permissions, callback to account.html, UUID equality on repeat login, session/reload/logout, password regression. Do not revoke permissions, create/delete users or perform financial/gameplay actions merely to force a new screen; agree any account-level consent reset separately if needed. Until then all new #1113 device/login checks are NOT TESTED.

## Files / methods

No implementation edits proposed now. Existing entry points `js/auth/supabaseClient.js::signInWithGoogle()`, `js/account-page.js`, generated `js/auth/supabase-config.js`, `netlify.toml` and Supabase provider remain untouched. If Google explicitly rejects the current homepage's shorter visible name, propose a minimal public copy update in `index.html` or an already-existing suitable public page, with normal PR/deployment approval; no speculative auth rewrite. Do not switch to kcswh.pl landing/legal URLs blindly: its terms link is currently404 and its privacy lacks the Google-specific paragraph.

## Costs / impact

Estimated incremental infrastructure cost for this plan:0. Existing services/domain retained; no paid-scope assessment or new APIs. No app-runtime breaking change is expected from display-name-only branding, but the name users see changes, Google may reject the draft, and a verified name does not guarantee removal of callback-domain text everywhere. Google may take minutes automatically or roughly2–3business days manually; no approval deadline is promised. Supabase custom domain is a separate paid/risky callback migration (~$10/month add-on on an eligible paid plan), explicitly not selected.
