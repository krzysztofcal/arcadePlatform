# Arcade code and legal evidence map

Re-evaluate every path on the current branch. These are navigation hints, not a claim that behavior is currently deployed.

| Subject | Starting paths |
|---|---|
| Project rules | `agents.md`, `skills.md` |
| Phase A and legal status | `specs/1114-arcade-profiles-avatars/{spec.md,plan.md,tasks.md}`, G-LEGAL-A reports/operations/`legal-drafts` |
| Current Terms/Privacy | `legal/terms.*.html`, `legal/privacy.*.html`, historic `legal/terms.2026-10-26-a1.*.html`; landing copies if published |
| WWW signup/OAuth notice | `account.html`, `js/account-page.js`, `js/i18n.js`, `js/auth/supabaseClient.js` |
| Public profiles and leaderboards | `netlify/functions/_shared/user-profile.mjs`, `netlify/functions/profile-me.mjs`, public profile routes, `docs/automatic-public-profile-provisioning.md`, Supabase migrations |
| Versioned terms and guest receipts | `shared/profile-terms.mjs`, `ws-server/server.mjs`, `specs/1114-arcade-profiles-avatars/operations/enable-terms.sql` |
| Android documentation package | `mobile/poker/package-web.mjs`, legalPages allowlist, current Android version and explicit owner approval |
| Analytics/cookie consent | `js/klaro-config.js`, `js/consent-services.js`, copies in `landing/`, `js/analytics.js` |
| Account deletion and safety | Account UI, `shared/account-deletion.mjs`, `netlify/functions/`, `ws-server/`, `supabase/migrations/` |
| Server, databases and suppliers | `netlify.toml`, Netlify site metadata; Supabase regional project settings; Upstash Redis config; VPS systemd/journald; email configuration |

Published a1 != draft a2. G-LEGAL-A review 2026-10-28 reports: Supabase Paris, Netlify Functions US region; guest receipt TTL 1h and planned bounded deletion, which is not deployed until a compatible WS release. Validate live state before saying these remain true.
