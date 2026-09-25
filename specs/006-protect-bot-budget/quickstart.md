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

## Przyszły Stage/Preview

1. Przed publikacją PR z migracjami opisać zamierzony automatyczny DB Stage Apply PR na wspólnym Stage. Applied migrations niezmienne; poprawki nowymi migracjami. Schema i jednorazowa alokacja to oddzielne kroki; potwierdzić target i zatwierdzone D3: jednorazowy MINT miliona GENESIS → POKER_BOT_BANKROLL_100, 900000/100000.
2. Stage preflight: saldo SYSTEM, open committed capital, historyczny seed 500, certyfikaty/archives, 90/10, brak podwójnej alokacji 100. Zatwierdzone pilot caps i źródło bez ekstrapolacji #870.
3. Po implementacji jawny WS Preview Deploy: workflow definition z main i aplikacja exact latest runtime-affecting SHA; potwierdzić sukces i release metadata tego SHA. Netlify preview/WS PR Checks nie wdrażają WS. Host współdzielony, ustalić wyłączność na czas smoke.
4. Użytkownik może wykonać manual smoke: dwóch standard ludzi, constrained private slow, human-only z obiema grupami, próba direct URL bot-only/cudzego slow, brak płynności, drain z reconnect i aktywną ręką na deadline, cash-out i źródła. Zwykłego managed rotation nie pomylić z drain.
5. Zmierzyć (obserwacja, bez automatycznej zmiany cap): rzeczywisty net outflow, udział zwykłych graczy z dostępnym miejscem, liczbę odmów allowance/liquidity, zużycie każdej klasy/tieru, issuance vs caps; bot-only nie generuje human usage ani inflacji. Zapisać okres obserwacji i liczbę prób — nie twierdzić, że krótkie smoke potwierdza ekonomię długoterminową.
6. Gdy brak smoke: status „implementation ready, awaiting manual runtime verification”. Przed Production oddzielny jawny GO obejmujący environment, source, seed, politykę i refill; nie wynika z #869 ani zielonego CI. Późniejsze docs/test-only zmiany mogą użyć dowodu po potwierdzeniu braku runtime/config diff.

## Recovery

Odmowa nowego finansowania nie wyłącza rozliczeń. Awaria po commit: odczytać trwałą decyzję; nie refundować na ślepo. Brak dowodu: brak refillu, nie dopisywać GENESIS/TREASURY fallback. Deadline po restarcie zachowany. Niezgodny stary runtime po rollback nie otrzymuje możliwości nowego funding; schemat i historia pozostają, naprawa forward-only. Rozliczenie z niespójnymi dowodami wymaga istniejącej kontrolowanej rekonsyliacji, nie wymuszonego close.
