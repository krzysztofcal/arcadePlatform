# Feature Specification: Chroniony budżet botów — issue #869

**Feature Branch**: `docs/issue-869-protected-bot-budget-spec`; draft PR #1017; katalog `specs/006-protect-bot-budget/`.
**Created**: 2026-09-24
**Status**: Draft do niezależnego review; decyzje D1–D3 zatwierdzone i uwzględnione; nie jest zgodą na implementację.
**Input**: Wszystkie zatwierdzone wymagania [issue #869](https://github.com/krzysztofcal/arcadePlatform/issues/869), wersja i pełna treść w [issue-source.md](issue-source.md).

## Clarifications

### Session 2026-09-25

Aktualizacja na podstawie zatwierdzonych odpowiedzi w issue z 2026-09-24 i polecenia właściciela. D1–D3 zamknięte; S1-A zatwierdzone, Q1 WS-only zatwierdzone; projekt techniczny do niezależnego review. Uwzględniono oba P1: globalne wyczerpanie oraz ułamkowe slow. Znane luki Q1 są jawne; przyszłe dowody runtime i osobne zlecenie implementacji pozostają bramkami wykonania, nie lukami wymagań.

- D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.
- D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.
- D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Aktualizacja D.1 z issue 2026-09-25: filtrowanie przed prezentacją, find-or-create, ograniczony rematch i jawne granice awarii są zatwierdzone. Clarify: Q1 wymagają review; limit prób jest decyzją techniczną planu, nie zmianą polityki D1–D3.

Checklist jakości: 14/16; niezależna economy checklist pozostaje do review. Brak `.specify/extensions.yml` i hooków analyze. Nie uruchamiać implementacji.

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

Gracze FAST dzielą STANDARD, gracze SLOW dzielą SLOW_SHARED; HUMAN_ONLY nie finansuje botów. Lobby jest pasywne i nie ma ręcznego Create. Jeden przycisk Graj teraz automatycznie dobiera i dołącza bez formularza.

**Why this priority**: Każdy uczestnik musi samodzielnie autoryzować dostęp do wspólnie finansowanych botów.
**Independent Test**: Serwerowa projekcja JOIN/RESUME, preference humans, find-or-create oraz wyścig rekomendacja/admission z ograniczonym retry; direct link bez cichego rematch. Prezentacja ręcznie na Preview.
**Acceptance Scenarios**:

1. Dwóch FAST może współdzielić STANDARD, dwóch niezależnie uprawnionych SLOW może współdzielić SLOW_SHARED. Nowy człowiek autoryzuje pre-funded stack bez powtórnego transferu.
2. Constrained nie wejdzie nowo do STANDARD/CONTINUOUS_BOT nawet direct URL; SLOW_SHARED nie ma owner-only ani single-human cap. HUMAN_ONLY bez botów pozostaje alternatywą.
3. Adam i Bartek SLOW100: jeden FUNDING50CH i dwa EXPOSURE0,5; USER bez debitu exposure. Brak allowance nowego gościa odrzuca jego admission, nie legalną rękę obecnych.
4. Brak puli/allowance/cfg/proof lub błąd SQL/WS daje uczciwy unavailable, zero fikcyjnego create i bez cichej zamiany trybu.
5. Otwarcie pustego/niepustego lobby, refresh/reconnect: zero create/seat/funding. JOIN tylko zgodne cele wszystkich dostępnych tierów; Resume osobno; Graj teraz zawsze widoczne, bez Create/formularza/Unavailable rows.
6. Jeden click wybiera pierwszy nadal zgodny widoczny cel i jego faktyczne parametry. Bez oferty: najwyższy rzeczywiście grywalny tier w dozwolonym trybie, canonical stakes/maxPlayers,≤1 create, automatyczne przeniesienie i WS join bez dodatkowego wyboru.
7. Stale pierwszy cel→ograniczony automatyczny rematch bez click, maks2 admission/1create. Parallel clicks/replay/unknown commit bez duplikatu stołu/CH/EXPOSURE.
8. Zbiór większy niż zmierzony bounded zakres K: poprawnie ukończony dobór może stworzyć≤1 stół bez global rescan/manual continuation. Timeout/stale/proof failure nie jest completed empty. DIRECT nie zmienia sam celu.
9. Seed min2/max3 przy pool250/T100: brak oferty niezależnie od RNG; pool300 dopuszcza oba, actual-only debit. WS descriptor obowiązuje także Netlify, brak/mismatch fail-closed.
10. Własny INIT2 nie jest reuse dla nowego planu6/niezgodnych stakes; brak owner-unique SLOW. Widoczny istniejący stół2 może być wybrany ze swoimi parametrami.
11. Admin inventory wszystkich persisted stołów pozostaje niezależne od player budget, class/legacy/unknown i drain daty bez zmiany OPEN/CLOSED; brak prywatnych kart/admission bypass. Spectator #789 poza zakresem.

### User Story 3 - Bezpieczne wygaszanie po wyczerpaniu (Priority: P1)

Gracz już siedzący zachowuje rękę, stack i wypłatę. Stół kończy przyjmowanie ludzi i finansowanie, następnie zamyka się na bezpiecznej granicy ręki.

**Why this priority**: Natychmiastowy kick albo nieskończony rollover blokowałby prawidłowe rozliczenie.
**Independent Test**: Zegar tuż przed i na deadline, aktywna ręka, restart, obecny/nieobecny człowiek, zwrot z właściwego źródła i zero escrow.
**Acceptance Scenarios**:

1. **Given** pierwszy brak fast na wymagane dalsze finansowanie w chwili t, **When** gracz nadal siedzi, **Then** stół ma trwały DRAINING i deadline t+30 minut; nowi ludzie i nowe środki SYSTEM są blokowani.
2. **Given** DRAINING, **When** mija nowy tydzień lub następuje reconnect, **Then** deadline pozostaje identyczny.
3. **Given** żywa ręka w deadline, **When** kończy się jej normalne rozliczenie, **Then** następuje terminal close i wypłaty bez kolejnej ręki.
4. **Given** brak finansowania w tierze 100 lub 500, **When** dochodzi do rollover, **Then** istniejące rozliczenie/wyjście postępuje bez nieskończonego retry finansowania.

5. **Given** konto siedzi przy A i pre-funded B, **When** A wyczerpuje fast w t0, a B odkrywa to 20 minut później bez nowego fundingu, **Then** oba mają deadline t0+30 min; ręka rozpoczęta wcześniej kończy się i wypłaca poprawnie. HUMAN_ONLY i istniejący SLOW_SHARED pozostają bez drain wywołanego FAST.

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
- **FR-010**: SLOW_SHARED dopuszcza wielu niezależnie uprawnionych graczy SLOW i wspólne boty chronionej puli; brak właściciela dostępu/single-human cap/unique open owner. Każdy autoryzuje nowe i pre-funded exposure, jeden FUNDING nie powiela transferu. HUMAN_ONLY to multiplayer bez botów. [D]
- **FR-011**: Pasywne lobby pokazuje tylko zgodne JOIN ze wszystkich dostępnych graczowi tierów, odrębne własne Resume, bez Create/formularza i Unavailable rows. Otwarcie/refresh/reconnect nie tworzy, nie zajmuje ani nie finansuje. Serwer filtruje progression/allowance/class/seats/drain/proof; końcowa autoryzacja atomowa, discovery nie rezerwuje. Admin inventory/szczegóły wszystkich persisted stołów z dotychczasowymi filtrami i paginacją pozostają niezależne od player eligibility; class/legacy/unknown, oddzielny drain i daty, bez kart/bypass. #789 poza zakresem. [D.1–D.3]
- **FR-012**: Zawsze widoczne Graj teraz bez wyboru tier/tryb/maxPlayers lub potwierdzenia automatycznie dołącza do pierwszego nadal zgodnego widocznego celu z jego parametrami; brak oferty uruchamia bounded dobór i najwyższy rzeczywiście grywalny tier dozwolonego trybu z parametrami kanonicznymi,≤1 create. Maks2 admission/1create, jeden rematch bez click, trwały replay/cross-tab dedupe, DIRECT przypięty. Brak silent mode switch; brak budget/pool/cfg/proof lub failed/stale reads daje zero create. Wspólna bezpieczna granica seed WS i actual-only debit, reuse zgodnego INIT z maxPlayers/stakes. Brak global rescan/manual continuation; wyjątkowy dodatkowy stół poza prawidłowo ocenionym zakresem dozwolony. Granice discovery po analizie Q1, nie arbitralne100. [D.1,D.3,P1,P2]
- **FR-013**: Pierwsze wyczerpanie fast utrwalić na koncie z czasem i powiązaniami wszystkich już zajętych STANDARD z botami, także pre-funded i managed. Trigger: dokładne wyczerpanie limitu po legalnej ekspozycji lub pierwsza odmowa wymaganego kosztu. Każdy taki stół jest DRAINING z deadline pierwotny exhausted_at +30 min; nigdy czas późniejszego wykrycia. [E, P1] SLOW_SHARED: pierwsza odmowa autoryzacji wymaganego dodatniego nowego finansowania botów siedzącemu graczowi z powodu jego SLOW utrwala trigger stołu i deadline+30min; samo zero bez kosztu nie wystarcza. Wielostołowość S1-A zatwierdzona, nie marker FAST7dni. [D,E]
- **FR-014**: DRAINING zakazuje nowych ludzi i wszelkiego nowego finansowania SYSTEM botów. Dotychczasowi ludzie i już finansowane stacki mogą grać w grace; dobrowolne odejście z wypłatą działa. [E]
- **FR-015**: Od deadline nie zaczynać następnej ręki; żywą dokończyć i rozliczyć, następnie terminal close z legalnym cash-out ludzi, udowodnionymi źródłami zwrotu botów i zerowym escrow. Dopuszczone wcześniejsze bezpieczne zamknięcie po odejściu ludzi. [E]
- **FR-016**: Sprawdzać globalne zdarzenie i deadline przy admission, przed nowym funding oraz przed każdą kolejną ręką/prepare/commit także bez fundingDelta. Restart, leave, reconnect i reset fast nie usuwają powiązań; HUMAN_ONLY i istniejące SLOW_SHARED wyłączone z tego drain. Bez kicka/przerwania ręki; brak finansowania 100/500 nie zapętla rollover. [E, P1]
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
- **Klasa stołu**: STANDARD/SLOW_SHARED/HUMAN_ONLY, wspólny slow, niezależne sticky wygaszanie.
- **Pula tieru/klasy**: źródło SYSTEM, płynne i aktywnie zaangażowane środki, przydział 90/10.
- **Dowód zamknięcia i emisji**: fundings/returns, strata netto, kompensacja, okres i limity emisji.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: W krytycznych scenariuszach granicznych i współbieżnych zero przekroczeń 100 jednostek i 1 000 000 CH fast; suma slow w każdym kroczącym (t−12 h, t] ≤1, także dla ułamków i równoczesnych żądań.
- **SC-002**: Każda ścieżka nowego dopuszczenia odrzuca constrained do STANDARD/bot-only i do slow bez wystarczającego własnego allowance; zero podwójnych naliczeń tej samej ekspozycji po retry/reconnect. Lobby ma zero niedostępnych JOIN/Unavailable; normalny MATCH z jednym stale kandydatem i dostępnym drugim celem kończy się bez ręcznego ponawiania, ≤2 próby i ≤1 create; realny brak warunków daje zero pozornych create.
- **SC-003**: Zero nowych ludzi/fundingu po DRAINING; zero następnych rąk rozpoczynanych od deadline; każda prawidłowa żywa ręka i wypłata zachowana.
- **SC-004**: Zero przekroczeń 100 000/500 000/600 000 CH i limitów klas w każdym kroczącym (t−168 h, t]; zero emisji uzasadnionej wyłącznie otwartym escrow; zero finansowania standard ze środków zarezerwowanych slow.
- **SC-005**: Każdy refill i terminal return ma dokładny audyt źródła i idempotencji; ponowienie nie zmienia kwot; niepełny dowód daje zero refillu.
- **SC-006**: Przed aktywacją dostępne są przypisane do środowiska dowody Stage oraz exact-SHA WS Preview i potwierdzony smoke. Brak dowodu oznacza status oczekiwania, a nie gotowość do wydania.

- **SC-007**: Fundamentalne scenariusze potwierdzają bounded/coalesced odczyty bez viewer×table, brak create przy failed/stale proof, completed zakres K przy inventory>K bez ręcznej kontynuacji oraz poprawny settlement/recovery bez zależności od refillu. Przyszła bramka Q1/T038 mierzy RT/rows/bytes, CPU/I/O/WAL/locks i latency baseline vs implementacja; bez niezmierzonych SLO. [D.3]

## Assumptions

- D.2 zatwierdzone; #789 OPEN potwierdzone w GitHub 2026-09-25. D.2 i D.3 są zatwierdzone; spectator to wyłącznie osobna przyszła funkcja. P1 obejmuje koszt graniczny i wiarygodny descriptor WS zapisany w istniejącym receipt; P2 pełną zgodnością parametrów, bez zmiany zasad slow.


- Autorytet wymagań: aktualne issue z 2026-09-25 (updatedAt w issue-source.md); konstytucja 1.1.1; aktualny kod GitHub wskazany w issue-source.md. Podane limity to zatwierdzony pilot, nie prognoza inflacji.
- Konkretny zakres istniejący: `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `bots.mjs::seedBotsForJoin`, `table-economy.mjs::getBotFundingSystemKeyForBuyIn`, `terminal-close.mjs::resolveBotFundingSource/executeTerminalPokerCloseInTx`; `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover` i właściwość `allowBotFunding`; writer `writeMutation/writeReplacementFundings/writeManagedBotTopUps`; `poker_tables.rotation_due_at`. Szczegóły techniczne znajdują się w plan.md.
- Nie zmieniać reguł gry, obliczania wygranych, progresji bankroll użytkownika ani gościnnego trybu bez ekonomii. Nie planować nowych testów UI/CSS/JSP ani nowych frameworków.


## Zatwierdzona korekta D.1

Issue updatedAt2026-09-25T21:18:32Z: obowiązuje WS-only inventory/wybór, shared SLOW; projekt techniczny podlega review bez benchmarków SQL jako bramki; wcześniejszy problem ręcznej kontynuacji nie jest otwartą decyzją.

### Otwarte decyzje do niezależnego review

- **S1-A zatwierdzony:** tylko stół A z odmową autoryzacji rzeczywiście potrzebnego dodatniego nowego finansowania botów przechodzi w DRAINING. Inne stoły działają do własnej potrzeby takiego finansowania; zero allowance bez nowego finansowania nie wyzwala drain. Globalny FAST bez zmian.
- **Q1:** wybór najmniejszego dowiedzionego źródła dostępności i zmierzonych granic odczytu. Plan porównuje SQL/batch, registry WS i minimalną projekcję. Brak DB pomiarów podczas tej korekty; niezależne review i przyszła walidacja wymagane przed zamrożeniem rozwiązania.

Acceptance SLOW: dwóch ludzi dostaje po0,5 exposure z jednego FUNDING50CH/T100; zero dodatkowego USER debitu. Gdy siedzący człowiek nie mieści rzeczywiście wymaganego dodatniego kosztu, stół ma jeden pierwszy trigger i sticky+30min. Sam zero limit bez nowego kosztu nie przerywa gry. Po zużyciu0,4+0,6 godzinę później odnowienie0,4 po12h nie usuwa drain; pełna1 po13h. Równoczesne odmowy nie przesuwają czasu, brak partial funding, bieżąca ręka i legalne wypłaty zachowane. Dwa stoły sprawdzić według zatwierdzonego S1-A.

### Doprecyzowanie zatwierdzonego S1-A

Trigger SLOW wymaga rzeczywiście potrzebnego dodatniego **nowego finansowania botów** i odmowy jego indywidualnej autoryzacji siedzącemu graczowi z powodu limitu SLOW. Sam nowy dostęp do wcześniej sfinansowanego stacku nadal wymaga EXPOSURE, lecz bez nowego finansowania nie wyzwala tego drain. A otrzymuje pierwszy trwały receipt i deadline+30min; B bez nowego finansowania działa dalej. B przy własnej potrzebie finansowania sprawdza wspólny rolling12h i przy odmowie otrzymuje swój pierwszy deadline. Zero dostępnego limitu bez potrzeby finansowania nie zatrzymuje gry. Receipt SLOW_EXPOSURE_DENIED zachowuje nazwę i atomowość; jego required cost/plan musi wskazywać dodatnią rzeczywistą fundingDelta. Globalny FAST, wypłaty i pozostałe reguły bez zmian.

## Wiążące Q1 WS-first

FR-011/012/033/034: loaded/ready WS registry jest jedynym źródłem ordinary JOIN i wyboru Graj teraz; klient renderuje, Netlify nie wyszukuje SQL-wide. Persisted-only OPEN nie oferta. WS-only MATCH na istniejącym uwierzytelnionym transporcie; dowody DB bounded/coalesced, final join atomowy. Completed/current/ready scoped empty + pełny finance preflight pozwala≤1 create; bootstrap/stale/niepełna enumeracja/proof/transport error to unknown, zero create. T042-U historyczne, nie wykonywać. S1-A zatwierdzone. SC-002/007 obejmują te rozróżnienia i brak równoległego SQL inventory.
