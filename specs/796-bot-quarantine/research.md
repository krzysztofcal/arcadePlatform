# Research — #1018

## Evidence and workflow

Live GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`, issue updated2026-09-26T08:58:10Z. Odczyt agents.md, skills.md, constitution1.1.1, repo templates i umiejscowienia kodu; bez DB, aplikacji, testów i środowisk. Spec Kit specify→clarify (decyzje poniżej)→plan→checklist→tasks→analyze. Wszystkie nowe nazwy są planowane, nie rzekomo istniejące API.

## R1 — storage i detekcja

Decision: istniejący USER chips_accounts z polami poker_bot_access, detection metadata. NORMAL→RESTRICTED monotonicznie pod blokadą konta. Wspólny shared classifier/parser używa singleton config row zamiast niezależnych env overrides; kontrakt opisuje threshold1mld i serializację wersji między WS i Netlify Create. Discovery nie klasyfikuje; authenticated Create jest teraz authoritative classification point.

Evidence: poker-progression.mjs::readPokerBankroll już czyta balance z USER z opcjonalnym FOR UPDATE; obecnie missing zwraca0 — gate musi rozróżnić brak konta od prawdziwego0. evaluatePokerProgression jest czyste i nie powinno otrzymać ukrytych zapisów. join.mjs::executePokerJoinAuthoritative blokuje table,state, czyta seats, obsługuje rejoin przed nowym buy-in, odczytuje balance pod lockiem.

Rationale: osobna tabela klasyfikacji dublowałaby trwałą tożsamość/lock USER. Brak fraud platform i post-cashout hook: post-cashout detektor uzależniałby wypłatę od nowych reguł. Leniwa detekcja przy human Create i przed nowym JOIN/funding jest dozwolona w issue. Nie wykrywa chwilowych peaków ani bogactwa w escrow.

Klasyfikacja zaobserwowana staje się authoritative po COMMIT. Znana odmowa policy/tier/full przed finansami musi zwrócić wynik zamiast throw, by zachować update. Błąd SQL/unavailable oznacza rollback, zero admission/funding; następny request ponawia odczyt. Nie twierdzić, że nieudany COMMIT jest trwałą detekcją. Rejoin zachowuje finansowane miejsce i dostęp do legalnych akcji.

## R2 — wszystkie dodatnie transfery

| Live entry | Evidence / future integration |
|---|---|
| shared/poker-domain/bots.mjs::seedBotsForJoin | seats + SYSTEM→ESCROW TABLE_BUY_IN, savepoint per bot; gate przed dodatnim seed, nie actor/createdBy |
| shared/poker-domain/join.mjs::executePokerJoinAuthoritative | seed po buy-in; klasyfikacja wszystkich ludzi i candidate musi nastąpić wcześniej, przed seat/debit |
| ws-server/poker/persistence/continuous-bot-table-repository.mjs | wywołuje seedBotsForJoin z allowBotsOnly/requireExactTarget; ten sam gate/source budget, bez specjalnego bypass |
| persisted-state-writer.mjs::writeReplacementFundings | mutacja seat/stack i ledger w tej samej tx co state CAS |
| persisted-state-writer.mjs::writeManagedBotTopUps | bot insert/topup i ledger w tej samej tx; nie tylko zwykły seed |

Decision: jeden planowany shared/poker-domain/bot-access.mjs helper, używany przez JOIN/seed i writer; argumenty z locked membership i USER rows. Nie nowy silnik. Unknown membership fail-closed, brak query per lobby viewer/table. Odczyt wielu USER w jednym uporządkowanym query, liczba ograniczona pojemnością stołu. Bot-only ma pusty human set, ale marker true zawsze zabrania finansowania; nadal finance guards.

## R3 — mixed i finansowo neutralny rollover

writer::writeViaDb obecnie najpierw CAS poker_state, potem human projections i oba fundings. Gate przed CAS, pod wspólnym table/state lock; deny zwraca strukturalny wynik bez funded state. Nie połknąć wyjątku finansowania i nie zatwierdzić fikcyjnych stacków.

server.mjs::runSettledRolloverCommand już obsługuje bot_bounded_bankroll_exhausted500: restore persisted SETTLED→prepareSettledHandRollover(allowBotFunding:false)→persist pustych planów→restore committed state. Rozszerzyć tę ścieżkę dla restriction/unknown/refill failure i obu tierów, zachowując bounded retry. Nie uruchamiać normalnego commitSettledHandRollover na unfunded planie: metoda ponownie oblicza replacement/topup i może odrzucić mismatch. Reuse restore jest mniejsze niż nowy model planu. Brak wymuszonego zamknięcia; za mało uprawnionych funded graczy daje oczekiwanie i legalne leave.

CONTINUOUS_BOT lifecycle_kind/managed_profile_key, rotacja i bot-only seed pozostają. Connected/disconnected nie zmienia membership; pending leave nadal liczy się do gate do ukończenia roszczenia i seat removal.

## R4 — demand-driven autorefill, bez lifetime cap

Ponowny live read main93d0f191c3f87006d56f7afb2fb1c4052a7ecb84: brak runtime auto-refillu; jednorazowa migracja20260810100000_poker_bot_bankroll.sql alokuje1m500 przez seed:poker-bot-bankroll:v1. table-economy:100→configured legacy/default TREASURY;500→POKER_BOT_BANKROLL. Nie powtarzać historycznego seeda.

Decision po wiążącej korekcie issue: usunąć lifetime policy/counter i osobny scheduler. Planowany shared/poker-domain/bot-refill.mjs::postBotFundingWithRefill wykonuje krótki composite transfer w istniejącej transakcji konkretnego seed/replacement/topup. Najpierw replay oryginalnego funding key; potem config FOR SHARE i table/state lock, pełny gate wszystkich humans, walidacja planu i uporządkowane account locks. Source balance B (ujemne/nieprawidłowe saldo→integrity failure,zero mint); wymagany rzeczywisty funding F; emisja D=max(0,F−B). Jeśli D>0, MINT GENESIS→dokładny source; zaraz TABLE_BUY_IN source→escrow i existing registry. Wszystko w jednym tx/savepoint ze zmianą seat/stack/state. Błąd następnego kroku cofa także MINT; nie ma emisji na później ani refillu po samym zobaczeniu niskiego salda.

TREASURY nie wymaga wydzielonej puli100: lock istniejącego źródła od świeżego balance read do jego debitu sprawia, że inny stół/wydatek nie przejmie tej samej uzupełnionej kwoty między mint a funding. Wszystkie funding paths sprawdzają gate również gdy płynność już istnieje. RESTRICTED nie dostaje świeżych CH ze wspólnego source nawet po refillu dla NORMAL; nadal może legalnie wygrać wcześniej finansowany stack. Shared source powoduje contention, ale nie uzasadnia usunięcia autorefillu ani90/10.

Wymagana eligible gra: is_farmer_only=false i brak RESTRICTED/unknown we wszystkich seated humans, joining human NORMAL jeśli występuje. Existing managed CONTINUOUS_BOT bot-only init/rollover zachowuje lifecycle: pusty human set przechodzi gate tylko przy rzeczywistym serwerowym managed planie, nie przy dowolnym żądaniu mint. Jest to zachowanie bez RESTRICTED, nie obejście dla twórcy stołu; próbujący dołączyć RESTRICTED później otrzymuje odmowę nowego JOIN do tego zwykłego managed stołu. Ordinary no-human bez existing authorized seed/rollover plan nie generuje zapotrzebowania.

Granice techniczne: jeden composite refill na trwały funding_key, D<=F<=buyIn per bot; suma F<=liczba faktycznych deltas*buyIn, deltas<=maxPlayers. Seed/rollover przetwarzają jedną existing decyzję wersji, nie zapętlają kolejnych emisji. Source/GENESIS lock_timeout250ms, łączny deadline nowej operacji funding2s (statement_timeout ograniczony pozostałym budżetem; przekroczenie→rollback całej próby) jako propozycja do przyszłej runtime walidacji, nie zmierzone SLO. Najwyżej jedno kontrolowane ponowienie tej samej tożsamości po rozstrzygniętym rollback; unknown commit najpierw recovery. Brak background refill cykli i tight retry. Nowa próba wymaga aktualnego realnego niezaspokojonego planu, nie tylko nowego operationId. Istniejący runtime scheduler/backoff nie może wielokrotnie wyemitować tej samej delty.

Refill jest częścią wyłącznie nowego fundingu, nie settlement ani cash-out. Krótkie locki mogą czasowo opóźnić kolejny command FIFO; nie deklarować priority/preemption. Denial/timeout kończy transakcję i zwalnia kolejkę; istniejący no-funding fallback chroni rozliczoną rękę. Brak zewnętrznego job/oczekiwania na globalny guard, pełnego skanu i pre-mint. Awaria całej DB nadal recovery.

Alternatywy odrzucone: osobny scheduler mint→późniejszy funding wymagałby durable reservations/ponownej autoryzacji i mógł zostawić CH po odmowie; nowa pula100/refill service zwiększa zakres; lifetime100k/500k przeczy zatwierdzonej dostępności NORMAL i jest zastąpione. Brak globalnego limitu emisji w czasie jest świadomą polityką; NORMAL farming akceptowane.

## R4a — has_human_participant przy denied JOIN

Live join.mjs ustawia marker przed loadStateForUpdate/seat lookup i dotąd rollback wyjątku chronił false. Structured denial commit wymaga przeniesienia tego zapisu. Dla nowego admission dopiero po wszystkich wymaganych walidacjach i zaakceptowanym seat/buy-in/state, w tej samej tx; dla rzeczywiście istniejącego accepted rejoin przed udanym COMMIT każdej ścieżki rejoin. Denial commit utrwala tylko classification, marker bot-only zostaje false. Nigdy nie resetować wcześniejszego true. Jeden fundamentalny test: bot-only false, candidate przekracza próg, nowy JOIN odrzucony np. z powodu niedozwolonego tieru; po commit RESTRICTED, zero seat/debit, marker=false.

## R5 — ledger/retention i payout

WS chips-ledger.mjs::postTransaction dopuszcza TABLE_BUY_IN; general netlify/functions/_shared/chips-ledger.mjs ma MINT enum, lecz validateEntries odrzuca no-USER poza bot buy-in/cash-out. Nie zakładać gotowej obsługi SYSTEM→SYSTEM MINT. Najmniejsza zmiana: ściśle ograniczony composite helper w shared/poker-domain/bot-refill.mjs używa general adaptera z wewnętrzną walidacją GENESIS→dokładny source, fresh gate/demand/registry w tej samej tx. Nie poszerzać publicznego mint endpointu ani generycznej możliwości wywołania nowego kształtu bez authoritative gate/demand. WS adapter buy-in pozostaje poza mint.

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

## R6 — zamknięcie table hopping (review a6a2107)

Schema sprawdzona: poker_tables ma lifecycle_kind STANDARD/CONTINUOUS_BOT,managed_profile_key i one-way has_human_participant; brak farmer/quarantine pola. Wybrano is_farmer_only boolean NOT NULL DEFAULT false z one-way ochroną true. Nie nowe klasy z #869 i nie replacement lifecycle.

Nie wystarczy dynamiczny human gate: restricted mógł zużyć prefunded stół, odejść i wrócić po refill. Zwykły pusty/prefunded/CONTINUOUS_BOT stół odmawia nowego RESTRICTED zawsze. Farmer-only odmawia NORMAL i każdego bot funding/refillu również pusty. Wykryty już seated człowiek utrwala marker przy następnej authoritative kontroli; jego dotychczasowi NORMAL współgracze zachowują rękę/rejoin/legalne leave, ale nie nowe admission. Leave/deferred finalization utrwala marker istniejącej restriction przed usunięciem membership, bez nowego payout eligibility gate (kontrakt). Nie ma globalnego fanout/drain.

Minimalny start: existing poker-create-table.mjs::handler→_shared/poker-table-init.mjs::createPokerTableWithState tworzy table+INIT+empty ESCROW, bez seed. Helper klasyfikuje authenticated twórcę z locked USER balance i wspólnego threshold,utrwala restriction i marker atomowo przy INSERT. Wszyscy callers współdzielą helper; managed no-human create nie omija późniejszego JOIN gate. Claim istniejącego zwykłego stołu odrzucony: wymagałby dodatkowych dowodów pustki/funding history i grozi przejęciem prefunded inventory. Pierwszy farmer może utworzyć i zająć farmer-only, czeka na drugiego bez finansowanych botów. Istniejące progression/stakes nadal obowiązują.

Runtime projected tableMeta.isFarmerOnly przez bootstrap repository/db/adapter i table-manager jest tylko projekcją; final JOIN/funding sprawdza locked DB marker. Brak nowego lobby engine; błędna rekomendacja może neutralnie odmówić. Zwykłe managed replacement tables pozostają ordinary i odmawiają RESTRICTED; nie przenosić farmer membership automatycznie na nowy normalny stół. Quarantined table nie jest resetowane ani relabel przy rotacji/reuse.

Cztery fundamentalne scenariusze: restricted fresh prefunded/continuous odmowa; leave/restart marker sticky i zero refill; normal farmer-only odmowa/drugi restricted sukces; restricted Create→empty INIT farmer-only→JOIN zero bot CH. Wykorzystać existing join/leave/writer/create behavior tests, bez UI tests. Historyczna zasada empty first-class claim/dynamic funding reset jest zastąpiona tą korektą.

## R7 — retention review fe968a4, decyzja bez nowej tabeli

Live main93d0f191c3f87006d56f7afb2fb1c4052a7ecb84 sprawdzony ponownie. WS chips-ledger.mjs::findIdempotencyRecord / assert identity oraz general chips-ledger korzystają z chips_transaction_idempotency,payload_hash,unique conflict savepoint i transaction_id także po hot prune. To wystarcza do exactly-once composite tx: istniejący funding key jest tożsamością całej decyzji, po D=0 nie powstaje drugi rekord. Osobny poker_bot_refill_receipts odrzucony jako niepotrzebny trwały wzrost.

Dowód luki retencji: scripts/ops/chips-ledger-archive-prune.mjs ALLOWED_TX_TYPES obejmuje obecnie TABLE_BUY_IN/TABLE_CASH_OUT, tableIdForRecord i shape checker wymagają ESCROW; nowy MINT ma dwa SYSTEM. chips-ledger-archive-export.mjs selektory bot-only/closed-human i registry joins filtrują te same typy. DB guard chips_guard_idempotency_mutations i TABLE binding/fence w migracji20260819220000 oraz bot-only proof selectors20260905160000/20260907100000,closed-human20260904100000/20260907120000,missing-table retirement20260911100000 też wymagają dostosowania. Samo metadata.tableId nie daje retention eligibility.

Plan: jedna addytywna migracja rozszerza istniejące funkcje/fences/strict key parser o wyłącznie bot-refill:<valid existing funding key>, jego zgodny table binding i zweryfikowaną parę MINT GENESIS→source + TABLE_BUY_IN. General MINT nie staje się bot-only/human prune eligible. W existing export/prune dodać narrow shape branch dla tej pary, zachować audit/source attribution i manifest hash. Exclude ten namespace z ogólnego30d exportu, jeśli omijałby table closure/holds; objąć właściwą table lane7d/closed-human30d. Rozszerzyć stary versioned archive reader kompatybilnie, nie reinterpretować starych manifests ani ręcznie seed MINT historycznych. Candidate proof,execute validation,registry retirement i missing-table cleanup muszą zgadzać się co do tego samego namespace. Nie wystarcza zmienić jednej JS allowlist.

Funding+MINT mogą mieć różne IDs i trafiać do bounded batches: table lifecycle completion dopiero po dowodzie export/prune obu powiązań; existing pending/manifest recovery zachowuje postęp. Nie dokładać archiwizatora ani permanentnego pair tombstone. Po skutecznym usunięciu registry replay starego key jest zablokowany przez closed/deleted/retired table i stale state plan,nie przez wieczny receipt. Brak aktualnego OPEN/plan dowodu daje zero emisji. Existing active registry nie jest usuwany tylko dlatego, że minęło7/30dni.

Fundamentalne dowody T013/T016/T017: D=0 jeden funding registry; D>0 atomic pair i retry/unknown once; export/prune7d i human30d rozpoznają typed MINT bez wpuszczenia unrelated MINT; missing-table registry retirement i ponowienie starego key po cleanup→zero mint; cleanup vs funding race fenced. Bez uruchamiania teraz SQL/tests.

## Handoff — live issue sync przed T001

Live #1018 nadal zawiera starsze empty/bot-only admission i nie opisuje is_farmer_only. Review użytkownika zatwierdził farmer-only,ale adnotacja issue-source nie zastępuje aktualizacji issue. Przed T001 właściciel/autor musi zsynchronizować live #1018 z zatwierdzonym markerem,admission,sticky no-funding i first Create flow. Do tego czasu STOP implementacji. W tej korekcie nie zmieniamy issue #869/PR#1017 ani samodzielnie treści live #1018.

## R8 — first-farmer Create i wspólna konfiguracja

Review f166a0b wykazał lukę durable NORMAL mimo balance>=threshold. Zastąpiono odczyt samej klasy wspólnym classifierem w create tx przed INSERT. Existing helper jest współdzielony przez manual Create i Quick Seat fallback. Final JOIN nie traci authority. Managed userId=null wyjątek wyłącznie trusted server lifecycle,nie publiczny payload.

Identical env parser nie dowodzi zgodności env dwóch runtime. Nie znaleziono ogólnego istniejącego autorytatywnego config storage dla tego progu; wybrano jeden ograniczony singleton row zamiast nowego endpointu/handshake/fraud service. Shared bot-access.mjs loader/parser/classifier i config FOR SHARE zapewniają tę samą politykę; independent env overrides odrzucone. To stała liczba1 wiersza,nie powrót permanentnych per-funding receipts. Unknown fail-closed. Kontrakt/data-model podają pola i lock order.

Jedyny nowy/rozszerzony fundamentalny przypadek: persisted NORMAL,balance>=1mld,Create klasyfikuje i atomowo tworzy empty farmer-only; późniejszy JOIN ma sukces bez bot funding przy legalnym tierze i miejscu. Brak renderowania UI i testów glue.

## UNKNOWN przy legalnym leave — korekta review

Tylko known durable RESTRICTED ustawia is_farmer_only=false→true. Known NORMAL i UNKNOWN nie zmieniają markera przy otherwise legal leave/cash-out i nie blokują payout; wcześniejsze true pozostaje sticky. Nie emitować ani finansować botów podczas niepewnej operacji. Po successful membership removal kolejne admission/funding używają normalnego authoritative classifier/gate; powrót przez Create/JOIN ponownie ocenia balance. UNKNOWN w nowym admission/funding nadal fail-closed. Missing class nie oznacza dowodu restriction. To nie obietnica payout przy całkowitej awarii DB; istniejąca transakcyjna poprawność i recovery pozostają.
