# Research — issue #869

Data: 2026-09-24. Badanie wyłącznie kodu i źródeł; nie badano ani nie zmieniano żywego Stage/Production. Źródło polityki: [issue-source.md](issue-source.md). GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`; baza bieżącej korekty PR `6478ffe0a61e4f5b3d334780fabf5fc0f65d201a`. Pobrano aktualne repozytorium do katalogu tymczasowego i porównano główne pliki domeny oraz agents.md/skills.md/konstytucję: zgodne. Nie użyto repomix.

## Decyzje techniczne i istniejące mechanizmy

| Obszar | Decision | Rationale / Alternatives considered |
|---|---|---|
| Budżet | Jeden wiersz na konto, blokowany w transakcji istniejącego join/writera; nowy mały moduł `shared/poker-domain/bot-budget.mjs` | Nie istnieje trwały limit dostępu; portfel USER i cache WS nie zastępują go. Moduł współdzielony zapobiega dwóm algorytmom. |
| Jednostki | Dokładny integer: 10 000 podjednostek na buy-in; delta * (10 000 / tier) | Wszystkie projektowane tiery 100/500/1000/5000/10000 dzielą 10000. 1 CH przy 100 to 100, przy 500 to 20 podjednostek. Bez float, bez zaokrągleń. Inny przyszły tier wymaga jawnej zmiany reprezentacji. |
| Admission | Konserwatywne pełne live bot stacks dla nowego gracza, osobna autoryzacja każdego człowieka przy nowym fundingDelta | `join.mjs` już blokuje table i state i finansuje seat. Nie dzielić fungible escrow na hipotetycznych właścicieli. Znaczniki ekspozycji i powiązanie źródła opisuje kontrakt. |
| Transakcja | Postgres beginSql/tx; commit DB przed commit runtime/broadcast | Join ma transakcję; writer posiada expectedVersion i receipts. Błąd finansowania ma wycofać cały kandydat, nie tylko pojedynczy bot savepoint. |
| Klasy | Oddzielne `bot_access_class` w poker_tables; bez slow_owner_user_id | `lifecycle_kind` oznacza STANDARD/CONTINUOUS_BOT i nie należy mieszać go z dostępem STANDARD/SLOW_SHARED/HUMAN_ONLY. |
| Slow | Najwyżej jeden bot seed z pełnym buy-in, wielu niezależnie uprawnionych humans; istniejące min/max bot count dla standard pozostają | `computeTargetBotCount` zwykle zakłada min. 2 boty, co nie mieści się w burst 1. Brak nowej mechaniki mikrostawkowych botów. |
| Draining | Oddzielne `bot_draining_started_at` i `bot_draining_deadline_at` | `handleContinuousBotRotationAtSettled` przy human postpones. Samo ustawienie rotation_due_at nie spełnia #869. |
| No funding | Rozszerzyć `allowBotFunding:false` na obydwa tiery i przyczyny odmowy | Obecna ścieżka w server jest ograniczona `buyIn === 500`, writer rozpoznaje tylko HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY. |
| Rezerwa | Rzeczywiście egzekwowane dwa salda klas w nowym `poker_bot_pool_state`, połączone z jednym istniejącym kontem SYSTEM na tier | Zachować POKER_BOT_BANKROLL dla 500 i nie komplikować terminal source. Podkonta odrzucone jako zbędne dla pilota. Sama kontrola dostępnego salda bez blokady/aktualizacji klas byłaby niewystarczająca. |
| Nowe 100 | SYSTEM key `POKER_BOT_BANKROLL_100`; provision zero balance w schema, osobna jednorazowa autoryzowana alokacja | Nie zmieniać historycznego seeda 500 ani source aktywnych stacków. D3 zatwierdza GENESIS i jeden milion, osobno od refillu. |
| Refill | Mały `shared/poker-domain/bot-bankroll.mjs` korzystający z istniejącego ledger `postTransaction`, uruchamiany po udowodnionym close i w istniejącym sweep | Nie ma potrzeby nowego serwisu/cron. Po crash sweep podejmuje pozostawiony dowód. Nigdy MINT w krytycznej transakcji wypłaty. |
| Audit | Kompaktowy certyfikat każdego zamknięcia i nieusuwalny rejestr kompensacji, podparty istniejącymi ledger/archives | `loadBotFundingRows` czyta hot ledger; ogólne metadata TABLE_CASH_OUT nie dowodzą straty botów. Hot history nie wolno uznać za bezterminowo dostępną. |

## Odkryte zależności, których nie wolno pominąć

1. `netlify/functions/poker-join.mjs` jest retired. Realne wejście biegnie przez `ws-server/poker/handlers/join.mjs`, `persistence/authoritative-join-adapter.mjs`, re-export `ws-server/shared/poker-domain/join.mjs`, następnie shared join. Adapter ma allowlistę kodów odmowy: trzeba ją rozszerzyć.
2. `poker-quick-seat.mjs::selectCandidate/createAndRecommend` rekomenduje stół, nie rezerwuje budżetu. Create Table używa `_shared/poker-table-init.mjs::createPokerTableWithState`. Lobby WS `buildLobbySnapshotPayload/sendLobbySnapshot` obecnie wysyła wspólną listę: potrzebna projekcja na odbiorcę i unieważnianie przy zmianie jego budżetu, nie tylko zmianie stołu.
3. `persisted-state-writer.mjs::writeViaDb` zmienia poker_state przed funding w tej samej transakcji. `writeMutation` po rollback może zwrócić trwałe reason. DENIED/DRAIN trzeba zatwierdzić jako wynik tej samej transakcji bez niedozwolonego kandydata (ewentualnie rollback jego savepoint); wycofanie całej transakcji i późniejszy osobny zapis pozostawia lukę na utratę pierwszego deadline.
4. Writer korzysta z **WS** `persistence/chips-ledger.mjs` (tylko TABLE_BUY_IN). Ledger Netlify `_shared/chips-ledger.mjs` obsługuje różne typy, lecz `validateEntries` odrzuca MINT bez USER (`missing_user_entry`). Nie wystarczy wywołać dzisiejsze postTransaction z GENESIS/SYSTEM. Plan przewiduje wąski wewnętrzny kontrakt MINT i rebalance, bez odblokowania publicznego `chips-tx` dla tych pul.
5. Managed top-up w `ws-server/poker/engine/poker-engine.mjs::topUpManagedBotsForNextHand` **dodaje nowego bota do wolnego miejsca**, z nowym botUserId i pełnym buy-in; writer zapisuje go jako `BOT_SEED_BUY_IN` z `managedBotTopUp`. Nie jest to doładowanie tego samego botUserId. Zachować ten kontrakt; nie przerabiać resolvera na tolerowanie duplikatów seed. Replacement z residual to osobna istniejąca ścieżka delta. Test ma chronić oba przypadki.
6. `resolveBotFundingSource` odrzuca `bot_provenance_mixed`; nowego źródła 100 nie wolno zastosować do replacement zachowującego stary residual TREASURY. Cutover wyłącza dalszy funding starych stołów i zachowuje dotychczasowe wypłaty; nie przepisuje historycznych entries.
7. `inactive-cleanup.mjs` może wstrzymać close z powodu człowieka i posiada stale-live cleanup. Wygaśnięcie budget drain musi trafić do osobnej, wąsko uprawnionej gałęzi wywołującej istniejący terminal close dopiero po SETTLED/bez żywej ręki; nie może używać generic force-close ani wymuszać zwrotu nierozliczonego potu.
8. `persisted-bootstrap-repository.mjs`, adapter, `table-manager` oraz repozytorium managed muszą przenosić nową klasę i deadline. Samo dodanie kolumn nie zabezpiecza restartu/start_hand.
9. Globalna lista stołów i istniejące seated bypass w join wymagają rozróżnienia odtworzenia istniejącego seat od NOWEGO dopuszczenia. Grace istniejących ludzi jest jawnym wyjątkiem, nie ogólnym zezwoleniem constrained.

## Zatwierdzone decyzje właściciela — aktualizacja 2026-09-25

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.

D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Odrzucone warianty: pełny skokowy grant slow na granicy cyklu, proporcjonalny token bucket, stałe tygodnie emisji oraz transfer istniejących środków zamiast GENESIS. Nie są opcjami do wyboru. Brak otwartych decyzji D1–D3.

### Globalne wyczerpanie fast — P1

Pierwszy zatwierdzony FAST_EXHAUSTED jest faktem konta, unikalnym dla (user_id, fast_period_start), z exhausted_at. Powstaje przy dokładnym wyczerpaniu któregokolwiek limitu fast po ostatniej legalnej ekspozycji lub pierwszej odmowie wymaganej ekspozycji z powodu niewystarczającego fast. Nie tworzyć go z powodu braku płynności ani arbitralnego progu pełnego buy-in. Pozostaje constrained do kolejnego okresu fast; nowy okres nie usuwa historycznego zdarzenia ani drenujących stołów.

W tej samej transakcji zapisać trwałe powiązania zdarzenia ze wszystkimi już zajętymi przez konto stołami STANDARD z botami, także pre-funded B bez żądania fundingu; uwzględnić nowy seat, jeśli ostatnia legalna ekspozycja go zatwierdza. Snapshot obejmuje leave_after_hand aż do rzeczywistego opuszczenia. HUMAN_ONLY i istniejące SLOW_SHARED są wyłączone z tego wyłącznie FAST-triggered drain. W audycie pozostają table_id i admission identity; późniejsze leave, usunięcie seat lub reset fast nie gubią obowiązku wygaszenia.

Zmiany członkostwa w `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `leave.mjs::executePokerLeave` i deferred leave finalizer oraz cleanup/writer muszą użyć tego samego guard konta: table → state/seats → posortowane konta → pool → ledger. Snapshot innych członkostw czytać po uzyskaniu guard w świeżym odczycie READ COMMITTED; nigdy blokować B podczas trzymania A/konta. Każdy zapis/usunięcie członkostwa musi być zinwentaryzowany, także terminal cleanup. Serializacja na guard zapewnia kompletną listę w chwili zdarzenia bez blokad wielu stołów naraz.

Po commit uruchomić istniejące `ws-server/server.mjs::enqueueTableCommand` dla powiązanych stołów, po jednym stole/transakcji. Restart/sweep ponawia nieprzeniesione powiązania. Fanout jest projekcją: autorytatywny DRAINING obowiązuje od exhausted_at nawet przed zapisem lokalnej meta. Każde admission (także przed seated rejoin early return), nowe finansowanie i każdy start_hand/bootstrap/prepare/commit rollover odczytuje trwałe powiązania dla stołu i konta. Recheck w `persisted-state-writer.mjs::writeViaDb` obejmuje również pusty funding plan; sama kolejka per-table ani cache WS nie wystarczą. Final gate blokuje posortowane konta wszystkich obecnych ludzi i utrzymuje guard do commit nowej ręki nawet przy zerowym funding; odczyt po guard widzi konkurencyjny COMMIT FAST_EXHAUSTED. Powiązania historyczne sprawdza również po odejściu konta. Serializacja rozstrzyga race A-exhaustion/B-start: zatwierdzona wcześniej ręka pozostaje żywa, późniejsza podlega oryginalnemu deadline. Brak dowodu blokuje nową rękę/dostęp/funding, zachowując settlement.

Deadline to najwcześniejsze właściwe exhausted_at + 30 min, nigdy czas lokalnego wykrycia. Projekcja może zostać skorygowana wyłącznie do wcześniejszego udowodnionego zdarzenia, nigdy wydłużona; identyfikator źródłowego zdarzenia pozostaje w audycie. A wyczerpane w t0, B wykryte w t0+20 min: B ma deadline t0+30 min; wykryte po nim nie zacznie ręki. Trwająca ręka kończy się normalnie, bez automatycznego kicka, z poprawną wypłatą. Już sfinansowane boty mogą grać tylko w grace, bez dalszego finansowania.

### Kroczące slow — D1 i częściowe zużycie P1

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

Pod blokadą konta odczytać trwałe EXPOSURE z budget_mode=SLOW, result=COMMITTED, consumed_at i kosztem integer. Dostępność jest wyliczana jako 10000 minus suma w oknie, nie przechowywana jako odnawiany grant. DENIED/replay nie zużywa ponownie. Czas UTC t pobierać z DB po uzyskaniu blokady (nie transaction-start sprzed oczekiwania); kontrola cofnięcia zegara ma blokować nowe zużycie. Retry zachowuje pierwotny receipt/czas. nextEligibleAt oznacza najwcześniejsze wygaśnięcie dostatecznej sumy dla konkretnego żądanego kosztu; wygaśnięcie 0,4 nie obiecuje pełnego bota.

Fundamentalny przykład: 0,4 jednostki w t0 i 0,6 w t0+1 h. Tuż przed t0+12 h dostępne 0; dokładnie w t0+12 h dostępne tylko 0,4; pełne 1 dopiero w t0+13 h, o ile nie było nowego zużycia. Dwa równoczesne żądania o pozostałe 0,4 przy różnych tierach mogą łącznie zużyć najwyżej 0,4. Przełączenia fast/slow i sesji nie usuwają drugiego kosztu.

## Źródła techniczne

Istniejące blokady wierszy można rozszerzyć dla wspólnych liczników; stała kolejność blokad ogranicza deadlock, a przerwana transakcja wymaga pełnego retry z tym samym kluczem. [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html).
Nowe tabele w public wymagają RLS i ograniczonych grantów; konto klienta nie może modyfikować własnego budżetu ani licznika emisji. [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Uzupełnienie mapy klienta i bieżącego GitHub

`agents.md`/`skills.md` wspominają historyczną ścieżkę poker/poker-realtime.js, której obecnie nie ma. Rzeczywiste pliki to `poker/poker.js` (lobby quickSeat/createTable), `poker/poker-ws-client.js` (transport) i `poker/poker-v2.js` (fetchTableAccess, joinErrorMessage, isRetryableAutoJoinError). HTML `poker/index.html` i `poker/table-v2.html` potwierdza ładowanie tych plików. Lokalny poker-v2 różni się od aktualnego main (m.in. zmiany celebrations), dlatego odniesienia do V2 zweryfikowano w pobranym aktualnym GitHub main; nie kopiować historycznego pliku przy implementacji. Zasady konstytucji dotyczące WS/JSP obowiązują mimo starej nazwy w mapie, nie wymagają zmiany konstytucji.

Preflight direct URL używa `netlify/functions/poker-progression.mjs::readTableAccess`; jest projekcją dostępu, wymaga wspólnego odczytu klasy/budżetu, ostateczny join nadal WS. `netlify/functions/poker-get-table.mjs` jest retired. Transport `poker/poker-ws-client.js` traktuje obecnie błędy join jako resumable pending; nowe końcowe odmowy polityki muszą zakończyć pending i przekazać neutralną alternatywę zamiast zapętlać retry. Potwierdzić tylko krytyczny transportowy kontrakt, bez testów renderowania.

## Ponowna weryfikacja kodu 2026-09-25

Odczytano bieżące issue i head PR #1017 `f54d5532db76b6095569a80a9dd8cd0330042d4d`; main pozostaje `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`. Per-table enqueueTableCommand nie serializuje kont między stołami. Join ma wczesny return seated; writer aktualizuje state przed funding; prepare/commit mogą nie potrzebować nowych botów. Dlatego P1 wymaga recheck także przy zerowym funding i przed seated return. Przeczytano aktualne agents.md, skills.md i konstytucję 1.1.1; nie zmieniano ich ani środowisk.

## D.1 — ponowna inspekcja 2026-09-25

Decision: rozszerzyć istniejący find-or-create i użyć minimalnego receipt w już planowanym journal, bez równoległego silnika/rezerwacji. Rationale: `poker-quick-seat.mjs` ma selectCandidate (do 50 kandydatów), prefer_humans/any_open/create, advisory lock quickseat:maxPlayers i selectExistingActiveSeat, ale nie ma operation receipt; createAndRecommend wybiera highestUnlockedBuyIn i pomija capability 100. `createPokerTableWithState` tworzy table/state/escrow bez funding. Trwały receipt jest potrzebny dla replay po utracie HTTP/WS odpowiedzi; sam advisory lock i kliencki licznik nie wystarczą. Alternatives considered: in-memory dedup odrzucony (restart); nowy serwis/rezerwacja odrzucone jako zbędne. Limit 2 prób i 1 create to konkretna granica techniczna projektu dla zatwierdzonego bounded retry.

`buildLobbySnapshotPayload` obecnie zwraca całą activeLobbyTablesById bez odbiorcy. `poker.js::renderTables` tworzy disabled Unavailable przy canViewLobbyTable=false. `quickSeat` tylko nawiguje do strony z autoJoin; faktyczny sendJoin jest w poker-v2.js. Transport poker-ws-client.js oznacza każdy join error jako resumable pending. D.1 wymaga korekty wszystkich tych punktów, nie tylko endpointu HTTP. Finalna autoryzacja nadal shared join przez WS. Aktualne otwarte punkty S1/Q1 poniżej; zatwierdzone granice retry i ekonomii pozostają.

## Korekty P1/P2 i D.2 — 2026-09-25

Decision: bezpieczny koszt graniczny seed zamiast losowania preflight lub nowej persystencji target. Rationale: computeTargetBotCount losuje między lower/upper; join już przekazuje targetBotCount do seedBotsForJoin, które wtedy nie losuje ponownie. Wspólna granica w tym samym bots.mjs pozwala zachować mechanizm z konserwatywną dostępnością. Alternatives: utrwalony random target odrzucony jako więcej stanu; dwa losowania odrzucone jako przewidywalna odmowa. Reuse rozszerza istniejący predicate o maxPlayers/canonical stakes i pełną zgodność zamiast relabel.

Admin listTables/loadTableDetails używają requireAdminUser i persisted inventory; admin-ops loadPersistedTableSnapshots ma jawny SELECT bez nowych policy pól, więc trzeba rozszerzyć także ten helper i createTableMeta. UI pozostaje js/admin-page.js. #789 pozostaje OPEN; aktualne D.2 nie obejmuje żywego spectatora. Ta wcześniejsza korekta D.2 nie wymagała nowych tabel/pól DB; późniejsze uzupełnienia D.3 są opisane w data-model.md.

## D.3 i potwierdzenie cfg WS — 2026-09-25

Bieżący checkWsBuyInCapability odczytuje wyłącznie header x-poker-buy-in-materialization z healthz; nie potwierdza getBotConfig. Najmniejsza zmiana: dodatkowy authenticated descriptor w tej samej odpowiedzi i normalizacja/digest z WS, shared per HTTP operation, bez DB ani per-candidate fetch; final revision recheck z receipt. Binarny header i Netlify env odrzucone jako niewystarczający dowód. Nie tworzyć serwisu/rezerwacji; wariant Q1-B1 jednego bounded endpointu pozostaje do review.

server.mjs ma activeLobbyTablesById, maybeBroadcastLobbySnapshot z skip jeśli brak changed oraz visibility sweep domyślnie1s; obecny broadcast bezpersonalny nie odpytuje DB. Zachować tę zaletę, rozszerzyć dirty coalescing zamiast SQL dla każdego widza przy każdym sweep. action-history-cleanup już używa sweep-in-progress i lokalnych statement/lock timeout; table janitor i resource guards dostarczają wzorce bounded maintenance. Quick Seat dzisiaj LIMIT50 i pętla recommendSeatAtTable per kandydat — plan D.3 wymaga batched facts i pomiarowej bramki Q1, nie nieograniczonego search. Admin loadPersistedTableSnapshots jest zbiorczy: nowy earliest-drain też batch.

Decyzja: bounded exact refill przy małym kompletnym zbiorze; powyżej limitu zero i durable pending, zamiast kosztownego pełnego skanu pod global lock lub niebezpiecznego cache kapitalizacji. Limity planu są startowymi bezpiecznikami, ich przydatność wymaga Stage evidence. D.2/D.3 zatwierdzone, spectator #789 OPEN i poza zakresem; nie mylić D.3 z ekonomicznym D3.

## Zatwierdzone D.1 — pasywne lobby + Graj teraz

Issue z 2026-09-25T12:38:01Z rozstrzyga wcześniejszą lukę dostępności. Zamiast trwałego postępu wyszukiwania zachować tylko operację MATCH/replay. Aktualny WS buildLobbySnapshotPayload sortuje tableId, HTTP selectCandidate preferuje ludzi i sortuje last_activity_at/created_at; wymagają wspólnego humans-first/tableId porządku i batch recheck. poker.js ma już pokerQuickSeat/quickSeat/renderTables/navigateToPokerTable: rozszerzyć istniejącą akcję, nie dodawać nowego flow. Browse wyłącznie projekcja; explicit click pozwala create po zakończonym ograniczonym doborze i pełnym preflight. Odrzucono global rescan/engine inventory; zaakceptowano wyjątkowy dodatkowy stół poza zakresem. Finansowe incomplete nadal fail-closed.


## Aktualizacja 2026-09-25T18:17:21Z — dowody i decyzje

### Q1 — decyzja i dowody

Kanoniczna analiza obecnego kodu, indeksów, wariantów A/B0/B1/C oraz kosztów znajduje się w plan.md §Q1. Rekomendowany B1 wymaga niezależnego review; A nie dowodzi live z samego OPEN, B0 nie ufa pustej liście klienta, C zwiększa WAL i nie jest domyślny. Nie wykonano EXPLAIN/pomiarów DB; K/L/B/C/D pozostają bramką T002/T038.

### S1 — wymagane nowe exposure SLOW i wielostołowość (wariant do niezależnego review)

Zatwierdzone: SLOW_SHARED to wielu niezależnie uprawnionych ludzi plus boty puli SLOW. Każdy nowy uczestnik autoryzuje także pre-funded stock; każdy siedzący człowiek autoryzuje całe wymagane nowe exposure, jeden FUNDING nie jest powielany per human. D1 rolling12h i precyzja ułamków pozostają. Seed slow ma target najwyżej1 pełnego bota przy wolnym miejscu, **nie limit jednego człowieka**. Kolejne osoby muszą zmieścić własne exposure aktualnego stacku w swoim allowance; brak miejsca/budżetu odrzuca nowego gościa bez pozbawiania legalnej gry obecnych ludzi.

Pierwsza potwierdzona odmowa dodatniego, rzeczywiście wymaganego nowego exposure już siedzącego gracza z powodu jego limitu SLOW zapisuje `SLOW_EXPOSURE_DENIED` i DRAINING tego stołu atomowo, przed funding/EXPOSURE/nową ręką. Nie uruchamiać drain na podstawie konserwatywnego preflight, samego salda0, pool/capability/proof failure ani odmowy nowemu gościowi. Pod wspólną kolejnością table/state/seats→sorted users→pool potwierdzić rzeczywisty plan i dokładną sumę (t−12h,t]; brak kompletnego dowodu blokuje nową operację, nie udaje wyczerpania. Pierwszy receipt ma czas DB po lockach, wymaganą deltę/plan identity i pierwszego odrzuconego siedzącego user. Jeden trigger/stoł; równoczesne odmowy odtwarzają pierwszy receipt. Deadline=trigger+30min pozostaje po wygaśnięciu części kosztów, odejściu, reconnect i restarcie. Zero nowego funding/admission, istniejąca ręka i wypłaty normalnie; następna ręka tylko przed deadline na legalnych już finansowanych stackach. Błąd zapisu receipt/drain cofa całą nową decyzję, wymaga recovery; nie ogłaszać trwałego drain przed COMMIT.

**S1-A rekomendowany, wymaga review:** trigger jest lokalny dla stołu faktycznie wymagającego dodatniego kosztu. A odmawia w t0; pre-funded B bez nowej ekspozycji nie jest automatycznie wygaszany. B przy swojej następnej wymaganej ekspozycji ponownie ocenia ten sam wspólny rolling limit i przy odmowie ma własny pierwszy czas. Brak kontowego slow exhausted marker na7dni i brak fanout wszystkich slow. Koszt: jeden istniejący journal receipt/indeks i update table, wspólne user locks; brak dodatkowej relacji członkostwa.

**S1-B alternatywa do decyzji:** pierwsza odmowa A wygasza wszystkie zajęte SLOW_SHARED z czasem A. Wymaga jawnego określenia epizodu rolling12h, snapshotu członkostwa i trwałego fanout; więcej zapisów/WAL/lock contention, zamyka również B bez nowego kosztu. Nie jest zatwierdzone przez ogólny FAST marker i nie należy tego wdrażać bez decyzji. T001 blokuje zamrożenie tego fragmentu implementacji. FAST globalny drain STANDARD i jego pierwotne deadline pozostają bez zmian; SLOW_SHARED/HUMAN_ONLY są wyłączone wyłącznie z drain spowodowanego FAST.

Fundamentalne przypadki: Adam+Bartek SLOW_SHARED100, jeden transfer50CH i dwa exposure0,5 bez debitu USER; jeden siedzący gracz nie mieści nowej delty→jeden sticky trigger dla całego stołu. Zużycie0,4 w t0 i0,6 w t0+1h: bez nowego kosztu nie drain; wymagane0,1 przed t0+12h→drain, w t0+12h dostępne0,4 nie resetuje deadline; pełna1 dopiero t0+13h. Race dwóch graczy/stołów serializuje wspólny limit bez partial funding. A/B sprawdzić według zatwierdzonego S1, nie przejąć testu FAST.
