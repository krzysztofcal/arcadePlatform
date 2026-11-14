# PR2 — available baseline evidence (partial T001/T014)

Collected from existing normal runs only; no benchmark dispatch. Provider build time is not end-to-end developer feedback time. Event-to-job-start includes dependency wait and is not pure queue latency. No percentage improvement or full T001 completion is claimed.

| Existing run | Available duration | Breakdown / limitation |
| --- | --- | --- |
| Android [40763780479](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40763780479) | 118s event to last job completion; job113s | deps2s, packaging1s, Gradle88s, receipt1s; no cache-hit evidence |
| WS Preview [40696936884](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40696936884) | 52s | validate14s, deploy31s, packaging1s, remote switch/health4s |
| Tests [40835901747](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40835901747) | 101s | core81s, chips56s, WS persistence34s, Playwright77s (browser install17s, E2E44s); jobs overlap safely on hosted runners |
| #1161 deploy `6ae254bfe79965aaeed76c16` | provider deploy_time33s | source30e9711; initial temporary PR |
| #1161 deploy `6ae2610bcecfce068152a96c` | provider deploy_time25s | same source; CORS update; localhost OPTIONS204 + GET401 for profile-public/xp-leaderboard, not full authenticated native Android API PASS |
| #1162 deploy `6ae2f623aa2bf1745dc5b138` | provider deploy_time17s | sourcef9dee5b; existing native main-base Preview |

Observed workaround: unsuccessful #1160 retarget/close/reopen/restore required four PR mutations; temporary #1161 creation/closure added two. APK origin pin required a separate test branch/config commit/push/manual build. Total owner time and all clicks were not measured. PR2 target: after one-time trusted-parent enrollment, zero routine retarget/temp-PR/CORS-panel operations for each reviewed stacked change, with one native exact-SHA Preview status. Acceptance is OPEN until approved enrollment and actual child synchronization.

T001 remains partial/OPEN: no matched multi-run before/after samples or measured human elapsed time. Reuse ordinary hosted run telemetry; do not trigger additional builds to fill a table. npm/Gradle/Playwright cache hit rates, redundant jobs, bounded APK prerequisite wait and safe parallelism remain scoped to later approved PRs; PR2 does not rewrite CI or repeat #1029. PR3 must wait boundedly for the matching Preview before Gradle so a pending Preview does not routinely force a manual rebuild.
