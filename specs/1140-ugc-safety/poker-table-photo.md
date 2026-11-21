# #1282 Poker table photos

The table permission is separate from Google photo import and WWW profile permission g2. It is optional, bound to the currently saved copy, and recorded with notice version `2026-11-21-p1`. Account allows separate withdrawal. Revocation stops new links. Previously issued links can work until expiry, and saved copies cannot be recalled.

The photo endpoint verifies the viewer JWT. The token-protected internal WS HTTP mode checks both participants in a single table state. The function checks the current copy, consent, suppression, moderation, blocks and deletion before signing. It repeats the database check and WS authorization before returning the URL. The public WS contract carries no photo URL.

A successful read uses two internal WS requests, two bounded database reads and one Storage signing request for one object. The browser retains only renderer-local state, limits refresh by seat and uses the catalog fallback. The endpoint enforces 24 reads per viewer per minute. Storage transfer depends on the number of visible photos and players. No billed egress measurement is available.

Privacy a5 PL/EN is a candidate. Existing aliases stay on a4 and historical documents are immutable. Migration `20261121120000_poker_table_photo_consent.sql` is additive and must be applied through the separately authorized database operation. Production migration approval, internal WS rollout, Privacy acceptance and publication, and activation of `POKER_TABLE_PHOTO_ENABLED=1` are separate steps. Missing membership support fails closed. Google Play reconciliation remains separate.

Release order: apply the approved migration, roll out the compatible internal WS API, publish accepted Privacy a5, then separately authorize the flag. The Draft does not authorize any of these operations. Exact-SHA WS Preview and device smoke are outstanding before Ready.
