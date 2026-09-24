# Feature Specification: Chroniony budżet botów — issue #869

**Feature Branch**: bieżący checkout; nie utworzono gałęzi. Katalog funkcji niezależny od gałęzi: `specs/006-protect-bot-budget`.
**Created**: 2026-09-24
**Status**: Draft do niezależnego review; decyzje D1–D3 otwarte; nie jest zgodą na implementację.
**Input**: Wszystkie zatwierdzone wymagania [issue #869](https://github.com/krzysztofcal/arcadePlatform/issues/869), wersja i pełna treść w [issue-source.md](issue-source.md).

## Clarifications

### Session 2026-09-24

- Wykonano `$speckit-clarify` po `$speckit-specify`; odczytano issue, brak komentarzy, kod i konstytucję. Pytań zadanych/odpowiedzianych: 0/0. Zgodnie z poleceniem właściciela nierozstrzygnięte kwestie wypisano do niezależnego review zamiast zastępować zatwierdzone zasady domysłami. D1–D3 pozostają otwarte, nie są zaakceptowanymi odpowiedziami.
- Wyjaśnione przez źródła: jednostki wspólne między tierami (nie 100 na każdy); pre-funded admission jest płatną ekspozycją; standard może być multiplayer; slow jest prywatny; 30 min liczone od pierwszego wyczerpania, nie od utworzenia; reset fast nie otwiera draining; allowance nie emituje CH; wyższe tiery poza zakresem.
- Bramka planowania: dokumenty dalszych etapów są warunkowym projektem do review na wyraźne polecenie właściciela. Nie deklarują rozwiązania D1–D3 ani gotowości do wykonania zależnych zadań. Przed implementacją trzeba zamknąć te decyzje i ponowić analyze.

| Obszar taxonomy | Status | Uzasadnienie |
|---|---|---|
| Functional Scope & Behavior | Deferred | D1, D2; reszta potwierdzona issue |
| Domain & Data Model | Deferred | D3 źródło alokacji; reszta w research/data-model |
| Interaction & UX Flow | Clear | Standard multiplayer, prywatny slow, neutralna odmowa |
| Non-Functional Quality Attributes | Clear | Fail-closed, klog, atomowość; brak nowych celów throughput |
| Integration & External Dependencies | Clear | Istniejący WS/Netlify/ledger i oddzielne środowiska |
| Edge Cases & Failure Handling | Clear | Replay, restart, funding failure, live hand i brak dowodu |
| Constraints & Tradeoffs | Clear | Pilot, finite issuance, brak nowych tierów |
| Terminology & Consistency | Clear | Allowance, kapitalizacja, emisja osobno |
| Completion Signals | Deferred | D1–D3 i przyszłe dowody Stage/Preview |
| Misc / Placeholders | Deferred | Trzy jawne markery decyzji właściciela |

Spec Quality Checklist po clarify: 12/16 → 12/16, brak zmian checkboxów; cztery otwarte dotyczą D1–D3. Plik `.specify/extensions.yml` nie istnieje: brak hooków before/after dla wszystkich sześciu etapów.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Wspólny limit dostępu gracza (Priority: P1)

Gracz wykorzystuje jeden limit dostępu do nowych stacków botów niezależnie od tieru, stołu i sesji. Nie traci legalnych wygranych ani CH przez samo naliczenie limitu.

**Why this priority**: Bez trwałej autoryzacji ekspozycji zmiana stołu obchodzi ochronę finansowania.
**Independent Test**: Deterministyczny zegar, równoległe żądania tego samego konta, seedy i wejście do stołu już finansowanego; sprawdzenie sum zużycia oraz braku dodatkowego obciążenia USER.
**Acceptance Scenarios**:

1. **Given** 99 jednostek zużycia, **When** gracz uzyskuje ekspozycję 50 CH przy tierze 100 i 250 CH przy tierze 500, **Then** łączne zużycie wynosi 100 jednostek, a nowe ekspozycje wymagają wolnego dostępu.
2. **Given** zaakceptowane wejście do finansowanych botów, **When** następuje reconnect, powtórzone żądanie lub kolejna ręka na tych samych środkach, **Then** brak drugiego naliczenia i drugiego buy-in.
3. **Given** dwaj standardowi gracze, **When** bot otrzymuje nowe 50 CH przy tierze 100, **Then** każdy jest autoryzowany na 0,5 jednostki; rzeczywisty transfer SYSTEM wynosi łącznie 50 CH.
4. **Given** granica utrwalonego okresu 7 dni, **When** następuje następne uprawnione użycie, **Then** dostępne jest 100 jednostek bez sumowania nieużytych okresów; istniejący DRAINING pozostaje.

### User Story 2 - Zgodny dobór stołów (Priority: P1)

Zwykli gracze dzielą stoły STANDARD. Gracz z niewystarczającym szybkim limitem wybiera własny SLOW_PRIVATE albo HUMAN_ONLY.

**Why this priority**: Ochrona rezerwy nie działa, gdy da się wejść do cudzych finansowanych botów.
**Independent Test**: Ta sama macierz dopuszczenia dla Quick Seat, Create Table, ręcznego/direct join oraz WS; uprawnienie sprawdzane ponownie przy faktycznym wejściu.
**Acceptance Scenarios**:

1. **Given** wystarczający fast i płynność, **When** dwóch graczy wybiera multiplayer, **Then** może współdzielić STANDARD, także uprzednio bot-only.
2. **Given** niewystarczający fast, **When** gracz podaje bezpośredni adres STANDARD/CONTINUOUS_BOT lub cudzego SLOW_PRIVATE, **Then** nowe wejście odrzucone bez kary, z alternatywą HUMAN_ONLY/własnego slow.
3. **Given** jedna jednostka slow i właściwa rezerwa, **When** właściciel zakłada wolny stół, **Then** dostępny jest jeden pełny bot i jeden człowiek; brak finansowania drugiego pełnego bota.
4. **Given** wyczerpana płynność lub uprawnienie, **When** gracz szuka botów, **Then** otrzymuje informację o oczekiwaniu lub grze z ludźmi, a nie obietnicę finansowanej ręki.

### User Story 3 - Bezpieczne wygaszanie po wyczerpaniu (Priority: P1)

Gracz już siedzący zachowuje rękę, stack i wypłatę. Stół kończy przyjmowanie ludzi i finansowanie, następnie zamyka się na bezpiecznej granicy ręki.

**Why this priority**: Natychmiastowy kick albo nieskończony rollover blokowałby prawidłowe rozliczenie.
**Independent Test**: Zegar tuż przed i na deadline, aktywna ręka, restart, obecny/nieobecny człowiek, zwrot z właściwego źródła i zero escrow.
**Acceptance Scenarios**:

1. **Given** pierwszy brak fast na wymagane dalsze finansowanie w chwili t, **When** gracz nadal siedzi, **Then** stół ma trwały DRAINING i deadline t+30 minut; nowi ludzie i nowe środki SYSTEM są blokowani.
2. **Given** DRAINING, **When** mija nowy tydzień lub następuje reconnect, **Then** deadline pozostaje identyczny.
3. **Given** żywa ręka w deadline, **When** kończy się jej normalne rozliczenie, **Then** następuje terminal close i wypłaty bez kolejnej ręki.
4. **Given** brak finansowania w tierze 100 lub 500, **When** dochodzi do rollover, **Then** istniejące rozliczenie/wyjście postępuje bez nieskończonego retry finansowania.

### User Story 4 - Ograniczone środki i audyt emisji (Priority: P1)

Operator ma osobne fundusze 100/500, twardą ochronę klas 90/10 oraz emisję wyłącznie na udowodnioną zrealizowaną stratę.

**Why this priority**: Limit pojedynczego konta nie ogranicza łącznej emisji dla wielu kont.
**Independent Test**: Zamknięte stoły ze stratą/zyskiem i otwarte escrow, równoległe refille, replay, brak dowodu, osobna klasa i tier.
**Acceptance Scenarios**:

1. **Given** 100 000 CH przeniesiono do otwartego escrow, **When** spadła płynność SYSTEM, **Then** sama ta zmiana nie pozwala na żadną emisję.
2. **Given** udowodniona nieskompensowana strata 300 CH, headroom 200 CH, pozostały limit klasy/tieru/globalny 150 CH, **When** refill, **Then** emisja nie przekracza 150 CH; ponowienie nie emituje drugi raz.
3. **Given** standard wyczerpał własną część, **When** w slow pozostały środki, **Then** standard nie może ich pobrać; analogicznie slow nie korzysta ze standard.
4. **Given** brakuje audytu/proweniencji lub globalnego limitu, **When** żądanie refillu, **Then** zero emisji, bez blokowania legalnych wypłat.

### Edge Cases

- Ułamkowe fundingDelta, ostatnia jednostka, zero pozostałego fast oraz suma wielu botów większa od dostępnego limitu.
- Nowy użytkownik pre-funded stołu kontra stary uczestnik wracający do już autoryzowanej ekspozycji; brak dowodu to odmowa nowego finansowanego dostępu.
- Wiele kart, stołów i tierów; nakładające się grupy ludzi; nie wolno tworzyć budżetu per sesja.
- Bot-only przed pierwszym człowiekiem: brak budżetu użytkownika i brak automatycznej emisji z obrotu.
- Częściowy zapis, timeout po commit, restart, konflikt wersji, utracona odpowiedź; odzyskanie decyzji zamiast powtórnego obciążenia.
- Wygaszanie przy trwającej ręce, wcześniejsze odejście wszystkich ludzi, nowy okres fast, brak profilu managed.
- Legacy TREASURY i POKER_BOT_BANKROLL, zachowany residual bota, archiwizacja dowodów, niejednoznaczne/mieszane źródła.
- Konto gościa z istniejącym trybem bez ekonomii pozostaje poza budżetem CH; nie może uzyskać wejścia do ekonomii kontowej.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Rozdzielić niepieniężny limit ekspozycji użytkownika, rzeczywistą płynność SYSTEM i ograniczenie nowej emisji; odnowienie limitu nie obciąża USER i nie tworzy CH. [Issue A]
- **FR-002**: Jeden fast na trwałe konto: 100 jednostek pełnego bot buy-in na 7 dni, wspólnie dla tierów; delta CH / tier to koszt jednostkowy, osobno rzeczywiste CH ekspozycji; dodatkowy cap 1 000 000 CH/okres w projektowanym zakresie do 10 000 CH. Dokładne ułamki bez utraty najmniejszej delty. [B]
- **FR-003**: Pierwsze uprawnione użycie rozpoczyna utrwaloną kadencję 7 dni. Granica odnawia do 100, bez rollover/catch-up i bez ciągłego doładowywania fast. Zmiany tieru/sesji/stołu nie resetują kadencji. [B]
- **FR-004**: Slow wspólny między tierami: tempo najwyżej 1 jednostka/12 h, pojemność 1, bez akumulacji wielu jednostek; niewystarczający fast na kolejną ekspozycję kieruje do slow. Dokładny start i sposób odnowienia wymagają D1. [B]
- **FR-005**: Naliczanie obejmuje nowe stacki botów udostępnione graczowi, także już sfinansowane przed jego przyjściem; bot-only bez ludzi nie zużywa budżetu kont. Istniejących CH nie klasyfikować jako nowej emisji. [C]
- **FR-006**: Trwała tożsamość ekspozycji/finansowania i przyjęcia gwarantuje jedno naliczenie; reconnect/retry/reload/kolejna ręka nie naliczają tego samego ponownie. Nowy użytkownik nie dziedziczy autoryzacji poprzednika. [C]
- **FR-007**: Seed, replacement i top-up autoryzować przed widocznością; przy zachowanym residual naliczać wyłącznie nową deltę. Każdy uprawniony człowiek ma niezależną pełną konserwatywną autoryzację; nie dzielić zgadywanych wygranych między ludzi. [C]
- **FR-008**: Budżet, seat, finansowanie i wersja stanu muszą stanowić atomową decyzję albo idempotentne fail-closed reconciliation. Odwrócenie tylko gdy ekspozycja nigdy nie stała się dostępna; przegrana bota/wygrana gracza nie zwraca limitu. [C]
- **FR-009**: STANDARD dopuszcza wielu ludzi z wystarczającym fast, również do dostępnego stołu bot-only. Constrained nie może nowo wejść do STANDARD ani bot-only/CONTINUOUS_BOT. [D]
- **FR-010**: SLOW_PRIVATE ma dokładnie jednego uprawnionego właściciela i jego boty; HUMAN_ONLY dopuszcza zwykły multiplayer bez finansowania botów niezależnie od fast. W slow limit mieści najwyżej jeden pełny buy-in bota naraz. [D]
- **FR-011**: Serwer egzekwuje zgodność w discovery, Quick Seat, Create Table, manual/direct join, reconnect i WS bootstrap. Wynik discovery nie stanowi rezerwacji. Tożsamość konta/stołu pochodzi z serwera. [D]
- **FR-012**: Odmowa nowego wejścia ma neutralny powód i zgodne alternatywy. Brak limitu/płynności nie obiecuje finansowanej ręki; szybkość decyzji botów, timery i human-vs-human nie zmieniają się. [B,D]
- **FR-013**: Przy pierwszej niewystarczalności fast istniejącego człowieka na dalszą wymaganą ekspozycję zapisać sticky DRAINING i deadline +30 min; nie odraczać przez obecność człowieka, reconnect ani reset tygodnia. [E]
- **FR-014**: DRAINING zakazuje nowych ludzi i wszelkiego nowego finansowania SYSTEM botów. Dotychczasowi ludzie i już finansowane stacki mogą grać w grace; dobrowolne odejście z wypłatą działa. [E]
- **FR-015**: Od deadline nie zaczynać następnej ręki; żywą dokończyć i rozliczyć, następnie terminal close z legalnym cash-out ludzi, udowodnionymi źródłami zwrotu botów i zerowym escrow. Dopuszczone wcześniejsze bezpieczne zamknięcie po odejściu ludzi. [E]
- **FR-016**: Deadline dotyczy wszystkich zagrożonych STANDARD, także managed; jest niezależny od odraczalnej rotacji managed i nie stanowi globalnego TTL. Restart/absencja/retry nie znoszą ochrony. Brak finansowania 100 i 500 nie tworzy nieskończonego rollover. [E]
- **FR-017**: Docelowa kapitalizacja każdego tieru 100/500 wynosi 1 000 000 CH. Nowe finansowanie 100 izolowane od TREASURY; istniejący POKER_BOT_BANKROLL 500 zachowany wraz z historycznymi dowodami źródła. Żadnego fallbacku tierów/TREASURY. [F]
- **FR-018**: Jednorazowa alokacja 100 CH ma jawne zbilansowane źródło, osobną tożsamość i ochronę przed ponowieniem; nie zużywa limitów tygodniowego refillu. Źródło i wpływ na podaż zatwierdzane w D3/preflight, Stage evidence i odrębny Production GO obowiązkowe. [F]
- **FR-019**: Twardy podział dostępnego finansowania i dozwolonego refillu: 90% STANDARD, 10% SLOW. Transakcyjnie izolowane; brak pożyczania między klasami, także gdy środki pozostają niewykorzystane. [F]
- **FR-020**: Nowa emisja na 7 dni: tier 100 ≤100 000 CH (90 000/10 000), tier 500 ≤500 000 (450 000/50 000), globalnie ≤600 000 (540 000/60 000). Szczegół okna emisji wymaga D2. [F]
- **FR-021**: Refill wyłącznie na trwałą udowodnioną nieskompensowaną zrealizowaną stratę netto do ludzi, z committed funding i terminal returns bezpiecznie zamkniętych/reconciled stołów. Wykluczyć otwarte escrow, sam obrót oraz ogólne metadata cash-out jako jedyny dowód. [F]
- **FR-022**: Kwota refillu to nieujemne minimum: uprawniona strata, headroom kapitalizacji z uwzględnieniem nadal aktywnych środków oraz pozostałe limity klasy, tieru i globalny. Brak dowodu oznacza zero. Nie emitować całego maksimum na początku tygodnia. [F]
- **FR-023**: Refill stanowi append-only double-entry MINT: GENESIS → dokładny SYSTEM tieru/klasy. Liczniki, purpose/source, tożsamość i idempotency zapisane z kredytem w jednej blokowanej transakcji. Rebalance SYSTEM→SYSTEM nie jest emisją. [F]
- **FR-024**: Przechować audyt ekspozycji oddzielnie od zrealizowanej subsydii, wersję, źródło i dowody przez retention/archives; brak/mieszana proweniencja blokuje uprawnienie do refillu, bez zgadywania właściciela escrow. [C,F]
- **FR-025**: Wyczerpanie płynności/limitów zatrzymuje nowe finansowanie danej klasy/tieru, nie poprawne rozliczenia. Nie gwarantować nieograniczonej dostępności dla dowolnej liczby kont. [F]
- **FR-026**: W #869 włączone są tylko boty 100/500. Wartości ekspozycji dla 1000/5000/10000 są celami #870; wymagają przyszłej kapitalizacji, limitów emisji i uzgodnienia zapisu „NO automatic refill”. Nie ekstrapolować powyżej 10000. [B,F,G]
- **FR-027**: Pilotaż wymaga pomiaru odpływu netto, dostępu zwykłych ludzi, zużycia fast/slow, wyczerpań i emisji na Stage. Aktywacja Production, seed i refill wyłącznie po osobnym GO. [F,G]
- **FR-028**: Zachować WS jako jedyną władzę nad pokerem i istniejące warstwy. Przegląd obejmuje konkretne punkty z sekcji Assumptions; bez nowego silnika, fraud service, frameworka i porządkowania niezwiązanego setupu. [G, Konstytucja I–II]
- **FR-029**: Browser JS zgodny z JSP (global/IIFE, bez imports), CSS jeden selector na linię, poprawny hash CSP dla dodanego inline, logowanie wyłącznie klog. [Guardrails]
- **FR-030**: W przyszłej realizacji tylko fundamentalne deterministyczne testy krytycznej logiki i odpowiedni manual smoke. Zmiany migracji świadomie uruchomią DB Stage Apply PR; zapis o tym musi poprzedzać PR. Migracje zastosowane są niezmienne, poprawki forward-only. WS Preview Deploy wymaga exact runtime SHA i sprawdzonego wyniku przed smoke; zielony Netlify/CI nie zastępuje WS deploy. [G, Konstytucja V]
- **FR-031**: Obecny etap kończy się dokumentacją i analizą; brak implementacji, migracji, zmian środowisk i deploy. Niezależne review oraz osobne zlecenie implementacji są bramką dalszej pracy. Dokumenty bez poleceń Git i pełnego kodu. [Polecenie właściciela]
- **FR-032**: Przejście ze starych stołów nie może niejawnie zmienić ich klasy ani źródła sfinansowanych stacków. Istniejący uczestnicy zachowują wypłaty; dostęp nowego człowieka wymaga aktualnej polityki i dowodu. Jawnie udokumentować breaking changes matchmakingu, wygaszania, źródeł 100 CH i emisji. [G, Guardrails]

### Key Entities *(include if feature involves data)*

- **Budżet konta**: trwałe konto, kadencja, zużycie fast w jednostkach i CH, stan slow; to uprawnienie, nie portfel.
- **Ekspozycja i decyzja**: użytkownik, stół, udowodniony stock/funding, ilość, źródło, wersja i idempotentny wynik.
- **Klasa stołu**: STANDARD/SLOW_PRIVATE/HUMAN_ONLY, właściciel slow, niezależne sticky wygaszanie.
- **Pula tieru/klasy**: źródło SYSTEM, płynne i aktywnie zaangażowane środki, przydział 90/10.
- **Dowód zamknięcia i emisji**: fundings/returns, strata netto, kompensacja, okres i limity emisji.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: W krytycznych scenariuszach granicznych i współbieżnych zero przekroczeń 100 jednostek i 1 000 000 CH fast; slow nigdy nie ma więcej niż jednej jednostki ani tempa ponad 1/12 h.
- **SC-002**: Każda ścieżka nowego dopuszczenia odrzuca constrained do STANDARD/bot-only i do cudzego slow; zero podwójnych naliczeń tej samej ekspozycji po retry/reconnect.
- **SC-003**: Zero nowych ludzi/fundingu po DRAINING; zero następnych rąk rozpoczynanych od deadline; każda prawidłowa żywa ręka i wypłata zachowana.
- **SC-004**: Zero przekroczeń 100 000/500 000/600 000 CH i limitów klas; zero emisji uzasadnionej wyłącznie otwartym escrow; zero finansowania standard ze środków zarezerwowanych slow.
- **SC-005**: Każdy refill i terminal return ma dokładny audyt źródła i idempotencji; ponowienie nie zmienia kwot; niepełny dowód daje zero refillu.
- **SC-006**: Przed aktywacją dostępne są przypisane do środowiska dowody Stage oraz exact-SHA WS Preview i potwierdzony smoke. Brak dowodu oznacza status oczekiwania, a nie gotowość do wydania.

## Assumptions

- Autorytet wymagań: issue z 2026-09-24; konstytucja 1.1.1; aktualny kod GitHub wskazany w issue-source.md. Podane limity to zatwierdzony pilot, nie prognoza inflacji.
- Konkretny zakres istniejący: `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `bots.mjs::seedBotsForJoin`, `table-economy.mjs::getBotFundingSystemKeyForBuyIn`, `terminal-close.mjs::resolveBotFundingSource/executeTerminalPokerCloseInTx`; `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover` i właściwość `allowBotFunding`; writer `writeMutation/writeReplacementFundings/writeManagedBotTopUps`; `poker_tables.rotation_due_at`. Szczegóły techniczne znajdują się w plan.md.
- Nie zmieniać reguł gry, obliczania wygranych, progresji bankroll użytkownika ani gościnnego trybu bez ekonomii. Nie planować nowych testów UI/CSS/JSP ani nowych frameworków.
- D1: [NEEDS CLARIFICATION: Czy pierwsza jednostka slow dostępna od pierwszego wejścia w slow, czy po 12 h; czy odnowienie jest proporcjonalne, czy skokowe po zużyciu?] W issue zatwierdzono tempo i burst, lecz nie tę granicę.
- D2: [NEEDS CLARIFICATION: Czy limit emisji obowiązuje w dowolnych kroczących 7 dniach, czy wspólnych stałych oknach i z jaką kotwicą?] Nie wolno zakładać podwójnej emisji na styku okien.
- D3: [NEEDS CLARIFICATION: Jakie dokładne źródło zbilansowanej jednorazowej alokacji 1 000 000 CH do puli 100 zatwierdza właściciel?] Propozycja do preflight: GENESIS jako jawna emisja, nie automatyczna decyzja. Plan nie przyznaje Production GO.
