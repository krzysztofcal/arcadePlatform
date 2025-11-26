# Games Import Plan — May 2025

Five open games landed in commit `72fd21e` with XP-integrated shells. Summary below captures IDs, upstream attributions, licenses, import references, and compliance notes.

| gameId    | Upstream project name | Author / copyright | License URL | Imported commit/tag | Compliance deviations or removals |
|-----------|-----------------------|--------------------|-------------|---------------------|------------------------------------|
| breakout  | Breakout              | Arcade Hub contributors | [MIT](../games-open/breakout/LICENSE) | `72fd21e` | No removals; Cookiebot-gated analytics retained as upstream. |
| flappy    | Flappy Bird           | Arcade Hub contributors | [MIT](../games-open/flappy/LICENSE) | `72fd21e` | No removals; Cookiebot-gated analytics retained as upstream. |
| minesweeper | Minesweeper         | Arcade Hub contributors | [MIT](../games-open/minesweeper/LICENSE) | `72fd21e` | No removals; Cookiebot-gated analytics retained as upstream. |
| pong      | Pong                  | Arcade Hub contributors | [MIT](../games-open/pong/LICENSE) | `72fd21e` | No removals; Cookiebot-gated analytics retained as upstream. |
| snake     | Snake                 | Arcade Hub contributors | [MIT](../games-open/snake/LICENSE) | `72fd21e` | No removals; Cookiebot-gated analytics retained as upstream. |

## Notes
- Game pages declare `data-game-id` matching the slug for XP/score routing (e.g., `breakout`, `flappy`, `minesweeper`, `pong`, `snake`).
- Attribution in each shell credits the Arcade Hub contributors and MIT licensing; no extra assets or vendor bundles beyond Cookiebot-managed analytics.
