# Quickstart walidacji #869 — do przyszłej realizacji

Nie jest poleceniem wykonania w sesji planowania. Najpierw niezależne review, kontrola zgodności z zatwierdzonymi D1–D3 i P1, ponowne analyze i osobne zlecenie implementacji. Żadnych poleceń Git, seeda ani migracji Production w tym dokumencie.

## Bramki Q1 przed implementacją

Kolejność bramek: T002 analiza istniejących mechanizmów bez zmian środowiska → T042 osobno autoryzowane ograniczone pomiary w odizolowanym środowisku → T043 wybór rozwiązania na podstawie dowodów i niezależne review → T001 osobne zlecenie implementacji → T003 i dalsze zadania implementacyjne. Zgoda na review HEAD 3f5a128860ab3b26acc4f5560fe402676d9c4547 została udzielona; nie jest zgodą na pomiary ani implementację. T002/T042/T043 nie wymagają wcześniejszego zlecenia implementacji. T038 to późniejsza walidacja implementacji, nie warunek uzyskania dowodów przed wyborem Q1. Teraz żadnych pomiarów ani operacji środowiskowych.

## Prerequisites i setup implementacji

Istniejące Node 20 i zależności repozytorium; nie dodawać frameworków. Test transakcyjny używa dwóch niezależnych połączeń `postgres` do **odizolowanego lokalnego Postgres**, z fixtures utworzonymi wyłącznie tam. Specjalna konfiguracja testu musi jawnie odrzucać Stage/Production oraz brak identyfikacji lokalnego targetu. Nie uruchamiać istniejącego `test:chips`, który działa przez skonfigurowane zewnętrzne HTTP i nie dowodzi row-lock concurrency.

Po implementacji i istniejącym setupie zależności uruchomić tylko zmienione fundamentalne pliki, przykładowy zestaw:

```sh
node --test shared/poker-domain/join.behavior.test.mjs shared/poker-domain/inactive-cleanup.behavior.test.mjs
node --test ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs ws-server/poker/table/table-manager.behavior.test.mjs ws-server/server.behavior.test.mjs
node --test tests/poker-quick-seat.behavior.test.mjs tests/chips-ledger.test.mjs
node --test tests/chips/poker-bot-budget.transaction.test.mjs
```

Ostatni plik jest planowany, obecnie nie istnieje. Po wdrożeniu testowego harness jawnie opisać jego lokalne parametry w nagłówku pliku, bez sekretów i bez domyślnego Stage. Nie dopisywać ogromnego pełnego test suite. Jeśli dotknięto inline script, użyć istniejącego `npm run check:csp-inline`; nie tworzyć testów wyglądu.

## Fundamentalne oczekiwane wyniki

| Scenariusz | Oczekiwany dowód |
|---|---|
| Cross-tier 99 + 0,5 + 0,5; delta 1 CH | Exact 100 jednostek, bez utraty ułamków; osobny CH cap |
| 7 dni przed/na granicy; wiele tygodni idle | Jedno odnowienie do 100, trwała kadencja, żadnego catch-up |
| Slow pierwsze przejście i 0,4 w t0 +0,6 w t0+1 h | Pierwsza jednostka natychmiast; w t0+12 h dostępne tylko 0,4, pełne 1 dopiero t0+13 h bez nowego zużycia; race/tier/fast-slow nie resetują historii |
| Prefunded admission, reconnect, dwóch ludzi, replacement residual | Każdy nowy dostęp naliczony raz, fundingDelta niezależnie każdemu; CH transfer tylko raz |
| Race join/rollover i błąd po fundingu/przed commit | Zero częściowych seats/stacków/CH/used counters; replay po utraconej odpowiedzi nie dubluje |
| Klasy, direct URL, manual join, WS bootstrap i guest | Taka sama zgodność serwerowa, brak niezgodnych slow botów; HUMAN_ONLY działa |
| Exhaustion w live hand, deadline, obecny/nieobecny human, restart | Brak nowego funding/admission, niezmienny deadline; żywa ręka kończy się, kolejna nie startuje |
| Pusta płynność 100/500, cap, missing proof | Bez nieskończonego funding retry; poprawne settle/exit działa |
| Terminal legacy/new source, residual/top-up | Zwrot do dowiedzionego konta; zero escrow; certyfikat dokładnie raz |
| Dwa równoległe refille 100/500 i duplicate key | Jedno księgowanie per key; globalny/klasowy cap bez przekroczenia; rollback cofa credit i counters |
| Live escrow 100k, live bot profits, bot-only churn, closed loss 300/headroom200/cap150 | Sam live balance/churn bez emisji; live profits nie zaniżają kapitalizacji dzięki górnej granicy pełnego escrow; ostatni maks.150; closed profits pomniejszają loss |
| Retention/restart i utrata hot entries | Zgodny certyfikat/archiwum podtrzymuje dowód; brak dowodu daje zero, nie reset |

## Dodatkowe fundamentalne scenariusze D2–D3 i P1

- A wyczerpuje fast w t0; zajęty B ma wcześniej sfinansowane boty. Zablokować fanout, odczytać B w +20 min: deadline nadal t0+30 min; po nim zero kolejnych rąk nawet bez fundingu. Recheck admission/funding/prepare/commit i race z leave/deferred leave; restart/reset fast nie usuwa powiązania. HUMAN_ONLY i istniejący SLOW_SHARED bez tego drain; live hand i wypłaty zachowane.
- Slow race o 0,4 po pierwszym wygaśnięciu: dwa requesty na różnych tierach łącznie nie przekraczają 0,4. Retry/utrata odpowiedzi nie tworzą nowego kosztu ani nowej jednostki. Granice sprawdzać deterministycznym zegarem.
- REFILL w (t−168 h,t]: tuż przed/na/po lewej granicy, równoczesne klasy/tiery, wspólny global cap; trwałe receipts po restarcie/retention, brak resetu na granicy tygodnia.
- INITIAL_ALLOCATION: równoczesne/retry żądania dają dokładnie jeden milion GENESIS → POKER_BOT_BANKROLL_100 i 900000/100000; osobny purpose, bez zużycia REFILL cap. Schema alone daje zero CH; brak Production wykonania bez osobnego GO.

## Fundamentalna walidacja D.1 (przyszła)

Aktualny kontrakt D.1/SLOW_SHARED oraz Q1 w plan.md i contracts/bot-budget.md zastępuje ten wcześniejszy wariant. Bez owner-only/formularza i bez arbitralnego limitu kandydatów; pozostałe reguły ekonomii i P1/P2 zachowane.

## Przyszły Stage/Preview

1. Przed publikacją PR z migracjami opisać zamierzony automatyczny DB Stage Apply PR na wspólnym Stage. Applied migrations niezmienne; poprawki nowymi migracjami. Schema i jednorazowa alokacja to oddzielne kroki; potwierdzić target i zatwierdzone D3: jednorazowy MINT miliona GENESIS → POKER_BOT_BANKROLL_100, 900000/100000.
2. Stage preflight: saldo SYSTEM, open committed capital, historyczny seed 500, certyfikaty/archives, 90/10, brak podwójnej alokacji 100. Zatwierdzone pilot caps i źródło bez ekstrapolacji #870.
3. Po implementacji jawny WS Preview Deploy: workflow definition z main i aplikacja exact latest runtime-affecting SHA; potwierdzić sukces i release metadata tego SHA. Netlify preview/WS PR Checks nie wdrażają WS. Host współdzielony, ustalić wyłączność na czas smoke.
4. Użytkownik może wykonać manual smoke: dwóch standard ludzi, kilku constrained przy wspólnym SLOW_SHARED, human-only z obiema grupami, próba direct URL bot-only/slow, brak płynności, drain z reconnect i aktywną ręką na deadline, cash-out i źródła. Zwykłego managed rotation nie pomylić z drain.
5. Zmierzyć (obserwacja, bez automatycznej zmiany cap): rzeczywisty net outflow, udział zwykłych graczy z dostępnym miejscem, liczbę odmów allowance/liquidity, zużycie każdej klasy/tieru, issuance vs caps; bot-only nie generuje human usage ani inflacji. Zapisać okres obserwacji i liczbę prób — nie twierdzić, że krótkie smoke potwierdza ekonomię długoterminową.
6. Gdy brak smoke: status „implementation ready, awaiting manual runtime verification”. Przed Production oddzielny jawny GO obejmujący environment, source, seed, politykę i refill; nie wynika z #869 ani zielonego CI. Późniejsze docs/test-only zmiany mogą użyć dowodu po potwierdzeniu braku runtime/config diff.

## Recovery

Odmowa nowego finansowania nie wyłącza rozliczeń. Awaria po commit: odczytać trwałą decyzję; nie refundować na ślepo. Brak dowodu: brak refillu, nie dopisywać GENESIS/TREASURY fallback. Deadline po restarcie zachowany. Niezgodny stary runtime po rollback nie otrzymuje możliwości nowego funding; schemat i historia pozostają, naprawa forward-only. Rozliczenie z niespójnymi dowodami wymaga istniejącej kontrolowanej rekonsyliacji, nie wymuszonego close.

## Dodatkowa przyszła walidacja P1/P2/D.2

- Deterministyczny seed: min2/max3, T100, pula250 — zero rekomendacji/create niezależnie od RNG; pula300 — target2/3 dopuszczalne, tylko actual koszt. Recheck nadal wykrywa realną zmianę warunków.
- Reuse: INIT2 vs request6 oraz niezgodne canonical stakes nie mogą zostać zaakceptowane. Niezgodny INIT pomija się bez zmiany parametrów; SLOW_SHARED nie ma limitu jednego OPEN stołu na właściciela. Deduplikacja operacji/konta i maks1 create pozostają.
- Admin auth/projection: lista ALL/CLOSED zachowuje pagination i wszystkie utrwalone klasy mimo wyczerpanego fast admina; non-admin 401/403. Policy class/unknown, active drain i pierwotne daty odrębne od OPEN/CLOSED; zero prywatnych kart/allowance i zero mutacji. Admin join nadal zwykła polityka. #789 bez implementacji.
- Ręczny przyszły Preview: porównać listę gracza z inventory admina, czytelność dat i class/unknown, OPEN+DRAINING oraz CLOSED z historycznymi datami. Bez testów renderowania UI/CSS/JSP i bez Preview w sesji planowania.

## D.3 — przyszła bramka pomiarowa Stage/WS Preview

Nie wykonywać podczas planowania. Po osobnym zleceniu realizacji zebrać baseline obecnego runtime i pomiar implementacji dla tego samego małego zestawu danych, liczby widzów/stołów i czasu. Przed próbą odnotować środowisko, exact SHA, owner okna wspólnego Stage/Preview, istniejące limity połączeń, #962 resource health, limity pracy z planu i warunki STOP. Start od1 operacji/widza; drugi ograniczony krok kilku klientów/stołów wyłącznie jeśli guards zdrowe. Przed startem jawnie zapisać max klientów/stołów/żądań i czas (krótki pojedynczy przebieg, nie ciągły stress); żadnego nieograniczonego ruchu ani obciążania Production.

| Scenariusz | Dowód baseline vs implementacja |
|---|---|
| Idle lobby i kilka widzów/stołów | Zero nowego per-user poll; RT nie widzowie×stoły; coalescing, max pending refresh, bounded projection bytes; latency aktualizacji i stale-result discard |
| Równoległe join/rematch/HTTP replay | Jeden descriptor na operację; niezgodny cfg zero oferty; strony/candidate/proof caps i failed/incomplete odczyt bez create; query/tx count, bytes, busy/timeout, join latency, bez double seat/CH |
| Ręce/prepare/commit oraz multi-table drain | Odczyt konto/stół zamiast full history, lock hold/wait, original deadline mimo backlog; hand settlement i cash-out latency przy opcjonalnym obciążeniu |
| Równoczesne close/refill | Terminal payout nie czeka na global guard; max1 refill, kompletne capital/caps albo zero; coalescing/cooldown, signed loss i idempotency |
| Restart/backlog i failure pressure | Bounded fanout/pending replay/backoff; capacity/proof overflow daje zero mint; brak create z incomplete; accepted accounting odzyskiwane idempotentnie, DB outage jawnie recovery |
| Admin lista max100 | Jeden batch policy/drain strony, brak N+1 i player filtering, czas odpowiedzi i prywatność |

Zapisać per path approximate SQL reads/writes/transactions/RT, zwrócone rows/bytes i WS payload bytes, Supabase egress oddzielnie, DB CPU/Disk I/O/WAL, active/waiting connections, lock wait/duration, serialization retry/timeouts, lobby/join/settlement/cash-out latencies i zaległości cleanup/refill. Użyć obecnych metryk, klog, query plans/EXPLAIN na ograniczonych fixtures; nie uruchamiać ciężkiego profilu bez limitu. Mały wynik agregatu nie ukrywa rows scanned/buffers. Zachować pomiary i wybrany batch/page/concurrency/cooldown w tym dokumencie, z uzasadnieniem względem baseline; przed pomiarem brak numeric SLO ani twierdzenia o pojemności produkcyjnej.

STOP/odroczenie nowej opcjonalnej pracy przy critical/unknown zdrowiu DB, narastającej kolejce połączeń/locków lub pogorszeniu legalnych wypłat; nie zwiększać load aby „dokończyć test”. Nie obchodzić #962. Jeśli nie można uzyskać pełnego proof w bezpiecznych limitach, refill pozostaje zero/pending; nie zwiększać cap ekonomii. Wymagana ocena braku materialnego starvation względem baseline w zadanym małym scenariuszu; dopuszczalne delty określić z obserwacji i jawnego review, nie wymyślone SLO. Green unit/Netlify nie zastępują exact-SHA WS Preview i manual smoke; osobny GO dla Production/seed/refill nadal obowiązuje.

## Fundamentalne scenariusze korekty review: Graj teraz/FIFO/close

- T022: deterministycznie zatrzymać ciężkie przygotowanie/refill poza FIFO; istniejące settlement/leave wykonuje się. Finalny funding timeout cofa tx i zwalnia komendę przed następnym settlement; brak natychmiastowej pętli. Nie obiecywać wyprzedzania już zakolejkowanej pracy.
- T033: realny SQL timeout/conflict przy certyfikacie, następnie pending/counter failure; cała tx zwrotów/CAS/proof rollbackuje, stan nie udaje CLOSED. Kontrolowana nowa tx po recovery daje jeden return; unknown COMMIT/restart/final proof używa tego samego to_state_version i nie kredytuje liquid ponownie. Pending lub niepewny proof daje zero refill. Lokalny odizolowany DB w przyszłej implementacji, bez wykonania teraz.


## Nowe D.1 — fundamentalna weryfikacja

Aktualny kontrakt D.1/SLOW_SHARED oraz Q1 w plan.md i contracts/bot-budget.md zastępuje ten wcześniejszy wariant. Bez owner-only/formularza i bez arbitralnego limitu kandydatów; pozostałe reguły ekonomii i P1/P2 zachowane.

Manual przyszły Preview: Graj teraz zawsze obecne przy pustej i niepustej liście, Resume odrębne, żadnego create podczas oglądania i żadnej ręcznej paginacji; kolejność JOIN zachowana, uczciwe failure/alternatywy. Baseline D.3 porównać oddzielnie pasywne idle zero writes i jawne kliknięcia, w dotychczasowych małych granicach obciążenia. Bez testów renderowania.


## Bieżący handoff: SLOW_SHARED, jeden klik i pomiary Q1

Tylko plan. S1-A zatwierdzone: tylko lokalny trigger rzeczywiście wymaganego dodatniego finansowania. Przed implementacją rozstrzygnąć Q1 A indexed SQL vs B1 bounded registry read (C tylko jeśli pomiary uzasadnią). T042 osobno autoryzowane lokalne plany zapytań i uzasadnienie K/L/B/D/C poprzedza zamrożenie discovery; T038 przyszły jawny Stage/WS Preview baseline vs implementacja, nie wykonywać teraz. Żadnych arbitralnych100/2×50 jako acceptance. Koszty/warianty: plan Q1.

Manual Preview: brak panelu Create/tier/maxPlayers/trybu w zwykłym lobby; przycisk Graj teraz stale widoczny. Browse/refresh/reconnect puste lub niepuste→zero create/seat/funding. Lista wszystkich eligible tierów+oddzielne Resume; click pierwszy nadal właściwy cel używa jego parametrów, stale→drugi bez click. Empty→najwyższy rzeczywiście grywalny tier/canonical6,≤1 create i auto-join. Brak budget/pool/proof/WS/DB→uczciwa alternatywa, zero fake create i silent mode switch. Admin create/inventory nadal autoryzowane.

Fundamentalne backend/runtime/transaction cases T015/T020/T033: inventory>K i kompletny zakres→bounded create bez interactive search, failed/stale→zero; parallel tabs/replay→bez duplikatu. SLOW dwóch ludzi, jeden FUNDING50/tier100, dwa EXPOSURE0,5 bez USER debit; seated positive-cost denial→first receipt+30min, zero/no new cost nie drain. Rolling0,4+0,6, renewal nie usuwa drain, concurrent users/table requests i A/B według zatwierdzonego S1-A. FAST global A/B nadal oryginalny czas i osobne reguły. Zachować FIFO, full/pending close rollback/unknown-commit recovery i poprawne legalne wypłaty.

Pomiar mały, ograniczony i dopiero w uzgodnionym oknie: idle lobby, więcej viewerów/live+persisted-only stołów, click/rematch, rollover, wspólny slow drain/A-B, terminal/refill/backlog restart. Rejestrować query plans actual rows/loops/buffers, RT/rows/bytes DB i WS, egress osobno od CPU/Disk I/O/WAL, connections/locks/retries oraz lobby/join/settlement/cash-out latency. Porównać baseline i implementację z konkretnym SHA, stop przy critical/unknown lub starvation. Nie obiecywać utrzymania rozliczeń przy całkowitej awarii DB. Nie dodawać UI tests ani telemetry DB.

Breaking: znika manual Create UX i parametry zwykłego Quick Seat; AUTO API/receipt/resolved params, all-tier personalized lista i auto-join; SLOW_SHARED zastępuje projektowaną klasę prywatną oraz owner constraints i zmienia admission/drain. Przyszła addytywna migracja wymaga jawnej klasyfikacji legacy, bez relabel żywych źródeł/escrow; admin i backend auth pozostają. Overload może odroczyć nowe oferty/funding, nie zwalnia finalnych checks ani payout invariants. JSP JS/klog/CSS jeden selector/CSP SHA nadal obowiązują.

## Q1 — dowód wyboru i warunkowy routing

Cel zatwierdzony: automatycznie znaleźć odpowiedni stół przy małym koszcie DB i ograniczać zbędne tworzenie stołów. Architektura niewybrana. Najpierw porównać obecne selectCandidate/recommendSeatAtTable/handler (SQL OPEN/ACTIVE seats/last_seen_at), publiczne live facts activeLobbyTablesById i istniejące account/proof batch. Ocenić pushdown i istniejące indeksy, rozjazd persisted/live oraz kolejność widoczną w lobby. Sam błąd/niepełny/stary odczyt nie dowodzi pustki. Nie dodawać endpointu ani liczbowego limitu zapytań przed dowodem.

T042 po analizie T002 i osobnej zgodzie pomiarowej: w przyszłym dozwolonym odizolowanym lokalnym DB odtworzyć istniejącą schema i kontrolowane fixtures małego/większego inventory, pełnych/niezgodnych stołów i opóźnionej persystencji. Zebrać plany EXPLAIN (ANALYZE, BUFFERS) wyłącznie bezpiecznych odczytów, actual rows/loops/buffers, RT/bytes i czas. Porównać narrow indexed SQL/batch z wykorzystaniem istniejącego registry bez dodatkowego HTTP; dopiero wykazana luka uzasadnia wariant bounded authenticated HTTP. Minimalną projekcję DB ocenić przez dodatkowe writes/WAL/locks. Zapisać query shape, schema/indexes, cardinality, SHA, wyniki i wybrany wariant/limity; wrócić do review. T038 później kontrolowany baseline/Preview pomiar egress osobno od CPU/I/O/WAL/locks i opóźnień settlement. Teraz brak tych pomiarów i brak operacji DB/Stage/Production; Q1 blokuje zamrożenie implementacji discovery.

Warunkowo, **tylko jeżeli Q1 wybierze nową ścieżkę HTTP do WS**: przyszły zakres obejmie infra/vps/Caddyfile, w obu blokach ws.kcswh.pl (upstream127.0.0.1:3000) i ws-preview.kcswh.pl (3001), z dokładnym matcherem ustalonej ścieżki przed fallback. Obecny fallback odpowiada tekstem OK/200, więc sam HTTP200 nie dowodzi dotarcia do WS. T018 zaplanuje routing i autoryzację bez rozszerzenia publicznego dostępu, T038 zweryfikuje odpowiedź/schema/revision z WS i odrzucenie brakującego tokenu przez proxy na osobno autoryzowanym Preview; Production analogicznie dopiero po osobnym GO. Bez nowej ścieżki zadanie Caddy jest niepotrzebne i nie zmienia pliku. Teraz nie modyfikować Caddy ani deployować.

## T042 — protokół do osobnej akceptacji (nie wykonano)

**Cel:** porównać koszt istniejących odczytów discovery i najprostszych read-only wariantów zbiorczych, zidentyfikować luki live/persisted. Nie dowodzić jeszcze pełnego admission/ekonomii #869 ani wydajności Production.

**Target proponowany:** jednorazowy lokalny Postgres na loopback w odizolowanym katalogu/instancji, bez Supabase cloud, poświadczeń i danych użytkowników; lokalny Node/harness z istniejącymi zależnościami, bez uruchamiania serwera produkcyjnego lub Netlify handlera. Przed startem zapisać wersję PG/Node, host/port i potwierdzić brak routingu do Stage/Production. Jeśli brak dostępnego izolowanego PG, zatrzymać się; instalacja/usługa/kontener lub zewnętrzny target wymagają osobnej zgody. Nie wykonywać repo migration runner. Zgoda T042 musi obejmować stworzenie i usunięcie wyłącznie lokalnej schemy pomiarowej z minimalnym DDL istniejących tabel/indeksów oraz syntetycznymi fixtures; nie migrację aplikacji, seed CH ani nowe pola feature.

**Dane i macierz:** trzy rozmiary inventory:20,100,200 stołów; max10 seats/stół, do200 syntetycznych kont. Maksymalnie2000 seat rows,200 poker_state,200 poker_tables na wariant; bez ledger transferów. Dwa rozkłady: (a) mieszanka tiers100/500/higher-human-only, maxPlayers2/6/10, humans/bot-only/full/OPEN/CLOSED, aktywne i nieaktywne seats; (b) większość kandydatów SQL odrzucana przy dalszej walidacji, zgodny cel na końcu albo brak celu. Daty przed/na/po120s, identyczne sort timestamps z różnymi UUID; fixtures legacy/niekanoniczne stakes. W oddzielnej in-memory reprezentacji registry: loaded vs persisted-only, live full mimo DB wolnego miejsca, zamknięty runtime mimo DB OPEN i starsza wersja. Klasy/drain #869 symulować jako jawne wejścia kontraktu w pamięci, nie implementować migracji lub nowej autoryzacji. SLOW shared i S1-A nie są ponownie wybierane.

**Przebiegi:** dla6 zestawów (3 rozmiary×2 rozkłady) maks3 kształty odczytu: obecny SQL, read-only szkic pushdown/batch na istniejących kolumnach, read-only zbiorcza walidacja identyfikatorów istniejącego registry. Po1 warm-up i3 powtórzenia: maks72 sekwencje odczytu. Każda sekwencja≤10 SELECT, cały eksperyment≤1000 SELECT włącznie z EXPLAIN; osiągnięcie limitu raportować jako nieukończony pomiar, nie brak stołu. Osobny mały przebieg in-memory registry dla1 i10 odbiorców, po3 powtórzenia; nie jest testem renderowania ani sieciowej dostępności WS. Porównanie zapytań per candidate przy limicie pracy wolno zakończyć wcześniej i zapisać skalowanie teoretyczne, nie dorabiać wyników.

**Limity wyłącznie eksperymentu:** concurrency1 domyślnie, jeden kontrolowany przebieg maks2 równoległych połączeń tylko po zdrowym sekwencyjnym; łączny wall time≤15min, SQL statement_timeout1s, lock_timeout100ms, rozmiar lokalnych fixtures/output≤100MiB. To bezpieczniki laboratorium, nie SLO ani docelowe limity matchmakingu. Brak automatycznych ponowień timeoutu/awarii, podnoszenia limitów lub zwiększania danych. Nie odpytujemy usług cloud ani nie mierzymy ich kosztu przez generowanie ruchu.

**Co zapisać:** SQL shape i parametry bez sekretów, SHA/schema/indexes/cardinality, EXPLAIN ANALYZE BUFFERS dla SELECT, actual rows/loops, sort/scan/index, buffers/temp spill, RT i liczba zwróconych wierszy, bajty serializowanego wyniku, elapsed range/mediana. Porównać kolejność/kwalifikację z in-memory authoritative fixtures, liczbę pominiętych właściwych celów i przypadków potencjalnie zbędnego create (bez tworzenia stołów). SQL error/timeout/stale/incomplete musi dawać status niewiarygodnego wyniku. Lokalny CPU/I/O/RSS/połączenia i lock waits obserwować dostępnymi narzędziami; niedostępne metryki oznaczyć brak. Bytes lokalne to proxy payload, **nie zmierzony Supabase egress**. WAL fixture setup oddzielić od SELECT; brak implementacji projekcji C oznacza brak pomiaru jej write/WAL kosztu. Nie wyciągać p95/SLO ani wniosków o Production z3 próbek.

**STOP:** niewłaściwy/nieudowodniony target, dostęp do realnych danych/sekretów, próba zewnętrznego połączenia, przekroczenie któregokolwiek limitu, timeout/błąd SQL, blokada, swap/OOM lub utrata zdrowia hosta. Przy zajętości CPU>80% przez10s albo pamięci hosta>80% przerwać i nie eskalować obciążenia. Zatrzymać kontrolowany eksperyment, zapisać częściowe wyniki; sprzątanie wyłącznie własnej jednoznacznie nazwanej lokalnej schemy/plików, bez systemowego cleanup.

**Wymagana zgoda:** zaakceptować powyższy target lokalny, minimalny DDL i syntetyczne dane tylko w izolowanej schemie, read-only warianty SQL/harness, limity72 sekwencji/1000 SELECT/2 connections/15min/100MiB i warunki STOP oraz usunięcie tych lokalnych artefaktów. Zgoda nie obejmuje instalacji brakującego PG, Stage/Production, migracji repo, feature code, endpointu/Caddy/deployu, CH seeda/refillu ani wyboru Q1. Po T042 raport w research.md; T043 wybór i niezależne review; następnie osobne zlecenie T001.
