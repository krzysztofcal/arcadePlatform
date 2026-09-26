# Quickstart — przyszła walidacja, nie polecenie wykonania

## STOP / approvals

Teraz docs-only, bez implementacji, DB, Stage/Production, deployu, seed/refill. Najpierw niezależne review alternatywy #1018 vs #869 i zatwierdzonej polityki demand-driven NORMAL autorefill; potem osobne zlecenie T001. Aktywacja/mint dopiero w osobno autoryzowanym zakresie. Żaden test opisany niżej nie został wykonany.

## Lokalna fundamentalna weryfikacja po zleceniu

Użyć istniejącego node:test; pojedynczo uruchomić dotknięte shared/poker-domain/join.behavior.test.mjs, poker-progression.behavior.test.mjs, persisted-state-writer.behavior.test.mjs, existing leave/terminal-close/table-manager suites i tests/chips-ledger.test.mjs. Nowy transaction test T017 tylko po potwierdzeniu izolowanego lokalnego PostgreSQL; syntetyczne fixture, nie real accounts. Nie instalować nowego frameworka.

| Przypadek | Oczekiwany dowód |
|---|---|
| threshold−1/=threshold, restart/spadek | sticky class, one first detection; missing USER unknown |
| deny tier/full/class po detekcji | commit restriction, brak seat/buy-in; jeden przypadek bot-only false→denied zachowuje has_human_participant=false; SQL failure rollback/unknown jawny |
| RESTRICTED fresh prefunded/CONTINUOUS_BOT ordinary | denied bez seat/buy-in,bez claim |
| NORMAL vs drugi RESTRICTED na farmer-only | NORMAL denied,RESTRICTED accepted |
| Ostatni farmer leave/restart | is_farmer_only=true,zero seed/replacement/topup/refill mimo braku ludzi |
| Pierwszy RESTRICTED existing Create→JOIN | atomic farmer-only INIT/empty ESCROW,zero bot CH; czeka na drugiego |
| seed/managed seed/replacement/topup | zero nowych CH przy restricted; existing stacks bez zmian |
| mixed active hand, disconnected/pending leave | gra/settlement/cash-out zachowane, gate obejmuje seated człowieka |
| unfunded rollover | brak inflated candidate commit, restore poprawnej wersji, brak wymuszonego close |
| source niedobór/pełny,2NORMAL refille,restart/unknown | exact deficit+funding+existing registry atomowe,replay exactly once; RESTRICTED obok nie blokuje NORMAL i nie wywołuje refillu |
| invalid source/env/client metadata,retention | zero mint/admission bypass, replay po prune |

## Stage i Preview później

Same-repo migration PR może automatycznie uruchomić DB Stage Apply PR i mutować shared Stage. Ten efekt musi być jawny przed przyszłym push; applied migrations immutable/forward-only. Przed cutover ograniczyć nowe admissions/funding; nie przerywać rąk/wypłat. Schema przed runtime, wszystkie writers aktualne. Rollback nie może uruchamiać starego unrestricted/nieidempotentnego writer; funding pozostaje wyłączone do naprawy.

WS-affecting implementacja wymaga manual WS Preview Deploy z definicji main i dokładnego latest runtime SHA, potwierdzonego sukcesu. Netlify Preview/WS checks nie dowodzą wdrożenia WS. Osobne okno na shared Preview, bez automatycznego deployu każdego PR. Użytkownik może wykonać manual smoke; bez niego status implementation ready, awaiting manual runtime verification, nigdy merge-ready.

Manual smoke: istniejące lobby/Create/Quick Seat i direct join; neutralna odmowa przeciwnej klasy; dwóch restricted razem; mixed bez kick; CONTINUOUS_BOT no-funding fallback i legalny cash-out. Obserwować mały kontrolowany przebieg (bez load): query count, rows/bytes, locks/retry, latency JOIN/settlement/leave, klog oraz existing registry/manifest dowody. Bez UI/CSS/JSP rendering tests. Nie uruchamiać refillu/mint na środowisku bez osobnego zakresu i zatwierdzonego zakresu operacji. Production zawsze osobny GO; brak merge przez agenta.

## Ograniczenia i breaking impacts

Brak automatic unban; bogaci gracze mogą wymagać odrębnego audytowanego review. Leniwy próg nie mierzy escrow/peaków. Farmer poniżej progu nadal działa; shared TREASURY wymaga source lock dla atomic deficit+debit. Brak lifetime limitu; NORMAL farming może powodować dalszą emisję, co jest zatwierdzone. RESTRICTED nie otrzymuje nowych bot CH nawet ze źródła uzupełnionego gdzie indziej. Stale Quick Seat może neutralnie odmówić, bez nowego lobby engine. Timeouty i granice pracy composite fundingu wymagają runtime walidacji, nie są zmierzonym SLO.

Breaking review table hopping: farmer-only jest trwałe i nie staje się normalnym stołem po leave. Istniejące NORMAL miejsca na mixed converted table zachowują tylko rejoin/akcje/cash-out; nowe NORMAL admissions denied. Brak nowego engine i testów UI.

## Retention review i bramka T001

Przed T001 zsynchronizować live issue #1018 z farmer-only,którego starsza treść issue nie opisuje; adnotacja issue-source nie wystarcza. Potem osobne zlecenie implementacji. Nie modyfikować #869/#1017.

Przyszłe fundamentalne przypadki: D=0 tylko funding registry; D>0 atomic pair/replay/unknown; typed MINT w7d bot-only i30d closed-human export/prune; unrelated MINT excluded; missing-table cleanup i retry starego key po usunięciu registry→zero emisji; cleanup vs funding race. Weryfikować manifest/hash,table binding i brak permanentnego hot MINT/receipt. Nowa tabela receipts nie jest wymagana. To scenariusze przyszłe,bez DB/testów teraz.
