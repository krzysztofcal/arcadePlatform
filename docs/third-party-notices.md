# Third-party notices

Generated from repository evidence and upstream license files on 2026-06-22. This document supplements, and does not replace, the complete license texts linked below. Exact package versions remain authoritative in the two lockfiles.

## Games and game runtimes verified for redistribution

| Component | Repository location | Source / author | License and local copy | Required notice |
|---|---|---|---|---|
| 2048 | `games-open/2048` | [Gabriele Cirulli](https://github.com/gabrielecirulli/2048) | MIT — `public/games/2048/LICENSE` | retain copyright and MIT text |
| Canvas Tetris | `games-open/tetris` | [Dionysis Zindros](https://github.com/dionyziz/canvas-tetris) | MIT — `public/games/tetris/LICENSE` | retain copyright and MIT text |
| Maze Muncher | `games-open/pacman`, `play.html` route/credit compatibility keys `pacman` and `open-pacman` | Internal / AI-assisted first-party Arcade Hub work | MIT — root `LICENSE` and `public/games/pacman/LICENSE` | first-party component; no third-party notice beyond repository MIT |
| T-Rex Runner | `games/t-rex/vendor/wayou-t-rex-runner/`, `games/t-rex/main.js`, `game_trex.html`, `games/t-rex/index.html`, `play.html` | [wayou/t-rex-runner](https://github.com/wayou/t-rex-runner/tree/5455bfa408ec6b707c7300ff194b7390733a766d), wayou / 牛さん; vendored runtime header also names The Chromium Authors | BSD-3-Clause — `third_party/t-rex/LICENSE` | [attribution](../third_party/t-rex/ATTRIBUTION.md), [source](../third_party/t-rex/SOURCE.md); retain copyright, conditions, disclaimer and no-endorsement condition |
| Freedoom game data | `games-open/freedoom/assets/freedoom2.bin` | [Freedoom contributors](https://github.com/freedoom/freedoom) | BSD-3-Clause — `games-open/freedoom/LICENSE` | retain copyright, conditions and disclaimer; no endorsement |

No active game runtime is currently classified HIGH RISK in `docs/license-audit.md`.

## Vendored and remotely loaded browser components

| Component | Location/use | Source / author | License | Local evidence / requirement |
|---|---|---|---|---|
| Klaro | `js/vendor/klaro/*` and landing copy | [KIProtect GmbH and contributors](https://github.com/kiprotect/klaro) | BSD-3-Clause | [license](../third_party/klaro/LICENSE), [attribution](../third_party/klaro/ATTRIBUTION.md); retain license and disclaimer |
| Poppins | Google Fonts links in HTML; no tracked binary | [Poppins Project](https://github.com/itfoundry/Poppins); Indian Type Foundry, Jonny Pinhorn, Ninad Kale | OFL-1.1 | [license](../third_party/poppins/LICENSE), [attribution](../third_party/poppins/ATTRIBUTION.md); include OFL if font software is redistributed |
| `@supabase/supabase-js` | jsDelivr major-v2 UMD references in HTML | [Supabase](https://github.com/supabase/supabase-js) | MIT | [license](../third_party/supabase-js/LICENSE), [attribution](../third_party/supabase-js/ATTRIBUTION.md); retain MIT notice |

Klaro and Supabase CDN references do not identify exact releases in current repository evidence. These notices do not invent versions.

## Direct npm runtime dependencies

| Component | Location | Source / author | License | Local evidence |
|---|---|---|---|---|
| `postgres` | both manifests/locks | [Rasmus Porsager](https://github.com/porsager/postgres) | Unlicense | [license](../third_party/postgres/LICENSE), [attribution](../third_party/postgres/ATTRIBUTION.md) |
| `ws` | WS server manifest/lock | [Einar Otto Stangvik and contributors](https://github.com/websockets/ws) | MIT | [license](../third_party/ws/LICENSE), [attribution](../third_party/ws/ATTRIBUTION.md) |

## Complete locked npm inventory

Sources are the exact npm registry tarball URLs in the lockfiles. Package author details live in upstream package manifests; they are not inferred here.

| License | Locked components |
|---|---|
| Apache-2.0 | `@playwright/test`, `playwright`, `playwright-core`, `human-signals` |
| ISC | `isexe`, `signal-exit`, `which`, `yaml` |
| Unlicense | `postgres` |
| MIT | `acorn`, `ansi-escapes`, `ansi-regex`, `ansi-styles`, `braces`, `chalk`, `cli-cursor`, `cli-truncate`, `colorette`, `commander`, `cross-spawn`, `debug`, `emoji-regex`, `environment`, `eventemitter3`, `execa`, `fill-range`, `fsevents`, `get-east-asian-width`, `get-stream`, `husky`, `is-fullwidth-code-point`, `is-number`, `is-stream`, `lilconfig`, `lint-staged`, `listr2`, `log-update`, `merge-stream`, `micromatch`, `mimic-fn`, `mimic-function`, `ms`, `npm-run-path`, `onetime`, `path-key`, `picomatch`, `pidtree`, `restore-cursor`, `rfdc`, `shebang-command`, `shebang-regex`, `slice-ansi`, `string-argv`, `string-width`, `strip-ansi`, `strip-final-newline`, `to-regex-range`, `wrap-ansi`, `ws` |

Playwright distributions include an Apache-2.0 LICENSE and NOTICE. Those files remain in the installed package tarball; any deployment process that redistributes Playwright must retain them. Most packages are development-only and are not shipped by the web application, but are listed because they are third-party build/repository dependencies.

## Hosted services

Google Analytics and Google AdSense scripts are hosted services rather than copied repository software. Their service terms and privacy obligations require separate review and are not software license grants.

## Maintenance

Regenerate this file whenever either lockfile, a vendored component, a CDN URL or a font reference changes. Do not add a license for any component whose origin cannot be tied to a specific upstream artifact.
