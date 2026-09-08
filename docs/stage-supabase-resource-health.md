# Stage Supabase resource monitor (Issue #962, PR1)

The independent `Stage Supabase Resource Health` workflow runs every 15 minutes
and supports owner dispatch from canonical `main`. It does not consult or change
`CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED`. No cleanup caller imports the monitor.
This is observation only: `cleanupDecision=not_evaluated_monitor_only`, including
critical capacity. No circuit breaker is implemented in PR1.

## Credentials and read boundaries

Add GitHub secret `SUPABASE_STAGE_MANAGEMENT_TOKEN`: a fine-grained token scoped
to the Stage project with **only** `analytics_logs_read` and
`infra_disk_config_read`. The workflow also uses existing `SUPABASE_STAGE_DB_URL`.
It does not need a service-role Storage key. Token creation/configuration and
Stage execution are not part of this PR.

Only these Management API GET requests are made:

- `/v1/projects/krydukthwdvccggbyjfw/analytics/endpoints/metrics` (twice).
- `/v1/projects/krydukthwdvccggbyjfw/config/disk` (once).
- `/v1/projects/krydukthwdvccggbyjfw/config/disk/util` (once).

Each request has a 15-second timeout, no retries and no redirects. Two scrapes
are separated by a 60-second sleep; the actual elapsed window must be 55–75
seconds. No database connection is held during sampling. The DB URL must name
canonical Stage and the read-only transaction verifies `pg_control_system()`
against Stage's system identifier before reading capacity. One connection,
at most 5-second statement timeout (preserving a lower configured limit), 10-second connect timeout, 5-minute job timeout.

`loadLedgerCapacity` remains shared with `admin-ops-summary`: the admin keeps its
default exact row counts and response/logging contract, while this monitor uses
`includeRowCounts: false`. The monitor still reads PostgreSQL table/index sizes
and `pg_database_size()` without running exact ledger row counts. Only a
capacity warning/critical runs the largest-relations SELECT, `LIMIT 10`, inside
the same read-only boundary. No telemetry tables, history artifacts, Storage
operations, cleanup calls, migrations or maintenance SQL are introduced.
The admin API response, warning threshold and logging contract are unchanged.
The standalone script follows the existing ops klog pattern without importing
DB/auth startup logging; each monitor invocation emits one klog.

## Series and interpretation

Series names and label shape come from the official Supabase Metrics fixture:
https://github.com/supabase/supabase-grafana/blob/main/docs/metrics.md

- `node_cpu_seconds_total`: delta across all eight documented modes per CPU.
  CPU percent excludes idle and iowait; iowait is reported separately. Guest
  counters are not added again. Every CPU must have all modes and plausible
  elapsed CPU time. Missing/non-finite samples, resets, changed series sets and
  stale samples never become a healthy zero.
- `node_disk_read_bytes_total`, `node_disk_written_bytes_total`: bytes/second.
- `node_disk_reads_completed_total`, `node_disk_writes_completed_total`: IOPS.
  Rates are per device; stacked devices are not summed or compared to a guessed
  cloud I/O budget. Only matching Stage `service_type="db"` series are consumed.

CPU warning/critical: 70/85%; iowait: 10/20%. These are averages over one bounded
window, not instantaneous gauges or proof of pressure across multiple windows.
Missing CPU/iowait or complete disk counters produces unknown pressure.
Disk throughput/IOPS are observations, not an inferred saturation percentage.

Filesystem capacity warning/critical: 70/85% of
`fs_used_bytes / fs_size_bytes` from the authoritative `/config/disk/util`
response. `fs_avail_bytes`, `fs_used_bytes` and `fs_size_bytes` are reported
separately. The `/config/disk` response is retained for configured `size_gb`,
IOPS, throughput and disk type. PostgreSQL `pg_database_size()` is reported as
`databaseBytes` separately and is not used to reconstruct filesystem
capacity. The existing `ADMIN_LEDGER_DB_WARNING_MB` warning (default 800 MiB)
continues to belong to the admin contract.

Capacity and pressure have separate states. When pressure is healthy and
capacity alone is critical, `capacityState=critical` but top-level `state=warning`;
the monitor remains observation-only and cannot authorize or block cleanup.
Critical resource pressure wins over unknown, which wins over warning, then
healthy. Unknown and critical resource pressure make the monitor job fail
visibly; no cleanup workflow depends on it.

## Explicitly unavailable

No authoritative Dashboard “Disk IO % consumed” series was established from the
reviewed Supabase API/docs. It is reported as null, never reconstructed from
IOPS, throughput or time spent in I/O. WAL is also null: the official metrics
fixture/dashboard does not establish a WAL series; the Supabase postgres exporter
service explicitly disables the default WAL collector. This does not prove a
particular live project lacks custom WAL metrics. No live Stage scrape was made;
adding a verified WAL mapping can follow actual read-only rollout evidence.
Historical DB growth is unavailable because PR1 stores no history. Optional
unavailable signals are named explicitly and do not masquerade as zero.

API references (reviewed September 8, 2026):

- https://supabase.com/docs/guides/observability/metrics (beta; names may evolve)
- https://supabase.com/docs/reference/api/v1-scrape-project-metrics (analytics_logs_read)
- https://supabase.com/docs/reference/api/v1-get-database-disk (infra_disk_config_read;
  attributes.size_gb, iops, throughput_mibps, type)
- https://supabase.com/docs/reference/api/v1-get-disk-utilization
  (infra_disk_config_read; metrics.fs_size_bytes, fs_avail_bytes, fs_used_bytes)
- https://github.com/supabase/postgres/blob/develop/ansible/files/postgres_exporter.service.j2

Operational impact: one independent scheduled observation every 15 minutes after
merge, two API scrapes, one disk-config GET, and bounded read-only SQL. Missing
credentials produce a visible unknown result. Logs and job summary contain only
interpreted observations, never raw metrics, HTTP bodies, errors or credentials.
No Stage run is required to review this PR. Production, frontend, cleanup
selectors, batch sizes, retries and recovery/proof contracts are unchanged.
