# High-risk components

Generated from [license-audit.md](license-audit.md). A HIGH RISK classification means the repository does not currently contain enough evidence to prove origin, authorship, applicable license, or compliance with redistribution conditions. It does not assert infringement.

Allowed action values:

- **KEEP** — evidence is sufficient to retain the component as-is.
- **REPLACE** — substitute a component with one having proven provenance.
- **REMOVE** — stop distributing the component.
- **INVESTIGATE** — obtain and verify missing evidence before deciding whether to keep, replace, or remove it.

The owner’s provenance statement resolves components identified as first-party AI-assisted work. **KEEP** below records that resolution; it is not a legal certification or a guarantee of originality.

## Unresolved game components

| Component | Repository location | Why HIGH RISK | Missing evidence | Probable origin, if known | Recommended action |
|---|---|---|---|---|---|
| Pacman | `games-open/pacman/` | Local files claim MIT, while the cited upstream currently publishes WTFPL v2. The imported revision is unknown. | Exact imported commit/tag; license in force for that revision; code comparison; modification record. | The local credit cites [daleharvey/pacman](https://github.com/daleharvey/pacman), by Dale Harvey. Whether the current files derive from a specific revision is unproved. | **INVESTIGATE** |

## Resolved game components

| Component | Repository location | Resolution evidence | Status | Recommended action |
|---|---|---|---|---|
| T-Rex Runner | `games/t-rex/` | The unresolved local implementation was removed from the active runtime path and replaced with `wayou/t-rex-runner` at exact commit `5455bfa408ec6b707c7300ff194b7390733a766d`, licensed BSD-3-Clause. `third_party/t-rex/{ATTRIBUTION.md,LICENSE,SOURCE.md}` plus `public/games/t-rex/LICENSE` and `about/licenses.html` retain the upstream license, source mapping, checksums and attribution. | Active runtime uses vendored upstream `index.js`/sprite PNGs plus a local adapter for Arcade Hub controls and XP. | **KEEP** |
| Twenty AI-assisted Arcade Hub games: Breakout, Flappy Bird, Minesweeper, Pong, Snake, Asteroids, Space Invaders, Frogger, Galaga, Missile Command, Simon, Connect Four, Whac-A-Mole, Memory Match, Sokoban, Brick Breaker, Tic-Tac-Toe, Hangman, Solitaire and Sudoku | `games-open/` subdirectories named in `docs/provenance-audit.md` | Owner states these simple games were created iteratively by AI agents under owner direction rather than copied from external upstreams. Local Arcade Hub attribution and Git history support repository-first introduction; no external source claim was found. | First-party AI-assisted provenance, based on owner representation; no longer HIGH RISK solely for lacking an external upstream. | **KEEP** |
| Poker chip atlas and 35 derived PNGs | `poker/assets/chips/chip-atlas.png` and `chip-{color}-{1..5}.png` | Owner states that ChatGPT image generation created the atlas at the owner’s request and Codex created and committed the derived PNGs from it. Git history records atlas addition and derived-asset commits. | First-party AI-generated asset path, based on owner representation; no external source URL or author is claimed. | **KEEP** |

## Runtime and asset components still requiring investigation

None currently. The current Freedoom browser runtime is now documented as a pinned source-built Dwasm replacement in `third_party/dwasm/`, and the prior libarchive extraction layer has been removed from `games-open/freedoom/vendor/dwasm/`.

## Resolved runtime and asset components

| Component | Repository location | Resolution evidence | Status | Recommended action |
|---|---|---|---|---|
| Dwasm / PrBoomX compiled runtime | `games-open/freedoom/vendor/dwasm/index.js`, `index.wasm`, `index.data` | `third_party/dwasm/ATTRIBUTION.md`, `third_party/dwasm/LICENSE`, `third_party/dwasm/SOURCE.md`, plus vendored `games-open/freedoom/vendor/dwasm/{AUTHORS,COPYING,README.md}` record the exact upstream repository, pinned commit `ddf0347a4fc115b11ffb1c5710768b7c47c46698`, build inputs, produced artifact checksums and GPL corresponding-source obligations for the shipped binaries. | Exact source-built replacement is retained with reproducible provenance. The current loader boots the preloaded IWAD from `index.data`; `games-open/freedoom/assets/freedoom2.bin` remains tracked only as a legacy archive and is no longer loaded by `script.js`. | **KEEP** |
| Google libarchive/Comlink bundle | removed from `games-open/freedoom/vendor/dwasm/` | `games-open/freedoom/script.js` no longer imports `libarchive.js` or extracts `assets/freedoom2.bin`, and the old `libarchive.js`, `libarchive.wasm` and `worker-bundle.js` files are no longer shipped in the runtime path. | Historical runtime dependency removed from the distributed Freedoom build. | **REMOVE** |

## Decision rule after investigation

For each **INVESTIGATE** entry:

1. Change to **KEEP** only when origin, authorship, applicable license, required attribution, and redistribution rights are supported by retained evidence.
2. Change to **REPLACE** when evidence cannot be recovered but an equivalent component with verified provenance can be used.
3. Change to **REMOVE** when evidence cannot be recovered and no verified replacement is selected.
4. Do not create a new license file on behalf of an upstream author or infer ownership from Git committer identity.
