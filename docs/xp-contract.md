# XP v1 Contract (UI-facing)

Global `window.XP` provides:
- `startSession(gameId: string, opts?: { resume?: boolean }): void`
- `stopSession(opts?: { flush?: boolean }): void`
- `resumeSession(): void`
- `nudge(): void`

Lifecycle listeners (pagehide/beforeunload/pageshow/visibilitychange) must be
centralized in `js/xp.js`. Any temporary exception must include a line comment:
`/* xp-guard:allow-adhoc <issue/ticket> */` and be removed before release.
