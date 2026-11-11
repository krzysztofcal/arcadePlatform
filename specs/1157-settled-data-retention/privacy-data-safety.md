# Privacy / Data safety proposal: 12-month settled history cap (#1157, T040)

**Status:** OWNER REVIEW READY · FACTUAL OPEN for the two points under "Open" · **not published**.
**Date:** 2026-11-11 · **Basis:** `main` `7feb761b` (after #1233) and the Production run evidence below.

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
| Historia gry i rozliczeń oraz zakończone wnioski o usunięcie konta | Rozliczone zapisy gry i rozliczeń, w tym ich prywatne kopie archiwalne i awaryjne, usuwamy lub ograniczamy automatycznie, gdy są starsze niż 12 miesięcy. Proces działa codziennie, partiami, więc usunięcie może nastąpić nieco później. Dłużej przechowujemy wyłącznie: historię salda konta, które nadal istnieje, bo jest potrzebna do wykazania tego salda; historię rozliczeń usuniętego konta jako zapis finansowy, bez profilu i danych logowania; identyfikator usuniętego konta, aby nie mógł zostać użyty ponownie; zapisy potrzebne do dokończenia trwającej gry lub rozliczenia. |
| Uprawnienia do plików i inne zapisy techniczne konta | Część zapisów nie ma automatycznego terminu usunięcia i może pozostać po usunięciu konta. Dalsze przechowywanie wymaga konkretnego uzasadnienia, np. sprawdzenia zakwestionowanego rozliczenia, wyjaśnienia nierozstrzygniętego incydentu lub sporu albo wykonania obowiązku prawnego. Sam brak automatycznego usuwania nie uzasadnia przechowywania bez końca. |

### EN

| Data | Period or retention criterion |
|---|---|
| Game and settlement history, and completed account-deletion requests | Settled game and settlement records, including their private archive and recovery copies, are automatically deleted or minimized once they are older than 12 months. The process runs daily in batches, so deletion may happen somewhat later. We keep only the following for longer: the balance history of an account that still exists, because it is needed to prove that balance; the settlement history of a deleted account as a financial record, without the profile or sign-in data; the identifier of a deleted account, so that it cannot be reused; records needed to finish a game or settlement in progress. |
| File permissions and other technical account records | Some records have no automatic deletion date and may remain after account deletion. Further retention needs a specific justification, such as checking a disputed settlement, resolving an outstanding incident or dispute, or meeting a legal obligation. The absence of automatic deletion alone does not justify keeping data indefinitely. |

## 2. Evidence matrix

| Statement | Mechanism (repo) | Decision | Production evidence |
|---|---|---|---|
| Archive and recovery copies older than 12 months are deleted | `scripts/ops/chips-ledger-settled-retention.mjs`, `public.chips_expire_archive_batch`; `docs/chips-ledger.md` "12-month settled history cap" | US1 | run `42954155632` (2026-11-11 03:39 UTC, policy `retention-12m`, executed, cutoff 2025-11-11, 0 eligible rows) |
| Archived idempotency rows go with the batch | `chips_expire_archive_batch` | D1 | same run |
| Gifts of closed or deleted tables, finished `poker_requests` older than 12 months are deleted | `public.chips_settled_retention_12m_run` | US2, D6 | same run |
| Completed deletion requests are minimized; the identifier stays | `chips_settled_retention_12m_run` | D3 | same run |
| Balance history of existing accounts is kept | not selected (FR-008) | D2 | — |
| Ledger history and snapshots of deleted accounts are kept | not selected | D5 | — |
| Records of a game or settlement in progress are kept | pending escrow retirement, unpruned and held closed-human batches are not expired (FR-003, FR-010) | D7 | — |
| "Daily, in batches" | dispatcher slot `03:39 UTC` (`arcade-chips-ledger-production-dispatch.timer`); at most 10 batches and 5000 rows per run (FR-005) | — | VPS audit 2026-11-11: installed dispatcher sha256 `24ac4554…` equals `main`, `chips_settled_retention_control.enabled = true` |
| NULL `p_execute` is a dry run on Stage and Production | `20261111213000_chips_settled_retention_12m_null_execute_guard.sql` (#1233) | — | Stage Apply run `43108320717`; Production is unchanged and needs its own GO |
| Provider copies follow provider rules | out of codebase (research.md) | D4 | unchanged a2 row |

## 3. Google Play Data safety

Data safety asks which data types are collected or shared, for what purposes, whether data is encrypted in transit and
whether users can request deletion. It has no retention-period field; retention is stated in the linked Privacy Policy
([Play Console Help: Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), to recheck
at entry time). #1157 therefore changes no Data safety answer:

- data types, purposes and sharing: unchanged (no new collection or recipient);
- "Users can request that data be deleted": unchanged (Account entry point and email, see `id="account-deletion"`);
- Privacy Policy URL: update the form only when the new Privacy version is published, so that the form and the policy
  match.

## 4. Open (needs OWNER)

1. **Version and rollout.** The wording needs a new candidate version, its immutable snapshot, alias, APK allowlist,
   manifest and tests, following `.agents/skills/arcade-legal-docs/references/release-gates.md`. This is a separate GO.
2. **`bot-only-7d` storage failure.** Since 2026-11-11 01:09 UTC the hourly `:09` `bot-only-7d` archive cycle fails
   with `chips_ledger_storage_get_failed` (`NoSuchKey`) followed by "durable recovery is not complete". The
   `retention-12m` entrypoint does not use that durable-recovery gate. It shares only the advisory lock and the exact
   object-path and delete helpers, and its 03:39 run succeeded. This does not change the wording above. The missing
   object should be diagnosed (read-only, separate GO) before an archive batch it belongs to reaches the 12-month cutoff.
