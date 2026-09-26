# Implementation Plan: Minimalna kwarantanna botów #1018

**Branch**: docs/issue-1018-bot-quarantine | **Date**:2026-09-26 | **Spec**: [spec.md](spec.md)

## Summary

Trwała klasa na USER i boolean is_farmer_only na poker_tables, jeden shared access gate, istniejący authoritative JOIN i no-funding rollover, dokładny demand-driven autorefill. Farming NORMAL akceptowany; po detekcji brak nowych bot CH przy stole z RESTRICTED. Nowy model i kontrakt są potrzebne do opisania trwałych blokad, retry i gwarancji finansowych. Wszystko poniżej jest przyszłym planem.

## Technical Context

JavaScript .mjs Node według istniejących package manifests, obecny postgres client/PostgreSQL ledger, WS na systemd Ubuntu, Netlify adapter. Brak nowych packages/frameworków. Testy node:test oraz istniejące behavior suites; tylko jeden nowy lokalny transaction test do prawdziwych wyścigów. Bez UI testów. Zakres100/500, istniejące CONTINUOUS_BOT.

Performance: batch USER rows tylko bounded członkostwem stołu, brak lobby viewer×table SQL, brak skanów ledger/history/inventory. Jedna dodatkowa batch classification write/read na nową decyzję; fresh source read i opcjonalny mint w istniejącym funding tx,bez pollera. Egress to tylko account IDs/class/balance i wynik istniejącego registry, bez historii. Koszt CPU/WAL: detekcja zapisuje raz, existing registry raz na funding (dodatkowy MINT registry tylko D>0), MINT tylko przy niedoborze. Contention: wspólne konta graczy na wielu stołach i source; brak osobnego job i globalnego guard. Brak niezmierzonych SLO; przyszły mały smoke obserwuje locks/retry/latency, nie load test.

## Constitution Check (przed i po projekcie)

PASS: reuse istniejących plików/ledger/locks; WS authority; fail-closed nowe finansowanie; zero bramki payout; fundamental tests only; JSP/global JS,klog,CSS jeden selector/linia,CSP SHA dla ewentualnego inline. Brak nowego inline/UI jest najmniejszym zakresem. Plan nie zawiera kodu ani poleceń Git. Docs PR nie zawiera migrations ani konfiguracji. Przyszłe supabase/migrations w same-repo PR świadomie mogą uruchomić DB Stage Apply PR i mutować shared Stage; deklaracja przed push, applied immutable/forward-only, osobny Production GO. Exact-runtime-SHA WS Preview i runtime smoke dopiero po implementacji i autoryzacji.

## Project Structure / punkty zmian

- shared/poker-domain/poker-progression.mjs: zachować pure progression, współdzielić walidację authoritative balance; nie dodać detekcji do publicznego read endpointu.
- Planowany shared/poker-domain/bot-access.mjs: parser threshold, batch locked USER facts, monotonic classifier, predicate classes/funding. Jeden helper jest uzasadniony trzema funding callers.
- shared/poker-domain/join.mjs::executePokerJoinAuthoritative: classification przed nowym seat/buy-in; table/state serializują marker i membership, zwykły pusty stół nie przyjmuje RESTRICTED, istniejący rejoin zachowany.
- shared/poker-domain/bots.mjs::seedBotsForJoin: gate przed seed writes, także continuous repository call; nie utracić existing funded bots przy pomijaniu seed.
- ws-server/poker/persistence/persisted-state-writer.mjs::writeViaDb/writeReplacementFundings/writeManagedBotTopUps: gate przed funded CAS/seat/ledger; caller dostaje denied reason, nie fikcyjny receipt.
- ws-server/server.mjs::runSettledRolloverCommand: rozszerzenie istniejącego bankroll500 no-funding fallback do obu tierów i restriction; table-manager.mjs::prepareSettledHandRollover allowBotFunding:false i restore zamiast niespójnego commit recalculation.
- ws-server/poker/persistence/continuous-bot-table-repository.mjs: zachować seed/lifecycle/currentProfile, gate no-human i rzeczywisty managed plan; brak specjalnego privileged bypass.
- shared/poker-domain/table-economy.mjs: istniejące mapping źródeł, nie nowe pule. Planowany shared/poker-domain/bot-refill.mjs: postBotFundingWithRefill,exact deficit+funding+existing registry w jednym istniejącym tx; bez nowego schedulera.
- netlify/functions/_shared/chips-ledger.mjs: wąska walidacja internal demand-authorized SYSTEM→SYSTEM MINT; WS chips-ledger.mjs zachowuje TABLE_BUY_IN; uporządkowane account locks w dotkniętych finansowych ścieżkach obu adapterów, bez szerokiego refaktoru.
- ws-server/poker/handlers/join.mjs, persistence/authoritative-join-adapter.mjs: neutralne denial; netlify/functions/poker-quick-seat.mjs::recommendSeatAtTable/handler nadal wskazówka, final JOIN authority. Brak nowego discovery/query/lobby engine.
- shared/poker-domain/leave.mjs i terminal-close.mjs: przegląd i fundamentalne regresje; nie wywoływać gate z cash-out. Leave/deferred finalization jedynie utrwala tabelowy marker już istniejącej restriction przed usunięciem membership, bez nowej przesłanki odmowy wypłaty.

## Kolejność transakcyjna

1. JOIN/funding zdobywa table row, state row, membership. Gate na dodatnim funding czy nowym admission; nie na każdej akcji gry.
2. Ustalić pełny zestaw potrzebnych kont USER/source/ESCROW/GENESIS (GENESIS tylko przy możliwym refillu) i zablokować rosnąco po account id przed ich mutacjami; wszyscy ludzie jednym batch. Dostosować prelock w dotkniętych callers; oba adaptery nie gwarantują dziś order. Żadna ścieżka gate nie blokuje USER przed table. Terminal/leave serialized tym samym table; cross-table deadlock/serialization może mimo tego wystąpić z innymi operacjami: rollback i bounded existing retry, bez partial success.
3. Wykryć threshold przed debitem i utrwalić jednorazową zmianę. Znane policy denial zwraca structured result przed seat/ledger/CAS, dzięki czemu COMMIT zachowuje detekcję. Jeśli późniejsza finansowa operacja wymaga savepoint, zakładać go po detekcji; przy obsługiwanym błędzie rollback to savepoint, nie w aborted tx bez rollback. Błąd połączenia całej tx→unknown/recovery; nie deklarować detection committed.
4. W zgodnym JOIN debit i seat/state atomowo. Seed restricted pomija nowe boty bez usuwania istniejących. Payout i rejoin nie wymagają nowej pozytywnej autoryzacji funding.
Marker has_human_participant przenieść z początku JOIN do zaakceptowanego admission/rejoin; denial commitujący detection nie zmienia false. Wcześniejsze true zachowane.
5. Writer musi uzyskać table/state lock także dla funded rollover zanim sprawdzi membership, by nie ścigać JOIN; existing accepted action bez finansowania nie musi pobierać classification/registry rows. Odmowa przed CAS→no-funding fallback; runtime restore potwierdza commit, nie normalny commitPrepared z błędnym planem.
6. Composite refill: table/state/membership→pełny uporządkowany zbiór USER/source/ESCROW/GENESIS→classification/gate→exact deficit MINT+funding+existing registry. Brak oddzielnej emisji i globalnego policy lock. Krótkie timeouty, bounded deltas/retry; odmowa/timeout kończy tx i uruchamia istniejący no-funding fallback. Settlement/cash-out nie wywołują helpera; chwilowego oczekiwania FIFO na trwającą transakcję nie mylić z logiczną zależnością wypłaty od refillu.

## Minimalność i breaking impacts

Nie dziedziczyć projektowanych mechanizmów #869 (tabela porównania research). Zachować publiczny lobby/Create/Quick Seat contract, lecz nowy final denial może zwiększyć liczbę nieskutecznych rekomendacji; neutralny retry użytkownika jest świadomym ograniczeniem. RESTRICTED nie wraca automatycznie do NORMAL, może dotknąć legalnie bogate konto. Mixed table ma zatrzymane nowe bot CH. NORMAL-only zachowuje autorefill bez historycznego globalnego limitu; błędy DB/gate mogą czasowo uniemożliwić dotkniętą próbę. RESTRICTED tables stopniowo zużywają istniejące stacki, bez dalszego funding.

Addytywna schema wymaga wdrożenia przed runtime; brak schema/config fail-closed dla nowych admission/funding, nie dla payout. Nie aktywować starych i nowych writers równocześnie: zatrzymać nowe admissions/funding w oknie cutover, pozwolić zakończyć istniejące ręce i legalne leave, wdrożyć wszystkie authoritative writers i dopiero wznowić. Rollback runtime nie może przywrócić writerów ignorujących restriction/demand; pozostawić nowe funding wyłączone do naprawy. Historyczne balances/source returns nietknięte.

## Phases / handoff

Research i projekt gotowe do niezależnego review, nie implementacja. Następnie osobne zlecenie→schema→US1→US2→US3→fundamental validation→Stage/WS Preview gate. Polityka dostępności NORMAL i brak lifetime cap są zatwierdzone. Kosztów/false-positive rate nie znamy. Brak technicznej potrzeby dodatkowego serwisu/projekcji/Caddy/lobby rewrite.

## Complexity Tracking

Brak uzasadnianych naruszeń konstytucji. Bez nowej tabeli receipt; existing ledger/registry z cyklem retencji oraz jeden monotoniczny boolean na istniejącym poker_tables; klasyfikacja wykorzystuje istniejący USER row. Usunięto policy/counter lifetime i scheduler refillu. Atomic deficit+funding jest mniejszy niż asynchroniczna emisja z rezerwacją i recheckiem. Pozostaje tylko pojedyncza ścieżka autorytatywna, bez EXPOSURE/drain/lobby rewrite.

## Table hopping — minimalna korekta

Spec/kontrakt is_farmer_only obowiązuje wszystkie admissions,seed,replacement,managed top-up i refill; false oraz brak RESTRICTED ludzi są konieczne łącznie. Marker true zostaje po leave i zamknięciu. Utrwalić false→true dla już seated restricted także przy leave/deferred finalization, nie uzależniając legalnego payout od policy success. Unknown marker daje odmowę nowych finansów, nie default false.

Create: netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState odczytuje trwałą klasę twórcy i wpisuje marker przy INSERT w istniejącej tx,bez seed. poker-create-table.mjs::handler i Quick Seat create korzystają z tego samego helpera; nie przyjmować marker z payload. Bez claim/relabel ordinary existing tables. Final join recheck nadal authority. Pierwszy farmer ma existing Create+JOIN,nie automatyczną grę jednoosobową.

Projection: ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs SELECT, persisted-bootstrap-db.mjs mapping, persisted-bootstrap-adapter.mjs→tableMeta.isFarmerOnly oraz table-manager.mjs metadata; potrzebne do poprawnego runtime recovery, nie nowe źródło prawdy. Locked JOIN i writer czytają właściwe pole DB nawet jeśli snapshot stary. CONTINUOUS_BOT lifecycle bez nowych typów; farmer nie przechodzi automatycznie do świeżego normalnego managed replacement.

Breaking: RESTRICTED traci możliwość nowego wejścia także na zwykły pusty/bot-only stół; farmer-only nie odzyskuje bot availability po opróżnieniu. Existing mixed table może stać się trwale farmer-only; dotychczasowe legalne ręce/wypłaty zachowane. Brak nowego matchmaking engine,FAST/SLOW,EXPOSURE,90/10 lub drain.

## Retention i replay bez permanentnego receipt

Usunąć projekt poker_bot_refill_receipts. Funding key + existing chips_transaction_idempotency/payload_hash identyfikuje composite tx; D=0 nie dodaje MINT ani dodatkowego registry poza istniejącym fundingiem. D>0 deterministic MINT key powiązany ze starym funding key,kwota/hash zapisane w existing ledger. Replay nie przelicza niedoboru. Przed ponowieniem bez registry wymagać nadal OPEN/non-retired table i aktualnej niezaspokojonej state/seat delty; brak CLOSED/deleted table lub stary plan odrzucić,nie mintować po cleanup.

T016 jest wymagane, nie opcjonalny audit: obecne archive-export SQL,archive-prune ALLOWED_TX_TYPES/ESCROW shape oraz DB table-binding i selectors nie obejmują MINT. Rozszerzyć wyłącznie typed bot-refill parę według research R7/data-model §3:7d bot-only/30d closed-human po existing proof/hold gates,missing-table retirement,paired manifests i complete lifecycle. Bez broad MINT whitelist,nowego archiwizatora i permanentnych tożsamości poza existing lifecycle. Nie obejść existing active/ambiguous gates w imię TTL; pending proof podlega dotychczasowej recovery. Koszt hot wzrasta o MINT+jego registry tylko gdy D>0,ale nowy typ ma kompletną ścieżkę archive/prune,nie permanentny wyjątek.

Przed T001 obowiązkowa synchronizacja live #1018 z zatwierdzonym farmer-only. Review użytkownika jest źródłem korekty,ale issue-source adnotacja nie zastępuje zmiany live issue. Do czasu synchronizacji i osobnego zlecenia STOP implementacji. #869/#1017 bez zmian.
