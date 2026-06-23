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
| Maze Muncher | `games-open/pacman` | Internal / AI-assisted first-party Arcade Hub work | MIT (root repository license) | `games-open/pacman/`; `public/games/pacman/LICENSE`; central page; `docs/provenance-audit.md` | KEEP; first-party code and original canvas shapes; no external maze-chase clone/assets remain active |
| T-Rex Runner | `games/t-rex` | [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner/tree/5455bfa408ec6b707c7300ff194b7390733a766d), wayou / 牛さん; vendored `index.js` also carries Chromium Authors notice | BSD-3-Clause | `third_party/t-rex/{ATTRIBUTION.md,LICENSE,SOURCE.md}`; `public/games/t-rex/LICENSE`; central page | KEEP; retain BSD-3-Clause notice/conditions/disclaimer and no-endorsement condition |
| Freedoom data | `games-open/freedoom/assets/freedoom2.bin` (legacy archive) and the preload now baked into `games-open/freedoom/vendor/dwasm/index.data` | [Freedoom contributors](https://github.com/freedoom/freedoom) | BSD-3-Clause | `games-open/freedoom/LICENSE`; central page; `third_party/dwasm/SOURCE.md` records the Freedoom 0.13.0 source zip URL/checksum and the extracted `freedoom2.wad` checksum used for the current runtime | retain notice/conditions/disclaimer; redistribution permitted conditionally |
| Dwasm / PrBoomX WebAssembly runtime | `games-open/freedoom/vendor/dwasm/index.js`, `index.data`, `index.wasm` | [GMH-Code/Dwasm](https://github.com/GMH-Code/Dwasm/tree/ddf0347a4fc115b11ffb1c5710768b7c47c46698), Gregory Maynard-Hoare and contributors | GPL-2.0-or-later | vendored `games-open/freedoom/vendor/dwasm/{README.md,COPYING,AUTHORS}` plus `third_party/dwasm/{ATTRIBUTION.md,LICENSE,SOURCE.md}` pin the exact upstream commit, build recipe and emitted artifact checksums | retain GPL notice and make complete corresponding source/build information available with redistributed binaries |
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

## First-party AI-assisted provenance follow-up

The repository owner states that the twenty simple games attributed to Arcade Hub contributors were created iteratively by AI agents under owner direction rather than copied from external upstreams. The owner also states that ChatGPT image generation created the poker chip atlas at the owner’s request and Codex created and committed the derived chip PNGs from that atlas. Combined with local attribution and Git history, these components are treated as first-party repository work under the repository’s MIT terms and are no longer HIGH RISK merely because they lack an external upstream URL. This is a provenance classification based on the owner’s representation, not a legal certification or a guarantee of originality.

## HIGH RISK

These components must not be changed merely by writing new license claims:

No game component is currently classified HIGH RISK due to the former unresolved implementation. The active `games-open/pacman` route now serves first-party Maze Muncher code and is classified KEEP.

The previous `games-open/freedoom/vendor/dwasm/libarchive.js`, `libarchive.wasm` and `worker-bundle.js` archive-extraction layer is no longer shipped by the current Freedoom runtime.

## Evidence locations and recommendations

Existing license evidence: root `LICENSE`; `about/licenses.html`; `public/games/{2048,pacman,t-rex,tetris}/LICENSE`; `games-open/{breakout,flappy,minesweeper,pong,snake,freedoom}/LICENSE`; vendored Dwasm `COPYING`, `AUTHORS` and `README.md`; `third_party/dwasm/{ATTRIBUTION.md,LICENSE,SOURCE.md}`; both npm lockfiles.

Maintain one `docs/third-party-notices.md` plus component license files, pin immutable upstream revisions/checksums, generate an SPDX/CycloneDX SBOM in CI, and reject new vendored files/assets without provenance. Do not rewrite upstream licenses or infer authorship from the committer.
