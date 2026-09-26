# Research — #1018

## Evidence and workflow

Live GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`, issue updated2026-09-26T08:58:10Z. Odczyt agents.md, skills.md, constitution1.1.1, repo templates i umiejscowienia kodu; bez DB, aplikacji, testów i środowisk. Spec Kit specify→clarify (decyzje poniżej)→plan→checklist→tasks→analyze. Wszystkie nowe nazwy są planowane, nie rzekomo istniejące API.

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

server.mjs::runSettledRolloverCommand już obsługuje bot_bounded_bankroll_exhausted500: restore persisted SETTLED→prepareSettledHandRollover(allowBotFunding:false)→persist pustych planów→restore committed state. Rozszerzyć tę ścieżkę dla restriction/unknown/refill failure i obu tierów, zachowując bounded retry. Nie uruchamiać normalnego commitSettledHandRollover na unfunded planie: metoda ponownie oblicza replacement/topup i może odrzucić mismatch. Reuse restore jest mniejsze niż nowy model planu. Brak wymuszonego zamknięcia; za mało uprawnionych funded graczy daje oczekiwanie i legalne leave.

CONTINUOUS_BOT lifecycle_kind/managed_profile_key, rotacja i bot-only seed pozostają. Connected/disconnected nie zmienia membership; pending leave nadal liczy się do gate do ukończenia roszczenia i seat removal.

## R4 — demand-driven autorefill, bez lifetime cap

Ponowny live read main93d0f191c3f87006d56f7afb2fb1c4052a7ecb84: brak runtime auto-refillu; jednorazowa migracja20260810100000_poker_bot_bankroll.sql alokuje1m500 przez seed:poker-bot-bankroll:v1. table-economy:100→configured legacy/default TREASURY;500→POKER_BOT_BANKROLL. Nie powtarzać historycznego seeda.

Decision po wiążącej korekcie issue: usunąć lifetime policy/counter i osobny scheduler. Planowany shared/poker-domain/bot-refill.mjs::postBotFundingWithRefill wykonuje krótki composite transfer w istniejącej transakcji konkretnego seed/replacement/topup. Najpierw replay oryginalnego funding key; potem table/state lock, pełny gate wszystkich humans, walidacja planu i uporządkowane account locks. Source balance B (ujemne/nieprawidłowe saldo→integrity failure,zero mint); wymagany rzeczywisty funding F; emisja D=max(0,F−B). Jeśli D>0, MINT GENESIS→dokładny source; zaraz TABLE_BUY_IN source→escrow i receipt. Wszystko w jednym tx/savepoint ze zmianą seat/stack/state. Błąd następnego kroku cofa także MINT; nie ma emisji na później ani refillu po samym zobaczeniu niskiego salda.

TREASURY nie wymaga wydzielonej puli100: lock istniejącego źródła od świeżego balance read do jego debitu sprawia, że inny stół/wydatek nie przejmie tej samej uzupełnionej kwoty między mint a funding. Wszystkie funding paths sprawdzają gate również gdy płynność już istnieje. RESTRICTED nie dostaje świeżych CH ze wspólnego source nawet po refillu dla NORMAL; nadal może legalnie wygrać wcześniej finansowany stack. Shared source powoduje contention, ale nie uzasadnia usunięcia autorefillu ani90/10.

Wymagana eligible gra: brak RESTRICTED/unknown we wszystkich seated humans, joining human NORMAL jeśli występuje. Existing managed CONTINUOUS_BOT bot-only init/rollover zachowuje lifecycle: pusty human set przechodzi gate tylko przy rzeczywistym serwerowym managed planie, nie przy dowolnym żądaniu mint. Jest to zachowanie bez RESTRICTED, nie obejście dla twórcy stołu; dołączający RESTRICTED później korzysta wyłącznie ze starych stacków i blokuje każdy kolejny funding. Ordinary no-human bez existing authorized seed/rollover plan nie generuje zapotrzebowania.

Granice techniczne: jeden composite refill na trwały funding_key, D<=F<=buyIn per bot; suma F<=liczba faktycznych deltas*buyIn, deltas<=maxPlayers. Seed/rollover przetwarzają jedną existing decyzję wersji, nie zapętlają kolejnych emisji. Source/GENESIS lock_timeout250ms, łączny deadline nowej operacji funding2s (statement_timeout ograniczony pozostałym budżetem; przekroczenie→rollback całej próby) jako propozycja do przyszłej runtime walidacji, nie zmierzone SLO. Najwyżej jedno kontrolowane ponowienie tej samej tożsamości po rozstrzygniętym rollback; unknown commit najpierw recovery. Brak background refill cykli i tight retry. Nowa próba wymaga aktualnego realnego niezaspokojonego planu, nie tylko nowego operationId. Istniejący runtime scheduler/backoff nie może wielokrotnie wyemitować tej samej delty.

Refill jest częścią wyłącznie nowego fundingu, nie settlement ani cash-out. Krótkie locki mogą czasowo opóźnić kolejny command FIFO; nie deklarować priority/preemption. Denial/timeout kończy transakcję i zwalnia kolejkę; istniejący no-funding fallback chroni rozliczoną rękę. Brak zewnętrznego job/oczekiwania na globalny guard, pełnego skanu i pre-mint. Awaria całej DB nadal recovery.

Alternatywy odrzucone: osobny scheduler mint→późniejszy funding wymagałby durable reservations/ponownej autoryzacji i mógł zostawić CH po odmowie; nowa pula100/refill service zwiększa zakres; lifetime100k/500k przeczy zatwierdzonej dostępności NORMAL i jest zastąpione. Brak globalnego limitu emisji w czasie jest świadomą polityką; NORMAL farming akceptowane.

## R4a — has_human_participant przy denied JOIN

Live join.mjs ustawia marker przed loadStateForUpdate/seat lookup i dotąd rollback wyjątku chronił false. Structured denial commit wymaga przeniesienia tego zapisu. Dla nowego admission dopiero po wszystkich wymaganych walidacjach i zaakceptowanym seat/buy-in/state, w tej samej tx; dla rzeczywiście istniejącego accepted rejoin przed udanym COMMIT każdej ścieżki rejoin. Denial commit utrwala tylko classification, marker bot-only zostaje false. Nigdy nie resetować wcześniejszego true. Jeden fundamentalny test: bot-only false, candidate przekracza próg, nowy JOIN odrzucony np. z powodu niedozwolonego tieru; po commit RESTRICTED, zero seat/debit, marker=false.

## R5 — ledger/retention i payout

WS chips-ledger.mjs::postTransaction dopuszcza TABLE_BUY_IN; general netlify/functions/_shared/chips-ledger.mjs ma MINT enum, lecz validateEntries odrzuca no-USER poza bot buy-in/cash-out. Nie zakładać gotowej obsługi SYSTEM→SYSTEM MINT. Najmniejsza zmiana: ściśle ograniczony composite helper w shared/poker-domain/bot-refill.mjs używa general adaptera z wewnętrzną walidacją GENESIS→dokładny source, fresh gate/demand/receipt w tej samej tx. Nie poszerzać publicznego mint endpointu ani generycznej możliwości wywołania nowego kształtu bez authoritative gate/demand. WS adapter buy-in pozostaje poza mint.

Oba adaptery mają payload hash, idempotency registry i atomowe entries/balance. Ich CTE FOR UPDATE nie gwarantuje kolejności account_id. Dla dotkniętych finansowych transakcji prelock pełnego zbioru kont w rosnącym id; sprawdzić zgodność obu adapterów i source/ESCROW przed nową blokadą USER. Nie dopisywać reverse lock order ani retry w aborted tx.

terminal-close.mjs::executeTerminalPokerCloseInTx: table→state→seats→ESCROW→source, claims==escrow, postTerminalHumanCashout/attributed bot returns, zero escrow, CAS/CLOSED. leave.mjs::postHumanLeaveCashoutInTx i zwykłe settlement pozostają bez nowego access/refill gate. Restriction to dostęp do nowego finansowania, nie blokada wypłat. Przyszły test wykazuje payout po restriction/refill denial; pełna awaria DB nadal recovery.

## Porównanie #869

| #869 | #1018 |
|---|---|
| FAST7d, SLOW rolling12h, jednostki między tierami | zbędne; brak EXPOSURE |
| per-human FUNDING/EXPOSURE journal | zbędny nowy journal; istniejący ledger identyfikuje rzeczywisty transfer |
| SLOW_SHARED, oddzielne pule90/10 | zbędne; istniejące źródła i lifecycle |
| global FAST_EXHAUSTED fanout,30min drain | zbędne; dynamiczny gate przy nowym funding, mixed naturalne wyjście |
| proof-based loss refill, CLOSE_PROOF/PENDING | zbędne; dokładny demand-driven refill niezależny od strat; istniejące terminal proof/invariants pozostają |
| pełne WS-first lobby/max32, usunięcie Create | poza zakresem; final JOIN i neutralna odmowa |

Mniejsza liczba stanów i query; ceną jest farming NORMAL poniżej progu i potencjalnie fałszywe restriction bogatych zwykłych kont. Autorefill utrzymuje dostępność NORMAL, z wyjątkiem rzeczywistych awarii/timeoutów. Przyjęcie #1018 nie wdraża ani nie kasuje #869. Użytkownik wybierze alternatywę po review.
