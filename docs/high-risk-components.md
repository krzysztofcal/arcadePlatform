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
| T-Rex Runner | `games/t-rex/` | Local files claim MIT, while the cited upstream currently publishes BSD-3-Clause and describes the project as extracted from Chromium. | Exact wayou and/or Chromium revision; applicable license and notices at import; code comparison; modification record. | The local credit cites [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner). That upstream states it was extracted from Chromium. | **INVESTIGATE** |

## Resolved first-party components

| Component | Repository location | Resolution evidence | Status | Recommended action |
|---|---|---|---|---|
| Twenty AI-assisted Arcade Hub games: Breakout, Flappy Bird, Minesweeper, Pong, Snake, Asteroids, Space Invaders, Frogger, Galaga, Missile Command, Simon, Connect Four, Whac-A-Mole, Memory Match, Sokoban, Brick Breaker, Tic-Tac-Toe, Hangman, Solitaire and Sudoku | `games-open/` subdirectories named in `docs/provenance-audit.md` | Owner states these simple games were created iteratively by AI agents under owner direction rather than copied from external upstreams. Local Arcade Hub attribution and Git history support repository-first introduction; no external source claim was found. | First-party AI-assisted provenance, based on owner representation; no longer HIGH RISK solely for lacking an external upstream. | **KEEP** |
| Poker chip atlas and 35 derived PNGs | `poker/assets/chips/chip-atlas.png` and `chip-{color}-{1..5}.png` | Owner states that ChatGPT image generation created the atlas at the owner’s request and Codex created and committed the derived PNGs from it. Git history records atlas addition and derived-asset commits. | First-party AI-generated asset path, based on owner representation; no external source URL or author is claimed. | **KEEP** |

## Runtime and asset components

| Component | Repository location | Why HIGH RISK | Missing evidence | Probable origin, if known | Recommended action |
|---|---|---|---|---|---|
| Dwasm / PrBoomX compiled runtime | `games-open/freedoom/vendor/dwasm/index.js`, `index.wasm`, `index.data`, and related vendor files | GPL text and author history are present, but the repository does not prove that users can obtain complete corresponding source for these exact binaries. | Exact upstream commits/tags; checksums; build configuration and scripts; local modification record; complete corresponding source or durable source offer for the distributed build. | Local files cite [GMH-Code/Dwasm](https://github.com/GMH-Code/Dwasm), which is based on PrBoom+ and PrBoomX. Exact revisions are unknown. | **INVESTIGATE** |
| Google libarchive/Comlink bundle | `games-open/freedoom/vendor/dwasm/libarchive.js`, `libarchive.wasm`, `worker-bundle.js` | JavaScript headers identify Google LLC and Apache-2.0, but the exact source artifact/version and complete applicable license/NOTICE set are not established. | Exact upstream repository and revision; relationship between JS/WASM/bundle files; upstream LICENSE and NOTICE; checksums; build/modification record. | Google-authored libarchive.js/Comlink-related code is indicated by embedded headers. The exact upstream project is not proven. | **INVESTIGATE** |

## Decision rule after investigation

For each **INVESTIGATE** entry:

1. Change to **KEEP** only when origin, authorship, applicable license, required attribution, and redistribution rights are supported by retained evidence.
2. Change to **REPLACE** when evidence cannot be recovered but an equivalent component with verified provenance can be used.
3. Change to **REMOVE** when evidence cannot be recovered and no verified replacement is selected.
4. Do not create a new license file on behalf of an upstream author or infer ownership from Git committer identity.
