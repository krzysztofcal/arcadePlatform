# Quickstart walidacji #869 — do przyszłej realizacji

Nie jest poleceniem wykonania w sesji planowania. Najpierw niezależne review, kontrola zgodności z zatwierdzonymi D1–D3 i P1, ponowne analyze i osobne zlecenie implementacji. Żadnych poleceń Git, seeda ani migracji Production w tym dokumencie.

## Prerequisites i setup

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
| Klasy, direct URL, manual join, WS bootstrap i guest | Taka sama zgodność serwerowa, brak cudzych slow botów; HUMAN_ONLY działa |
| Exhaustion w live hand, deadline, obecny/nieobecny human, restart | Brak nowego funding/admission, niezmienny deadline; żywa ręka kończy się, kolejna nie startuje |
| Pusta płynność 100/500, cap, missing proof | Bez nieskończonego funding retry; poprawne settle/exit działa |
| Terminal legacy/new source, residual/top-up | Zwrot do dowiedzionego konta; zero escrow; certyfikat dokładnie raz |
| Dwa równoległe refille 100/500 i duplicate key | Jedno księgowanie per key; globalny/klasowy cap bez przekroczenia; rollback cofa credit i counters |
| Live escrow 100k, live bot profits, bot-only churn, closed loss 300/headroom200/cap150 | Sam live balance/churn bez emisji; live profits nie zaniżają kapitalizacji dzięki górnej granicy pełnego escrow; ostatni maks.150; closed profits pomniejszają loss |
| Retention/restart i utrata hot entries | Zgodny certyfikat/archiwum podtrzymuje dowód; brak dowodu daje zero, nie reset |

## Dodatkowe fundamentalne scenariusze D2–D3 i P1

- A wyczerpuje fast w t0; zajęty B ma wcześniej sfinansowane boty. Zablokować fanout, odczytać B w +20 min: deadline nadal t0+30 min; po nim zero kolejnych rąk nawet bez fundingu. Recheck admission/funding/prepare/commit i race z leave/deferred leave; restart/reset fast nie usuwa powiązania. HUMAN_ONLY i istniejący SLOW_PRIVATE bez tego drain; live hand i wypłaty zachowane.
- Slow race o 0,4 po pierwszym wygaśnięciu: dwa requesty na różnych tierach łącznie nie przekraczają 0,4. Retry/utrata odpowiedzi nie tworzą nowego kosztu ani nowej jednostki. Granice sprawdzać deterministycznym zegarem.
- REFILL w (t−168 h,t]: tuż przed/na/po lewej granicy, równoczesne klasy/tiery, wspólny global cap; trwałe receipts po restarcie/retention, brak resetu na granicy tygodnia.
- INITIAL_ALLOCATION: równoczesne/retry żądania dają dokładnie jeden milion GENESIS → POKER_BOT_BANKROLL_100 i 900000/100000; osobny purpose, bez zużycia REFILL cap. Schema alone daje zero CH; brak Production wykonania bez osobnego GO.

## Fundamentalna walidacja D.1 (przyszła)

- Backend lobby: macierz dwóch kont/klas/tierów, pełny/DRAINING/cudzy slow pominięty; własny seat wyłącznie Resume; odświeżenie po zmianie eligibility/capacity/time, stary async snapshot nie przywraca oferty.
- Quick Seat: zgodny STANDARD z ludźmi przed innym STANDARD, po click poprawnie zakończony bounded dobór bez kandydata + świeży preflight → najwyżej jeden create i final WS join w żądanym tierze/mode; slow owner i HUMAN_ONLY find-or-create bez zmiany trybu. Brak allowance/pool/proof/capability → zero nowych funded stołów.
- Stale admission: pierwszy cel zajęty/draining, drugi zgodny → automatyczny rematch bez nowego kliknięcia; ≤2 admission attempts/1 create. DIRECT nie przeskakuje. Retry po utracie HTTP odpowiedzi odtwarza tableId; unknown WS commit odzyskuje wynik przed rematch. Dwa połączenia DB/duplikaty kart: bez powielania create, transferu i EXPOSURE.
- Po porzuconym create pusty INIT odzyskuje istniejący lifecycle z zero escrow; receipt pozostaje. Jeżeli ktoś dołączył, brak usunięcia jego stołu. Rzeczywisty brak środków i backend outage mają uczciwy terminal/wait; brak obietnicy całkowitego wyeliminowania błędów.
- Wyłącznie ręczna przyszła weryfikacja Preview: brak wierszy Unavailable, odrębne Join/Resume, stan dobierania zamiast pierwszego stale błędu, jawne alternatywy direct/HUMAN_ONLY, brak cichej zmiany tieru/trybu. Nie dodawać testów renderowania UI/CSS/JSP.

## Przyszły Stage/Preview

1. Przed publikacją PR z migracjami opisać zamierzony automatyczny DB Stage Apply PR na wspólnym Stage. Applied migrations niezmienne; poprawki nowymi migracjami. Schema i jednorazowa alokacja to oddzielne kroki; potwierdzić target i zatwierdzone D3: jednorazowy MINT miliona GENESIS → POKER_BOT_BANKROLL_100, 900000/100000.
2. Stage preflight: saldo SYSTEM, open committed capital, historyczny seed 500, certyfikaty/archives, 90/10, brak podwójnej alokacji 100. Zatwierdzone pilot caps i źródło bez ekstrapolacji #870.
3. Po implementacji jawny WS Preview Deploy: workflow definition z main i aplikacja exact latest runtime-affecting SHA; potwierdzić sukces i release metadata tego SHA. Netlify preview/WS PR Checks nie wdrażają WS. Host współdzielony, ustalić wyłączność na czas smoke.
4. Użytkownik może wykonać manual smoke: dwóch standard ludzi, constrained private slow, human-only z obiema grupami, próba direct URL bot-only/cudzego slow, brak płynności, drain z reconnect i aktywną ręką na deadline, cash-out i źródła. Zwykłego managed rotation nie pomylić z drain.
5. Zmierzyć (obserwacja, bez automatycznej zmiany cap): rzeczywisty net outflow, udział zwykłych graczy z dostępnym miejscem, liczbę odmów allowance/liquidity, zużycie każdej klasy/tieru, issuance vs caps; bot-only nie generuje human usage ani inflacji. Zapisać okres obserwacji i liczbę prób — nie twierdzić, że krótkie smoke potwierdza ekonomię długoterminową.
6. Gdy brak smoke: status „implementation ready, awaiting manual runtime verification”. Przed Production oddzielny jawny GO obejmujący environment, source, seed, politykę i refill; nie wynika z #869 ani zielonego CI. Późniejsze docs/test-only zmiany mogą użyć dowodu po potwierdzeniu braku runtime/config diff.

## Recovery

Odmowa nowego finansowania nie wyłącza rozliczeń. Awaria po commit: odczytać trwałą decyzję; nie refundować na ślepo. Brak dowodu: brak refillu, nie dopisywać GENESIS/TREASURY fallback. Deadline po restarcie zachowany. Niezgodny stary runtime po rollback nie otrzymuje możliwości nowego funding; schemat i historia pozostają, naprawa forward-only. Rozliczenie z niespójnymi dowodami wymaga istniejącej kontrolowanej rekonsyliacji, nie wymuszonego close.

## Dodatkowa przyszła walidacja P1/P2/D.2

- Deterministyczny seed: min2/max3, T100, pula250 — zero rekomendacji/create niezależnie od RNG; pula300 — target2/3 dopuszczalne, tylko actual koszt. Recheck nadal wykrywa realną zmianę warunków.
- Reuse: INIT2 vs request6 oraz niezgodne canonical stakes nie mogą zostać zaakceptowane. Slow przy konflikcie parametrów zachowuje jeden OPEN stół i zgłasza jawny konflikt.
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

T015: otwarcie/refresh/reconnect pustego lobby zero table/seat/funding writes; click pierwszy nadal zgodny JOIN w kolejności listy; stale pierwszy→drugi bez kliknięcia; brak oferty po completed bounded selection→≤1 create+final join.150 kandydatów, brak oferty w ocenionych100 (także zgodny poza nimi) pozwala create przy pełnym preflight; brak dalszych stron UI/query-loop. Timeout po50/missing budget/pool/cfg/proof→zero create. T033: równoległe click/operationId/karty i unknown COMMIT odtwarzają jeden cel/seat/CH, in-flight recovery przed drugim create.

Manual przyszły Preview: Graj teraz zawsze obecne przy pustej i niepustej liście, Resume odrębne, żadnego create podczas oglądania i żadnej ręcznej paginacji; kolejność JOIN zachowana, uczciwe failure/alternatywy. Baseline D.3 porównać oddzielnie pasywne idle zero writes i jawne kliknięcia, w dotychczasowych małych granicach obciążenia. Bez testów renderowania.
