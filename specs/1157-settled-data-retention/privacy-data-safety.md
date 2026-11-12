# Privacy / Data safety proposal: 12-month settled history cap (#1157, T040)

**Status:** OWNER accepted the PL/EN wording with one correction (deletion delays, applied below) · candidate
`2026-11-12-a3` prepared in [`legal-candidate-a3/`](legal-candidate-a3/README.md) · **not published**.
**Date:** 2026-11-12 · **Basis:** `main` `4edf67ad` (after #1233 and #1237) and the Production run evidence below.

This file holds proposed user-facing wording and the evidence behind it. It changes no published document.
`legal/privacy.{pl,en}.html` must keep the text of the immutable a1 snapshot (`tests/mobile-legal-packaging.test.mjs`).
The a1 and a2 HTML files are immutable (`guard.config.json`). The wording below can be published only as a new
candidate version, after a separate OWNER GO for the text, the version and its rollout.

## 1. Proposed wording (replaces one row of the a2 retention table)

The a2 row "Historia gry, rozliczeń, usuwania kont i uprawnień do plików" / "Game, settlement, account-deletion and
file-permission records" is replaced by these two rows. All other a2 rows stay unchanged, including "Logs and recovery
backups", which already covers provider copies (D4).

### PL

| Dane | Okres lub kryterium przechowywania |
|---|---|
| Historia gry i rozliczeń oraz zakończone wnioski o usunięcie konta | Rozliczone zapisy gry i rozliczeń, w tym ich prywatne kopie archiwalne i awaryjne, usuwamy lub ograniczamy automatycznie, gdy są starsze niż 12 miesięcy. Usuwanie odbywa się cyklicznie i partiami, dlatego może nastąpić po upływie tego terminu, a przy zaległościach może trwać dłużej. Dłużej przechowujemy wyłącznie: historię salda konta, które nadal istnieje, bo jest potrzebna do wykazania tego salda; historię rozliczeń usuniętego konta jako zapis finansowy, bez profilu i danych logowania; identyfikator usuniętego konta, aby nie mógł zostać użyty ponownie; zapisy potrzebne do dokończenia trwającej gry lub rozliczenia. |
| Uprawnienia do plików i inne zapisy techniczne konta | Część zapisów nie ma automatycznego terminu usunięcia i może pozostać po usunięciu konta. Dalsze przechowywanie wymaga konkretnego uzasadnienia, np. sprawdzenia zakwestionowanego rozliczenia, wyjaśnienia nierozstrzygniętego incydentu lub sporu albo wykonania obowiązku prawnego. Sam brak automatycznego usuwania nie uzasadnia przechowywania bez końca. |

### EN

| Data | Period or retention criterion |
|---|---|
| Game and settlement history, and completed account-deletion requests | Settled game and settlement records, including their private archive and recovery copies, are automatically deleted or minimized once they are older than 12 months. Deletion runs periodically and in batches, so it may happen after this period ends and may take longer when there is a backlog. We keep only the following for longer: the balance history of an account that still exists, because it is needed to prove that balance; the settlement history of a deleted account as a financial record, without the profile or sign-in data; the identifier of a deleted account, so that it cannot be reused; records needed to finish a game or settlement in progress. |
| File permissions and other technical account records | Some records have no automatic deletion date and may remain after account deletion. Further retention needs a specific justification, such as checking a disputed settlement, resolving an outstanding incident or dispute, or meeting a legal obligation. The absence of automatic deletion alone does not justify keeping data indefinitely. |

## 2. Evidence matrix

Production evidence so far proves schedule and activation only. The daily `retention-12m` runs so far (2026-11-11 and
2026-11-12, 03:39 UTC) found zero eligible records, so no Production archive or table row has been deleted by this
policy yet. The delete path is evidenced by the Stage canary (run `42119577000`, batch `6`: 3 objects and 2 registry
rows deleted, `objects_expired_at` set; `tasks.md` T050) and the fundamental tests
(`tests/chips/chips-ledger-settled-retention.test.mjs`).

| Statement | Mechanism (repo) | Decision | Evidence |
|---|---|---|---|
| Archive and recovery copies older than 12 months are deleted | `scripts/ops/chips-ledger-settled-retention.mjs`, `public.chips_expire_archive_batch`; `docs/chips-ledger.md` "12-month settled history cap" | US1 | Delete path: Stage canary and tests above. Production: no candidates yet; latest run `43149624610` (2026-11-12 03:39 UTC, `state=complete`, `expired=[]`, cutoff 2025-11-12) |
| Archived idempotency rows go with the batch | `chips_expire_archive_batch` | D1 | Stage canary and tests; Production: no candidates yet (same run) |
| Gifts of closed or deleted tables, finished `poker_requests` older than 12 months are deleted | `public.chips_settled_retention_12m_run` | US2, D6 | Tests; Production: same run, all table counts 0 |
| Completed deletion requests are minimized; the identifier stays | `chips_settled_retention_12m_run` | D3 | Tests; Production: same run, `deletion_requests` 0 |
| Balance history of existing accounts is kept | not selected (FR-008) | D2 | — |
| Ledger history and snapshots of deleted accounts are kept | not selected | D5 | — |
| Records of a game or settlement in progress are kept | pending escrow retirement, unpruned and held closed-human batches are not expired (FR-003, FR-010) | D7 | — |
| "Periodically, in batches; longer with a backlog" | dispatcher slot `03:39 UTC` (`arcade-chips-ledger-production-dispatch.timer`); at most 10 batches and 5000 rows per run (FR-005) | — | VPS audit 2026-11-11: installed dispatcher sha256 `24ac4554…` equals `main`, `chips_settled_retention_control.enabled = true` |
| NULL `p_execute` is a dry run on Stage and Production | Production: `if p_execute is not true` in the already applied `supabase/production-migrations/20261105160500_chips_settled_retention_12m_production_contract.sql`; Stage: follow-up `20261111213000_chips_settled_retention_12m_null_execute_guard.sql` (#1233) | — | Stage Apply run `43108320717`. No additional Production migration is needed for the NULL guard; any new Production change still needs an OWNER GO |
| Provider copies follow provider rules | out of codebase (research.md) | D4 | unchanged a2 row |

## 3. Google Play Data safety

Data safety asks which data types are collected or shared, for what purposes, whether data is encrypted in transit and
whether users can request deletion. It has no standalone retention-duration field; Google Play requires retention and
deletion to be disclosed in the linked Privacy Policy
([Play Console Help: Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), to recheck
at entry time). #1157 therefore changes no Data safety answer:

- data types, purposes and sharing: unchanged (no new collection or recipient);
- "Users can request that data be deleted": unchanged (Account entry point and email, see `id="account-deletion"`);
- Privacy Policy URL: update the form only when the new Privacy version is published, so that the form and the policy
  match. The deletion-request answers must stay consistent with the published policy.

## 4. Open (needs OWNER)

1. **Candidate approval.** OWNER approval of the exact `2026-11-12-a3` files and their SHA-256 in
   `legal-candidate-a3/manifest.json`, including the corrected deletion-delay sentence.
2. **Version and rollout (separate GO).** Copy into `legal/` as an immutable snapshot, alias, APK allowlist, guard
   exclusions, CSP where applicable and tests, following `.agents/skills/arcade-legal-docs/references/release-gates.md`,
   with consistency with the authenticated profile/leaderboard (#1158) and the Play Data safety answers.
3. **Exceptions stay visible.** The retained identifier of a deleted account (D3) and the kept settlement history of a
   deleted account (D5) are explicit exceptions. They are not evidence of a general 12-month deletion of all data.

The `bot-only-7d` storage incident (#1236) is closed: fixed by #1237 (merge `4edf67ad`); batch `626` was `cleaned`
(6 transactions, 12 entries) in run `43125155458` (2026-11-12 00:09 UTC) and its escrow account was `retired` in run
`43128827366` (00:39 UTC). The OWNER's separate SELECT-only Production check confirmed both receipts and the Storage
objects. It does not affect the wording above.
