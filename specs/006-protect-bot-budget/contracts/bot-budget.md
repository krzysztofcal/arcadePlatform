# Kontrakty — admission, funding, drain, refill

Normatywny projekt do review; D1–D3 z spec.md są zatwierdzone. Nazwy nowych pól/kodów są propozycją kontraktu implementacyjnego, nie opisem już istniejącego API. FR-001–032 pozostają autorytetem zakresu.

## 1. Koszt i tożsamość ekspozycji

Jednostka = 10000 podjednostek. Dla tieru T koszt q CH = q*(10000/T), dokładnie. Sumować cały plan udostępnienia, nie sprawdzać tylko pierwszego bota. Fast jest dopuszczalny tylko gdy oba limity mieszczą cały koszt; brak mieszania fast+slow w STANDARD.

**Lineage** oznacza ciąg udowodnionego stacku bota: seed rozpoczyna ciąg; replacement z zachowanym oldStack>0 dziedziczy lineage; replacement od zera i managed top-up dodający nowego bota tworzą nowy ciąg. Identyfikatory wynikają z istniejących seed/replacement transactions i state versions, nie z przysłanego UUID. Ledger provenance nadal wymaga dokładnego źródła; lineage nie jest przypisaniem żetonów gracza do bota.

| Zdarzenie | Autoryzowana ekspozycja per człowiek | Transfer CH |
|---|---|---|
| Pierwsze admission użytkownika do lineage | Pełny aktualny stack tego bota w authoritative snapshot | Zero dla już finansowanych botów |
| Ten sam istniejący seat: retry/reconnect/reload | Zero; odczyt committed result i access watermark | Zero powtórnego buy-in |
| Nowe funding przy obecnych eligible humans | Każdy niezależnie całą fundingDelta, razem z nowym funding sequence | SYSTEM→ESCROW tylko raz |
| Replacement z residual | Tylko fundingDelta; reszta tego samego ciągu nie naliczana ponownie | Tylko nowa delta |
| Bot-only bez humans | Zero user charge; funding fact zachowany na przyszłe admission | Właściwa STANDARD rezerwa, bez MINT |
| Nowe admission powracającego użytkownika do wcześniej autoryzowanej lineage | Jeśli brak nowych funding events od jego watermark: zero. Jeśli są: min(aktualny stack, suma nieautoryzowanych fundingDelta od watermark). Jest to konserwatywne pokrycie nowej dostępnej ekspozycji; nie dolicza utraconego, już nieobecnego stacku ani całego residual ponownie. | Zero nowego mint; własny USER buy-in zgodnie z istniejącym rejoin/leave kontraktem |

Pierwsze admission sumuje bieżące bot stacks i plan nowych seedów. Po COMMIT access watermark obejmuje funding sequence tego snapshotu. Aktualizacja watermark jest atomowa z charge, również gdy min wynosi zero, a cała nowa ekspozycja już zniknęła przed powrotem. Wzrost stacku od normalnych wygranych przy ciągłym uczestnictwie nie jest nowym funding; kolejna ręka nie nalicza ponownie. Nowy człowiek zawsze płaci pełny aktualny stock. Inny stół/nowa lineage nie dziedziczą starego watermark. Przy nieudowodnionym lineage/source odmówić nowego dostępu, nie zgadywać.

FUNDING jest zdarzeniem stołu/bota dla jednego transferu SYSTEM → ESCROW; user_id=NULL jest dozwolone także przy wielu ludziach. createdBy/inicjator to audyt operacji, nie właściciel finansowania. Trwały funding key/receipt jest wspólny dla wszystkich korzystających graczy; nie wykonywać transferu ponownie dla każdego z nich. EXPOSURE wymaga niepustego user_id oraz trwałej tożsamości finansowania lub udostępnionego stacku, a samo naliczenie nie zapisuje debitu USER.

EXPOSURE unique: user + stabilna authoritative admission/funding identity; policy_version jest audytowanym atrybutem, **nie częścią klucza pozwalającą naliczyć event ponownie**. Zmiana polityki nie resetuje unikalności/access watermark. Kolizja key z innym payload to conflict. RequestId jest tylko transportowym replay; backend generuje authoritative identity. Przy replay przed każdym reserve debit/credit odczytać trwałą decyzję; ponowiony ledger receipt nie wykonuje ponownie mutacji puli. Nie zwracać limitu po porażce bota, odejściu ani końcu okresu; reset okresu dotyczy used counters, nie historii dostępu.

**Przykłady krytyczne**: 100 CH seed w T100 to 10000 podjednostek; 1 CH delta w T500 to 20; replacement 99→100 w T100 to 100; dwóch ludzi i delta 10 CH kosztuje każdemu 1000 podjednostek, lecz tylko 10 CH transferu. Admission do trzech pre-funded botów po 100 wymaga trzech jednostek, więc slow burst 1 nie wystarcza.

### Kroczące slow — D1 i częściowe zużycie P1

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

Pod blokadą konta odczytać trwałe EXPOSURE z budget_mode=SLOW, result=COMMITTED, consumed_at i kosztem integer. Dostępność jest wyliczana jako 10000 minus suma w oknie, nie przechowywana jako odnawiany grant. DENIED/replay nie zużywa ponownie. Czas UTC t pobierać z DB po uzyskaniu blokady (nie transaction-start sprzed oczekiwania); kontrola cofnięcia zegara ma blokować nowe zużycie. Retry zachowuje pierwotny receipt/czas. nextEligibleAt oznacza najwcześniejsze wygaśnięcie dostatecznej sumy dla konkretnego żądanego kosztu; wygaśnięcie 0,4 nie obiecuje pełnego bota.

Fundamentalny przykład: 0,4 jednostki w t0 i 0,6 w t0+1 h. Tuż przed t0+12 h dostępne 0; dokładnie w t0+12 h dostępne tylko 0,4; pełne 1 dopiero w t0+13 h, o ile nie było nowego zużycia. Dwa równoczesne żądania o pozostałe 0,4 przy różnych tierach mogą łącznie zużyć najwyżej 0,4. Przełączenia fast/slow i sesji nie usuwają drugiego kosztu.

## 2. Macierz dopuszczenia

| Kontekst konta | STANDARD | SLOW_SHARED | HUMAN_ONLY |
|---|---|---|---|
| Wystarczający FAST | Nowy JOIN po pełnym proof | Istniejący uprawniony uczestnik może kontynuować wyłącznie z własnym SLOW, bez przeklasyfikowania | Tak, bez botów |
| Constrained, dostępny SLOW | Nie | Wielu ludzi, każdy własny rolling12h i pre-funded exposure | Tak |
| Brak wymaganego allowance/proof | Brak nowego funded JOIN | Brak nowego funded JOIN; siedzący trigger według S1 | Legalne wejście bez botów po zwykłej autoryzacji |
| Własny już zatwierdzony seat | RESUME także legalnej kończącej ręki/wypłaty | Analogicznie | Analogicznie |

FAST_EXHAUSTED utrzymuje constrained do kolejnego okresu fast; istniejące drain jest sticky. Odnowienie fast nie resetuje slow historii ani nie zmienia klasy stołu. Creator nie jest właścicielem botów ani praw dostępu. Final admission zawsze serwerowe; guest poza ekonomią CH.

### D.1 — projekcja gracza i find-or-create

Normatywny przebieg: końcowa sekcja D.1 tego kontraktu. Wspólny SLOW_SHARED, automatyczne parametry i pasywne lobby zastępują wcześniejszy formularz/owner-only model.

### P1 — wspólny bezpieczny koszt graniczny seed

Wybrany kontrakt: preflight nie losuje. W istniejącym `shared/poker-domain/bots.mjs` współdzielić wyliczenie górnej granicy używanej przez `computeTargetBotCount`: dla uprawnionego seed po przyjęciu człowieka U = max(0, min(maxBots, maxPlayers − humanCountAfterJoin)); zachować istniejące warunki enabled/tier/shouldSeedBotsOnJoin i normalizację liczb. HUMAN_ONLY ma U=0; SLOW_SHARED ma deterministyczny target 1 w dozwolonej pojemności. Gdy seed nie jest dozwolony, nowy koszt seed=0, lecz istniejący pre-funded stock nadal wymaga autoryzacji exposure.

Preflight używa tego samego snapshotu seats, buy_in/canonical stakes, klasy i cfg co obliczenie kosztu: maksymalna liczba nowych botów = max(0,U−existingActiveBotCount), ograniczona rzeczywiście wolnymi miejscami po human admission; sprzeczny snapshot oznacza brak rekomendacji. Maksymalny SYSTEM debit to ta liczba × buy_in. Do kosztu ekspozycji nowego człowieka dodać udostępniony dotąd nieautoryzowany stock według §1 kontraktu; nowy funding autoryzować niezależnie każdemu eligible human. Preflight sprawdza pełną granicę względem allowance i właściwej rezerwy, a nie pojedynczy wylosowany mniejszy wariant. Nowy stół oceniany jako pusty INIT z jednym przyszłym człowiekiem i rozwiązanymi przez serwer maxPlayers/tierem/klasą.

`executePokerJoinAuthoritative` ponownie odczytuje warunki pod lockami, oblicza tę samą granicę, następnie wybiera faktyczny target w jej zakresie przez istniejące computeTargetBotCount i przekazuje jawny targetBotCount do `seedBotsForJoin`. Seeder nie losuje ponownie, gdy otrzymał autoryzowany target. Finalny debit i EXPOSURE dotyczą tylko rzeczywistego nowego fundingu, nigdy całej granicy. Przy niezmienionych warunkach losowość nie może zwiększyć kosztu ponad preflight; rzeczywista zmiana cfg/seats/stacków/puli/budżetu nadal wymaga recheck i może uruchomić zatwierdzony bounded rematch. Brak zgodności konfiguracji/capability między projekcją WS a join oznacza brak oferty. Limit 2 prób/1 create pozostaje.

Fundamentalny scenariusz deterministyczny: STANDARD 100 CH, maxPlayers=6, pierwszy human, minBots=2/maxBots=3, brak starych botów, allowance wystarczające, pula STANDARD=250 CH. Granica wynosi 300 CH: preflight nie rekomenduje/nie tworzy funded stołu niezależnie od RNG wybierającego 2 lub 3; zero transferów. Przy puli 300 CH preflight dopuszcza, join z kontrolowanym RNG może wybrać 2 albo 3 i zawsze mieści się w zatwierdzonej granicy, księgując odpowiednio tylko 200 albo 300 CH. To jeden scenariusz graniczny z wariantami, nie nowy szeroki suite.

Celowy koszt prostoty: granica może odmówić nowego finansowanego dostępu, choć mniejszy losowy target mieściłby się w puli. Komunikat mówi o braku środków na wymagany bezpieczny plan; nie zmienia limitów ekonomii, liczby prób ani nie dopisuje rezerwacji/nowych pól DB.

### P2 — zgodny reuse własnego pustego INIT

Reuse jest deduplikacją tworzenia, nie prawem właściciela do wspólnego stołu. Pod guard konta/operacji i table/state locks wymaga created_by=auth account, OPEN+INIT, brak seats, roszczeń, escrow, drain/pauzy, zgodnej klasy, tier/buy_in, **maxPlayers**, canonical sb/bb oraz lifecycle/policy/capability. Dla automatycznego create porównuje się parametry rozwiązane przez serwer; dla istniejącej widocznej oferty obowiązują jej faktyczne parametry. Niezgodny INIT pomija się bez relabel, automatycznego zamykania lub nadpisania. Pełny preflight nadal obowiązuje. SLOW_SHARED nie ma unique otwartego stołu na twórcę ani owner-only admission; deduplikacja in-flight konta/operacji i limit1 create pozostają.

Fundamentalny scenariusz: INIT2 nie jest reuse dla planowanego nowego stołu6 ani niezgodnych stakes; można znaleźć inny zgodny cel/utworzyć≤1 stół wszystkich klas. Wybranie istniejącego widocznego stołu2 nie jest takim reuse i prawidłowo używa jego parametrów. Nie zmieniać ekonomii historycznego stołu.

### D.2 — istniejąca administracyjna inspekcja (read-only)

D.1 filtruje wyłącznie lobby gracza/Quick Seat/JOIN/RESUME. `netlify/functions/admin-tables-list.mjs::listTables` zachowuje inventory wszystkich utrwalonych poker_tables, istniejące filtry OPEN/CLOSED/ALL, sortowanie i bounded pagination (domyślnie20, max100), bez eligibility/budżetu admina, capacity lub player lobby filter. `admin-table-details.mjs::loadTableDetails` zachowuje odczyt dowolnego utrwalonego tableId po `requireAdminUser`; nie zmienia allowlist/auth i 401/403. Nie obejmuje automatycznie procesowych guest tables nieobecnych w inventory.

Minimalnie rozszerzyć SELECT i bezpieczną projekcję `netlify/functions/_shared/admin-ops.mjs::loadPersistedTableSnapshots/createTableMeta` (używane również przez loadPersistedTableSnapshot), listTables i loadTableDetails: botAccessClass z bot_access_class (STANDARD/SLOW_SHARED/HUMAN_ONLY; brak → jawne LEGACY/unknown), botDrainingStartedAt i botDrainingDeadlineAt z utrwalonych pól, odrębny botDrainingActive. OPEN+udowodnione drain daje active=true; CLOSED zachowuje historyczne daty, active=false; brak kompletnego dowodu → unknown, nie „brak drain”. Przy opóźnionej projekcji fanout odczytać najwcześniejszy trwały FAST_EXHAUSTED powiązany ze stołem i zastosować ten sam min/original+30 jako czystą projekcję, bez naprawiania DB w GET. Nie zmieniać status/persistedStatus OPEN/CLOSED ani phase/lifecycle; nie zgadywać klasy z liczby botów. Timestampy prezentować jawnie z timezone.

`js/admin-page.js::renderTables/renderTableDetail` pokazuje te pola w istniejącej liście i szczegółach, bez osobnego panelu. Nie wysyłać raw poker_state, prywatnych hole cards, sekretów ani allowance innych kont; istniejące action meta/cashout metadata przechodzą bezpieczną allowlistę/redakcję, jeżeli mogłyby ujawnić takie dane. Inspekcja nie wykonuje join/funding/akcji/lifecycle i nie daje dodatkowego seat ani wyjątku FAST/SLOW. Admin grający używa zwykłego autorytatywnego admission. Brak żywej subskrypcji spectator; [#789 — Poker: Spectator Mode](https://github.com/krzysztofcal/arcadePlatform/issues/789) to osobna przyszła funkcja (OPEN; odrębny zakres przyszłej funkcji).

Fundamentalne testy: dodać przypadki list/details i auth/projection do istniejących `tests/admin-tables-list.behavior.test.mjs`, `tests/admin-table-actions.behavior.test.mjs` i `tests/admin-auth.behavior.test.mjs`: non-admin odrzucony; admin z wyczerpanym fast widzi wszystkie persisted klasy/statusy w wybranym filtrze i poprawną paginację; szczegóły dają class/unknown i osobny drain/original deadline, bez prywatnych kart/allowance i bez zapisów. W istniejącym join behavior potwierdzić brak admin bypass. UI admina/lobby wyłącznie ręcznie na przyszłym Preview.

### P1 — autorytatywna konfiguracja seed WS

MATCH i preflight wykonuje teraz WS: ten sam getBotConfig snapshot/granica dla projekcji, selekcji i final join. Szczegóły Q1 poniżej; Netlify cfg nie jest autorytetem. Zachować actual-only debit i recheck pod locks.

## 3. Protokół i błędy

W istniejących payloadach dodać minimalne `botAccessClass`, `botAccessMode` (FAST/SLOW/HUMAN_ONLY), `botDrainingDeadlineAt`, własne `nextEligibleAt` oraz `botBudgetPolicyVersion`. Stół i klasę wyznacza serwer. Nie wysyłać foreign user budget ani informacji pozwalających wnioskować o jego CH.

Nowe powody: `bot_budget_insufficient`, `bot_slow_not_ready`, `bot_table_class_incompatible`, ``bot_table_draining`, `bot_pool_unavailable`, `bot_funding_proof_missing`, `bot_policy_unavailable`. Adapter mapuje je na istniejącą strukturę `ok:false/code` i trwały wynik próby MATCH (odmowa kandydata nie jest jeszcze końcem całej operacji), bez zmiany normalnych snapshotów/settlement. `nextEligibleAt` tylko gdy znany i policzony według D1/fast cadence; brak dowodu/liquidity nie ma fikcyjnego terminu. Neutralny opis i available alternatives HUMAN_ONLY / wspólny slow / STANDARD gdy ponownie dostępny. Nie ujawniać wewnętrznego SQL ani sekretów.

Capabilities: rozszerzyć istniejący `checkWsBuyInCapability` i wewnętrzny materialize o zgodną wersję polityki, bez uznania v2 buy-in capability za zgodność #869. Domyślnie brak polityki wyłącza nowe chronione admission/funding; zachować recovery/settlement legacy.

## 4. Atomowe decyzje i drain

Join: table/state/seat locks → użytkownicy w stabilnej kolejności → pool lock → obliczenie i autoryzacja pełnego planu → existing postTransaction/seat/state/access writes → commit → runtime snapshot. Rollover: ten sam lock order i expectedVersion, receipts muszą odpowiadać przygotowanemu batchowi. Odmowa któregokolwiek uczestnika nie może pozostawić częściowego finansowania innych botów.

Drain jest trwałym wynikiem odmowy dalszej ekspozycji istniejącego człowieka albo osiągnięcia dokładnego zera fast. Deadline=first decision time+30 min. Wycofanie niedozwolonego kandydata nie może wycofać samego zapisu drain. Decyzja DENIED/DRAIN może zostać zatwierdzona bez zmiany stacków/budżetu; serwer nie traktuje jej jak committed rollover. Replay pierwszego triggera zachowuje czas.

Przed deadline istniejące funded bots mogą grać. Od deadline blokada start_hand/bootstrap/prepare/commit; żywa ręka zachowuje timery i settle. Terminal close dopiero na bezpiecznej granicy (SETTLED/INIT bez żywej ręki i bez nierozliczonych roszczeń), w tej samej ścieżce zero-escrow i source proof. Brak profilu managed/obecny human nie odracza drain. Brak budżetu/puli nie blokuje istniejącego hand settlement.

### Globalne wyczerpanie fast — P1

Pierwszy zatwierdzony FAST_EXHAUSTED jest faktem konta, unikalnym dla (user_id, fast_period_start), z exhausted_at. Powstaje przy dokładnym wyczerpaniu któregokolwiek limitu fast po ostatniej legalnej ekspozycji lub pierwszej odmowie wymaganej ekspozycji z powodu niewystarczającego fast. Nie tworzyć go z powodu braku płynności ani arbitralnego progu pełnego buy-in. Pozostaje constrained do kolejnego okresu fast; nowy okres nie usuwa historycznego zdarzenia ani drenujących stołów.

W tej samej transakcji zapisać trwałe powiązania zdarzenia ze wszystkimi już zajętymi przez konto stołami STANDARD z botami, także pre-funded B bez żądania fundingu; uwzględnić nowy seat, jeśli ostatnia legalna ekspozycja go zatwierdza. Snapshot obejmuje leave_after_hand aż do rzeczywistego opuszczenia. HUMAN_ONLY i istniejące SLOW_SHARED są wyłączone z tego wyłącznie FAST-triggered drain. W audycie pozostają table_id i admission identity; późniejsze leave, usunięcie seat lub reset fast nie gubią obowiązku wygaszenia.

Zmiany członkostwa w `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `leave.mjs::executePokerLeave` i deferred leave finalizer oraz cleanup/writer muszą użyć tego samego guard konta: table → state/seats → posortowane konta → pool → ledger. Snapshot innych członkostw czytać po uzyskaniu guard w świeżym odczycie READ COMMITTED; nigdy blokować B podczas trzymania A/konta. Każdy zapis/usunięcie członkostwa musi być zinwentaryzowany, także terminal cleanup. Serializacja na guard zapewnia kompletną listę w chwili zdarzenia bez blokad wielu stołów naraz.

Po commit uruchomić istniejące `ws-server/server.mjs::enqueueTableCommand` dla powiązanych stołów, po jednym stole/transakcji. Restart/sweep ponawia nieprzeniesione powiązania. Fanout jest projekcją: autorytatywny DRAINING obowiązuje od exhausted_at nawet przed zapisem lokalnej meta. Każde admission (także przed seated rejoin early return), nowe finansowanie i każdy start_hand/bootstrap/prepare/commit rollover odczytuje trwałe powiązania dla stołu i konta. Recheck w `persisted-state-writer.mjs::writeViaDb` obejmuje również pusty funding plan; sama kolejka per-table ani cache WS nie wystarczą. Final gate blokuje posortowane konta wszystkich obecnych ludzi i utrzymuje guard do commit nowej ręki nawet przy zerowym funding; odczyt po guard widzi konkurencyjny COMMIT FAST_EXHAUSTED. Powiązania historyczne sprawdza również po odejściu konta. Serializacja rozstrzyga race A-exhaustion/B-start: zatwierdzona wcześniej ręka pozostaje żywa, późniejsza podlega oryginalnemu deadline. Brak dowodu blokuje nową rękę/dostęp/funding, zachowując settlement.

Deadline to najwcześniejsze właściwe exhausted_at + 30 min, nigdy czas lokalnego wykrycia. Projekcja może zostać skorygowana wyłącznie do wcześniejszego udowodnionego zdarzenia, nigdy wydłużona; identyfikator źródłowego zdarzenia pozostaje w audycie. A wyczerpane w t0, B wykryte w t0+20 min: B ma deadline t0+30 min; wykryte po nim nie zacznie ręki. Trwająca ręka kończy się normalnie, bez automatycznego kicka, z poprawną wypłatą. Już sfinansowane boty mogą grać tylko w grace, bez dalszego finansowania.

## 5. Finanse i refill

MINT wywołuje wyłącznie backend po aktywacji polityki. Contract input: tier, class, durable proof identity; **kwotę, źródło, okres i pozostałe limity wylicza backend pod lockiem**, nie przyjmuje autorytatywnie od klienta. Odrzucić źródła poza zatwierdzonymi pulami, dowolny USER credit, brak GENESIS debit, niezerową sumę, brak dowodu/policy lub powtórny proof allocation.

Netlify ledger potrzebuje wąskiego wewnętrznego kontraktu dla SYSTEM-only MINT oraz zatwierdzonej INITIAL_ALLOCATION/REBALANCE; ogólne `chips-tx` nie przekazuje tej capability i nie może bezpośrednio obciążać chronionych pul. WS TABLE_BUY_IN adapter współdzieli transakcyjną ochronę pool state. Wszystkie transfery chronionych kont muszą aktualizować właściwy stan rezerwy; metadata klienta nie wybierają klasy.

Refill receipt zawiera kind, event_key, timestamp, policy, proof IDs, source/target, amount, ledger transaction/hash i zaktualizowane limity. Powtórzenie zwraca dokładny wcześniejszy wynik. Zyski zamkniętych stołów kompensują straty w signed sum; zgadywana atrybucja indywidualnych winnings jest zakazana. Aktywne commitment pozostaje w kapitalizacji. Headroom używa konserwatywnej górnej granicy max(committed cost, pełne escrow) każdego otwartego stołu, w spójnym serializable odczycie z refill; pełne escrow służy tylko ograniczeniu headroom, nigdy udowodnieniu straty. Brak kompletności = zero; żadnej emisji z samego spadku live liquidity ani obrotu bot-only.

### Krocząca emisja i pierwsza alokacja — D2–D3

D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.

D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Global emission guard → pool → receipts/accounts; wszystkie klasy i tiery uczestniczą w tej samej serializacji. Czas UTC t pobierać po blokadzie, przy niekompletnym dowodzie lub cofnięciu zegara odmowa emisji. Serializable snapshot sprzed oczekiwania na guard nie może pominąć konkurencyjnego receipt: zapisywać version globalnego guard w każdej emisji i ponawiać całą transakcję po serialization conflict. Autoryzacja, kompensacja proof, receipt i double-entry MINT commitują razem. Liczniki są projekcją as-of t; suma trwałych REFILL receipts jest źródłem prawdy. Granica issued_at=t−168 h uwalnia dokładnie tę emisję; młodsze pozostają. INITIAL_ALLOCATION ma osobny audyt podaży, nie konsumuje ani nie odnawia cap REFILL. Schema tworzy konto z zerem; alokacja przy jednym kredycie 1 000 000 CH ustawia obie rezerwy atomowo. Powtórzenie lub równoczesne wywołanie zwraca istniejący rezultat bez drugiego kredytu.

Fundamentalne testy: tuż przed/na/po 168 h; równoczesne 100/500 i STANDARD/SLOW przy ostatnim headroom klasy/tieru/global; restart i utracona odpowiedź; proof/receipt retention; brak podwójnej emisji na granicy kalendarzowego tygodnia; INITIAL_ALLOCATION retry i race dają jeden milion oraz dokładne 900000/100000, osobno od REFILL. Żaden test nie wykonuje Production GO.

Żaden reset allowance nie wywołuje przelewu.

## 6. Minimalny audyt

Klog: user-budget decision (account/table/event/version/mode/cost/reason), drain first/deadline, funding committed/denied (tier/class/source/receipt), close proof (terminal version/net/return/escrow), refill (proof/amount/limits/idempotency), proof unavailable. Bez tokenów, prywatnych kart, sekretów i nadmiarowego logowania ręki. Finansowym dowodem jest trwały ledger/event, nie sam klog. Istniejąca możliwość kopiowania logów pozostaje.

## D.3 — kontrakt pracy i degradacji

Normatywne bezpieczniki D.3 opisuje plan.md; dla discovery otwarta Q1 wymaga planów zapytań i zmierzonych skończonych K/L/B/C/D, bez arbitralnego100. Jeden in-flight refresh/konto, brak viewer×table SQL,≤1 WS envelope/próbę jeśli zatwierdzono B1,2 admission/1create. Completed scoped dobór po click może prowadzić do create po pełnym preflight; failure/stale/timeout/niepełny proof nigdy. D.3 obciążenia nie jest D3 jednorazowej alokacji.

Lobby private facts na dirty konto raz w scalonym refresh (max1 in-flight/account, max2/proces), registry publiczne w pamięci; table event nie wywołuje SQL viewer×table. Admin drain projection jest jednym batchem całej istniejącej strony, bez player filtering. Gorący join/final hand gate zbiorczo czyta tylko index-backed konto/stół, z tym samym lock order i exact evidence. Timeout wycofuje nową decyzję; nie akceptować częściowych sum slow/168h. Wypłaty nadal wymagają swoich poprawnych dowodów, nie mint work.

Refill coalesced pending tier/class po terminal commit: max1 global próba,1 klasa/cykl, cooldown/backoff i skończona praca według planu; pełna kapitalizacja i caps albo zero emisji. Pending zachowane, brak ciężkich skanów na każdy tick/close. Opcjonalna praca ustępuje settlement/cash-out/admin; DB outage oznacza recovery, nie obietnicę wykonanej wypłaty. Granice startowe planu to bezpieczniki do pomiaru, nie SLO. Przed aktywacją wymagane baseline vs implementacja z quickstart, istniejące guards #962 i osobny Production GO.

D.3 close fallback: CLOSE_PROOF_PENDING jest trwałym faktem końca, nie dowodem straty. Zwrócone CH aktualizują liquid/quarantine atomowo z legalnym close; committed cost i signed loss rozlicza dopiero kompletny CLOSE_PROOF bez ponownego kredytu liquid. Indeksowany pending_close_count blokuje REFILL całego tieru, aby nie pominąć możliwych zysków zamkniętego stołu. Final proof i zmniejszenie pending są idempotentne pod pool lock; zachować źródła do rekonsyliacji. Szczegóły w data-model.md §D.3, realizacja T006–T007/T028/T030–T033.

### D.3 — FIFO, terminal close i recovery

Normatywne granice transakcji i kolejki opisuje plan.md w sekcjach „FIFO i oddzielenie opcjonalnej pracy” oraz „transakcja terminal close i odzyskiwanie dowodu”. Kolejka createTableCommandQueue pozostaje FIFO. Lobby/search/refill i ciężka rekonsyliacja działają poza kolejką i table/settlement locks; final join/rollover pozostaje atomowy. Timeout finalnej nowej operacji kończy rollback przed zwolnieniem komendy, bez pętli; istniejąca ręka/settlement nie zależy od nowego fundingu. Nie obiecywać wyprzedzenia już zakolejkowanej komendy.

Full proof wybrać tylko z gotowych kompletnych bounded dowodów, inaczej pending przed dodatkowym SQL. Zwrot CH, liquid/quarantine, terminal CAS/CLOSED oraz proof lub pending+counter są jednym outer COMMIT. Każdy SQL error/timeout certyfikatu albo pending/counter wymaga rollback całego close; fallback dopiero w nowej kontrolowanej transakcji przez istniejący cleanup/janitor. Nie publikować CLOSED przy braku trwałego blocker. Unknown COMMIT wymaga odczytu stanu/keys/proof przed retry.

Oba proof używają istniejącej kolumny to_state_version, wartości terminal CAS zgodnej z cash-out keys; UNIQUE(event_kind,table_id,to_state_version). Pending i final mogą współistnieć jako dwa fakty tego samego close, final wskazuje pending_event_id. Full-direct ma tylko final. Kompensacja tylko po final, raz; finalizacja pending zmienia counters/committed/signed loss pod pool lock, bez ponownego liquid credit. Niepewny lub nierozwiązany pending blokuje tier refill. Testy T022/T033 potwierdzają FIFO, rollback i recovery bez double CH; nie zmieniają zasad payout.


### D.1 — pasywne lobby

Bez manual Create/formularza; pasywne subscribe/refresh/reconnect niczego nie tworzy. Wszystkie uprawnione tiery w JOIN, własne Resume osobno, zawsze Graj teraz. Dokładny WS-only przebieg, brak silent mode switch i awarie: Q1 poniżej.

### S1-A — lokalny drain SLOW (zatwierdzone)

SLOW_SHARED pozostaje multiplayer: każdy człowiek autoryzuje własne exposure, również pre-funded; jeden FUNDING nie powiela transferu per human. Seed najwyżej1 pełnego bota nie oznacza limitu jednego człowieka. Sam admission do wcześniej finansowanego stacku bez nowego finansowania lub zero allowance bez takiej potrzeby nie wyzwala drain.

Trigger dotyczy wyłącznie odmowy autoryzacji **rzeczywiście potrzebnego dodatniego nowego finansowania botów** siedzącemu graczowi z powodu jego SLOW. Nie wynika z konserwatywnego preflight, braku pool/capability/proof ani odmowy nowemu gościowi. Pod table/state/seats→sorted users→pool potwierdzić plan i dokładne rolling12h; atomowo utrwalić pierwszy SLOW_EXPOSURE_DENIED i drain przed funding/EXPOSURE/nową ręką. Receipt wskazuje dodatnią fundingDelta, czas DB po lockach i pierwszego odrzuconego user. Jeden trigger per stół; retry/równoczesne odmowy zachowują pierwszy czas. Błąd zapisu cofa decyzję i wymaga recovery, bez ogłaszania drain przed COMMIT.

A ma deadline pierwszego triggeru+30min; B bez nowego finansowania działa dalej i dopiero przy własnej potrzebie sprawdza wspólny rolling limit oraz ewentualnie ustala własny pierwszy deadline. Brak globalnego fanout/7-dniowego markera SLOW i dodatkowej relacji członkostwa. Globalny FAST pozostaje bez zmian. Drain jest sticky po odnowieniu/leave/reconnect/restart: brak nowych ludzi/fundingu, już finansowane stacki tylko w grace; żywa ręka i wypłaty kończą się legalnie, po deadline brak następnej ręki.

Fundamentalne kryteria: Adam+Bartek SLOW100,1 FUNDING50CH i2 EXPOSURE0,5, bez USER debitu exposure; odmowa rzeczywistej nowej delty jednemu seated human daje jeden trigger stołu. Zużycie0,4 w t0 i0,6 w t0+1h: brak nowego finansowania→brak drain; wymagane0,1 przed t0+12h→drain. Odnowione0,4 w t0+12h nie usuwa deadline, pełna1 dopiero t0+13h. Race kont/stołów bez partial funding; A/B lokalnie, nie według globalnego FAST.



## Q1 — zatwierdzony kierunek WS; projekt techniczny do review

Aktualne issue updatedAt2026-09-25T21:18:32Z rozstrzyga źródło listy: **wyłącznie loaded/ready activeLobbyTablesById/tableManager WS**. DB OPEN poza runtime nie jest ofertą i nie blokuje samym istnieniem create. Brak SQL-wide selectCandidate dla zwykłego lobby/MATCH; admin persisted inventory pozostaje. T042 SQL i T042-U historyczne, uzupełnienie wstrzymane bez autoryzacji; nie są bramką projektowania. S1-A zamknięte.

### Dokładny przebieg i właściciel decyzji

1. `poker/poker.js::initLobby` używa obecnego `poker-ws-client.js` hello/auth/lobby_subscribe. `server.mjs` zachowuje PROTECTED_MESSAGE_TYPES i REQUEST_ID_REQUIRED_TYPES, wymaga session.userId. `buildLobbySnapshotPayload/sendLobbySnapshot/maybeBroadcastLobbySnapshot` budują personalny JOIN/oddzielny własny RESUME; `renderTables` tylko renderuje, bez wyboru z własnego filtra. Publiczny snapshot, jeśli potrzebny innym odbiorcom, nie ujawnia personalnych dowodów.
2. WS z registry tworzy wspólny deterministyczny porządek humans-first,buyIn DESC,tableId ASC. Używa actual maxPlayers/stakes/live seats/class/drain/readiness, a DB zbiorczo dostarcza trwałe allowance/access/rolling usage/pool/proof i własne Resume. Brak DB viewer×table i brak SQL enumeracji OPEN kandydatów. Koszt nowych botów używa tego samego WS getBotConfig snapshot/granicy co final join, nie Netlify env. Nowe finansowanie musi być możliwe dla każdego już siedzącego człowieka; potrzebne dowody tych kont pobierać jako deduplikowany batch dla ograniczonego zakresu IDs, nigdy osobny query per table/human.
3. Proponowana **nowa komenda istniejącego protokołu**, nie istniejąca dziś capability: `lobby_match`, wysyłana przez `poker.js::quickSeat` → małe rozszerzenie publicznego API `poker-ws-client.js` o wrapper istniejącego sendCommand. Payload: operationId, intent AUTO, ostatnia server projection revision (wyłącznie wykrywanie stale). Żadnej klientowej listy IDs, własnej kolejności, tier/maxPlayers lub prawa create. requestId koreluje transport, operationId jest trwałe. server.mjs dodaje typ do auth/requestId allowlists i dispatchuje poza FIFO stołu.
4. WS odzyskuje receipt/in-flight konto pod istniejącymi DB guardami, odświeża potrzebny proof i wybiera pierwszy nadal zgodny cel z tej samej personalnej kolejności. Dla niezmienionej revision jest to pierwszy widoczny JOIN; dla zmienionej WS ponawia ocenę i wysyła nową projekcję w ramach tej samej akcji. SQL nie proponuje alternatywnego tableId. Po zapisaniu rekomendacji zwolnić opcjonalne locks/odczyty, następnie użyć istniejącej `enqueueTableCommand` → `handleJoinCommand` → `createAuthoritativeJoinExecutor` → `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`. Wąskie wydzielenie dotychczasowego dispatch join wewnątrz server.mjs pozwala wywołać go także z MATCH bez drugiego silnika. Adapter odpowiedzi zbiera wynik próby; pośredni DENIED nie zamyka promise lobby_match.
5. Final join ponownie sprawdza seat, runtime/version, klasę, sorted user allowance, FUNDING/EXPOSURE, pool/source/drain/cfg i receipt pod istniejącą kolejnością locks. Trwały DENIED ze stale celu może uruchomić jedną ponowną selekcję WS; maks2 admission/1create. Unknown commit/pending odzyskuje tę samą próbę, bez drugiego celu. Sukces MATCH zwraca obecnym `commandResult` terminal payload `{operationId,attemptNo,tableId,outcome:joined,admissionIdentity}` (kontrakt pól, nie pełny kod). Dopiero sukces powoduje navigateToPokerTable. `poker-v2.js::autoJoinSeat` przy takim kontekście wznawia już zatwierdzony seat przez istniejący join/rejoin, nie nowy buy-in; DB receipt rozstrzyga, session storage nie autoryzuje. DIRECT i RESUME pozostają przypięte.
6. Dopiero świadomy click z **complete/current/ready scoped no-offer** i świeżym pełnym preflight może wybrać najwyższy faktycznie grywalny tier zatwierdzonego trybu, canonical6/stakes, reuse zgodnego własnego INIT albo≤1 create. Propozycja minimalna: przenieść czysty `netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState` do wspólnego `shared/poker-domain/poker-table-init.mjs` (planowany plik), zachować re-export Netlify i użyć go z WS poprzez istniejący beginSqlWs w adapterze persistence. Helper ma wyłącznie SQL przez przekazane tx, bez zależności Netlify. WS create+recommendation receipt+account dedupe w jednym tx, bez fundingu; po commit `tableManager.ensureTableLoaded` i syncLobbyTable, potem final join z pkt4. Błąd materializacji→recovery tej samej identity, nigdy kolejny create. Nie publikować INIT jako dostępnego przed gotowością/proof. Lifecycle sprząta orphan INIT bez usuwania receipt.
7. `netlify/functions/poker-quick-seat.mjs::selectCandidate/recommendSeatAtTable/handler` przestaje być ścieżką doboru zwykłego gracza. Najmniejszy plan: stary HTTP Quick Seat zwraca strukturalne410/WS_MATCH_REQUIRED bez SQL discovery/create; klient korzysta wyłącznie z WS. Zachować osobny `poker-create-table.mjs`/admin backend z auth/preflight, bez ręcznego panelu zwykłego lobby. Brak HTTP WS endpointu, nowej trasy Caddy, DB projection/trigger lub nowej usługi. Caddy tylko jeśli przyszły review wykaże konieczność odmiennego transportu, nie bieżące zadanie.

### Kompletność, przeciążenie i replay

Projektowane ulotne pola projekcji: runtimeEpoch (nowe przy starcie), registryRevision, recipientProofRevision, scopeId, ready, complete, generatedAt. Nie są capability finansową. syncLobbyRegistry/table load/retire/seat/drain aktualizują revision; async wynik zatwierdzić tylko jeśli wszystkie wersje nadal zgodne. Bootstrap niegotowy, przerwana enumeracja, byte/time overflow, proof failure lub revision race→unknown/unavailable, zero create. Definiowany scope to ograniczony deterministyczny prefiks live inventory; complete oznacza ukończoną ocenę **tego scope**, nie całej DB. Nie wolno przemianować przypadkowo obciętego wyniku na complete. Wyjątkowy dodatkowy stół poza poprawnym scope pozostaje dozwolony, nie brak gwarancji dowolnego mnożenia stołów.

Coalescing:1 in-flight refresh/konto,1 aktywny MATCH/konto (również wiele kart); synchronizacja receipt przed drugim create; brak locka stołu podczas proof fetch. Dirty po budget/exposure/12h/7d boundary,pool/proof/cfg,seat/drain i reconnect. Publiczny table change nie wywołuje osobnych odczytów dla każdego viewer×table. Invalidacja usuwa niepewne JOIN natychmiast, odświeżenie w istniejącym sweep; zero nowego idle poll. Konfiguracja WS znormalizowana raz na decyzję i sprawdzona ponownie po locks; niezależne RNG nie może przekroczyć wspólnej granicy seed.

**Propozycja skończonych bezpieczników do review, nie zmierzone limity operacyjne:** jeden zakres≤32 live entries i≤32 JOIN,≤32KiB payload,≤320 distinct seated users (istniejący maxPlayers10),≤1000 wymaganych proof rows/128KiB jak wcześniejszy hot-path gate; brak pełnego proof→unknown.32 jest propozycją małego batch dla wszystkich klas/tiers, nie wynikiem benchmarku SQL ani zatwierdzonym capacity; review musi zaakceptować/zmienić ją przed implementacją. Jeden refresh/konto, max2 concurrent proof jobs/proces,2 admission/1create/operation; proof fetch≤1s, lock try/wait≤100ms, cała selekcja≤2s z odrzuceniem spóźnionych wyników i poprawnym rollback (bez zwolnienia aktywnej transakcji). Niedotrzymanie daje unavailable, nie create. Te wartości są bezpiecznikami propozycji, nie SLO; konieczna późniejsza T038 walidacja. DB koszt modelować jako kilka set-based RT kont/pul/access/receipts oraz istniejący join/create; actual RT/bytes i wszystkie potrzebne proofs zweryfikować fundamentalnym harness implementacji, nie obiecywać niezmierzonych liczb. Brak skanu ledger/inventory, brak ciężkiej pracy FIFO; settlement/cash-out nie czeka na matchmaking/refill.

### Review techniczne i breaking changes

Q1 kierunek zamknięty decyzją właściciela. Do review projektu pozostaje potwierdzenie skończonych bezpieczników powyżej i modelu działania przy jednym authoritative WS runtime. Aktualny kod pokazuje lokalny registry, nie globalny routing między procesami: jeśli wdrożenie ma wiele niezależnych runtime z rozłącznymi stołami, zakres lokalny wymaga jawnej akceptacji/routingu zanim można wdrożyć MATCH; brak dowodu topologii nie uzasadnia nowej usługi. Nie blokuje to zapisania niniejszego projektu; T043 to ten projekt + niezależne review, nie implementacja. Bez kolejnych benchmarków SQL jako bramki. T038 musi potwierdzić rzeczywiste koszty/świeżość/rozliczenia.

Breaking: stary HTTP Quick Seat410, nowy WS command/result i personalny lobby payload; stary klient nie może dostać fallback SQL. Usunięty manual Create, auto-join wykonany przed nawigacją i idempotentne Resume po niej. Po reconnect epoch mismatch odrzuca stare oferty, odzyskuje trwałą operację. SLOW_SHARED/migracje/drain/provenance i admin inventory bez zmian względem zatwierdzonego planu. JSP global/IIFE,klog,CSS jedna linia na selector,CSP SHA ewentualnego inline; tylko fundamentalne backend/runtime/transaction tests, UI ręcznie Preview.
