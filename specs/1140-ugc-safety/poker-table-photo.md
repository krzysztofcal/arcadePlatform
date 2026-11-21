# #1282 Poker table photos

One optional Google-photo consent covers the web profile, leaderboard and, in g3 (2026-11-21-g3), Poker tables. Existing g2 grants retain WWW access and require a one-time g3 confirmation tied to the saved copy and consent revision. Confirmation performs no download or upload. One withdrawal blocks new links everywhere, as does changing to a catalog avatar. Previously issued links may work until expiry, and recipients may retain saved copies.

The photo endpoint verifies the viewer JWT. The token-protected internal WS HTTP mode checks both participants in a single table state. The function checks the current copy, consent, suppression, moderation, blocks and deletion before signing. It repeats the database check and WS authorization before returning the URL. The public WS contract carries no photo URL.

A successful read uses two internal WS requests, two bounded database reads and one Storage signing request for one object. The browser retains only renderer-local state, limits refresh by seat and uses the catalog fallback. The endpoint enforces 24 reads per viewer per minute. Storage transfer depends on the number of visible photos and players. No billed egress measurement is available.

Privacy a5 PL/EN is a candidate. Existing aliases stay on a4 and historical documents are immutable. The feature reuses the existing consent schema and needs no new migration. Missing membership support fails closed. Google Play reconciliation remains separate.

Release order: verify the existing Google photo schema, roll out the compatible internal WS API, publish accepted Privacy a5, then separately authorize the flag. The Draft does not authorize any rollout operation. Exact-SHA WS Preview and device smoke are outstanding before Ready.
