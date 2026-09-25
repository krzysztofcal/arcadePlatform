# Feature Specification: Chroniony budżet botów — issue #869

**Feature Branch**: `docs/issue-869-protected-bot-budget-spec`; draft PR #1017; katalog `specs/006-protect-bot-budget/`.
**Created**: 2026-09-24
**Status**: Draft do niezależnego review; decyzje D1–D3 zatwierdzone i uwzględnione; nie jest zgodą na implementację.
**Input**: Wszystkie zatwierdzone wymagania [issue #869](https://github.com/krzysztofcal/arcadePlatform/issues/869), wersja i pełna treść w [issue-source.md](issue-source.md).

## Clarifications

### Session 2026-09-25

Aktualizacja na podstawie zatwierdzonych odpowiedzi w issue z 2026-09-24 i polecenia właściciela. D1–D3 zamknięte; brak nierozstrzygniętych pytań właściciela. Uwzględniono oba P1: globalne wyczerpanie oraz ułamkowe slow. Wszystkie obszary taxonomy clarify są Clear; przyszłe dowody runtime i osobne zlecenie implementacji pozostają bramkami wykonania, nie lukami wymagań.

- D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.
- D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.
- D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Aktualizacja D.1 z issue 2026-09-25: filtrowanie przed prezentacją, find-or-create, ograniczony rematch i jawne granice awarii są zatwierdzone. Clarify: 0 pytań, wszystkie kategorie Clear; limit prób jest decyzją techniczną planu, nie zmianą polityki D1–D3.

Checklist jakości: 16/16; niezależna economy checklist pozostaje do review. Brak `.specify/extensions.yml` i hooków analyze. Nie uruchamiać implementacji.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Wspólny limit dostępu gracza (Priority: P1)

Gracz wykorzystuje jeden limit dostępu do nowych stacków botów niezależnie od tieru, stołu i sesji. Nie traci legalnych wygranych ani CH przez samo naliczenie limitu.

**Why this priority**: Bez trwałej autoryzacji ekspozycji zmiana stołu obchodzi ochronę finansowania.
**Independent Test**: Deterministyczny zegar, równoległe żądania tego samego konta, seedy i wejście do stołu już finansowanego; sprawdzenie sum zużycia oraz braku dodatkowego obciążenia USER.
**Acceptance Scenarios**:

1. **Given** 99 jednostek zużycia, **When** gracz uzyskuje ekspozycję 50 CH przy tierze 100 i 250 CH przy tierze 500, **Then** łączne zużycie wynosi 100 jednostek, a nowe ekspozycje wymagają wolnego dostępu.
2. **Given** zaakceptowane wejście do finansowanych botów, **When** następuje reconnect, powtórzone żądanie lub kolejna ręka na tych samych środkach, **Then** brak drugiego naliczenia i drugiego buy-in.
3. **Given** Adam i Bartek siedzą przy STANDARD 100 CH z wystarczającymi limitami, **When** SYSTEM finansuje bota dodatkowym 50 CH, **Then** powstaje jeden FUNDING (user_id=NULL dozwolone) dla jednego transferu SYSTEM → ESCROW 50 CH oraz dwa EXPOSURE z user_id Adama/Bartka i tą samą trwałą tożsamością finansowania; każdemu nalicza się 0,5 jednostki. Salda USER pozostają bez zmian z tytułu exposure. Retry/reconnect nie powtarza transferu ani żadnego naliczenia.
4. **Given** granica utrwalonego okresu 7 dni, **When** następuje następne uprawnione użycie, **Then** dostępne jest 100 jednostek bez sumowania nieużytych okresów; istniejący DRAINING pozostaje.

5. **Given** pierwsze przejście w slow, **Then** dostępna od razu 1 jednostka. Po 0,4 w t0 i 0,6 w t0+1 h, w t0+12 h dostępne tylko 0,4; w t0+13 h pełna 1 bez nowego zużycia. Zmiana tieru/fast/slow i równoczesne żądania nie zwiększają sumy.

### User Story 2 - Zgodny dobór stołów (Priority: P1)

Zwykli gracze dzielą stoły STANDARD. Gracz z niewystarczającym szybkim limitem wybiera własny SLOW_PRIVATE albo HUMAN_ONLY.

**Why this priority**: Ochrona rezerwy nie działa, gdy da się wejść do cudzych finansowanych botów.
**Independent Test**: Serwerowa projekcja JOIN/RESUME, preference humans, find-or-create oraz wyścig rekomendacja/admission z ograniczonym retry; direct link bez cichego rematch. Prezentacja ręcznie na Preview.
**Acceptance Scenarios**:

1. **Given** wystarczający fast i płynność, **When** dwóch graczy wybiera multiplayer, **Then** może współdzielić STANDARD, także uprzednio bot-only.
2. **Given** niewystarczający fast, **When** gracz podaje bezpośredni adres STANDARD/CONTINUOUS_BOT lub cudzego SLOW_PRIVATE, **Then** nowe wejście odrzucone bez kary, z alternatywą HUMAN_ONLY/własnego slow.
3. **Given** jedna jednostka slow i właściwa rezerwa, **When** właściciel zakłada wolny stół, **Then** dostępny jest jeden pełny bot i jeden człowiek; brak finansowania drugiego pełnego bota.
4. **Given** wyczerpana płynność lub uprawnienie, **When** gracz szuka botów, **Then** otrzymuje informację o oczekiwaniu lub grze z ludźmi, a nie obietnicę finansowanej ręki.

5. **Given** mieszana lista zgodnych, pełnych, DRAINING i cudzych slow stołów, **When** gracz otrzymuje lobby, **Then** zero niedostępnych nowych ofert i zero wierszy Unavailable; własne udowodnione miejsca mają Resume, nie Join.
6. **Given** dozwolony tier/tryb i pełne środki, **When** Quick Seat, **Then** STANDARD preferuje zgodne stoły z ludźmi, potem inne STANDARD; brak kandydata automatycznie tworzy zgodny stół i kontynuuje WS admission. Własny SLOW_PRIVATE/HUMAN_ONLY analogicznie, bez zmiany tieru/trybu i bez obietnicy przeciwnika HUMAN_ONLY.
7. **Given** kandydat zajęty/wygaszony przed admission i inny zgodny cel, **When** pierwsza próba MATCH otrzymuje trwałą odmowę, **Then** jeden automatyczny rematch bez ponownego kliknięcia; maksymalnie 2 próby i 1 nowy stół na operację. Retry/reconnect nie powiela stołów, CH ani EXPOSURE.
8. **Given** realny brak allowance/liquidity/proof/capability, **When** matchmaking lub Create, **Then** zero pozornych nowych funded stołów i brak obietnicy bota; jawna alternatywa HUMAN_ONLY lub obliczalne oczekiwanie. Direct link do niedostępnego stołu oferuje alternatywę bez cichej zmiany celu. Awaria backendu lub wyczerpanie retry może zakończyć się błędem.

9. **Given** seed może wybrać 2 lub 3 boty po 100 CH, pula ma 250 CH, **Then** preflight nie obiecuje dostępu na podstawie mniejszego losowania; bez zmiany warunków RNG nie może spowodować większego kosztu niż sprawdzona granica. Przy 300 CH oba warianty mieszczą się, naliczany tylko faktyczny funding.
10. **Given** własny pusty INIT maxPlayers=2, **When** żądanie maxPlayers=6 lub niezgodnych stakes, **Then** stół nie jest reuse; dla slow jawny konflikt bez drugiego OPEN stołu i bez zmiany parametrów.
11. **Given** uwierzytelniony admin z wyczerpanym fast, **When** administracyjna lista ALL/szczegóły, **Then** widzi utrwalone stoły wszystkich klas, także CLOSED i niedostępne mu jako gracz, z class/legacy/unknown oraz osobnym drain i pierwotnym deadline; non-admin odrzucony. Inspekcja nie ujawnia prywatnych kart/allowance, nie mutuje gry i nie przyznaje admission. Live spectator #789 poza zakresem.

### User Story 3 - Bezpieczne wygaszanie po wyczerpaniu (Priority: P1)

Gracz już siedzący zachowuje rękę, stack i wypłatę. Stół kończy przyjmowanie ludzi i finansowanie, następnie zamyka się na bezpiecznej granicy ręki.

**Why this priority**: Natychmiastowy kick albo nieskończony rollover blokowałby prawidłowe rozliczenie.
**Independent Test**: Zegar tuż przed i na deadline, aktywna ręka, restart, obecny/nieobecny człowiek, zwrot z właściwego źródła i zero escrow.
**Acceptance Scenarios**:

1. **Given** pierwszy brak fast na wymagane dalsze finansowanie w chwili t, **When** gracz nadal siedzi, **Then** stół ma trwały DRAINING i deadline t+30 minut; nowi ludzie i nowe środki SYSTEM są blokowani.
2. **Given** DRAINING, **When** mija nowy tydzień lub następuje reconnect, **Then** deadline pozostaje identyczny.
3. **Given** żywa ręka w deadline, **When** kończy się jej normalne rozliczenie, **Then** następuje terminal close i wypłaty bez kolejnej ręki.
4. **Given** brak finansowania w tierze 100 lub 500, **When** dochodzi do rollover, **Then** istniejące rozliczenie/wyjście postępuje bez nieskończonego retry finansowania.

5. **Given** konto siedzi przy A i pre-funded B, **When** A wyczerpuje fast w t0, a B odkrywa to 20 minut później bez nowego fundingu, **Then** oba mają deadline t0+30 min; ręka rozpoczęta wcześniej kończy się i wypłaca poprawnie. HUMAN_ONLY i istniejący SLOW_PRIVATE pozostają bez tego drain.

### User Story 4 - Ograniczone środki i audyt emisji (Priority: P1)

Operator ma osobne fundusze 100/500, twardą ochronę klas 90/10 oraz emisję wyłącznie na udowodnioną zrealizowaną stratę.

**Why this priority**: Limit pojedynczego konta nie ogranicza łącznej emisji dla wielu kont.
**Independent Test**: Zamknięte stoły ze stratą/zyskiem i otwarte escrow, równoległe refille, replay, brak dowodu, osobna klasa i tier.
**Acceptance Scenarios**:

1. **Given** 100 000 CH przeniesiono do otwartego escrow, **When** spadła płynność SYSTEM, **Then** sama ta zmiana nie pozwala na żadną emisję.
2. **Given** udowodniona nieskompensowana strata 300 CH, headroom 200 CH, pozostały limit klasy/tieru/globalny 150 CH, **When** refill, **Then** emisja nie przekracza 150 CH; ponowienie nie emituje drugi raz.
3. **Given** standard wyczerpał własną część, **When** w slow pozostały środki, **Then** standard nie może ich pobrać; analogicznie slow nie korzysta ze standard.
4. **Given** brakuje audytu/proweniencji lub globalnego limitu, **When** żądanie refillu, **Then** zero emisji, bez blokowania legalnych wypłat.

5. **Given** emisja sprzed 168 h i równoczesne refille różnych tierów/klas, **Then** uwolnić tylko receipt na wyłączonej lewej granicy; sumy wraz z nowymi emisjami pozostają w cap.
6. **Given** powtórzona/równoczesna pierwsza alokacja 100, **Then** dokładnie jeden MINT miliona z GENESIS, podział 900000/100000, brak zużycia REFILL cap; Production nadal wymaga osobnego GO.

7. **Given** wiele dirty lobby zdarzeń/odbiorców, **When** scalony refresh lub przeciążenie DB, **Then** ograniczony batch/RT/bytes, zero query viewer×table, stale result odrzucony; niepełne dane nie uprawniają nowej oferty/create. Przy backlog close/refill rozliczenie nie czeka na emisję, overflow proof daje zero mint i pending. Brak samej DB skutkuje recovery.

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
- **FR-004**: D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast. Niewystarczający fast kieruje do slow. [B, D1, P1]
- **FR-005**: Naliczanie obejmuje nowe stacki botów udostępnione graczowi, także już sfinansowane przed jego przyjściem; bot-only bez ludzi nie zużywa budżetu kont. Istniejących CH nie klasyfikować jako nowej emisji. [C]
- **FR-006**: Trwała tożsamość ekspozycji/finansowania i przyjęcia gwarantuje jedno naliczenie; reconnect/retry/reload/kolejna ręka nie naliczają tego samego ponownie. Nowy użytkownik nie dziedziczy autoryzacji poprzednika. [C]
- **FR-007**: Seed, replacement i top-up autoryzować przed widocznością; przy zachowanym residual naliczać wyłącznie nową deltę. Każdy uprawniony człowiek ma niezależną pełną konserwatywną autoryzację; nie dzielić zgadywanych wygranych między ludzi. [C]
- **FR-008**: Budżet, seat, finansowanie i wersja stanu muszą stanowić atomową decyzję albo idempotentne fail-closed reconciliation. Odwrócenie tylko gdy ekspozycja nigdy nie stała się dostępna; przegrana bota/wygrana gracza nie zwraca limitu. [C]
- **FR-009**: STANDARD dopuszcza wielu ludzi z wystarczającym fast, również do dostępnego stołu bot-only. Constrained nie może nowo wejść do STANDARD ani bot-only/CONTINUOUS_BOT. [D]
- **FR-010**: SLOW_PRIVATE ma dokładnie jednego uprawnionego właściciela i jego boty; HUMAN_ONLY dopuszcza zwykły multiplayer bez finansowania botów niezależnie od fast. W slow limit mieści najwyżej jeden pełny buy-in bota naraz. [D]
- **FR-011**: Serwer filtruje zwykłe lobby gracza per odbiorca przed prezentacją: tylko obecnie dozwolone JOIN według konta/tieru/budżetu/klasy/owner/pojemności/drain oraz odrębne własne legalne RESUME; zero niedostępnych wierszy Unavailable i cudzych slow stołów. Odświeża po zmianach uprawnień, seats, drain, liquidity/proof/capability i granicach czasu. Ta sama polityka w Quick Seat/Create/direct/reconnect/WS, finalna atomowa autoryzacja przy wejściu; discovery nie rezerwuje. Administracyjna lista/szczegóły zachowują autoryzowany dostęp do wszystkich persisted stołów z istniejącymi filtrami/paginacją, bez eligibility admina; pokazują klasę/legacy/unknown, osobny DRAINING i pierwotne daty, bez prywatnych kart/allowance, mutacji lub bypass admission. Live spectator #789 poza zakresem. [D, D.1–D.2]
- **FR-012**: Zwykły MATCH preferuje zgodny STANDARD z ludźmi, potem inne STANDARD, a brak kandydata prowadzi do automatycznego find-or-create żądanego dozwolonego tieru/klasy; własny slow i HUMAN_ONLY analogicznie. Pierwsza przewidywalna stale odmowa uruchamia ograniczony rematch bez ponownego kliknięcia: maks. 2 próby/1 utworzenie na operację, idempotentne także po timeout. DIRECT nie przenosi bez wyboru. Znany brak allowance/puli/proof/capability blokuje tworzenie pozornego funded stołu, daje neutralne HUMAN_ONLY/wait; brak cichej zmiany trybu/tieru, gwarancji bota ani gwarancji sukcesu przy awarii/wyczerpaniu prób. Preflight sprawdza bezpieczną pełną granicę fundingu zgodną z możliwościami finalnego seed, bez niezależnego tańszego losowania. Reuse wymaga zgodnych maxPlayers i ekonomii oprócz owner/class/tier; niezgodny OPEN slow daje jawny konflikt, nie drugi stół. Pasywne lobby nigdy nie tworzy/finansuje stołu. Zawsze widoczne „Graj teraz” po click wybiera pierwszy nadal zgodny JOIN według listy albo tworzy≤1 stół po zakończonym bounded doborze i preflight. Brak manual search controls i pełnego globalnego rescan; zaakceptowane dodatkowe create, gdy zgodny cel poza zakresem. Timery i reguły gry bez zmian. [B,D,D.1]
- **FR-013**: Pierwsze wyczerpanie fast utrwalić na koncie z czasem i powiązaniami wszystkich już zajętych STANDARD z botami, także pre-funded i managed. Trigger: dokładne wyczerpanie limitu po legalnej ekspozycji lub pierwsza odmowa wymaganego kosztu. Każdy taki stół jest DRAINING z deadline pierwotny exhausted_at +30 min; nigdy czas późniejszego wykrycia. [E, P1]
- **FR-014**: DRAINING zakazuje nowych ludzi i wszelkiego nowego finansowania SYSTEM botów. Dotychczasowi ludzie i już finansowane stacki mogą grać w grace; dobrowolne odejście z wypłatą działa. [E]
- **FR-015**: Od deadline nie zaczynać następnej ręki; żywą dokończyć i rozliczyć, następnie terminal close z legalnym cash-out ludzi, udowodnionymi źródłami zwrotu botów i zerowym escrow. Dopuszczone wcześniejsze bezpieczne zamknięcie po odejściu ludzi. [E]
- **FR-016**: Sprawdzać globalne zdarzenie i deadline przy admission, przed nowym funding oraz przed każdą kolejną ręką/prepare/commit także bez fundingDelta. Restart, leave, reconnect i reset fast nie usuwają powiązań; HUMAN_ONLY i istniejące SLOW_PRIVATE wyłączone z tego drain. Bez kicka/przerwania ręki; brak finansowania 100/500 nie zapętla rollover. [E, P1]
- **FR-017**: Docelowa kapitalizacja każdego tieru 100/500 wynosi 1 000 000 CH. Nowe finansowanie 100 izolowane od TREASURY; istniejący POKER_BOT_BANKROLL 500 zachowany wraz z historycznymi dowodami źródła. Żadnego fallbacku tierów/TREASURY. [F]
- **FR-018**: D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO. Dowody Stage obowiązkowe przed aktywacją. [F]
- **FR-019**: Twardy podział dostępnego finansowania i dozwolonego refillu: 90% STANDARD, 10% SLOW. Transakcyjnie izolowane; brak pożyczania między klasami, także gdy środki pozostają niewykorzystane. [F]
- **FR-020**: REFILL w kroczącym oknie (t−168 h, t]: tier 100 ≤100 000 CH (90 000/10 000), tier 500 ≤500 000 (450 000/50 000), globalnie ≤600 000 (540 000/60 000). Wspólny czas i trwałe dowody; atomowe egzekwowanie wszystkich cap dla równoczesnych emisji klas/tierów. [F, D2]
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

- **FR-033**: Preflight nowego bot funding używa wersjonowanej, wiarygodnie potwierdzonej konfiguracji autorytatywnego WS i wspólnej bezpiecznej granicy; nie lokalnego env Netlify ani samej binary buy-in capability. Brak/niezgodność dowodu wyklucza nową funded ofertę; zmiana revision przed join daje atomową stale odmowę i bounded rematch, bez obejścia finalnych locks. [P1]
- **FR-034**: D.3: ograniczyć pracę lobby/matchmaking/join/rollover/drain/close/refill/admin według jawnych limitów RT, rows, bytes, czasu, retry i concurrency w planie. Zero DB viewer×table/N+1 admin; brak częstego idle per-user pollingu; scalone refresh, bounded payload, discarded stale async. Nieudany/obcięty odczyt lub niepełny proof nie uprawnia create; poprawnie zakończony bounded dobór bez oferty może po click prowadzić do create bez globalnego dowodu pustki, niepełny dowód finansowy nie uprawnia mint. Refill low-priority, bounded i recoverable; ciężka opcjonalna praca pozostaje poza FIFO stołu, bez obietnicy wyprzedzania już zakolejkowanych komend; accepted settlement/cash-out nie zależą od tej pracy przy dostępnej DB, pełna awaria oznacza recovery bez fałszywej gwarancji. Egress mierzyć oddzielnie od CPU/Disk I/O/WAL/locks i wymagać baseline vs implementacja przed aktywacją. [D.3]

### Key Entities *(include if feature involves data)*

- **Budżet konta**: trwałe konto, kadencja, zużycie fast w jednostkach i CH, stan slow; to uprawnienie, nie portfel.
- **Ekspozycja i decyzja**: użytkownik, stół, udowodniony stock/funding, ilość, źródło, wersja i idempotentny wynik.
- **Klasa stołu**: STANDARD/SLOW_PRIVATE/HUMAN_ONLY, właściciel slow, niezależne sticky wygaszanie.
- **Pula tieru/klasy**: źródło SYSTEM, płynne i aktywnie zaangażowane środki, przydział 90/10.
- **Dowód zamknięcia i emisji**: fundings/returns, strata netto, kompensacja, okres i limity emisji.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: W krytycznych scenariuszach granicznych i współbieżnych zero przekroczeń 100 jednostek i 1 000 000 CH fast; suma slow w każdym kroczącym (t−12 h, t] ≤1, także dla ułamków i równoczesnych żądań.
- **SC-002**: Każda ścieżka nowego dopuszczenia odrzuca constrained do STANDARD/bot-only i do cudzego slow; zero podwójnych naliczeń tej samej ekspozycji po retry/reconnect. Lobby ma zero niedostępnych JOIN/Unavailable; normalny MATCH z jednym stale kandydatem i dostępnym drugim celem kończy się bez ręcznego ponawiania, ≤2 próby i ≤1 create; realny brak warunków daje zero pozornych create.
- **SC-003**: Zero nowych ludzi/fundingu po DRAINING; zero następnych rąk rozpoczynanych od deadline; każda prawidłowa żywa ręka i wypłata zachowana.
- **SC-004**: Zero przekroczeń 100 000/500 000/600 000 CH i limitów klas w każdym kroczącym (t−168 h, t]; zero emisji uzasadnionej wyłącznie otwartym escrow; zero finansowania standard ze środków zarezerwowanych slow.
- **SC-005**: Każdy refill i terminal return ma dokładny audyt źródła i idempotencji; ponowienie nie zmienia kwot; niepełny dowód daje zero refillu.
- **SC-006**: Przed aktywacją dostępne są przypisane do środowiska dowody Stage oraz exact-SHA WS Preview i potwierdzony smoke. Brak dowodu oznacza status oczekiwania, a nie gotowość do wydania.

- **SC-007**: Fundamentalne scenariusze wykazują: zmiana lobby nie mnoży SQL przez widzów×stoły, idle nie dodaje pollingu; duplicate dirty zdarzenia scalają się, starszy wynik nie przywraca JOIN; 150 kandydatów nie wymaga interaktywnej kontynuacji:100 w pełni ocenionych bez oferty pozwala click/create przy pełnym preflight; pasywne lobby ma zero writes, a click wybiera pierwszy nadal zgodny widoczny JOIN; nieukończony odczyt lub overflow/niekompletność dowodu finansowego daje zero create/mint i recoverable backlog; timeout certyfikatu/pending cofa cały close, recovery nie dubluje CH, final proof korzysta z jednej to_state_version; opcjonalny ciężki proof poza FIFO nie blokuje rozliczenia; błędny WS config daje zero funded ofert. Stage dowodzi zmierzonych RT/rows/bytes/egress/CPU/I/O/WAL/connections/locks/retry/latency i braku materialnego starvation przy zadanym małym obciążeniu; liczby z planu nie są obietnicą niezmierzonego SLO. [FR-033–034]

## Assumptions

- D.2 zatwierdzone; #789 OPEN potwierdzone w GitHub 2026-09-25. D.2 i D.3 są zatwierdzone; spectator to wyłącznie osobna przyszła funkcja. P1 obejmuje koszt graniczny i wiarygodny descriptor WS zapisany w istniejącym receipt; P2 pełną zgodnością parametrów, bez zmiany zasad slow.


- Autorytet wymagań: aktualne issue z 2026-09-25 (updatedAt w issue-source.md); konstytucja 1.1.1; aktualny kod GitHub wskazany w issue-source.md. Podane limity to zatwierdzony pilot, nie prognoza inflacji.
- Konkretny zakres istniejący: `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `bots.mjs::seedBotsForJoin`, `table-economy.mjs::getBotFundingSystemKeyForBuyIn`, `terminal-close.mjs::resolveBotFundingSource/executeTerminalPokerCloseInTx`; `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover` i właściwość `allowBotFunding`; writer `writeMutation/writeReplacementFundings/writeManagedBotTopUps`; `poker_tables.rotation_due_at`. Szczegóły techniczne znajdują się w plan.md.
- Nie zmieniać reguł gry, obliczania wygranych, progresji bankroll użytkownika ani gościnnego trybu bez ekonomii. Nie planować nowych testów UI/CSS/JSP ani nowych frameworków.


## Zatwierdzona korekta D.1

Issue updatedAt 2026-09-25T12:38:01Z zastępuje wcześniejszą otwartą kwestię dostępności create; brak nierozstrzygniętych wariantów. Stała akcja „Graj teraz”, pasywny JOIN/Resume i bounded click/create opisane w FR-011/012/034 oraz contracts. Fundamentalne acceptance: browse zero table/seat/funding writes; click pierwszy zgodny; stale pierwszy→drugi; brak oferty→max1 create; race/replay bez duplikatów; missing evidence/DB failure→zero create; >100 kandydatów bez ręcznej kontynuacji. Widoczność przycisku przy pustej i niepustej liście manual Preview.
