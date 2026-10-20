# Redis V3 cutover — COMPLETED

The operational migration is closed on Stage and Production. Canonical evidence and protected-backup recovery procedure: [docs/ops/redis-v3-cutover.md](../../docs/ops/redis-v3-cutover.md), #1129 merged82aee39d, closeout#1130.

570 exact approved legacy XP keys deleted once;0uncertain outcomes,0legacy repopulation. Stage and Production use one Upstash Free database with distinct kcswh:stage:xp:v3 and kcswh:prod:xp:v3. Old credentials revoked, supported runtimes/new XP/profile/ranking/refresh/WS validated. No further reset, rotation, epoch reinitialization or dual-read is planned. Retain planner/executor for audit/recovery; they are NOT startup/background migration paths and must not be rerun as Account Deletion preparation.

## Remaining Account Deletion integration (not a Redis migration)

`store-upstash.mjs::cleanupRedisIdentity` still verifies account_deletion_release.redis_cutover against actual namespace/endpoint SHA256/current epoch/manifest and proven writers_drained+legacy_xp_reset_verified. Operational completion supplies evidence but does not itself write that private Stage release record. Next separate operator GO may bind/review the genuine existing evidence with deletion OFF; never manufacture proof, reset epochs or rerun destructive tools. Sticky BLOCKED+SQL lifecycle checks and atomic owner index cleanup remain mandatory.

Runtime outside XP_TEST_MODE requires immutable V3 pins and exact environment configuration; missing credentials/namespace/epoch fail closed, while Poker/CH settlement remains independent. Deletion-enabled runtime requires its full lifecycle schema. With deletion OFF preserve main's pre-deletion Production-schema compatibility. No scan of global Redis is used for UUID cleanup.

Historical inventory classifications, backup hashes, CAS validation, drain and credential chronology are retained in research.md and the canonical operational document, not as a second executable cutover runbook.
