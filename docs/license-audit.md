# Third-party licensing verification audit

Audit date: 2026-06-22
Repository revision audited: `3da23441568838d8121508228eb7d8254ea269bb`

This evidence audit covers tracked games, assets, vendored libraries, manifests, lockfiles and Git history. `UNKNOWN / HIGH RISK` means the repository does not prove origin or redistribution rights; it does not assert infringement.

## Executive result

Licensing information is not complete in one place. `about/licenses.html` is the human-facing register, while additional evidence is scattered through `public/games/*/LICENSE`, five `games-open/*/LICENSE` files, `games-open/freedoom/LICENSE`, the Dwasm vendor directory and npm metadata.

## SAFE

| Component | Location | Source / author | License | Existing evidence | Attribution / redistribution |
|---|---|---|---|---|---|
| 2048 | `games-open/2048` | [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048), Gabriele Cirulli | MIT | `public/games/2048/LICENSE`; central page | retain notice; redistribution permitted |
| Canvas Tetris | `games-open/tetris` | [dionyziz/canvas-tetris](https://github.com/dionyziz/canvas-tetris), Dionysis Zindros | MIT | `public/games/tetris/LICENSE`; central page | retain notice; redistribution permitted |
| Freedoom data | `games-open/freedoom/assets/freedoom2.bin` | [Freedoom contributors](https://github.com/freedoom/freedoom) | BSD-3-Clause | `games-open/freedoom/LICENSE`; central page | retain notice/conditions/disclaimer; redistribution permitted conditionally |
| postgres | root and WS npm manifests | [porsager/postgres](https://github.com/porsager/postgres), Rasmus Porsager | Unlicense | lock/package metadata | redistribution permitted |
| ws | WS npm manifest | [websockets/ws](https://github.com/websockets/ws), Einar Otto Stangvik and contributors | MIT | lock/package metadata | retain notice; redistribution permitted |

## REVIEW REQUIRED

| Component | Type / location | Proven source / license | Problem | Required fix |
|---|---|---|---|---|
| Klaro | vendored JS/CSS in `js/vendor/klaro` and landing duplicate | [KIProtect Klaro](https://github.com/kiprotect/klaro), BSD-3-Clause | no local license, notice, version or central entry | add upstream license/attribution; record paths; pin version separately when established |
| Poppins | remotely loaded font in HTML | [Poppins](https://github.com/itfoundry/Poppins), OFL-1.1 | absent from notices | add font authors/source/OFL notice; ship OFL if self-hosted |
| @supabase/supabase-js | CDN browser library | [supabase-js](https://github.com/supabase/supabase-js), MIT | central page identifies broad Supabase/Apache-2.0 instead of actual library | correct entry and retain MIT license |
| npm dependency set | both manifests/lockfiles | package registry/upstream metadata | no committed consolidated BOM/notices | generate notices including all locked components and preserve Apache NOTICE data |
| repository SVG/icon artwork | `img/**/*.svg`, inline SVG | Git history indicates custom repository additions | no explicit asset provenance manifest | record provenance only when maintainers can make a supported declaration; do not invent it |

The locked npm set consists of Apache-2.0 (`@playwright/test`, `playwright`, `playwright-core`, `human-signals`), ISC (`isexe`, `signal-exit`, `which`, `yaml`), Unlicense (`postgres`), MIT (`ws` and the remaining named packages in `docs/third-party-notices.md`). `fsevents` and several root-lock entries omit a license field; upstream/installed package metadata must be used and kept under review.

## HIGH RISK

These components must not be changed merely by writing new license claims:

- **Pacman** (`games-open/pacman`): local MIT claim conflicts with the cited upstream's WTFPL v2; imported revision unknown.
- **T-Rex Runner** (`games/t-rex`): local MIT claim conflicts with the cited upstream's current BSD-3-Clause and Chromium extraction history; imported revision unknown.
- **Twenty “Arcade Hub contributors” games**: Breakout, Flappy Bird, Minesweeper, Pong, Snake, Asteroids, Space Invaders, Frogger, Galaga, Missile Command, Simon, Connect Four, Whac-A-Mole, Memory Match, Sokoban, Brick Breaker, Tic-Tac-Toe, Hangman, Solitaire and Sudoku have no independent upstream/provenance proof. A self-issued MIT text does not prove ownership of externally copied code.
- **Dwasm/PrBoomX binaries**: GPL text/authors exist, but exact source revision, build recipe and complete corresponding source for deployed WASM/JS are not recorded.
- **Google libarchive/Comlink bundle in Dwasm**: embedded Apache-2.0 header exists, but exact source/version and complete applicable notice set are unproved.
- **Poker chip atlas and 35 derivatives**: source, author and license are unknown.

## Evidence locations and recommendations

Existing license evidence: root `LICENSE`; `about/licenses.html`; `public/games/{2048,pacman,t-rex,tetris}/LICENSE`; `games-open/{breakout,flappy,minesweeper,pong,snake,freedoom}/LICENSE`; Dwasm `COPYING`, `AUTHORS` and `README.md`; both npm lockfiles.

Maintain one `docs/third-party-notices.md` plus component license files, pin immutable upstream revisions/checksums, generate an SPDX/CycloneDX SBOM in CI, and reject new vendored files/assets without provenance. Do not rewrite upstream licenses or infer authorship from the committer.
