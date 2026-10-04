# Verification

Run existing fundamental suites for progression/bot-access/JOIN, poker-create-table.stakes, poker-quick-seat, poker-progression.endpoint, table-manager funding snapshots, Admin policy and funding/refill. Run full required CI and verify Netlify Preview. Review diff against #1038.

Deploy final runtime SHA with WS Preview Deploy and verify installed metadata. Using isolated Stage users and the existing Admin API, toggle 1000 disabled/enabled/disabled; verify new Create/JOIN/Quick Seat, 1099 vs 1100 unlock, wealthy availability and existing WS snapshot expiry/propagation. Keep live class rules. Stage target is 100/500/1000 enabled and higher disabled, with exact existing pools; preserve refill fields/caps. Production target requires separate authorization after review/merge.
