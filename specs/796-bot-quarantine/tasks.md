# Tasks: #1018 bot quarantine

Wyłącznie przyszłe zadania. Żaden checkbox implementacyjny nie jest wykonany. Spec i policy proposals wymagają niezależnego review; nie uruchamiać speckit-implement.

## Phase 1 — Setup / autoryzacja

- [ ] T001 Zapisać w specs/796-bot-quarantine/quickstart.md niezależny wybór #1018 vs #869, osobne zlecenie implementacji i decyzję cap100000/500000 lifetime/default disabled. Gotowe: jawne review, brak automatycznego startu. FR-007/013/014,SC-004.

## Phase 2 — Foundational

- [ ] T002 Po T001 dodać addytywną supabase/migrations dla chips_accounts i dwóch tabel z data-model.md: access NOT NULL NORMAL/RESTRICTED; RESTRICTED komplet metadanych; policy tier PK IN(100,500),source FK,0<=issued_ch<=cap_ch,enabled=false; receipts operation_id PK,amount>0,ledger UUID UNIQUE,hash NOT NULL bez cascade hot-ledger FK. Sprawdzić rzeczywiste grants/RLS i odebrać klientowi zapis policy/access. Gotowe: brak seed/MINT i masowej klasyfikacji, istniejący500 seed nietknięty; przed publikacją jawny zamiar DB Stage Apply PR/shared Stage, applied forward-only. FR-001/007/008/013.
- [ ] T003 Po T002 sprawdzić i ujednolicić prelock w dotkniętych shared/poker-domain/join.mjs, ws-server/poker/persistence/persisted-state-writer.mjs oraz obu chips-ledger.mjs: table/state/membership przed uporządkowanym zbiorem account IDs; refill bez table/USER. Gotowe: żadnej deklaracji nieistniejącego order w CTE; unknown/deadlock rollback, payout bez nowego gate. FR-003/006/008/009.

## Phase 3 — US1: trwały dostęp (P1)

Independent test: próg, sticky stan i dwa przeciwne pierwsze admission.

- [ ] T004 [US1] Po T003 rozszerzyć shared/poker-domain/poker-progression.behavior.test.mjs i join.behavior.test.mjs: próg−1/=próg, invalid config/missing USER, spadek po detection, policy denial zachowuje classification, rejoin finansowanego miejsca. Gotowe: deterministyczne expected class/seat/debit, bez UI/glue testów. FR-001–003/006,SC-001.
- [ ] T005 [US1] Po T004 dodać shared/poker-domain/bot-access.mjs i reuse balance validation poker-progression.mjs: server threshold default1mld, batch all seated humans+candidate, monotonic status/first reason. Gotowe: missing !=zero; client nie ustala klasy; brak zapisu z pure evaluatePokerProgression i brak skanera/cashout hook. FR-001/002/006.
- [ ] T006 [US1] Po T005 rozszerzyć shared/poker-domain/join.mjs::executePokerJoinAuthoritative o final segregation przed seat/buy-in i structured deny commit. Gotowe: mixed odmawia wszystkich nowych ludzi, empty race serializowany, tier/capacity/stakes nadal obowiązują, savepoint po detection dla obsługiwanego błędu; resume nie wymaga zgodności nowego admission. FR-002/003/005/006/010,SC-001.
- [ ] T007 [US1] Po T006 dopasować ws-server/poker/handlers/join.mjs i persistence/authoritative-join-adapter.mjs do neutralnych poker_access_incompatible/unavailable; przejrzeć netlify/functions/poker-quick-seat.mjs::recommendSeatAtTable/handler bez nowego discovery. Gotowe: odmowa nie publikuje seat/success, direct i Quick Seat równoważne, brak automatycznej pętli/create, brak ujawnienia cudzej klasy/balance. FR-010/011/012.

## Phase 4 — US2: wszystkie funding gates (P1)

Independent test: każdy transfer path + no-funding rollover i legalny payout.

- [ ] T008 [US2] Po T006 rozszerzyć shared/poker-domain/join.behavior.test.mjs oraz ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs: seed/replacement/managed top-up denied przy jednym restricted, bot-only source guards, disconnected/pending leave, bez inflated stack i bez nowego transferu. Gotowe: true gate wspólny, known denial commit, unknown rollback. FR-004–006/010,SC-002.
- [ ] T009 [US2] Po T008 wpiąć bot-access do shared/poker-domain/bots.mjs::seedBotsForJoin oraz continuous-bot-table-repository.mjs existing call. Gotowe: ordinary restricted join succeeds bez nowych botów, already-funded stacks zachowane; managed exact-target failure atomowe bez phantom seats, brak bypass allowBotsOnly. FR-004/010,SC-002.
- [ ] T010 [US2] Po T009 wpiąć gate przed funded CAS w persisted-state-writer.mjs::writeViaDb/writeReplacementFundings/writeManagedBotTopUps. Gotowe: all-human batch pod table/state locks, brak częściowego zapisu planu po odmowie, preexisting action settlement bez dodatniego funding nie dotyka gate. FR-004/006/009,SC-002.
- [ ] T011 [US2] Po T010 rozszerzyć ws-server/server.mjs::runSettledRolloverCommand existing restore→prepare allowBotFunding:false→persist→restore dla obu tierów/restriction/unknown i zachować CONTINUOUS_BOT lifecycle w table-manager.mjs. Gotowe: bez normalnego commit recomputation na unfunded planie, bounded retry, brak kick/drain, wait jeśli za mało finansowanych graczy. FR-005/006/009/010.
- [ ] T012 [US2] Po T011 rozszerzyć shared/poker-domain/inactive-cleanup.behavior.test.mjs, leave.behavior.test.mjs oraz ws-server/poker/table/table-manager.behavior.test.mjs dla terminal-close.mjs/leave.mjs/table-manager.mjs: newly restricted mixed hand kończy się, legalny cash-out/return źródeł raz, brak finansowania, no-funding fallback/restart. Gotowe: dokładne escrow/claims, nie testować renderingu; nie dodawać gate payout. FR-005/006/009/010/012,SC-002.

## Phase 5 — US3: skończony refill (P1)

Independent test: ostatni cap, unknown commit/restart i brak blokady cash-out.

- [ ] T013 [US3] Po T003 rozszerzyć tests/chips-ledger.test.mjs o wąski capped SYSTEM→SYSTEM MINT i odmowę dowolnego source/kwoty/metadata bypass. Gotowe: istniejące buy-in/cash-out shape i hash/idempotency bez regresji; WS TABLE_BUY_IN adapter nie staje się publicznym minterem. FR-007/008/012,SC-003.
- [ ] T014 [US3] Po T013 dodać shared/poker-domain/bot-refill.mjs i minimalny internal entry w netlify/functions/_shared/chips-ledger.mjs: policy/source lookup, lifetime counter, receipt/hash/replay,dopełnienie do1 buy-in gdy source balance<buyIn i remaining wystarcza. Gotowe: cap/ledger/receipt jeden tx, no reset/env/source bypass, zero przy disabled/missing/timeout, registry idempotency zachowany. Nie wystawiać ogólnego uncapped MINT kształtu publicznym callers. FR-007/008/009,SC-003.
- [ ] T015 [US3] Po T014 wpiąć bounded refiller do istniejącego ws-server/poker/runtime/table-janitor.mjs/server sweep poza table queue/settlement locks;1job,2tiers/cykl,cooldown60s,timeout2s/lock250ms do walidacji. Gotowe: potrzeba istniejącego live table, brak tight retry i refill await w JOIN, persistent operation recovery, cap exhaust pauzuje nowe finansowanie przy braku płynności, source100 zgodne z table-economy.mjs. FR-007/009/010.
- [ ] T016 [US3] Po T014 sprawdzić retention w scripts/ops/_shared/chips-ledger-retention-cycle.mjs i chips-ledger-archive-prune.mjs względem data-model.md. Gotowe: receipts/issued nie kasowane ani resetowane, hot-ledger prune nie łamie replay; preferować dowód zgodności zamiast runtime zmiany, brak drugiego archiwizatora. FR-008,SC-003.

## Phase 6 — Cross-cutting / handoff

- [ ] T017 Po T007/T012/T015/T016 dodać jeden tests/chips/poker-bot-quarantine.transaction.test.mjs z istniejącym postgres/node:test i lokalnym odizolowanym DB: race NORMAL/RESTRICTED empty JOIN, cross-table classification/funding, ostatni cap/retry/unknown commit, denial+cashout. Gotowe:2połączenia, bariery bez sleeps, odmowa Stage/Production target; zero mixed/double mint/payout i funded-state rollback. FR-001–010/012,SC-001–003.
- [ ] T018 Po T017 zapisać w specs/796-bot-quarantine/quickstart.md wyniki fundamentalnych testów i minimalny cutover/rollback: wszystkie writers zgodne, brak reset classification/cap. Gotowe: ponowny simplicity/constitution review, breaking impacts jawne, tylko potrzebne zmiany packages/methods, bez generic cleanup. FR-012–014,SC-004.
- [ ] T019 Po T018 i osobnej zgodzie środowiskowej przeprowadzić przyszły Stage/WS Preview exact-SHA według .github/workflows/ws-preview-deploy.yml i quickstart.md. Gotowe: schema Stage właściwego targetu, deploy exact runtime SHA, manual smoke zwykły/restricted/mixed/CONTINUOUS_BOT/cash-out; nieaktywny refill lub odrębnie zatwierdzony ograniczony scenariusz. Brak Production bez osobnego GO. FR-013,SC-004.

## Dependencies / parallel examples / strategy

T001→T002→T003. US1:T004–007; US2:T008–012 zależy od klasyfikatora US1. US3:T013–016 po foundation może być opracowane niezależnie od US2, lecz T003/T014 dzielą ledger, więc sekwencyjnie. Nie oznaczono P dla współdzielonych plików. Przykład bezpiecznej równoległej pracy po T014: przegląd retention T016 i samodzielna walidacja US2, bez równoległych zmian ledger. T017 zbiera wszystkie story→T018→T019. MVP review to klasyfikacja+funding+cap jako całość; nie aktywować częściowej ochrony tylko na seed. 19 zadań,US1=4,US2=5,US3=4,setup/foundation=3,cross-cutting=3.
