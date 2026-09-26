# Quickstart — przyszła walidacja, nie polecenie wykonania

## STOP / approvals

Teraz docs-only, bez implementacji, DB, Stage/Production, deployu, seed/refill. Najpierw niezależne review alternatywy #1018 vs #869 i proponowanych cap lifetime100000/500000; potem osobne zlecenie T001. Refill initial disabled. Żaden test opisany niżej nie został wykonany.

## Lokalna fundamentalna weryfikacja po zleceniu

Użyć istniejącego node:test; pojedynczo uruchomić dotknięte shared/poker-domain/join.behavior.test.mjs, poker-progression.behavior.test.mjs, persisted-state-writer.behavior.test.mjs, existing leave/terminal-close/table-manager suites i tests/chips-ledger.test.mjs. Nowy transaction test T017 tylko po potwierdzeniu izolowanego lokalnego PostgreSQL; syntetyczne fixture, nie real accounts. Nie instalować nowego frameworka.

| Przypadek | Oczekiwany dowód |
|---|---|
| threshold−1/=threshold, restart/spadek | sticky class, one first detection; missing USER unknown |
| deny tier/full/class po detekcji | commit restriction, brak seat/buy-in; SQL failure rollback/unknown jawny |
| NORMAL vs RESTRICTED jednocześnie empty/bot-only | jeden typ admission pod table lock |
| seed/managed seed/replacement/topup | zero nowych CH przy restricted; existing stacks bez zmian |
| mixed active hand, disconnected/pending leave | gra/settlement/cash-out zachowane, gate obejmuje seated człowieka |
| unfunded rollover | brak inflated candidate commit, restore poprawnej wersji, brak wymuszonego close |
| remaining cap poniżej/równe buy-in,2refille,restart/unknown | cap/receipt/ledger atomowe, replay exactly once |
| invalid source/env/client metadata,retention | zero mint/admission bypass, replay po prune |

## Stage i Preview później

Same-repo migration PR może automatycznie uruchomić DB Stage Apply PR i mutować shared Stage. Ten efekt musi być jawny przed przyszłym push; applied migrations immutable/forward-only. Przed cutover ograniczyć nowe admissions/funding; nie przerywać rąk/wypłat. Schema przed runtime, wszystkie writers aktualne. Rollback nie może uruchamiać starego uncapped/unrestricted writer; funding pozostaje wyłączone do naprawy.

WS-affecting implementacja wymaga manual WS Preview Deploy z definicji main i dokładnego latest runtime SHA, potwierdzonego sukcesu. Netlify Preview/WS checks nie dowodzą wdrożenia WS. Osobne okno na shared Preview, bez automatycznego deployu każdego PR. Użytkownik może wykonać manual smoke; bez niego status implementation ready, awaiting manual runtime verification, nigdy merge-ready.

Manual smoke: istniejące lobby/Create/Quick Seat i direct join; neutralna odmowa przeciwnej klasy; dwóch restricted razem; mixed bez kick; CONTINUOUS_BOT no-funding fallback i legalny cash-out. Obserwować mały kontrolowany przebieg (bez load): query count, rows/bytes, locks/retry, latency JOIN/settlement/leave, klog oraz receipts. Bez UI/CSS/JSP rendering tests. Nie uruchamiać refillu/mint na środowisku bez osobnego zakresu i zatwierdzonego cap. Production zawsze osobny GO; brak merge przez agenta.

## Ograniczenia i breaking impacts

Brak automatic unban; bogaci gracze mogą wymagać odrębnego audytowanego review. Leniwy próg nie mierzy escrow/peaków. Farmer poniżej progu nadal działa; shared TREASURY poza poker może otrzymać inne środki, więc cap dotyczy wyłącznie emisji tego refillera. Brak obietnicy bot availability po cap; istniejąca płynność/zwroty nadal legalne. Stale Quick Seat może neutralnie odmówić, bez nowego lobby engine. Parametry pracy refillera wymagają runtime walidacji, nie są zmierzonym SLO.
