# Privacy candidate 2026-11-12-a3 (#1157) — not published

**Status:** candidate, OWNER approval of the exact files pending · **not published** · no alias, APK, CSP or guard
change.

- `privacy.2026-11-12-a3.pl.html`, `privacy.2026-11-12-a3.en.html`: copies of `legal/privacy.2026-10-28-a2.{pl,en}.html`
  with two changes only: the version line, and the a2 row "Historia gry, rozliczeń, usuwania kont i uprawnień do
  plików" / "Game, settlement, account-deletion and file-permission records" replaced by the two rows from
  [`../privacy-data-safety.md`](../privacy-data-safety.md) section 1 (deletion-delay sentence and completed
  deletion-request clarification as corrected by OWNER).
- `manifest.json`: SHA-256 of both candidate files and of the a2 sources they are based on.

The files sit outside `legal/`, so no alias, packager or Account link points to them. The repository root is the
Netlify publish directory, so they remain reachable by direct URL on deploy previews (and on Production after a merge),
like the other files under `specs/`; nothing links to them.

Publishing needs a separate OWNER GO: copy the files unchanged into `legal/` (re-check SHA-256 against the manifest),
make them immutable in `guard.config.json`, then switch aliases, APK allowlist and tests per
`.agents/skills/arcade-legal-docs/references/release-gates.md`. The a1 and a2 files stay unchanged.
