# Redis V3 cutover — COMPLETED

The operational migration is closed on Stage and Production. Canonical evidence and protected-backup recovery procedure: [docs/ops/redis-v3-cutover.md](../../docs/ops/redis-v3-cutover.md), #1129 merged82aee39d, closeout#1130.

570 exact approved legacy XP keys deleted once;0uncertain outcomes,0legacy repopulation. Stage and Production use one Upstash Free database with distinct kcswh:stage:xp:v3 and kcswh:prod:xp:v3. Old credentials revoked, supported runtimes/new XP/profile/ranking/refresh/WS validated. No further reset, rotation, epoch reinitialization or dual-read is planned. Retain planner/executor for audit/recovery; they are NOT startup/background migration paths and must not be rerun as Account Deletion preparation.

## Stage Account Deletion integration — evidence recorded (not a Redis migration)

`store-upstash.mjs::cleanupRedisIdentity` still verifies account_deletion_release.redis_cutover against actual namespace/endpoint SHA256/current epoch/manifest and proven writers_drained+legacy_xp_reset_verified. Under the subsequent explicit Stage evidence GO, that metadata was recorded and independently re-read with enabled=false. Snapshot SHA2561590a62337efd688e2cb8cfc158cece4cce99192cb3969633e65ba66685997bf, operation-manifest6eb72bde2b7cf82af8de48c0dc3030ba9c33479e04acff7576bbc391510dd178,570matching intent/done pairs and0legacy keys were verified; old token rejected and existing Stage epoch matched the protected cutover journal. No Redis data/configuration/epoch mutation or Production release-record change. Preserve the protected backup/journal; do not rerun destructive tools. Storage and E2E readiness remain separate and OPEN. Sticky BLOCKED+SQL lifecycle checks and atomic owner index cleanup remain mandatory.

Runtime outside XP_TEST_MODE requires immutable V3 pins and exact environment configuration; missing credentials/namespace/epoch fail closed, while Poker/CH settlement remains independent. Deletion-enabled runtime requires its full lifecycle schema. With deletion OFF preserve main's pre-deletion Production-schema compatibility. No scan of global Redis is used for UUID cleanup.

Historical inventory classifications, backup hashes, CAS validation, drain and credential chronology are retained in research.md and the canonical operational document, not as a second executable cutover runbook.
