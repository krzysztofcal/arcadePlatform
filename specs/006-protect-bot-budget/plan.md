# Implementation Plan: Chroniony budżet botów — #869

**Branch**: `docs/issue-869-protected-bot-budget-spec`, draft PR #1017.
**Date**: 2026-09-25
**Spec**: [spec.md](spec.md)
**Status**: Plan do niezależnego review. Zatwierdzone D1–D3 i oba P1 uwzględnione. Wszystkie prace poniżej są przyszłe; obecna sesja kończy się analyze.

## Summary

Rozszerzyć istniejący authoritative join i persist-before-commit rollover o trwały wspólny limit ekspozycji, dopuszczenie klas, nieodraczalne wygaszanie oraz rezerwę SYSTEM i ograniczony refill. Pozostawić jeden silnik WS i append-only ledger. #869 dotyczy botów 100/500; kolejne tiery należą do #870. Zachować legalne ręce, wypłaty i człowiek–człowiek.

## Technical Context

**Language/Version**: JavaScript ESM backend; istniejący deploy/CI Node 20; browser global/IIFE JSP.
**Primary Dependencies**: istniejące `postgres ^3.4.5`, `ws ^8.18.0`; bez nowych pakietów.
**Storage**: istniejący PostgreSQL/Supabase, poker_tables/poker_state/poker_seats oraz chips_accounts/transactions/entries i archiwalne dowody/idempotency. DB przechowuje decyzje, WS zarządza grą.
**Testing**: node:test, istniejące behavior tests; rzeczywista konkurencja transakcji sprawdzana celowanym testem na odizolowanym lokalnym Postgres, nie wyłącznie mockiem SQL.
**Target Platform**: Netlify + istniejący WS VPS/systemd, oddzielny Stage/Production.
**Project Type**: istniejąca platforma real-time.
**Performance Goals**: nie wprowadzać oczekiwania na refill na ścieżce wypłaty; stałe/indeksowane odczyty per konto/stół, bez skanowania całego ledger przy join; brak nowego niezatwierdzonego SLO.
**Constraints**: finite issuance, fail-closed, exact arithmetic, atomowość, zachowanie proweniencji; tylko fundamentalne testy. D1–D3 z research są zatwierdzonymi wymaganiami.
**Scale/Scope**: jeden budżet/konto; dwie aktywne pule tierów i dwie klasy rezerwy na pulę; przyszła konfiguracja jednostek do 10000 nie aktywuje botów.

## Constitution Check

| Zasada / gate | Przed Phase 0 | Po Phase 1 |
|---|---|---|
| I — prostota | PASS: rozszerzenia istniejących punktów, dwa małe współdzielone moduły domenowe | PASS: nowe tabele tylko dla nowych trwałych faktów; brak frameworków i generic service |
| II — WS authority | PASS | PASS: Netlify discovery nie rezerwuje/nie rozpoczyna ręki; DB decyzja finansowa, WS commit gameplay |
| III — fail-closed, środowiska | PASS | PASS: brak dowodu = brak nowego dostępu/refillu, osobny Production GO; brak merge |
| IV — JSP/CSS/CSP/klog | PASS | PASS: minimalna prezentacja; brak browser imports; hash inline w tej samej zmianie |
| V — testy fundamentalne, konkretne ścieżki | PASS | PASS: tylko krytyczne admission/finanse/lifecycle/runtime; bez UI/CSS/JSP test suites i pełnego kodu |
| Stage apply / Preview | PASS jako plan | PASS jako wymaganie przyszłej realizacji; dowodów wykonania obecnie brak |
| Spec Kit: wszystkie decyzje rozwiązane | PASS: D1–D3 zatwierdzone | PASS: brak otwartych decyzji; wykonanie wymaga review i osobnego zlecenia |

Bramki konstytucji oceniają zgodność projektu, nie działającą implementację. D1–D3 nie są wyjątkami od konstytucji. Nie zmieniać konstytucji, ignore files, tooling ani zależności.

## Project Structure

### Documentation (this feature)

`specs/006-protect-bot-budget/`: spec.md, research.md, data-model.md, contracts/bot-budget.md, quickstart.md, plan.md, tasks.md, issue-source.md, checklists/requirements.md, checklists/economy.md. Wyniki obu analiz raportowane w rozmowie; analyze jest read-only.

### Source Code (repository root)

| Istniejąca ścieżka / symbol | Planowana odpowiedzialność |
|---|---|
| `shared/poker-domain/table-economy.mjs` — getBotFundingSystemKeyForBuyIn, isBotFundingAllowedForBuyIn | Źródło 100 z dedykowanej puli; 500 istniejące; tylko autoryzowana klasa; brak fallbacku |
| `shared/poker-domain/join.mjs` — executePokerJoinAuthoritative | Lock/rozróżnienie rejoin; obliczenie admission exposure; wszystkie budżety i seat w jednym tx |
| `shared/poker-domain/leave.mjs` — executePokerLeave i deferred leave finalizer | Wspólny guard członkostwa konta z join/writer/cleanup; trwałe powiązania drain pozostają po leave |
| `shared/poker-domain/bots.mjs` — seedBotsForJoin, computeTargetBotCount | Planowana liczba botów znana przed autoryzacją; slow target=1; zapis nowych funding identities; bez częściowego ukrycia odmowy |
| `ws-server/poker/persistence/authoritative-join-adapter.mjs`, `ws-server/poker/handlers/join.mjs` | Propagacja nowych kodów i metadanych; bez odtworzenia gry na podstawie odmówionego join |
| `netlify/functions/poker-quick-seat.mjs` — selectCandidate, createAndRecommend, handler | Filtrowanie per konto/klasa/tier i wyraźny wybór slow/human-only; ostateczny join w WS |
| `netlify/functions/poker-progression.mjs::readTableAccess` | Projekcja dostępu dla V2 direct URL, wspólny odczyt polityki bez autorytatywnego charge |
| `netlify/functions/poker-create-table.mjs::handler`, `netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState` | Trwała klasa i owner z auth; odrzucenie niezgodnych preferencji; Create nie emituje |
| `netlify/functions/_shared/poker-ws-runtime-notify.mjs`, `ws-server/server.mjs` internal materialize | Istniejąca bramka capabilities obejmuje także wersję polityki budżetu; stary WS nie materializuje nowych chronionych stołów |
| `ws-server/server.mjs` — buildLobbyTableEntry, buildLobbySnapshotPayload, sendLobbySnapshot, runSettledRolloverCommand, start_hand/resync/resume | Projekcja discovery per odbiorca, deadline przed ręką, odtworzenie istniejącego seat, no-funding fallback obydwu tierów |
| `ws-server/poker/table/table-manager.mjs` — bootstrapHand, prepareSettledHandRollover, commitSettledHandRollover, tableMeta | Klasa/owner/drain meta; blokada kolejnej ręki od deadline; allowBotFunding=false przy drain/pauzie |
| `ws-server/poker/persistence/persisted-state-writer.mjs` — writeViaDb, writeMutation, writeReplacementFundings, writeManagedBotTopUps | Autoryzacja pod lockami, delta, expectedVersion, ledger receipts i budżet razem; runtime dopiero po commit |
| `ws-server/poker/runtime/continuous-bot-table-rotation.mjs`, `table-janitor.mjs`, `continuous-bot-table-supervisor.mjs` | Drain ma pierwszeństwo nad postponement; sweep/restart odzyskuje deadline; managed churn bez user allowance |
| `ws-server/poker/persistence/continuous-bot-table-repository.mjs` — createManagedTable i odczyty meta | Nowe managed jako STANDARD, właściwa pula/rezerwa i funding proof |
| `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs`, `persisted-bootstrap-adapter.mjs` | Odczyt i walidacja pełnego policy/drain metadata przy restarcie |
| `shared/poker-domain/terminal-close.mjs` — loadBotFundingRows, resolveBotFundingSource, executeTerminalPokerCloseInTx | Legacy/new/top-up provenance; certyfikat zamknięcia i zwrot do oryginalnego źródła |
| `shared/poker-domain/inactive-cleanup.mjs` | Wąski close reason budget-drain po trwałym deadline i safe phase, bez human-presence postponement |
| `netlify/functions/_shared/chips-ledger.mjs::postTransaction/validateEntries`, `ws-server/poker/persistence/chips-ledger.mjs::postTransaction` | Różne istniejące adaptery, wspólne blokowane rezerwy; w Netlify wąski wewnętrzny SYSTEM-only MINT/rebalance, WS nadal finansuje TABLE_BUY_IN |
| `netlify/functions/chips-tx.mjs::handler` | Nie udostępnia publicznego obejścia chronionych źródeł/nowego wewnętrznego kontraktu |
| `scripts/ops/_shared/chips-ledger-retention-cycle.mjs`, `scripts/ops/chips-ledger-archive-prune.mjs` | Weryfikacja zachowania certyfikatu/dowodów; brak prune bez kompletnego powiązania audytu |
| `poker/poker.js`, `poker/poker-ws-client.js` i `poker/poker-v2.js` | Minimalne etykiety klas, countdown, neutralne komunikaty i alternatywy w istniejącym UI |

**Nowe pliki uzasadnione**: `shared/poker-domain/bot-budget.mjs` (jeden algorytm dla join/writer/odczytu), `shared/poker-domain/bot-bankroll.mjs` (reserve/refill i audyt, niezależne od silnika). Migracje w `supabase/migrations/` dopiero w przyszłej implementacji, nazwy wygenerowane przez istniejący CLI, nie fikcyjne timestampy. Nowy test concurrency tylko gdy istniejący harness nie pozwala dwóch realnych połączeń.

## Phase 0 — Evidence i zamknięcie decyzji

Research w research.md wskazuje aktualne mechanizmy i pułapki. D1–D3 są zatwierdzone; sprawdzić zgodność przyszłej realizacji z opisanymi granicami. Przed implementacją rewalidować SHA i diff relewantnych plików. Stage preflight ma potwierdzić actual balances, aktywne zobowiązania, archiwalne receipts, istniejącą alokację 500 oraz źródło i cel seeda 100. Nie zakładać miliona płynnej gotówki w istniejącym 500 tylko dlatego, że seed wynosił milion.

## Phase 1 — Design

### 1. Tożsamość, arytmetyka i admission

Kontrakt normatywny projektu w contracts/bot-budget.md; pola i ograniczenia w data-model.md. Fast rozliczać dokładnie w podjednostkach, 100 jednostek=1 000 000 podjednostek. Actual exposure CH też kumulować. Kadencja startuje przy pierwszej zatwierdzonej ekspozycji, nie przy otwarciu lobby ani odrzuconym join. Przesunięcie po bezczynności obliczyć względem niezmiennej kotwicy, nie od nowego requestu. Slow nigdy nie dofinansowuje brakującego fast w STANDARD.

Przy admission istniejący authoritative snapshot bot stacks jest podstawą ekspozycji nowego człowieka. Nie używać samej kwoty historycznego seed, bo stack mógł się zmienić. Ten sam uczestnik ma trwały zapis już udostępnionego stocku i watermark finansowania; retry nie polega na nowym requestId. Dla obecnych ludzi nowe fundingDelta autoryzować pełną kwotą dla każdego, obejmując leave_after_hand do momentu faktycznego odejścia. Czyste bot-only zapisuje funding, ale zero user exposure. FUNDING pozostaje zdarzeniem stołu/bota również przy wielu ludziach: user_id=NULL dozwolone, jeden ledger transfer i debit rezerwy, niezależne EXPOSURE z wymaganym user_id każdego gracza oraz trwałą tożsamością finansowania/stacku. Nie wyprowadzać właściciela z createdBy i nie wywoływać transferu w pętli po ludziach. Potwierdzenie w obecnym kodzie: `bots.mjs::seedBotsForJoin` przekazuje userId:null i osobne createdBy; writer `writeReplacementFundings/writeManagedBotTopUps` używa userId:null oraz klucza table/version/seat; `ws-server/poker/persistence/chips-ledger.mjs` oddziela user_id od created_by i księguje parę SYSTEM(-)/ESCROW(+) bez wpisów USER. Replacement zachowuje lineage starego residual; managed top-up dodaje nowego bota z pełnym buy-in; replacement z residual nalicza wyłącznie deltę.

Kolejność nowych ścieżek: table row → poker_state/seat rows → budżety ludzi posortowane po userId → pula tieru → źródłowe konta ledger w stałej kolejności. Istniejące cleanup z kolejnością state→table ujednolicić w dotykanych ścieżkach, nie tworzyć odwrotnej zależności. Refiller: global emission guard → pula tieru → liczniki/receipts → konta; nigdy nie blokuje poker_tables ani user budgets. Replay decyzji sprawdzić przed zmianą jakiegokolwiek salda rezerwy; ledger replay nie może ponownie zmniejszyć pool. Po deadlock/serialization retry pełnej transakcji z tą samą tożsamością i ograniczoną liczbą prób; nie publikować kandydata.

Wszystkie sprawdzenia finansowania w writerze są pod lockiem table przed CAS state, nawet gdy decyzja runtime była wcześniej pozytywna. Odmowa dowolnego człowieka wycofuje cały nowy batch. Nie zostawiać buy-in USER z odrzuconym seat. Timeout po commit rozstrzygać z trwałej decyzji, nie kompensacją na ślepo.

### Kroczące slow — D1 i częściowe zużycie P1

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

Pod blokadą konta odczytać trwałe EXPOSURE z budget_mode=SLOW, result=COMMITTED, consumed_at i kosztem integer. Dostępność jest wyliczana jako 10000 minus suma w oknie, nie przechowywana jako odnawiany grant. DENIED/replay nie zużywa ponownie. Czas UTC t pobierać z DB po uzyskaniu blokady (nie transaction-start sprzed oczekiwania); kontrola cofnięcia zegara ma blokować nowe zużycie. Retry zachowuje pierwotny receipt/czas. nextEligibleAt oznacza najwcześniejsze wygaśnięcie dostatecznej sumy dla konkretnego żądanego kosztu; wygaśnięcie 0,4 nie obiecuje pełnego bota.

Fundamentalny przykład: 0,4 jednostki w t0 i 0,6 w t0+1 h. Tuż przed t0+12 h dostępne 0; dokładnie w t0+12 h dostępne tylko 0,4; pełne 1 dopiero w t0+13 h, o ile nie było nowego zużycia. Dwa równoczesne żądania o pozostałe 0,4 przy różnych tierach mogą łącznie zużyć najwyżej 0,4. Przełączenia fast/slow i sesji nie usuwają drugiego kosztu.

### 2. Matchmaking, powrót i UI

STANDARD zachowuje multiplayer preference. SLOW_PRIVATE wybierany jawnie, owner z uwierzytelnionej sesji, najwyżej jeden otwarty slow stół właściciela. HUMAN_ONLY nigdy nie seeduje botów. Netlify dobiera dostępny wariant po wspólnym odczycie polityki; WS ponownie sprawdza pod lockiem. Opcja klienta nie jest dowodem klasy. Nie wznawiać retired HTTP join/get-table. `netlify/functions/poker-progression.mjs::readTableAccess` ma zwracać zgodną projekcję także dla V2 direct URL, bez zmiany bankroll progression. `poker/poker-ws-client.js` musi odróżnić końcową policy denial od transportowego pending/recovery; inaczej neutralny komunikat nie dotrze i retry będzie trwał. V2 `joinErrorMessage/isRetryableAutoJoinError` mapują nowe powody, bez retry do odnowienia uprawnienia na tym samym niezgodnym stole; MATCH może wykonać jeden rematch według D.1, DIRECT kończy się neutralną alternatywą.

Lobby personalizować po stronie serwera, bez wycieku limitów innych graczy. Cache projekcji unieważniać także po zmianie budżetu oraz granicy fast/slow, nawet jeżeli registry stołów nie zmieniło się. Direct URL/WS subscribe/bootstrap nie tworzy seat i nie omija admission. Reconnect istniejącego poprawnego seat podczas grace to wznowienie, nie nowy join; po deadline odtworzenie służy kończącej się ręce/wypłacie, nie nowej ręce. Nie przywracać wycofanego seat samym starym requestId.

Pokazać osobno stan dostępu i brak płynności; nie używać etykiet „oszust”, „kara”. Countdown tylko z serwerowego deadline/nextEligibleAt. Minimum zmian w istniejących plikach JS; JSP global/IIFE. CSS tylko gdy potrzebny, jeden selector/deklaracje na linii. Bez nowego inline; jeżeli konieczny, hash w netlify.toml/CSP w tej samej zmianie.

### D.1 — konkretna integracja matchmakingu

Kontrakt normatywny: contracts/bot-budget.md §D.1, także limit 2 prób/1 create. Rozszerzyć istniejące metody i journal, bez nowego silnika/rezerwacji:

| Punkt | Odpowiedzialność |
|---|---|
| `shared/poker-domain/bot-budget.mjs` (już planowany) | Wspólny read-only wynik eligibility kosztu/klasy/owner/drain z istniejących dowodów; projekcja nie mutuje allowance. Uwzględnić progression, realnie dostępne miejsce, pełny seed plan i proof, nie tylko saldo. |
| `ws-server/server.mjs::buildLobbySnapshotPayload/sendLobbySnapshot` | Przyjmować uwierzytelnionego odbiorcę, odfiltrować przed wysłaniem, oddzielić JOIN/RESUME. `activeLobbyTablesById` dostarcza kandydatów, nie autoryzację. Odświeżenie przy budżecie, seats, globalnym drain, puli/proof/capability oraz granicach 7d/12h, wznowieniu połączenia/strony. Wynik starej asynchronicznej projekcji nie nadpisuje nowszej (wersja/sequence). Brak danych nie rozszerza listy. |
| `netlify/functions/poker-quick-seat.mjs::selectCandidate/recommendSeatAtTable/handler` | Zachować prefer_humans → any_open, ale filtrować po dokładnym żądanym tierze/klasie i eligibility; skan po filtrze nie kończy się na pierwszym odrzuconym kandydacie. Filtry przed SQL LIMIT; po filtrach wymagających snapshotu kontynuować istniejący dobór stronicowaniem do wykazania braku kandydatów. Sam koniec pierwszych 50 nie uzasadnia create; przerwanie odczytu/błąd daje wait, nie fałszywe „brak stołu”. Stare availableBuyIns/highestUnlockedBuyIn nie mogą samowolnie zmieniać tieru. `selectExistingActiveSeat` nie zastępuje żądanego trybu obcym Resume. |
| `createAndRecommend`, `netlify/functions/poker-create-table.mjs::handler`, `_shared/poker-table-init.mjs::createPokerTableWithState` | Wspólny preflight przed zapisem nowego stołu i capability wszystkich tierów; create plus receipt w jednym tx. Reuse pustego własnego INIT i unique slow owner, przed utworzeniem ponowny lookup pod istniejącym advisory guard. Brak fundingu w HTTP; zwracana oferta nie jest gwarancją ręki. |
| `ws-server/poker/handlers/join.mjs`, `persistence/authoritative-join-adapter.mjs`, `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` | Sprawdzić konto/operationId/attempt/candidate z journal. Finalnie pod lockami ponownie autoryzować seat, koszt, pool, globalny drain; zapisać wynik próby wraz z efektem join. Sukces po timeout jest odzyskiwany, nie rematchowany. DIRECT zachowuje przypięty tableId. |
| `poker/poker.js::quickSeat/renderTables/navigateToPokerTable`, `poker/poker-v2.js::autoJoinSeat/joinErrorMessage/isRetryableAutoJoinError` | Przekazać operationId i stały wybór do strony stołu, w sesji przechować tylko kontekst transportowy. Przy MATCH trwała stale odmowa wraca do istniejącego Quick Seat dla jednej kolejnej próby; pierwszej nie wyświetlać jako błędu. DIRECT i RESUME bez cichego przeskoku. Renderować tylko projekcję, zero disabled Unavailable rows; jawne Resume i końcowe alternatywy. |
| `poker/poker-ws-client.js::sendCommand/sendJoin` i obsługa error | Rozdzielić finalną odmowę jednej próby od nieznanego wyniku/transport retry. Maks. 2 automatyczne retransmisje tego samego żądania, potem recovery/wait bez pętli; reconnect nie resetuje trwałego limitu operacji. Zakończyć pending starej próby przed rematch, zachować operationId, nowy attempt tylko po trwałej odmowie. Sam kod policy denial nie uruchamia nieskończonego resumable pending. |

Deduplikacja potrzebuje trwałej tożsamości operacji, ponieważ dzisiejszy Quick Seat nie ma request receipt, a in-memory pending znika przy reload. Najmniejsze rozszerzenie: nowe typy MATCHMAKING w już projektowanym `poker_bot_exposure_events`, bez osobnej tabeli rezerwacji (data-model.md §3). Advisory guard operacji/konta i istniejący guard doboru są przed table→state→user→pool locks; żaden path nie dobiera advisory guard przy trzymanych table/user locks. Guard doboru dotyczy tylko HTTP find/create; WS join bierze guard operacji przed lockiem stołu. Zapis rekomendacji w tx create, wynik admission w tx join. Kompaktowe fakty nie naliczają EXPOSURE i nie rezerwują CH/seats.

Brak rezerwacji pomiędzy HTTP a WS celowo pozostawia wyścig po pozytywnym preflight. W przypadku utraty warunków finalny WS odmawia atomowo, kontroler MATCH odświeża warunki i wykonuje najwyżej jeden rematch. Nowy INIT bez graczy/CH odzyskuje istniejący cleanup; terminal receipt operacji pozostaje. Przy nieznanym wyniku transportu nie tworzyć nowego celu. Przed create powtórny lookup własnego INIT chroni także równoległe karty z różnymi operationId. Granice i brak pustych orphanów należy sprawdzić fundamentalnym testem realnych dwóch transakcji (T033), bez nowego frameworka.

Breaking changes D.1: lobby przestaje być globalnym katalogiem i nie zawiera disabled rows; JOIN/RESUME mają odrębne znaczenie; zwykły Join/Quick Seat może automatycznie dobrać inny zgodny stół po race, podczas gdy direct/manual link pozostaje przypięty. HTTP rekomendacja zwraca kontekst operacji/attempt, nie sam tableId; brak zgodnej capability daje fail-closed. Jawny tier/tryb zastępuje wybór najwyższego dostępnego tieru w tej ścieżce. Stary klient bez kontekstu nie otrzymuje automatycznego rematch ani możliwości obejścia finalnego join.

### P1 — wspólny bezpieczny koszt graniczny seed

Wybrany kontrakt: preflight nie losuje. W istniejącym `shared/poker-domain/bots.mjs` współdzielić wyliczenie górnej granicy używanej przez `computeTargetBotCount`: dla uprawnionego seed po przyjęciu człowieka U = max(0, min(maxBots, maxPlayers − humanCountAfterJoin)); zachować istniejące warunki enabled/tier/shouldSeedBotsOnJoin i normalizację liczb. HUMAN_ONLY ma U=0; SLOW_PRIVATE ma deterministyczny target 1 w dozwolonej pojemności. Gdy seed nie jest dozwolony, nowy koszt seed=0, lecz istniejący pre-funded stock nadal wymaga autoryzacji exposure.

Preflight używa tego samego snapshotu seats, buy_in/canonical stakes, klasy i cfg co obliczenie kosztu: maksymalna liczba nowych botów = max(0,U−existingActiveBotCount), ograniczona rzeczywiście wolnymi miejscami po human admission; sprzeczny snapshot oznacza brak rekomendacji. Maksymalny SYSTEM debit to ta liczba × buy_in. Do kosztu ekspozycji nowego człowieka dodać udostępniony dotąd nieautoryzowany stock według §1 kontraktu; nowy funding autoryzować niezależnie każdemu eligible human. Preflight sprawdza pełną granicę względem allowance i właściwej rezerwy, a nie pojedynczy wylosowany mniejszy wariant. Nowy stół oceniany jako pusty INIT z jednym przyszłym człowiekiem i żądanym maxPlayers/tierem/klasą.

`executePokerJoinAuthoritative` ponownie odczytuje warunki pod lockami, oblicza tę samą granicę, następnie wybiera faktyczny target w jej zakresie przez istniejące computeTargetBotCount i przekazuje jawny targetBotCount do `seedBotsForJoin`. Seeder nie losuje ponownie, gdy otrzymał autoryzowany target. Finalny debit i EXPOSURE dotyczą tylko rzeczywistego nowego fundingu, nigdy całej granicy. Przy niezmienionych warunkach losowość nie może zwiększyć kosztu ponad preflight; rzeczywista zmiana cfg/seats/stacków/puli/budżetu nadal wymaga recheck i może uruchomić zatwierdzony bounded rematch. Brak zgodności konfiguracji/capability między HTTP a WS oznacza brak oferty. Limit 2 prób/1 create pozostaje.

Fundamentalny scenariusz deterministyczny: STANDARD 100 CH, maxPlayers=6, pierwszy human, minBots=2/maxBots=3, brak starych botów, allowance wystarczające, pula STANDARD=250 CH. Granica wynosi 300 CH: preflight nie rekomenduje/nie tworzy funded stołu niezależnie od RNG wybierającego 2 lub 3; zero transferów. Przy puli 300 CH preflight dopuszcza, join z kontrolowanym RNG może wybrać 2 albo 3 i zawsze mieści się w zatwierdzonej granicy, księgując odpowiednio tylko 200 albo 300 CH. To jeden scenariusz graniczny z wariantami, nie nowy szeroki suite.

Celowy koszt prostoty: granica może odmówić nowego finansowanego dostępu, choć mniejszy losowy target mieściłby się w puli. Komunikat mówi o braku środków na wymagany bezpieczny plan; nie zmienia limitów ekonomii, liczby prób ani nie dopisuje rezerwacji/nowych pól DB.

### P2 — zgodny reuse własnego pustego INIT

Ponowne użycie wymaga łącznie: created_by=uwierzytelnione konto, właściwa niezmienna klasa/slow owner, dokładnie żądany tier/buy_in **i maxPlayers**, zgodne kanoniczne stakes (sb/bb dla tego buy_in), zgodny lifecycle/policy/capability, OPEN+INIT, brak drain/pauzy, brak zajętych seats, nierozliczonych roszczeń oraz escrow=0. Zweryfikować pod istniejącym guard doboru i table/state locks przed rekomendacją; sama zgodność created_by/class/tier nie wystarcza. Nie przepisywać parametrów starego stołu. Pełny preflight granicy fundingu nadal obowiązuje. Dla zwykłego STANDARD/HUMAN_ONLY niezgodny własny INIT pomija się i kontynuuje zgodny find-or-create w limicie 1 create.

Dla SLOW_PRIVATE najpierw znaleźć każdy OPEN stół właściciela: niezgodne maxPlayers/tier/stakes lub policy oznaczają jawny parameter conflict/wait i możliwość świadomego wyboru istniejącego stołu, jeśli legalnie dostępny. Nie tworzyć drugiego slow, nie zmieniać parametrów ani nie zamykać automatycznie starego tylko po to, aby obejść unique owner. Dalszy create dopiero gdy poprzedni został bezpiecznie zamknięty przez istniejący lifecycle, w nowej jawnej operacji. Nieznana ekonomia pozostaje fail-closed.

Fundamentalny kontrakt: własny OPEN INIT o maxPlayers=2 i tierze100 nie może zostać zwrócony dla żądania maxPlayers=6; wariant niezgodnych stakes również odrzucony. STANDARD/HUMAN_ONLY mogą znaleźć/utworzyć inny zgodny cel; SLOW_PRIVATE zwraca jawny konflikt, zero drugiego create, bez zmiany parametrów starego.

### D.2 — istniejąca administracyjna inspekcja (read-only)

D.1 filtruje wyłącznie lobby gracza/Quick Seat/JOIN/RESUME. `netlify/functions/admin-tables-list.mjs::listTables` zachowuje inventory wszystkich utrwalonych poker_tables, istniejące filtry OPEN/CLOSED/ALL, sortowanie i bounded pagination (domyślnie20, max100), bez eligibility/budżetu admina, owner slow, capacity lub player lobby filter. `admin-table-details.mjs::loadTableDetails` zachowuje odczyt dowolnego utrwalonego tableId po `requireAdminUser`; nie zmienia allowlist/auth i 401/403. Nie obejmuje automatycznie procesowych guest tables nieobecnych w inventory.

Minimalnie rozszerzyć SELECT i bezpieczną projekcję `netlify/functions/_shared/admin-ops.mjs::loadPersistedTableSnapshots/createTableMeta` (używane również przez loadPersistedTableSnapshot), listTables i loadTableDetails: botAccessClass z bot_access_class (STANDARD/SLOW_PRIVATE/HUMAN_ONLY; brak → jawne LEGACY/unknown), botDrainingStartedAt i botDrainingDeadlineAt z utrwalonych pól, odrębny botDrainingActive. OPEN+udowodnione drain daje active=true; CLOSED zachowuje historyczne daty, active=false; brak kompletnego dowodu → unknown, nie „brak drain”. Przy opóźnionej projekcji fanout odczytać najwcześniejszy trwały FAST_EXHAUSTED powiązany ze stołem i zastosować ten sam min/original+30 jako czystą projekcję, bez naprawiania DB w GET. Nie zmieniać status/persistedStatus OPEN/CLOSED ani phase/lifecycle; nie zgadywać klasy z liczby botów. Timestampy prezentować jawnie z timezone.

`js/admin-page.js::renderTables/renderTableDetail` pokazuje te pola w istniejącej liście i szczegółach, bez osobnego panelu. Nie wysyłać raw poker_state, prywatnych hole cards, sekretów ani allowance innych kont; istniejące action meta/cashout metadata przechodzą bezpieczną allowlistę/redakcję, jeżeli mogłyby ujawnić takie dane. Inspekcja nie wykonuje join/funding/akcji/lifecycle i nie daje dodatkowego seat ani wyjątku FAST/SLOW. Admin grający używa zwykłego autorytatywnego admission. Brak żywej subskrypcji spectator; [#789 — Poker: Spectator Mode](https://github.com/krzysztofcal/arcadePlatform/issues/789) to osobna przyszła funkcja (OPEN potwierdzone 2026-09-25, mimo starego CLOSED w treści #869).

Fundamentalne testy: dodać przypadki list/details i auth/projection do istniejących `tests/admin-tables-list.behavior.test.mjs`, `tests/admin-table-actions.behavior.test.mjs` i `tests/admin-auth.behavior.test.mjs`: non-admin odrzucony; admin z wyczerpanym fast widzi wszystkie persisted klasy/statusy w wybranym filtrze i poprawną paginację; szczegóły dają class/unknown i osobny drain/original deadline, bez prywatnych kart/allowance i bez zapisów. W istniejącym join behavior potwierdzić brak admin bypass. UI admina/lobby wyłącznie ręcznie na przyszłym Preview.

### 3. Trwały drain bez zablokowania live hand

Wykrywanie: przy każdej decyzji nowej ekspozycji i przed startem/rollover weryfikować, czy istniejący human może pokryć wymaganą deltę. Dokładne zero fast po zaakceptowanym funding też oznacza wyczerpanie w tej samej chwili; nie czekać na kolejny żądany seed. Dla dodatniej reszty brak wymaganego funding oznacza brak nowego triggera; nie wymyślać progu całego buy-in.

Zapis źródłowego FAST_EXHAUSTED pod lockiem; jego czas niezmienny. Projekcja started_at/deadline nie może być wydłużona; wcześniejsze udowodnione zdarzenie skraca ją zgodnie z regułą minimum. Rozdzielić wewnątrz tej samej transakcji wynik DENIED/DRAIN od kandydata rollover: najpierw pod table/state/user locks obliczyć pełny koszt; niewystarczający budżet zapisuje trwałe DENIED + pierwszy DRAIN i commit **bez** nowego finansowania/stacków/used counters. Nie rzucać błędu, który cofnąłby również ten wynik. Jeżeli zapis kandydata był już rozpoczęty, cofnąć go do savepoint sprzed mutacji i zatwierdzić wyłącznie decyzję odmowy/drain przy zachowanych wcześniejszych blokadach. Zewnętrzny błąd/awaria przed commit nie jest zatwierdzoną obserwacją: runtime nie wykonuje nowej ręki/admission i po recovery ponawia decyzję, nigdy nie rekonstruuje dawnego deadline z pamięci procesu. Przy ostatnim dozwolonym batchu wyczerpującym fast do zera jego funding i DRAIN zapisują się razem: jest to ostatnia autoryzowana ekspozycja, kolejne są zakazane. Odnowienie okresu nie usuwa zatwierdzonego triggera. Runtime synchronizuje meta dopiero po commit; niepewny wynik rozstrzyga durable replay, a żywa ręka nadal ma prawo do poprawnego settlement.

`runSettledRolloverCommand` sprawdza drain przed zwykłą rotacją i przed wymogiem managed profile. `bootstrapHand`, ręczny start_hand oraz commit rollover mają ten sam warunek deadline — zabezpieczenie przed przekroczeniem podczas prepare/persist. Dla żywej ręki timer deadline tylko blokuje kolejną; aktualna ręka kończy się normalnie. Janitor nie zastępuje jej generic stale close z powodu samego deadline. Bezpieczny terminal close przebiega przez istniejący executor z trwałym reason, nie force-close.

DRAINING i brak liquidity/cap/proof dają `allowBotFunding:false`, zero nowych receipts. Sam brak liquidity nie oznacza wyczerpania fast ani automatycznej kary/drain. Fallback obydwu tierów używa istniejących pozostałych stacków lub kontrolowanego oczekiwania/wyjścia; brak nieskończonego ponawiania niemożliwego fundingu. Niedostępne proof/cash-out invariant zachowuje fail-closed i sygnalizuje operatorowi konkretny błąd, nie obiecuje wypłaty bez dowodu.

### Globalne wyczerpanie fast — P1

Pierwszy zatwierdzony FAST_EXHAUSTED jest faktem konta, unikalnym dla (user_id, fast_period_start), z exhausted_at. Powstaje przy dokładnym wyczerpaniu któregokolwiek limitu fast po ostatniej legalnej ekspozycji lub pierwszej odmowie wymaganej ekspozycji z powodu niewystarczającego fast. Nie tworzyć go z powodu braku płynności ani arbitralnego progu pełnego buy-in. Pozostaje constrained do kolejnego okresu fast; nowy okres nie usuwa historycznego zdarzenia ani drenujących stołów.

W tej samej transakcji zapisać trwałe powiązania zdarzenia ze wszystkimi już zajętymi przez konto stołami STANDARD z botami, także pre-funded B bez żądania fundingu; uwzględnić nowy seat, jeśli ostatnia legalna ekspozycja go zatwierdza. Snapshot obejmuje leave_after_hand aż do rzeczywistego opuszczenia. HUMAN_ONLY i istniejące SLOW_PRIVATE są wyłączone. W audycie pozostają table_id i admission identity; późniejsze leave, usunięcie seat lub reset fast nie gubią obowiązku wygaszenia.

Zmiany członkostwa w `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `leave.mjs::executePokerLeave` i deferred leave finalizer oraz cleanup/writer muszą użyć tego samego guard konta: table → state/seats → posortowane konta → pool → ledger. Snapshot innych członkostw czytać po uzyskaniu guard w świeżym odczycie READ COMMITTED; nigdy blokować B podczas trzymania A/konta. Każdy zapis/usunięcie członkostwa musi być zinwentaryzowany, także terminal cleanup. Serializacja na guard zapewnia kompletną listę w chwili zdarzenia bez blokad wielu stołów naraz.

Po commit uruchomić istniejące `ws-server/server.mjs::enqueueTableCommand` dla powiązanych stołów, po jednym stole/transakcji. Restart/sweep ponawia nieprzeniesione powiązania. Fanout jest projekcją: autorytatywny DRAINING obowiązuje od exhausted_at nawet przed zapisem lokalnej meta. Każde admission (także przed seated rejoin early return), nowe finansowanie i każdy start_hand/bootstrap/prepare/commit rollover odczytuje trwałe powiązania dla stołu i konta. Recheck w `persisted-state-writer.mjs::writeViaDb` obejmuje również pusty funding plan; sama kolejka per-table ani cache WS nie wystarczą. Final gate blokuje posortowane konta wszystkich obecnych ludzi i utrzymuje guard do commit nowej ręki nawet przy zerowym funding; odczyt po guard widzi konkurencyjny COMMIT FAST_EXHAUSTED. Powiązania historyczne sprawdza również po odejściu konta. Serializacja rozstrzyga race A-exhaustion/B-start: zatwierdzona wcześniej ręka pozostaje żywa, późniejsza podlega oryginalnemu deadline. Brak dowodu blokuje nową rękę/dostęp/funding, zachowując settlement.

Deadline to najwcześniejsze właściwe exhausted_at + 30 min, nigdy czas lokalnego wykrycia. Projekcja może zostać skorygowana wyłącznie do wcześniejszego udowodnionego zdarzenia, nigdy wydłużona; identyfikator źródłowego zdarzenia pozostaje w audycie. A wyczerpane w t0, B wykryte w t0+20 min: B ma deadline t0+30 min; wykryte po nim nie zacznie ręki. Trwająca ręka kończy się normalnie, bez automatycznego kicka, z poprawną wypłatą. Już sfinansowane boty mogą grać tylko w grace, bez dalszego finansowania.

### 4. Rezerwa i przepływy CH

| Operacja | CH | Allowance / emisja |
|---|---|---|
| USER buy-in/cash-out | Istniejący USER↔ESCROW, bez zmiany reguł | Nie jest kosztem bot budget |
| Nowy bot seed/replacement/top-up | Dokładny SYSTEM tieru → ESCROW stołu; pula klasy pomniejszana atomowo | Per-user ekspozycja; nie emisja |
| Admission do pre-funded | Żadnego nowego transferu bot CH | Koszt ekspozycji nowego człowieka |
| Terminal bot return | ESCROW → udowodniony oryginalny SYSTEM | Uzupełnia właściwą klasę; brak zwrotu allowance |
| Bot refill | GENESIS → dedykowany SYSTEM | Nowa emisja, limity i kompensacja dowodu atomowo |
| Jednorazowy seed 100 | GENESIS → POKER_BOT_BANKROLL_100, 1 000 000 CH | Osobna zatwierdzona alokacja; nie weekly refill |
| Wewnętrzny rebalance | SYSTEM→SYSTEM, tylko jawna uprawniona alokacja | Nie emisja, nie fallback na wyczerpanie klasy |

`poker_bot_pool_state` utrzymuje twarde liquid_standard_ch i liquid_slow_ch. Po inicjalizacji rozdysponować dostępne, udowodnione środki 90/10 (reszta z dzielenia CH na korzyść zablokowanej rezerwy slow); nie przeliczać od nowa proporcji po każdej wypłacie, bo pozwoliłoby to kraść niewykorzystaną rezerwę. Debit blokuje pulę i konto, zmniejsza wyłącznie właściwą klasę. Return przywraca klasę pochodzenia; zwroty legacy bez klasy mają osobny udowodniony tor alokacji 90/10, raz. Suma sklasyfikowanej płynności i jawnej kwarantanny nie może przewyższać rzeczywistego salda konta. Nieznany drift blokuje nowe finansowanie/refill, a nie prawidłowy terminal payout do źródła.

Ochrona musi obejmować oba ledger adaptery oraz admin/public transaction endpoints: żadnego dowolnego debitu chronionej puli z pominięciem pool lock/decision. Nowe tabele RLS i brak grants dla anon/authenticated; tylko istniejąca uprawniona rola backend. Wąski ledger kontrakt akceptuje zatwierdzoną wewnętrzną decyzję z DB, nie ufne pole `purpose` w payload klienta.

### 5. Realized loss i bounded refill

Po bezpiecznym close w tej samej transakcji zapisać certyfikat: wszystkie faktyczne bot debits, wszystkie terminal returns, class/source, close version, human participation, stan zero escrow i kompletność dowodu. Dla nowych stołów jeden tier/source i klasa zapewniają przypisanie wyniku na poziomie stołu, bez rozdzielania żetonów ludzi. Bot-only może przemieszczać stacki, lecz netto bez udziału ludzi nie uprawnia do emisji; niewyjaśniony odpływ nie jest subsydią.

Dla puli klasy utrzymywać **signed** sumę zatwierdzonych closed losses: funding minus returns; zyski kompensują straty między stołami tej samej klasy. Kwota kwalifikowana = max(0, signed cumulative loss − już wypłacone refille). Nie sumować samych dodatnich strat. Aktywne committed funding pozostaje w kapitalizacji co najmniej jako outstanding cost basis do czasu kompletnego terminal proof; nie uznawać wstępnego spadku stacku za stratę. Dla bezpiecznego headroom trzeba również pokryć potencjalne zyski aktywnych botów — patrz konserwatywne ograniczenie poniżej. Jeżeli występuje wcześniejszy bot return, musi zmniejszyć outstanding w tej samej transakcji i być ujęty w certyfikacie, bez podwójnego odjęcia.

Headroom tieru = max(0, 1 000 000 − kapitalizacja udowodniona konserwatywnie). Dla każdego otwartego stołu o znanym tierze/źródle liczyć max(outstanding committed cost, **pełne aktualne saldo jego ESCROW**) jako górną granicę zaangażowanego kapitału; dodać liquid SYSTEM. Pełne escrow zawiera również środki ludzi, więc może zmniejszyć dostępność refillu, ale nie zaniża kapitału przez pominięcie wygranych botów i nie przypisuje właścicieli fungible chips. Nie jest to źródło dowodu straty — dodatni realized loss nadal musi pochodzić z zamkniętych certyfikatów. Dodatkowo headroom klasy przy target 900k/100k według tej samej zasady, bez przenoszenia strat między klasami. Odczyt kont/kompletnego zbioru active funding powiązać z refill w serializable transakcji i obsłużyć pełny retry; nie dokładać odwrotnej blokady poker table przy trzymanym pool lock. Brak kompletnego powiązania active escrow albo spójnego snapshotu daje zero refillu. Legacy active capital wchodzi do tier total; nie dopełniać historycznego 500 do miliona na podstawie brakującego salda. Stage ma zmierzyć wpływ konserwatywnego headroom na zwykły dostęp; ewentualne zmniejszenie granicy wymaga udowodnionej atrybucji, nie domysłu.

Refill minimum z kwalifikowanej straty klasy, headroom klasy/tieru i pozostałych limitów klasy/tieru/global. Obowiązuje kroczące (t−168 h, t]. Zgodnie z D2 każde wydanie ma trwały timestamp/receipt i wspólną blokadę globalną, co zabezpiecza równoczesne 100/500. Globalny cap nie może być cache per proces. Operacja `postTransaction` i consumed proof/counters są w jednym tx, przy niekompletności całkowity rollback. Zero kwoty nie wywołuje ledger.

Obecny Netlify validateEntries wymaga USER przy MINT. Rozszerzyć go tylko o wewnętrzną decyzję refillu/alokacji z poprawnym dokładnym debit GENESIS i credit jednej puli, sumą zero oraz lockiem licznika; publiczne chips-tx nie może przekazać tej capability. Nie robić nowej ogólnej ścieżki dowolnego SYSTEM MINT. Nie importować Netlify runtime do WS bez sprawdzenia pakowania — obecny deploy kopiuje shared i zależności; nowy moduł otrzymuje ledger adapter jako zależność, istniejący bootstrap/cleanup zapewnia wiring.

Refill po terminal commit uruchamia istniejący runtime/sweep; przechowywany certyfikat umożliwia odzyskanie po crash i ponowne sprawdzenie po uwolnieniu tygodniowego cap. Nie wykonywać refillu wewnątrz wypłaty. Retention pozostawia certyfikat, idempotency i audyt kompensacji; oryginalne entries mogą być archiwizowane tylko z istniejącymi zweryfikowanymi manifestami/hashami. Stary close bez dowodów nie otrzymuje automatycznego refillu.

### Krocząca emisja i pierwsza alokacja — D2–D3

D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.

D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Global emission guard → pool → receipts/accounts; wszystkie klasy i tiery uczestniczą w tej samej serializacji. Czas UTC t pobierać po blokadzie, przy niekompletnym dowodzie lub cofnięciu zegara odmowa emisji. Serializable snapshot sprzed oczekiwania na guard nie może pominąć konkurencyjnego receipt: zapisywać version globalnego guard w każdej emisji i ponawiać całą transakcję po serialization conflict. Autoryzacja, kompensacja proof, receipt i double-entry MINT commitują razem. Liczniki są projekcją as-of t; suma trwałych REFILL receipts jest źródłem prawdy. Granica issued_at=t−168 h uwalnia dokładnie tę emisję; młodsze pozostają. INITIAL_ALLOCATION ma osobny audyt podaży, nie konsumuje ani nie odnawia cap REFILL. Schema tworzy konto z zerem; alokacja przy jednym kredycie 1 000 000 CH ustawia obie rezerwy atomowo. Powtórzenie lub równoczesne wywołanie zwraca istniejący rezultat bez drugiego kredytu.

Fundamentalne testy: tuż przed/na/po 168 h; równoczesne 100/500 i STANDARD/SLOW przy ostatnim headroom klasy/tieru/global; restart i utracona odpowiedź; proof/receipt retention; brak podwójnej emisji na granicy kalendarzowego tygodnia; INITIAL_ALLOCATION retry i race dają jeden milion oraz dokładne 900000/100000, osobno od REFILL. Żaden test nie wykonuje Production GO.

### 6. Migracje, cutover i breaking changes

Zmiany DDL opisano w data-model.md. Użyć przyszłych forward-only migracji, bez edycji `20260810100000_poker_bot_bankroll.sql`. Najpierw addytywny schema i capability, z aktywacją chronionego fundingu/refillu domyślnie wyłączoną. Oddzielić schema od jednorazowej emisji/alokacji. Migracje zastosowane na Stage nie są odwracane przez edycję pliku.

**Zamierzony przyszły skutek PR migracji: DB Stage Apply PR zmieni współdzielone Stage.** W opisie spec/plan/tasks i przyszłego PR jawnie wskazać efekt przed publikacją. W tej sesji publikować wyłącznie dokumenty w istniejącym draft PR #1017; bez migracji i deploy. Production ma osobny target, zatwierdzoną politykę D1–D3, dowody Stage i osobny GO dla aktywacji/seeda/refillu.

Cutover istniejących stołów: spis pod lockiem, potwierdzenie źródła, odtworzenie aktualnych seated uczestników i admission proof; oznaczyć jawnie legacy, nie zmieniać istniejącego source. Bot-funded legacy otrzymują zakaz nowego fundingu i nowych admission w trakcie kontrolowanego wycofania; utrzymują legalne ręce/wyjścia. Limit budżetowego drain +30 obowiązuje tylko przy udowodnionym wyczerpaniu; nie udawać, że techniczny cutover jest wyczerpaniem. Nowe chronione stoły powstają z właściwą klasą/pulą. Stare bez wyczerpania zamykać istniejącym bezpiecznym lifecycle po odejściu ludzi; nie nakładać na nie nowego uniwersalnego TTL. Ten techniczny plan cutover podlega review jako jawna przejściowa niedostępność nowych admission.

Breaking changes: personalizowane lobby/Quick Seat i jawny tryb stołu; direct join może odmówić mimo wolnego miejsca; constrained nie wejdzie do bot-only; slow owner-only; już siedzący mogą trafić do 30-min drain; źródło nowych 100 opuszcza TREASURY; refille zmieniają podaż w granicach pilota; stary runtime/schema bez capability blokuje tworzenie chronionych stołów. Cash-out i reguły gry bez zmiany. Rollback aplikacji nie może przywrócić legacy funding bypass — w razie niezgodności zatrzymać nowe finansowanie, zachować settlement i wrócić do zgodnego runtime przez poprawkę forward-only.

## Phase 2 — Tasks, walidacja i wydanie

Zadania po checklist w tasks.md. Minimalny demonstrator US1 nie jest samodzielnym wydaniem #869: do aktywacji potrzeba US1–US4, rezerw, drain i dowodów. Fundamentalne testy: jednostki/granice, atomowe admission/funding, wszystkie serwerowe bypassy, deadline/live hand/restart, źródła i escrow, concurrent refill i brak emisji z live escrow. Brak testów UI/CSS/JSP/glue i nowych frameworków.

Przyszły WS Preview Deploy: definicja workflow z main, aplikacja exact latest runtime SHA, sukces zweryfikowany dla tego SHA; Netlify Preview nie wdraża WS. Host preview współdzielony, deploy jawny. Smoke Stage/Preview obu klas, direct URL, drain i cash-out może wykonać użytkownik. Brak potwierdzenia oznacza „implementation ready, awaiting manual runtime verification”, bez merge-ready. Późniejsze wyłącznie docs/test zmiany zachowują dowód po potwierdzeniu braku zmian deployable/config; runtime/config wymaga ponownego deploy/smoke. Żadnego polecenia Git w tym planie.

## Risks

- D1–D3 są zamknięte; niezależne review i osobne zlecenie realizacji pozostają wymagane. Globalne powiązania drain i serializacja członkostw wymagają fundamentalnego dowodu współbieżności.
- Konserwatywna autoryzacja wielu ludzi zużywa więcej allowance niż jeden rzeczywisty transfer; zmierzyć zwykły dostęp na Stage, nie osłabiać samodzielnie polityki.
- Niekompletny historyczny audyt/retention i mieszane źródła: możliwe zamrożenie nowych operacji; wymagana jawna rekonsyliacja, bez uznania OPEN escrow za stratę.
- Różne ledger adaptery, top-up history i blokady state/table wymagają wspólnego testu transakcyjnego, nie tylko mocków.
- Trwały drain przy restartach, manual start i pending rollover wymaga recheck w commit, inaczej ostatnia ręka może zacząć się za późno.
- Pilot nie gwarantuje płynności dla nieograniczonej liczby kont; Stage musi ujawnić częstotliwość braku zwykłych miejsc.
- Sama publikacja przyszłego PR z migracją mutuje Stage; wymaga uprzednio opisanego zamiaru, a Production osobnego GO.

## Complexity Tracking

Brak odstępstw od konstytucji. Decyzje D1–D3 zamknięte; implementacja nie została rozpoczęta.

## Review zakresu tej korekty

Przed prezentacją sprawdzić dokładność i uprościć do istniejących metod/pakietów. Wybrano koszt graniczny zamiast nowego utrwalonego planu botów; bez nowych tabel, zależności i frameworków. Breaking changes: preflight może konserwatywnie odrzucić funding na mniejszy losowy target; reuse wymaga zgodnych parametrów; admin API addytywnie ujawnia tylko policy metadata, bez player filtering i bez nowych praw do gry. Zasady JSP/global/IIFE, CSS jeden selector na linię, CSP SHA dla ewentualnego inline i klog obowiązują również js/admin-page.js. Plan bez pełnego kodu i poleceń Git.
