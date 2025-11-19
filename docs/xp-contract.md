# XP v1 Contract (UI-facing)

Global `window.XP` provides:
- `startSession(gameId: string, opts?: { resume?: boolean }): void`
- `stopSession(opts?: { flush?: boolean }): void`
- `resumeSession(): void`
- `nudge(): void`
- `requestBoost(multiplier: number, ttlMs?: number, reason?: string): void` (dispatches an `xp:boost` event; still accepts legacy `{ durationMs, source }` detail payloads.) Also accepts the legacy object form: `XP.requestBoost({ multiplier, ttlMs | durationMs, reason | source })`.
- `getFlushStatus(): { pending: number, lastSync: number, inflight?: boolean }`
- Boosts persist while `XP.stopSession()` is called, but boost timers are paused; they are rescheduled on the next `startSession()`/resume if the original TTL has not expired.

Lifecycle listeners (pagehide/beforeunload/pageshow/visibilitychange) must be
centralized in `js/xp/core.js`. Any temporary exception must include a same-line comment:
`// xp-lifecycle-allow: temporary(YYYY-MM-DD)` and be removed before the listed expiry.
