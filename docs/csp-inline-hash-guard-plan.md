# CSP inline script hash guard — implementation plan

## Goal

Prevent a served inline script from reaching Netlify without its exact SHA-256 in the effective `_headers` CSP. Keep the guard deliberately small and repository-specific.

## Implementation

1. Add `scripts/check-csp-inline-hashes.mjs`. Scan root HTML/JSP plus `about/`, `games/`, `games-open/`, `landing/`, `legal/`, and `poker/`; never scan tests, docs, tooling, dependencies, or build artifacts.
2. Remove HTML comments, extract bounded `<script>...</script>` pairs, and ignore external `src`, empty blocks, `application/json`, and `application/ld+json`. Treat every other inline block as executable and hash its exact bytes without trimming or newline normalization.
3. Parse exactly one CSP block for each current route: `/*`, `/games-open/*`, `/game*.html`, `/poker/*`, and `/games-open/freedoom/*`. Resolve documents with a small ordered route function; allow `unsafe-inline` only for the exact Freedoom route.
4. Add `check:csp-inline`, run the repository verification once through `scripts/test-all.mjs`, and protect that registration with the existing runner guard. Remove the older `play.html`-only hash assertion.
5. Add `.gitattributes` LF rules so hashes match deployed bytes. Update CSP documentation with the maintenance command and contract.

## Verification and acceptance

The current repository passes; a changed inline byte without a matching hash fails; a matching hash passes; `src` and JSON data blocks are ignored; combined casing/quotes/multiline markup works; Freedoom receives its exact exception; and `unsafe-inline` anywhere else fails. Manually check `/`, `/play.html`, `/games-open/2048/`, `/game_trex.html`, `/poker/`, and `/games-open/freedoom/` on Netlify Deploy Preview.

No DB migration, ENV, WS deploy, dependency, runtime API, JSP, CSS, or CSP SHA is introduced by the guard itself. The intended developer-facing breaking change is that future executable inline scripts must update the effective route CSP. Orphaned historical hashes remain outside this issue.
