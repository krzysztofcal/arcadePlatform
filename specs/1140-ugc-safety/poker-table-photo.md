# Poker table Google photos

g4 allows authenticated non-guest Arcade Hub users, including spectators before Join, to see an opted-in Google avatar. Explicit CAS confirmation upgrades a g2 or Stage g3 grant for the same copy. Poker checks bilateral blocks; WWW behavior is tracked separately in #1305.

The Netlify function authorizes one batch and signs only new or changed versions. The client fetches WebP immediately and renders local Object URLs. Unchanged reconciliation uses no Storage signing or image GET. Withdrawal prevents new signatures after the record changes. Issued bearer links may remain valid, including applicable CDN caching, and an already displayed image can remain until the next reconciliation. Saved copies cannot be recalled.

| Scenario | Estimated image requests and transfer |
| --- | --- |
| Cold full table, 12 viewers × 9 images | 108 Storage GET, 2.16 MB at 20 kB per WebP, 12 batch invocations |
| 10 composition changes in one hour | 132 total batched calls if all 12 viewers see each change, before focus/reconnect. 130–228 GET (2.6–4.56 MB) if these changes add 22–120 misses. |
| Warm unchanged batch | One invocation/eligibility query, small JSON, zero sign and image bytes |
| Prior draft, nine seated viewers refreshing every minute | 4,860 GET/h, 97.2 MB/h, plus two WS membership calls per successful request |

Model assumes 20 kB per image and constant viewers. A new document can cause up to nine fresh GET. Batch count scales with actual triggers. Changed batches add a signing request and a subset SQL recheck. Auth mode and account deletion guards can add work, as can rate limiting and Android API preflight. No binary Netlify egress. Estimates exclude headers and do not represent billed usage.

Deploy frontend and endpoint together. Old clients fall back when they encounter the new API contract. No public WS protocol or DB schema change. Verify successful CORS responses and count cold/warm GET on Chrome and Android WebView at T007. Flag OFF prevents new issuance in that deployment; immutable older ON builds require separately approved cleanup.
