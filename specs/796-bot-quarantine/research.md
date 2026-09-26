# Research — #1018

## Evidence and workflow

Live GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`, issue updated2026-09-26T08:27:40Z. Odczyt agents.md, skills.md, constitution1.1.1, repo templates i umiejscowienia kodu; bez DB, aplikacji, testów i środowisk. Spec Kit specify→clarify (decyzje poniżej)→plan→checklist→tasks→analyze. Wszystkie nowe nazwy są planowane, nie rzekomo istniejące API.

## R1 — storage i detekcja

Decision: istniejący USER chips_accounts z polami poker_bot_access, detection metadata. NORMAL→RESTRICTED monotonicznie pod blokadą konta. Serwerowy POKER_RESTRICTED_BALANCE_THRESHOLD_CH, default1mld, dodatni safe integer, brak/undefined używa default, niepoprawny skonfigurowany tekst daje unavailable nowych decyzji. Wszystkie autorytatywne ścieżki WS używają tej samej walidowanej konfiguracji; Netlify discovery nie klasyfikuje na podstawie swojej env.

Evidence: poker-progression.mjs::readPokerBankroll już czyta balance z USER z opcjonalnym FOR UPDATE; obecnie missing zwraca0 — gate musi rozróżnić brak konta od prawdziwego0. evaluatePokerProgression jest czyste i nie powinno otrzymać ukrytych zapisów. join.mjs::executePokerJoinAuthoritative blokuje table,state, czyta seats, obsługuje rejoin przed nowym buy-in, odczytuje balance pod lockiem.

Rationale: osobna tabela klasyfikacji dublowałaby trwałą tożsamość/lock USER. Brak fraud platform i post-cashout hook: post-cashout detektor uzależniałby wypłatę od nowych reguł. Leniwa detekcja przed nowym JOIN/funding jest dozwolona w issue. Nie wykrywa chwilowych peaków ani bogactwa w escrow.

Klasyfikacja zaobserwowana staje się authoritative po COMMIT. Znana odmowa policy/tier/full przed finansami musi zwrócić wynik zamiast throw, by zachować update. Błąd SQL/unavailable oznacza rollback, zero admission/funding; następny request ponawia odczyt. Nie twierdzić, że nieudany COMMIT jest trwałą detekcją. Rejoin zachowuje finansowane miejsce i dostęp do legalnych akcji.

## R2 — wszystkie dodatnie transfery

| Live entry | Evidence / future integration |
|---|---|
| shared/poker-domain/bots.mjs::seedBotsForJoin | seats + SYSTEM→ESCROW TABLE_BUY_IN, savepoint per bot; gate przed dodatnim seed, nie actor/createdBy |
| shared/poker-domain/join.mjs::executePokerJoinAuthoritative | seed po buy-in; klasyfikacja wszystkich ludzi i candidate musi nastąpić wcześniej, przed seat/debit |
| ws-server/poker/persistence/continuous-bot-table-repository.mjs | wywołuje seedBotsForJoin z allowBotsOnly/requireExactTarget; ten sam gate/source budget, bez specjalnego bypass |
| persisted-state-writer.mjs::writeReplacementFundings | mutacja seat/stack i ledger w tej samej tx co state CAS |
| persisted-state-writer.mjs::writeManagedBotTopUps | bot insert/topup i ledger w tej samej tx; nie tylko zwykły seed |

Decision: jeden planowany shared/poker-domain/bot-access.mjs helper, używany przez JOIN/seed i writer; argumenty z locked membership i USER rows. Nie nowy silnik. Unknown membership fail-closed, brak query per lobby viewer/table. Odczyt wielu USER w jednym uporządkowanym query, liczba ograniczona pojemnością stołu. Bot-only ma pusty human set, nadal finance guards.

## R3 — mixed i finansowo neutralny rollover

writer::writeViaDb obecnie najpierw CAS poker_state, potem human projections i oba fundings. Gate przed CAS, pod wspólnym table/state lock; deny zwraca strukturalny wynik bez funded state. Nie połknąć wyjątku finansowania i nie zatwierdzić fikcyjnych stacków.

server.mjs::runSettledRolloverCommand już obsługuje bot_bounded_bankroll_exhausted500: restore persisted SETTLED→prepareSettledHandRollover(allowBotFunding:false)→persist pustych planów→restore committed state. Rozszerzyć tę ścieżkę dla restriction/unknown/cap i obu tierów, zachowując bounded retry. Nie uruchamiać normalnego commitSettledHandRollover na unfunded planie: metoda ponownie oblicza replacement/topup i może odrzucić mismatch. Reuse restore jest mniejsze niż nowy model planu. Brak wymuszonego zamknięcia; za mało uprawnionych funded graczy daje oczekiwanie i legalne leave.

CONTINUOUS_BOT lifecycle_kind/managed_profile_key, rotacja i bot-only seed pozostają. Connected/disconnected nie zmienia membership; pending leave nadal liczy się do gate do ukończenia roszczenia i seat removal.

## R4 — skończony refill

Brak istniejącego runtime auto-refillu. Migracja20260810100000_poker_bot_bankroll.sql daje jednorazowy1m CH GENESIS→POKER_BOT_BANKROLL, klucz seed:poker-bot-bankroll:v1. Nie powtarzać ani reinterpretować alokacji. table-economy.mjs:100→cfg.bankrollSystemKey/default TREASURY;500→POKER_BOT_BANKROLL; inne tiery bez bot fundingu.

Decision: lifetime cap zamiast rolling/calendar window. Propozycja100000/500000, po1000 nominalnych buy-in; twarde600000 nowych CH łącznie, bez automatycznego resetu. To kontrolowany budżet ryzyka do review, nie prognoza wystarczalności. Default disabled; liczby i aktywacja jawnie zatwierdzane przed włączeniem. Zero cap to całkowite wyłączenie refillu. Wybranie0 zamiast propozycji nie wymaga innej architektury.

Refill gdy source balance<buy-in: dokładnie brakująca kwota buyIn−balance (maksymalnie100/500) na próbę, tylko jeśli cała mieści się w remaining cap. Bez częściowego dopełnienia, które nadal nie pozwoli sfinansować jednego bota. Ostatni dozwolony refill może zostać wydany raz przez normalny funding. Cap ogranicza nową emisję, nie konfiskuje już istniejącej płynności; po wyczerpaniu cap i wydaniu istniejącej płynności finansowanie pauzuje. Zwroty botów mogą ponownie zasilać to samo źródło bez zmniejszania issued_ch. Dodatkowe ręczne zasilenia poza tą automatyzacją wymagają osobnej autoryzacji i nie są objęte obietnicą cap całej platformy. TREASURY jest współdzielone: ten plan nie ogranicza innych emisji platformy, co musi pozostać jawne w review.

Scheduler: rozszerzyć istniejący WS janitor/sweep jedną koalescowaną pracą poza table queue. Maks1 job/proces,2 policy rows/cykl,1 transakcja/tier, cooldown60s/tier, bez natychmiastowej pętli retry; timeout2s i lock_timeout250ms propozycją ochrony do przyszłej walidacji. Nie benchmarkować teraz. Brak aktywnego zapotrzebowania istniejącego live bot table→brak próby. Nie utrzymywać table lock podczas refillu. Po timeout oddać sterowanie i odtworzyć pending operationId/replay przed nową próbą. Max1 buy-in/job i lifetime cap ograniczają pracę i emisję; nie gwarantują dostępności.

## R5 — ledger/retention i payout

WS chips-ledger.mjs::postTransaction dopuszcza TABLE_BUY_IN; general netlify/functions/_shared/chips-ledger.mjs ma MINT enum, lecz validateEntries odrzuca no-USER poza bot buy-in/cash-out. Nie zakładać gotowej obsługi SYSTEM→SYSTEM MINT. Najmniejsza zmiana: ściśle ograniczony helper refillu w shared/poker-domain/bot-refill.mjs używa general adaptera z nową wewnętrzną walidacją GENESIS→dokładny source, kwota/policy/receipt w tej samej tx. Nie poszerzać publicznego mint endpointu ani generycznej możliwości wywołania nowego kształtu bez cap. WS adapter buy-in pozostaje poza mint.

Oba adaptery mają payload hash, idempotency registry i atomowe entries/balance. Ich CTE FOR UPDATE nie gwarantuje kolejności account_id. Dla dotkniętych finansowych transakcji prelock pełnego zbioru kont w rosnącym id; sprawdzić zgodność obu adapterów i source/ESCROW przed nową blokadą USER. Nie dopisywać reverse lock order ani retry w aborted tx.

terminal-close.mjs::executeTerminalPokerCloseInTx: table→state→seats→ESCROW→source, claims==escrow, postTerminalHumanCashout/attributed bot returns, zero escrow, CAS/CLOSED. leave.mjs::postHumanLeaveCashoutInTx i zwykłe settlement pozostają bez nowego access/refill gate. Restriction to dostęp do nowego finansowania, nie blokada wypłat. Przyszły test wykazuje payout po restriction/cap denial; pełna awaria DB nadal recovery.

## Porównanie #869

| #869 | #1018 |
|---|---|
| FAST7d, SLOW rolling12h, jednostki między tierami | zbędne; brak EXPOSURE |
| per-human FUNDING/EXPOSURE journal | zbędny nowy journal; istniejący ledger identyfikuje rzeczywisty transfer |
| SLOW_SHARED, oddzielne pule90/10 | zbędne; istniejące źródła i lifecycle |
| global FAST_EXHAUSTED fanout,30min drain | zbędne; dynamiczny gate przy nowym funding, mixed naturalne wyjście |
| proof-based loss refill, CLOSE_PROOF/PENDING | zbędne; finite lifetime cap niezależny od strat; istniejące terminal proof/invariants pozostają |
| pełne WS-first lobby/max32, usunięcie Create | poza zakresem; final JOIN i neutralna odmowa |

Mniejsza liczba stanów i query; ceną jest farming poniżej progu, brak obietnicy ciągłej dostępności botów, potencjalnie fałszywe restriction bogatych zwykłych kont. Przyjęcie #1018 nie wdraża ani nie kasuje #869. Użytkownik wybierze alternatywę po review.
