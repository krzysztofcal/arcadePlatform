# Implementation Plan: Chroniony budżet botów — #869

**Branch**: identyfikator Spec Kit `006-protect-bot-budget` z feature.json, bez utworzenia gałęzi.
**Date**: 2026-09-24
**Spec**: [spec.md](spec.md)
**Status**: Plan warunkowy do niezależnego review. D1–D3 wymagają decyzji przed zależną realizacją. Wszystkie prace poniżej są przyszłe; obecna sesja kończy się analyze.

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
**Constraints**: finite issuance, fail-closed, exact arithmetic, atomowość, zachowanie proweniencji; tylko fundamentalne testy. D1–D3 z research pozostają bramkami decyzji.
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
| Spec Kit: wszystkie decyzje rozwiązane | HOLD D1–D3 | HOLD D1–D3; na polecenie właściciela dokument warunkowy do review, nie execution-ready |

Bramki konstytucji oceniają zgodność projektu, nie działającą implementację. D1–D3 nie są wyjątkami od konstytucji. Nie zmieniać konstytucji, ignore files, tooling ani zależności.

## Project Structure

### Documentation (this feature)

`specs/006-protect-bot-budget/`: spec.md, research.md, data-model.md, contracts/bot-budget.md, quickstart.md, plan.md, tasks.md, issue-source.md, checklists/requirements.md, checklists/economy.md. Wyniki obu analiz raportowane w rozmowie; analyze jest read-only.

### Source Code (repository root)

| Istniejąca ścieżka / symbol | Planowana odpowiedzialność |
|---|---|
| `shared/poker-domain/table-economy.mjs` — getBotFundingSystemKeyForBuyIn, isBotFundingAllowedForBuyIn | Źródło 100 z dedykowanej puli; 500 istniejące; tylko autoryzowana klasa; brak fallbacku |
| `shared/poker-domain/join.mjs` — executePokerJoinAuthoritative | Lock/rozróżnienie rejoin; obliczenie admission exposure; wszystkie budżety i seat w jednym tx |
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

Research w research.md wskazuje aktualne mechanizmy i pułapki. Zamknąć D1–D3 z właścicielem, dopisać konkretne wartości i scenariusze graniczne. Przed implementacją rewalidować SHA i diff relewantnych plików. Stage preflight ma potwierdzić actual balances, aktywne zobowiązania, archiwalne receipts, istniejącą alokację 500 oraz źródło i cel seeda 100. Nie zakładać miliona płynnej gotówki w istniejącym 500 tylko dlatego, że seed wynosił milion.

## Phase 1 — Design

### 1. Tożsamość, arytmetyka i admission

Kontrakt normatywny projektu w contracts/bot-budget.md; pola i ograniczenia w data-model.md. Fast rozliczać dokładnie w podjednostkach, 100 jednostek=1 000 000 podjednostek. Actual exposure CH też kumulować. Kadencja startuje przy pierwszej zatwierdzonej ekspozycji, nie przy otwarciu lobby ani odrzuconym join. Przesunięcie po bezczynności obliczyć względem niezmiennej kotwicy, nie od nowego requestu. Slow nigdy nie dofinansowuje brakującego fast w STANDARD.

Przy admission istniejący authoritative snapshot bot stacks jest podstawą ekspozycji nowego człowieka. Nie używać samej kwoty historycznego seed, bo stack mógł się zmienić. Ten sam uczestnik ma trwały zapis już udostępnionego stocku i watermark finansowania; retry nie polega na nowym requestId. Dla obecnych ludzi nowe fundingDelta autoryzować pełną kwotą dla każdego, obejmując leave_after_hand do momentu faktycznego odejścia. Czyste bot-only zapisuje funding, ale zero user exposure. Replacement zachowuje lineage starego residual; top-up jest nową deltą, nie nowym pełnym seed.

Kolejność nowych ścieżek: table row → poker_state/seat rows → budżety ludzi posortowane po userId → pula tieru → źródłowe konta ledger w stałej kolejności. Istniejące cleanup z kolejnością state→table ujednolicić w dotykanych ścieżkach, nie tworzyć odwrotnej zależności. Refiller: global emission guard → pula tieru → liczniki/receipts → konta; nigdy nie blokuje poker_tables ani user budgets. Replay decyzji sprawdzić przed zmianą jakiegokolwiek salda rezerwy; ledger replay nie może ponownie zmniejszyć pool. Po deadlock/serialization retry pełnej transakcji z tą samą tożsamością i ograniczoną liczbą prób; nie publikować kandydata.

Wszystkie sprawdzenia finansowania w writerze są pod lockiem table przed CAS state, nawet gdy decyzja runtime była wcześniej pozytywna. Odmowa dowolnego człowieka wycofuje cały nowy batch. Nie zostawiać buy-in USER z odrzuconym seat. Timeout po commit rozstrzygać z trwałej decyzji, nie kompensacją na ślepo.

### 2. Matchmaking, powrót i UI

STANDARD zachowuje multiplayer preference. SLOW_PRIVATE wybierany jawnie, owner z uwierzytelnionej sesji, najwyżej jeden otwarty slow stół właściciela. HUMAN_ONLY nigdy nie seeduje botów. Netlify dobiera dostępny wariant po wspólnym odczycie polityki; WS ponownie sprawdza pod lockiem. Opcja klienta nie jest dowodem klasy. Nie wznawiać retired HTTP join/get-table. `netlify/functions/poker-progression.mjs::readTableAccess` ma zwracać zgodną projekcję także dla V2 direct URL, bez zmiany bankroll progression. `poker/poker-ws-client.js` musi odróżnić końcową policy denial od transportowego pending/recovery; inaczej neutralny komunikat nie dotrze i retry będzie trwał. V2 `joinErrorMessage/isRetryableAutoJoinError` mapują nowe powody, bez retry do odnowienia uprawnienia na tym samym niezgodnym stole.

Lobby personalizować po stronie serwera, bez wycieku limitów innych graczy. Cache projekcji unieważniać także po zmianie budżetu oraz granicy fast/slow, nawet jeżeli registry stołów nie zmieniło się. Direct URL/WS subscribe/bootstrap nie tworzy seat i nie omija admission. Reconnect istniejącego poprawnego seat podczas grace to wznowienie, nie nowy join; po deadline odtworzenie służy kończącej się ręce/wypłacie, nie nowej ręce. Nie przywracać wycofanego seat samym starym requestId.

Pokazać osobno stan dostępu i brak płynności; nie używać etykiet „oszust”, „kara”. Countdown tylko z serwerowego deadline/nextEligibleAt. Minimum zmian w istniejących plikach JS; JSP global/IIFE. CSS tylko gdy potrzebny, jeden selector/deklaracje na linii. Bez nowego inline; jeżeli konieczny, hash w netlify.toml/CSP w tej samej zmianie.

### 3. Trwały drain bez zablokowania live hand

Wykrywanie: przy każdej decyzji nowej ekspozycji i przed startem/rollover weryfikować, czy istniejący human może pokryć wymaganą deltę. Dokładne zero fast po zaakceptowanym funding też oznacza wyczerpanie w tej samej chwili; nie czekać na kolejny żądany seed. Dla dodatniej reszty brak wymaganego funding oznacza brak nowego triggera; nie wymyślać progu całego buy-in.

Zapis pierwszego started_at/deadline pod lockiem; CAS nie może go przesunąć. Rozdzielić wewnątrz tej samej transakcji wynik DENIED/DRAIN od kandydata rollover: najpierw pod table/state/user locks obliczyć pełny koszt; niewystarczający budżet zapisuje trwałe DENIED + pierwszy DRAIN i commit **bez** nowego finansowania/stacków/used counters. Nie rzucać błędu, który cofnąłby również ten wynik. Jeżeli zapis kandydata był już rozpoczęty, cofnąć go do savepoint sprzed mutacji i zatwierdzić wyłącznie decyzję odmowy/drain przy zachowanych wcześniejszych blokadach. Zewnętrzny błąd/awaria przed commit nie jest zatwierdzoną obserwacją: runtime nie wykonuje nowej ręki/admission i po recovery ponawia decyzję, nigdy nie rekonstruuje dawnego deadline z pamięci procesu. Przy ostatnim dozwolonym batchu wyczerpującym fast do zera jego funding i DRAIN zapisują się razem: jest to ostatnia autoryzowana ekspozycja, kolejne są zakazane. Odnowienie okresu nie usuwa zatwierdzonego triggera. Runtime synchronizuje meta dopiero po commit; niepewny wynik rozstrzyga durable replay, a żywa ręka nadal ma prawo do poprawnego settlement.

`runSettledRolloverCommand` sprawdza drain przed zwykłą rotacją i przed wymogiem managed profile. `bootstrapHand`, ręczny start_hand oraz commit rollover mają ten sam warunek deadline — zabezpieczenie przed przekroczeniem podczas prepare/persist. Dla żywej ręki timer deadline tylko blokuje kolejną; aktualna ręka kończy się normalnie. Janitor nie zastępuje jej generic stale close z powodu samego deadline. Bezpieczny terminal close przebiega przez istniejący executor z trwałym reason, nie force-close.

DRAINING i brak liquidity/cap/proof dają `allowBotFunding:false`, zero nowych receipts. Sam brak liquidity nie oznacza wyczerpania fast ani automatycznej kary/drain. Fallback obydwu tierów używa istniejących pozostałych stacków lub kontrolowanego oczekiwania/wyjścia; brak nieskończonego ponawiania niemożliwego fundingu. Niedostępne proof/cash-out invariant zachowuje fail-closed i sygnalizuje operatorowi konkretny błąd, nie obiecuje wypłaty bez dowodu.

### 4. Rezerwa i przepływy CH

| Operacja | CH | Allowance / emisja |
|---|---|---|
| USER buy-in/cash-out | Istniejący USER↔ESCROW, bez zmiany reguł | Nie jest kosztem bot budget |
| Nowy bot seed/replacement/top-up | Dokładny SYSTEM tieru → ESCROW stołu; pula klasy pomniejszana atomowo | Per-user ekspozycja; nie emisja |
| Admission do pre-funded | Żadnego nowego transferu bot CH | Koszt ekspozycji nowego człowieka |
| Terminal bot return | ESCROW → udowodniony oryginalny SYSTEM | Uzupełnia właściwą klasę; brak zwrotu allowance |
| Bot refill | GENESIS → dedykowany SYSTEM | Nowa emisja, limity i kompensacja dowodu atomowo |
| Jednorazowy seed 100 | Źródło D3 → POKER_BOT_BANKROLL_100 | Osobna zatwierdzona alokacja; nie weekly refill |
| Wewnętrzny rebalance | SYSTEM→SYSTEM, tylko jawna uprawniona alokacja | Nie emisja, nie fallback na wyczerpanie klasy |

`poker_bot_pool_state` utrzymuje twarde liquid_standard_ch i liquid_slow_ch. Po inicjalizacji rozdysponować dostępne, udowodnione środki 90/10 (reszta z dzielenia CH na korzyść zablokowanej rezerwy slow); nie przeliczać od nowa proporcji po każdej wypłacie, bo pozwoliłoby to kraść niewykorzystaną rezerwę. Debit blokuje pulę i konto, zmniejsza wyłącznie właściwą klasę. Return przywraca klasę pochodzenia; zwroty legacy bez klasy mają osobny udowodniony tor alokacji 90/10, raz. Suma sklasyfikowanej płynności i jawnej kwarantanny nie może przewyższać rzeczywistego salda konta. Nieznany drift blokuje nowe finansowanie/refill, a nie prawidłowy terminal payout do źródła.

Ochrona musi obejmować oba ledger adaptery oraz admin/public transaction endpoints: żadnego dowolnego debitu chronionej puli z pominięciem pool lock/decision. Nowe tabele RLS i brak grants dla anon/authenticated; tylko istniejąca uprawniona rola backend. Wąski ledger kontrakt akceptuje zatwierdzoną wewnętrzną decyzję z DB, nie ufne pole `purpose` w payload klienta.

### 5. Realized loss i bounded refill

Po bezpiecznym close w tej samej transakcji zapisać certyfikat: wszystkie faktyczne bot debits, wszystkie terminal returns, class/source, close version, human participation, stan zero escrow i kompletność dowodu. Dla nowych stołów jeden tier/source i klasa zapewniają przypisanie wyniku na poziomie stołu, bez rozdzielania żetonów ludzi. Bot-only może przemieszczać stacki, lecz netto bez udziału ludzi nie uprawnia do emisji; niewyjaśniony odpływ nie jest subsydią.

Dla puli klasy utrzymywać **signed** sumę zatwierdzonych closed losses: funding minus returns; zyski kompensują straty między stołami tej samej klasy. Kwota kwalifikowana = max(0, signed cumulative loss − już wypłacone refille). Nie sumować samych dodatnich strat. Aktywne committed funding pozostaje w kapitalizacji co najmniej jako outstanding cost basis do czasu kompletnego terminal proof; nie uznawać wstępnego spadku stacku za stratę. Dla bezpiecznego headroom trzeba również pokryć potencjalne zyski aktywnych botów — patrz konserwatywne ograniczenie poniżej. Jeżeli występuje wcześniejszy bot return, musi zmniejszyć outstanding w tej samej transakcji i być ujęty w certyfikacie, bez podwójnego odjęcia.

Headroom tieru = max(0, 1 000 000 − kapitalizacja udowodniona konserwatywnie). Dla każdego otwartego stołu o znanym tierze/źródle liczyć max(outstanding committed cost, **pełne aktualne saldo jego ESCROW**) jako górną granicę zaangażowanego kapitału; dodać liquid SYSTEM. Pełne escrow zawiera również środki ludzi, więc może zmniejszyć dostępność refillu, ale nie zaniża kapitału przez pominięcie wygranych botów i nie przypisuje właścicieli fungible chips. Nie jest to źródło dowodu straty — dodatni realized loss nadal musi pochodzić z zamkniętych certyfikatów. Dodatkowo headroom klasy przy target 900k/100k według tej samej zasady, bez przenoszenia strat między klasami. Odczyt kont/kompletnego zbioru active funding powiązać z refill w serializable transakcji i obsłużyć pełny retry; nie dokładać odwrotnej blokady poker table przy trzymanym pool lock. Brak kompletnego powiązania active escrow albo spójnego snapshotu daje zero refillu. Legacy active capital wchodzi do tier total; nie dopełniać historycznego 500 do miliona na podstawie brakującego salda. Stage ma zmierzyć wpływ konserwatywnego headroom na zwykły dostęp; ewentualne zmniejszenie granicy wymaga udowodnionej atrybucji, nie domysłu.

Refill minimum z kwalifikowanej straty klasy, headroom klasy/tieru i pozostałych limitów klasy/tieru/global. D2 określi dokładny przedział czasowy. Niezależnie od D2 każde wydanie ma trwały timestamp/receipt i wspólną blokadę globalną, co zabezpiecza równoczesne 100/500. Globalny cap nie może być cache per proces. Operacja `postTransaction` i consumed proof/counters są w jednym tx, przy niekompletności całkowity rollback. Zero kwoty nie wywołuje ledger.

Obecny Netlify validateEntries wymaga USER przy MINT. Rozszerzyć go tylko o wewnętrzną decyzję refillu/alokacji z poprawnym dokładnym debit GENESIS i credit jednej puli, sumą zero oraz lockiem licznika; publiczne chips-tx nie może przekazać tej capability. Nie robić nowej ogólnej ścieżki dowolnego SYSTEM MINT. Nie importować Netlify runtime do WS bez sprawdzenia pakowania — obecny deploy kopiuje shared i zależności; nowy moduł otrzymuje ledger adapter jako zależność, istniejący bootstrap/cleanup zapewnia wiring.

Refill po terminal commit uruchamia istniejący runtime/sweep; przechowywany certyfikat umożliwia odzyskanie po crash i ponowne sprawdzenie po uwolnieniu tygodniowego cap. Nie wykonywać refillu wewnątrz wypłaty. Retention pozostawia certyfikat, idempotency i audyt kompensacji; oryginalne entries mogą być archiwizowane tylko z istniejącymi zweryfikowanymi manifestami/hashami. Stary close bez dowodów nie otrzymuje automatycznego refillu.

### 6. Migracje, cutover i breaking changes

Zmiany DDL opisano w data-model.md. Użyć przyszłych forward-only migracji, bez edycji `20260810100000_poker_bot_bankroll.sql`. Najpierw addytywny schema i capability, z aktywacją chronionego fundingu/refillu domyślnie wyłączoną. Oddzielić schema od jednorazowej emisji/alokacji. Migracje zastosowane na Stage nie są odwracane przez edycję pliku.

**Zamierzony przyszły skutek PR migracji: DB Stage Apply PR zmieni współdzielone Stage.** W opisie spec/plan/tasks i przyszłego PR jawnie wskazać efekt przed publikacją. W tej sesji nie tworzyć migracji, PR ani deploy. Production ma osobny target, zatwierdzoną politykę D1–D3, dowody Stage i osobny GO dla aktywacji/seeda/refillu.

Cutover istniejących stołów: spis pod lockiem, potwierdzenie źródła, odtworzenie aktualnych seated uczestników i admission proof; oznaczyć jawnie legacy, nie zmieniać istniejącego source. Bot-funded legacy otrzymują zakaz nowego fundingu i nowych admission w trakcie kontrolowanego wycofania; utrzymują legalne ręce/wyjścia. Limit budżetowego drain +30 obowiązuje tylko przy udowodnionym wyczerpaniu; nie udawać, że techniczny cutover jest wyczerpaniem. Nowe chronione stoły powstają z właściwą klasą/pulą. Stare bez wyczerpania zamykać istniejącym bezpiecznym lifecycle po odejściu ludzi; nie nakładać na nie nowego uniwersalnego TTL. Ten techniczny plan cutover podlega review jako jawna przejściowa niedostępność nowych admission.

Breaking changes: personalizowane lobby/Quick Seat i jawny tryb stołu; direct join może odmówić mimo wolnego miejsca; constrained nie wejdzie do bot-only; slow owner-only; już siedzący mogą trafić do 30-min drain; źródło nowych 100 opuszcza TREASURY; refille zmieniają podaż w granicach pilota; stary runtime/schema bez capability blokuje tworzenie chronionych stołów. Cash-out i reguły gry bez zmiany. Rollback aplikacji nie może przywrócić legacy funding bypass — w razie niezgodności zatrzymać nowe finansowanie, zachować settlement i wrócić do zgodnego runtime przez poprawkę forward-only.

## Phase 2 — Tasks, walidacja i wydanie

Zadania po checklist w tasks.md. Minimalny demonstrator US1 nie jest samodzielnym wydaniem #869: do aktywacji potrzeba US1–US4, rezerw, drain i dowodów. Fundamentalne testy: jednostki/granice, atomowe admission/funding, wszystkie serwerowe bypassy, deadline/live hand/restart, źródła i escrow, concurrent refill i brak emisji z live escrow. Brak testów UI/CSS/JSP/glue i nowych frameworków.

Przyszły WS Preview Deploy: definicja workflow z main, aplikacja exact latest runtime SHA, sukces zweryfikowany dla tego SHA; Netlify Preview nie wdraża WS. Host preview współdzielony, deploy jawny. Smoke Stage/Preview obu klas, direct URL, drain i cash-out może wykonać użytkownik. Brak potwierdzenia oznacza „implementation ready, awaiting manual runtime verification”, bez merge-ready. Późniejsze wyłącznie docs/test zmiany zachowują dowód po potwierdzeniu braku zmian deployable/config; runtime/config wymaga ponownego deploy/smoke. Żadnego polecenia Git w tym planie.

## Risks

- D1–D3 blokują gotowość implementacyjną odpowiednich parametrów i emisji.
- Konserwatywna autoryzacja wielu ludzi zużywa więcej allowance niż jeden rzeczywisty transfer; zmierzyć zwykły dostęp na Stage, nie osłabiać samodzielnie polityki.
- Niekompletny historyczny audyt/retention i mieszane źródła: możliwe zamrożenie nowych operacji; wymagana jawna rekonsyliacja, bez uznania OPEN escrow za stratę.
- Różne ledger adaptery, top-up history i blokady state/table wymagają wspólnego testu transakcyjnego, nie tylko mocków.
- Trwały drain przy restartach, manual start i pending rollover wymaga recheck w commit, inaczej ostatnia ręka może zacząć się za późno.
- Pilot nie gwarantuje płynności dla nieograniczonej liczby kont; Stage musi ujawnić częstotliwość braku zwykłych miejsc.
- Sama publikacja przyszłego PR z migracją mutuje Stage; wymaga uprzednio opisanego zamiaru, a Production osobnego GO.

## Complexity Tracking

Brak odstępstw od konstytucji. Jedynym odstępstwem od typowej kolejności gotowości Spec Kit jest ukończenie warunkowych dokumentów mimo D1–D3 na jawne polecenie właściciela; nie zmienia to żadnej zatwierdzonej zasady ekonomii.
