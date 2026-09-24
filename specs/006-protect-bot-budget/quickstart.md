# Quickstart walidacji #869 — do przyszłej realizacji

Nie jest poleceniem wykonania w sesji planowania. Najpierw niezależne review, odpowiedzi D1–D3, ponowne analyze i osobne zlecenie implementacji. Żadnych poleceń Git, seeda ani migracji Production w tym dokumencie.

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
| Slow D1: przed/na 12 h, multi-tab i zmiana tieru | Burst nigdy >1; brak resetu i równoległej dodatkowej jednostki |
| Prefunded admission, reconnect, dwóch ludzi, replacement residual | Każdy nowy dostęp naliczony raz, fundingDelta niezależnie każdemu; CH transfer tylko raz |
| Race join/rollover i błąd po fundingu/przed commit | Zero częściowych seats/stacków/CH/used counters; replay po utraconej odpowiedzi nie dubluje |
| Klasy, direct URL, manual join, WS bootstrap i guest | Taka sama zgodność serwerowa, brak cudzych slow botów; HUMAN_ONLY działa |
| Exhaustion w live hand, deadline, obecny/nieobecny human, restart | Brak nowego funding/admission, niezmienny deadline; żywa ręka kończy się, kolejna nie startuje |
| Pusta płynność 100/500, cap, missing proof | Bez nieskończonego funding retry; poprawne settle/exit działa |
| Terminal legacy/new source, residual/top-up | Zwrot do dowiedzionego konta; zero escrow; certyfikat dokładnie raz |
| Dwa równoległe refille 100/500 i duplicate key | Jedno księgowanie per key; globalny/klasowy cap bez przekroczenia; rollback cofa credit i counters |
| Live escrow 100k, live bot profits, bot-only churn, closed loss 300/headroom200/cap150 | Sam live balance/churn bez emisji; live profits nie zaniżają kapitalizacji dzięki górnej granicy pełnego escrow; ostatni maks.150; closed profits pomniejszają loss |
| Retention/restart i utrata hot entries | Zgodny certyfikat/archiwum podtrzymuje dowód; brak dowodu daje zero, nie reset |

## Przyszły Stage/Preview

1. Przed publikacją PR z migracjami opisać zamierzony automatyczny DB Stage Apply PR na wspólnym Stage. Applied migrations niezmienne; poprawki nowymi migracjami. Schema i jednorazowa alokacja to oddzielne kroki; sprawdzić D3 i target.
2. Stage preflight: saldo SYSTEM, open committed capital, historyczny seed 500, certyfikaty/archives, 90/10, brak podwójnej alokacji 100. Zatwierdzone pilot caps i źródło bez ekstrapolacji #870.
3. Po implementacji jawny WS Preview Deploy: workflow definition z main i aplikacja exact latest runtime-affecting SHA; potwierdzić sukces i release metadata tego SHA. Netlify preview/WS PR Checks nie wdrażają WS. Host współdzielony, ustalić wyłączność na czas smoke.
4. Użytkownik może wykonać manual smoke: dwóch standard ludzi, constrained private slow, human-only z obiema grupami, próba direct URL bot-only/cudzego slow, brak płynności, drain z reconnect i aktywną ręką na deadline, cash-out i źródła. Zwykłego managed rotation nie pomylić z drain.
5. Zmierzyć (obserwacja, bez automatycznej zmiany cap): rzeczywisty net outflow, udział zwykłych graczy z dostępnym miejscem, liczbę odmów allowance/liquidity, zużycie każdej klasy/tieru, issuance vs caps; bot-only nie generuje human usage ani inflacji. Zapisać okres obserwacji i liczbę prób — nie twierdzić, że krótkie smoke potwierdza ekonomię długoterminową.
6. Gdy brak smoke: status „implementation ready, awaiting manual runtime verification”. Przed Production oddzielny jawny GO obejmujący environment, source, seed, politykę i refill; nie wynika z #869 ani zielonego CI. Późniejsze docs/test-only zmiany mogą użyć dowodu po potwierdzeniu braku runtime/config diff.

## Recovery

Odmowa nowego finansowania nie wyłącza rozliczeń. Awaria po commit: odczytać trwałą decyzję; nie refundować na ślepo. Brak dowodu: brak refillu, nie dopisywać GENESIS/TREASURY fallback. Deadline po restarcie zachowany. Niezgodny stary runtime po rollback nie otrzymuje możliwości nowego funding; schemat i historia pozostają, naprawa forward-only. Rozliczenie z niespójnymi dowodami wymaga istniejącej kontrolowanej rekonsyliacji, nie wymuszonego close.
