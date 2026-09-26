# Implementation Plan: Minimalna kwarantanna botów #1018

**Branch**: docs/issue-1018-bot-quarantine | **Date**:2026-09-26 | **Spec**: [spec.md](spec.md)

## Summary

Trwała klasa na USER, jeden shared access gate, istniejący authoritative JOIN i no-funding rollover, mały lifetime refill cap. Farming akceptowany do detekcji/wyczerpania budżetu. Nowy model i kontrakt są potrzebne do opisania trwałych blokad, retry i gwarancji finansowych. Wszystko poniżej jest przyszłym planem.

## Technical Context

JavaScript .mjs Node według istniejących package manifests, obecny postgres client/PostgreSQL ledger, WS na systemd Ubuntu, Netlify adapter. Brak nowych packages/frameworków. Testy node:test oraz istniejące behavior suites; tylko jeden nowy lokalny transaction test do prawdziwych wyścigów. Bez UI testów. Zakres100/500, istniejące CONTINUOUS_BOT.

Performance: batch USER rows tylko bounded członkostwem stołu, brak lobby viewer×table SQL, brak skanów ledger/history/inventory. Jedna dodatkowa batch classification write/read na nową decyzję; zależne query source/counter w refiller max2 tiers/cykl. Egress to tylko account IDs/class/balance i receipt, bez historii. Koszt CPU/WAL: detekcja zapisuje raz, counter/receipt raz na emisję. Contention: wspólne konta graczy na wielu stołach i source; cap job poza table queue. Brak niezmierzonych SLO; przyszły mały smoke obserwuje locks/retry/latency, nie load test.

## Constitution Check (przed i po projekcie)

PASS: reuse istniejących plików/ledger/locks; WS authority; fail-closed nowe finansowanie; zero bramki payout; fundamental tests only; JSP/global JS,klog,CSS jeden selector/linia,CSP SHA dla ewentualnego inline. Brak nowego inline/UI jest najmniejszym zakresem. Plan nie zawiera kodu ani poleceń Git. Docs PR nie zawiera migrations ani konfiguracji. Przyszłe supabase/migrations w same-repo PR świadomie mogą uruchomić DB Stage Apply PR i mutować shared Stage; deklaracja przed push, applied immutable/forward-only, osobny Production GO. Exact-runtime-SHA WS Preview i runtime smoke dopiero po implementacji i autoryzacji.

## Project Structure / punkty zmian

- shared/poker-domain/poker-progression.mjs: zachować pure progression, współdzielić walidację authoritative balance; nie dodać detekcji do publicznego read endpointu.
- Planowany shared/poker-domain/bot-access.mjs: parser threshold, batch locked USER facts, monotonic classifier, predicate classes/funding. Jeden helper jest uzasadniony trzema funding callers.
- shared/poker-domain/join.mjs::executePokerJoinAuthoritative: classification przed nowym seat/buy-in; table/state serializują pusty stół, rejoin zachowany.
- shared/poker-domain/bots.mjs::seedBotsForJoin: gate przed seed writes, także continuous repository call; nie utracić existing funded bots przy pomijaniu seed.
- ws-server/poker/persistence/persisted-state-writer.mjs::writeViaDb/writeReplacementFundings/writeManagedBotTopUps: gate przed funded CAS/seat/ledger; caller dostaje denied reason, nie fikcyjny receipt.
- ws-server/server.mjs::runSettledRolloverCommand: rozszerzenie istniejącego bankroll500 no-funding fallback do obu tierów i restriction; table-manager.mjs::prepareSettledHandRollover allowBotFunding:false i restore zamiast niespójnego commit recalculation.
- ws-server/poker/persistence/continuous-bot-table-repository.mjs: zachować seed/lifecycle/currentProfile, gate no-human i cap; brak specjalnego privileged bypass.
- shared/poker-domain/table-economy.mjs: istniejące mapping źródeł, nie nowe pule. Planowany shared/poker-domain/bot-refill.mjs: policy+receipt+general ledger tx; scheduler istniejący ws-server/poker/runtime/table-janitor.mjs/server sweep poza kolejką gry.
- netlify/functions/_shared/chips-ledger.mjs: wąska walidacja internal capped SYSTEM→SYSTEM MINT; WS chips-ledger.mjs zachowuje TABLE_BUY_IN; uporządkowane account locks w dotkniętych finansowych ścieżkach obu adapterów, bez szerokiego refaktoru.
- ws-server/poker/handlers/join.mjs, persistence/authoritative-join-adapter.mjs: neutralne denial; netlify/functions/poker-quick-seat.mjs::recommendSeatAtTable/handler nadal wskazówka, final JOIN authority. Brak nowego discovery/query/lobby engine.
- shared/poker-domain/leave.mjs i terminal-close.mjs: przegląd i fundamentalne regresje; nie wywoływać gate z cash-out.

## Kolejność transakcyjna

1. JOIN/funding zdobywa table row, state row, membership. Gate na dodatnim funding czy nowym admission; nie na każdej akcji gry.
2. Ustalić pełny zestaw potrzebnych kont USER/source/ESCROW i zablokować rosnąco po account id przed ich mutacjami; wszyscy ludzie jednym batch. Dostosować prelock w dotkniętych callers; oba adaptery nie gwarantują dziś order. Żadna ścieżka gate nie blokuje USER przed table. Terminal/leave serialized tym samym table; cross-table deadlock/serialization może mimo tego wystąpić z innymi operacjami: rollback i bounded existing retry, bez partial success.
3. Wykryć threshold przed debitem i utrwalić jednorazową zmianę. Znane policy denial zwraca structured result przed seat/ledger/CAS, dzięki czemu COMMIT zachowuje detekcję. Jeśli późniejsza finansowa operacja wymaga savepoint, zakładać go po detekcji; przy obsługiwanym błędzie rollback to savepoint, nie w aborted tx bez rollback. Błąd połączenia całej tx→unknown/recovery; nie deklarować detection committed.
4. W zgodnym JOIN debit i seat/state atomowo. Seed restricted pomija nowe boty bez usuwania istniejących. Payout i rejoin nie wymagają nowej pozytywnej autoryzacji funding.
5. Writer musi uzyskać table/state lock także dla funded rollover zanim sprawdzi membership, by nie ścigać JOIN; existing accepted action bez finansowania nie musi pobierać policy/classification rows. Odmowa przed CAS→no-funding fallback; runtime restore potwierdza commit, nie normalny commitPrepared z błędnym planem.
6. Refiller: policy→GENESIS/source accounts; żadnego table/USER lock. Niezależny od settlement, jedna mała emisja, bounded scheduler opisany w research. Nie czekać na refill przy JOIN/rollover.

## Minimalność i breaking impacts

Nie dziedziczyć projektowanych mechanizmów #869 (tabela porównania research). Zachować publiczny lobby/Create/Quick Seat contract, lecz nowy final denial może zwiększyć liczbę nieskutecznych rekomendacji; neutralny retry użytkownika jest świadomym ograniczeniem. RESTRICTED nie wraca automatycznie do NORMAL, może dotknąć legalnie bogate konto. Mixed table ma zatrzymane nowe bot CH. Bot availability może ustać trwale po lifetime cap do osobnej decyzji operatora; nie obiecywać odnawiania.

Addytywna schema wymaga wdrożenia przed runtime; brak schema/config fail-closed dla nowych admission/funding, nie dla payout. Nie aktywować starych i nowych writers równocześnie: zatrzymać nowe admissions/funding w oknie cutover, pozwolić zakończyć istniejące ręce i legalne leave, wdrożyć wszystkie authoritative writers i dopiero wznowić. Rollback runtime nie może przywrócić writerów ignorujących restriction/cap; pozostawić nowe funding wyłączone do naprawy. Historyczne balances/source returns nietknięte.

## Phases / handoff

Research i projekt gotowe do niezależnego review, nie implementacja. Następnie osobne zlecenie→schema→US1→US2→US3→fundamental validation→Stage/WS Preview gate. Cap values są proponowaną polityką do zatwierdzenia, disabled default; zmiana nie wymaga benchmarków. Kosztów/false-positive rate nie znamy. Brak technicznej potrzeby dodatkowego serwisu/projekcji/Caddy/lobby rewrite.

## Complexity Tracking

Brak uzasadnianych naruszeń konstytucji. Dwie małe nowe tabele tylko do trwałego cap i niezależnego od retention replay; klasyfikacja wykorzystuje istniejący USER row. Po ponownym przeglądzie usunięto potrzebę nowego table mode, detektora cash-out, drain i periodycznego window. Lifetime cap jest najprostszą skończoną polityką, ceną jest brak automatycznego odnowienia.
