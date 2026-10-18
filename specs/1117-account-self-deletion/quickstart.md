# Verification — #1117 V2

## Scope

Use local/disposable test databases and memory adapters only. No destructive Stage, deployment, production mutation or automatic migration apply under this task. Keep PR DRAFT; modified Stage migration workflow skips drafts. Do not make ready/dispatch migration until separately authorized. Never use ordinary Preview/personal users as deletion fixtures. Historic OVH/OTP PoC is discontinued, no PASS gate or new mail infrastructure.

## Fundamental checks

1. Verified owner vs arbitrary target UUID, origin/content/body rejection, explicit confirmation; duplicate POST/lost response one request, status cannot enumerate users.
2. Persist SQL intent then Redis fence; delayed writer cannot recreate profile/XP/session/ranking; raw SETEX/ZADD, admin target, sync, guest conversion, Redis epoch restart and already-active WS delivery tested. No cross-store atomicity assertion.
3. Multi-table active/all-in side-pot Leave, normal showdown, opponent/escrow conservation, deferred settlement and final single BURN including late winnings; replay uses frozen original receipt.
4. Retirement satisfies both USER CHECKs, FK deletion, history/idempotency/archive proofs; no new posting to retired wallet or old UUID.
5. Existing tick advances no-table requests; crash/outage/lost successful BURN/Auth response, lease takeover/stale result, bounded retry and financial mismatch incident. No destructive step after unresolved financial inconsistency.
6. Signed upload issued before request/legacy lost row; late PUT before horizon, delayed final cleanup, no false COMPLETED; bucket/issuer cutover gate.
7. Same email/Google new UUID, clean resources/roles/streak; max three Welcome, one Daily per UTC day, one once per campaign; atomic rollback/replay and global quota survive cascade. Privacy retention/rotation approved before release.

Use existing Node test runner/PGlite, extend critical tests where available; no UI snapshot suite. Run npm run syntax and npm run check:csp-inline as appropriate. CI runtime validation is not deployment evidence. Record actual commands/results in PR and tasks, not mocks described as Stage success.

## Later Stage activation

Separate GO for disposable destructive fixtures/migration/deploy. Standard password and genuine Google owner-confirmation smoke before enabling. Exact runtime SHA WS Preview Deploy and smoke required for runtime changes. No requirement to prove old login OTP request binding, no admin nonce reading or provider forgery. Completion requires official Admin hard-delete successful/reconciled and prior obligations satisfied. Production always separate GO.

## Current local evidence and stop conditions

CI account-deletion-fundamentals runs the maintained Node/PGlite endpoint, request/recovery/private-send, Redis/XP, Storage, retirement/WS-buy-in, reward and Leave suites: 109 passed locally. No real Stage/Google/password deletion smoke or PostgreSQL multi-connection contention run. Legacy Vitest-only files cannot run with current declared dependencies; no framework was added.

Do not enable the runtime flag/release row before legacy Redis standardization/cutover and final-effect inventory are complete. Redis cleanup currently explicitly reports unproven legacy ownership and prevents Auth deletion. Do not override this as an operator shortcut. HMAC approval/history and avatar legacy cutover rows require independent reviewed evidence; proposals seed no such approval. Stop new acceptance via database release=false while preserving guards/recovery; never roll back to old unfenced writers after acceptance.
