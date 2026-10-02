# Aktualizacja Q1 — pełny registry

Pełny registry WS, nie prefiks: jeden authoritative WS na środowisko jest potwierdzony. Przejrzeć wszystkie aktualne live entries w pamięci, ustalić eligibility i wspólną kolejność, dopiero potem ograniczyć payload do32 pasujących JOIN. Graj teraz znajduje również cel za32 wpisem. Create wymaga kompletnej oceny całego bieżącego registry, braku pasującego celu i świeżego pełnego preflight. Unknown/incomplete/stale/proof overflow nigdy nie oznacza no-offer. Brak wyjątku create z powodu celu poza sprawdzonym prefiksem.

Wcześniejsze T042/T042-U i scope-prefix propozycje poniżej historyczne, zastąpione tą decyzją. Jeden WS potwierdzony przez właściciela; brak nowych pomiarów. Bieżące scenariusze: cel33 poza pierwszymi niekwalifikującymi32, ponad32 pasujące→32 wyświetlone, pełny no-match vs unknown. Szczegóły plan/kontrakt.

# Research — bieżący status Q1

WS-first zatwierdzone issue2026-09-25T21:18:32Z. Konkretny aktualny projekt w plan.md/kontrakcie Q1. Poniższe porównania SQL-vs-WS, T042 i T042-U stanowią **historię**, nie otwarte warianty źródła inventory ani bramkę dalszych benchmarków. T042-U wstrzymane/nieautoryzowane. S1-A bez zmian.

## HISTORIA — wcześniejsze protokoły i decyzje zastąpione przez WS-first

Poniższe dawne instrukcje wyboru SQL-vs-WS, zgody i zależności T042/T043 są archiwalne, nie aktualne polecenia. Aktualny kontrakt w plan.md/kontrakcie Q1; T042-U nie wykonywać.

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

`buildLobbySnapshotPayload` obecnie zwraca całą activeLobbyTablesById bez odbiorcy. `poker.js::renderTables` tworzy disabled Unavailable przy canViewLobbyTable=false. `quickSeat` tylko nawiguje do strony z autoJoin; faktyczny sendJoin jest w poker-v2.js. Transport poker-ws-client.js oznacza każdy join error jako resumable pending. D.1 wymaga korekty wszystkich tych punktów, nie tylko endpointu HTTP. Finalna autoryzacja nadal shared join przez WS. Aktualne otwarte punkty Q1 poniżej; zatwierdzone granice retry i ekonomii pozostają.

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

Kanoniczna analiza obecnego kodu, indeksów, wariantów A/B0/B1/C oraz kosztów znajduje się w plan.md §Q1. Żaden wariant Q1 nie jest wybrany; B1 wymaga dowodu konieczności; A nie dowodzi live z samego OPEN, B0 nie ufa pustej liście klienta, C zwiększa WAL i nie jest domyślny. Nie wykonano EXPLAIN/pomiarów DB; K/L/B/C/D pozostają bramką T042/T043; T038 waliduje późniejszą implementację.


Cel zatwierdzony: automatycznie znaleźć odpowiedni stół przy małym koszcie DB i ograniczać zbędne tworzenie stołów. Architektura niewybrana. Najpierw porównać obecne selectCandidate/recommendSeatAtTable/handler (SQL OPEN/ACTIVE seats/last_seen_at), publiczne live facts activeLobbyTablesById i istniejące account/proof batch. Ocenić pushdown i istniejące indeksy, rozjazd persisted/live oraz kolejność widoczną w lobby. Sam błąd/niepełny/stary odczyt nie dowodzi pustki. Nie dodawać endpointu ani liczbowego limitu zapytań przed dowodem.

T042 po T002 i osobnej autoryzacji pomiarów: w przyszłym dozwolonym odizolowanym lokalnym DB odtworzyć istniejącą schema i kontrolowane fixtures małego/większego inventory, pełnych/niezgodnych stołów i opóźnionej persystencji. Zebrać plany EXPLAIN (ANALYZE, BUFFERS) wyłącznie bezpiecznych odczytów, actual rows/loops/buffers, RT/bytes i czas. Porównać narrow indexed SQL/batch z wykorzystaniem istniejącego registry bez dodatkowego HTTP; dopiero wykazana luka uzasadnia wariant bounded authenticated HTTP. Minimalną projekcję DB ocenić przez dodatkowe writes/WAL/locks. Zapisać query shape, schema/indexes, cardinality, SHA, wyniki i wybrany wariant/limity; wrócić do review. T038 później kontrolowany baseline/Preview pomiar egress osobno od CPU/I/O/WAL/locks i opóźnień settlement. Teraz brak tych pomiarów i brak operacji DB/Stage/Production; Q1 blokuje zamrożenie implementacji discovery.

Warunkowo, **tylko jeżeli Q1 wybierze nową ścieżkę HTTP do WS**: przyszły zakres obejmie infra/vps/Caddyfile, w obu blokach ws.kcswh.pl (upstream127.0.0.1:3000) i ws-preview.kcswh.pl (3001), z dokładnym matcherem ustalonej ścieżki przed fallback. Obecny fallback odpowiada tekstem OK/200, więc sam HTTP200 nie dowodzi dotarcia do WS. T018 zaplanuje routing i autoryzację bez rozszerzenia publicznego dostępu, T038 zweryfikuje odpowiedź/schema/revision z WS i odrzucenie brakującego tokenu przez proxy na osobno autoryzowanym Preview; Production analogicznie dopiero po osobnym GO. Bez nowej ścieżki zadanie Caddy jest niepotrzebne i nie zmienia pliku. Teraz nie modyfikować Caddy ani deployować.


Kolejność bramek: T002 analiza istniejących mechanizmów bez zmian środowiska → T042 osobno autoryzowane ograniczone pomiary w odizolowanym środowisku → T043 wybór rozwiązania na podstawie dowodów i niezależne review → T001 osobne zlecenie implementacji → T003 i dalsze zadania implementacyjne. Zgoda na review HEAD 3f5a128860ab3b26acc4f5560fe402676d9c4547 została udzielona; nie jest zgodą na pomiary ani implementację. T002/T042/T043 nie wymagają wcześniejszego zlecenia implementacji. T038 to późniejsza walidacja implementacji, nie warunek uzyskania dowodów przed wyborem Q1. Teraz żadnych pomiarów ani operacji środowiskowych.


### S1-A — lokalny drain SLOW (zatwierdzone)

SLOW_SHARED pozostaje multiplayer: każdy człowiek autoryzuje własne exposure, również pre-funded; jeden FUNDING nie powiela transferu per human. Seed najwyżej1 pełnego bota nie oznacza limitu jednego człowieka. Sam admission do wcześniej finansowanego stacku bez nowego finansowania lub zero allowance bez takiej potrzeby nie wyzwala drain.

Trigger dotyczy wyłącznie odmowy autoryzacji **rzeczywiście potrzebnego dodatniego nowego finansowania botów** siedzącemu graczowi z powodu jego SLOW. Nie wynika z konserwatywnego preflight, braku pool/capability/proof ani odmowy nowemu gościowi. Pod table/state/seats→sorted users→pool potwierdzić plan i dokładne rolling12h; atomowo utrwalić pierwszy SLOW_EXPOSURE_DENIED i drain przed funding/EXPOSURE/nową ręką. Receipt wskazuje dodatnią fundingDelta, czas DB po lockach i pierwszego odrzuconego user. Jeden trigger per stół; retry/równoczesne odmowy zachowują pierwszy czas. Błąd zapisu cofa decyzję i wymaga recovery, bez ogłaszania drain przed COMMIT.

A ma deadline pierwszego triggeru+30min; B bez nowego finansowania działa dalej i dopiero przy własnej potrzebie sprawdza wspólny rolling limit oraz ewentualnie ustala własny pierwszy deadline. Brak globalnego fanout/7-dniowego markera SLOW i dodatkowej relacji członkostwa. Globalny FAST pozostaje bez zmian. Drain jest sticky po odnowieniu/leave/reconnect/restart: brak nowych ludzi/fundingu, już finansowane stacki tylko w grace; żywa ręka i wypłaty kończą się legalnie, po deadline brak następnej ręki.

Fundamentalne kryteria: Adam+Bartek SLOW100,1 FUNDING50CH i2 EXPOSURE0,5, bez USER debitu exposure; odmowa rzeczywistej nowej delty jednemu seated human daje jeden trigger stołu. Zużycie0,4 w t0 i0,6 w t0+1h: brak nowego finansowania→brak drain; wymagane0,1 przed t0+12h→drain. Odnowione0,4 w t0+12h nie usuwa deadline, pełna1 dopiero t0+13h. Race kont/stołów bez partial funding; A/B lokalnie, nie według globalnego FAST.

## T002 — wykonana analiza read-only, baza do T042

Zweryfikowano przez fetch GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84` i docs HEAD `801b161e43ede19420368985622e2b403e94efb2`; odczyt agents.md, skills.md i konstytucji1.1.1. Bez DB, migracji, uruchomienia aplikacji lub pomiarów. Poniżej obserwacje kodu, nie wyniki wydajności.

| Istniejąca ścieżka | Obserwacja i luka względem Graj teraz |
|---|---|
| poker-quick-seat.mjs::selectCandidate | OPEN, dokładne maxPlayers, availableBuyIns, ACTIVE count, last_seen_at (domyślnie120s), managed rotation i JSON phase; dwa przebiegi humans/any mogą sprawdzać te same rekordy. ORDER last_activity_at DESC/created_at ASC, bez unikalnego tie-break; LIMIT50 to obecny kod, nie wybrany algorytm. |
| recommendSeatAtTable/handler | Zapytania o własny ACTIVE seat i wszystkie seat_no per kandydat; ta druga lista nie filtruje ACTIVE, inaczej niż selectCandidate. Sukces aktualizuje activity. Advisory quickseat:maxPlayers serializuje również różne konta tej samej pojemności; nie jest receipt operacji. Nie uruchamiać całego handlera w pomiarze read-only, bo może zapisywać/create. |
| createAndRecommend/selectExistingActiveSeat | Nowy cel z highestUnlockedBuyIn i parametrów klienta; capability100 pominięte; istniejący seat LIMIT1 bez ORDER. Nie dowodzi najwyższego rzeczywiście grywalnego tieru ani osobnej semantyki Resume. |
| server.mjs::syncLobbyRegistry/buildLobbySnapshotPayload/sendLobbySnapshot/maybeBroadcastLobbySnapshot | Registry załadowanych live stołów, publiczne seatCount/humanCount/phase/joinable ze snapshotu/meta, wspólny payload bez recipient eligibility; sort tableId. Brak DB per odbiorca w obecnym broadcast. Nie obejmuje automatycznie wszystkich persisted OPEN; DB freshness120s nie dowodzi live miejsc. |
| poker.js::renderTables/quickSeat | Lista w kolejności payload; obecny formularz maxPlayers i disabled Quick Seat przy braku progression, autoJoin nawigacji. Wymagane D.1 nadal zadaniami przyszłej implementacji, nie T002. |
| shared/poker-domain/join.mjs::executePokerJoinAuthoritative; bots.mjs | Ostateczna transakcja/locki i WS getBotConfig, target przekazany seederowi. Discovery nie jest rezerwacją; finalnego recheck nie zastąpi wynik T042. |

Istniejące indeksy do odtworzenia w pomiarze: poker_tables(status)/(last_activity_at), seats(table_id)/(table_id,last_seen_at)/(table_id,is_bot), unique(table_id,seat_no)/(table_id,user_id), partial OPEN managed; źródła w migracjach 20260117090000,20260210000000,20260729100000. Obecność indeksu nie dowodzi korzystnego planu; brak danych o actual rows/loops/buffers, egress lub opóźnieniu persystencji. Nie zakładać zastosowanej schema środowisk z samych plików migracji.

Porównanie pozostaje otwarte: A narrow SQL/batch może usunąć per-candidate RT i odrzucać tanie niezgodności wcześniej, ale nie dowodzi live WS; B istniejący registry plus zbiorczy proof konta zachowuje live authority, wymaga rozwiązania świeżego bezpiecznego przekazania faktów matcherowi; dodatkowe HTTP tylko po dowodzie potrzeby. C projekcja/trigger wymaga dowodu przewagi read vs writes/WAL/locks, nie mierzymy hipotetycznej implementacji jako istniejącej. T042 może porównać read-only szkice SQL w izolowanym harness, nie wdraża endpointu/projekcji ani feature schema. Brak odpowiednich pól #869 oznaczyć jako lukę pomiaru, nie fikcyjny dowód gotowości ekonomii.

Konkretny protokół, limity i zgoda: quickstart.md „T042 — protokół do osobnej akceptacji”. Dopiero dowody i T043 pozwolą wybrać architekturę; S1-A pozostaje zamknięte.

## T042 — rzeczywisty wynik ograniczonej próby (częściowe dowody)

Zgoda właściciela obejmowała lokalny eksperyment po dopisaniu ograniczenia skali; dokumentacyjny HEAD startowy1b6b010a7956980f6cbacd9d88d2ae97606494ec, kod main93d0f191c3f87006d56f7afb2fb1c4052a7ecb84. PostgreSQL17.11, własny initdb z WAL segment1MiB, prywatny katalog0700/socket Unix, listen_addresses puste (brak TCP), max_connections2, shared_buffers16MiB. Jawne parametry psql i oczyszczone środowisko bez cloud DSN. Własny klaster nie modyfikował innych instancji; shutdown potwierdzony i katalog usunięty. Nie uruchamiano aplikacji, migracji repo ani usług środowiskowych.

**Zakres faktycznie wykonany:** 20/100/200 stołów ×2 rozkłady ×3 read-only kształty SQL ×(1 warm-up+3 próby)=72 sekwencje. Jedno połączenie naraz, EXPLAIN ANALYZE BUFFERS FORMAT JSON w BEGIN READ ONLY/ROLLBACK, statement_timeout1s/lock_timeout100ms.217 konserwatywnie policzonych SELECT (także podzapytania), poniżej1000. Cała próba wraz z initdb/setup trwała5,74s. Szczyt rozmiaru własnych artefaktów klastra29 231 988B (~27,9MiB), raport~0,5MiB; poniżej100MiB. Obserwowany host CPU max62,9%, pamięć max26,5%, swap0. Brak STOP timeout/SQL/resource. Dane syntetyczne≤200 tables/200 states/200 kont/2000 seats, bez ledger/CH. Setup lokalnego DDL/fixtures oddzielny od odczytów.

**Kształty:** current to wyciągnięty selectCandidate z requireHuman=false, maxPlayers6, tiers100/500/1000 i cutoff2026-01-01; batch_sketch to read-only CTE agregujący ACTIVE/all seat counts, stale/human flags, join state oraz dodatkowy warunek all_seats<maxPlayers odpowiadający późniejszemu pickSeatNo, stabilny id tie-break; registry_batch to zbiorczy odczyt metadata/seats dla listy IDs z syntetycznego loaded registry. Bez nowego indeksu feature, endpointu lub kodu aplikacji. Minimalne istniejące kolumny i indeksy odtworzono lokalnie; partial managed index był uproszczony do rotation_due_at/OPEN CONTINUOUS_BOT, fixture nie miało managed rows — nie jest pomiarem pełnej produkcyjnej schema.

Tabela: mediana Execution Time PostgreSQL w ms / rows wyniku planu / Shared Hit Blocks (pierwsza mierzona próba);3 prób nie interpretować jako p95/SLO.

| Inventory / rozkład | Obecny SQL | Szkic batch | Registry IDs batch |
|---|---|---|---|
| 20 / mixed | 0.298 / 5 / 12 | 0.429 / 5 / 9 | 0.374 / 13 / 5 |
| 20 / rejected | 0.685 / 20 / 48 | 0.510 / 1 / 11 | 0.228 / 0 / 4 |
| 100 / mixed | 1.654 / 22 / 101 | 0.702 / 22 / 55 | 0.520 / 63 / 8 |
| 100 / rejected | 1.226 / 50 / 224 | 0.858 / 1 / 17 | 0.140 / 0 / 5 |
| 200 / mixed | 2.276 / 44 / 142 | 1.246 / 44 / 104 | 0.912 / 126 / 13 |
| 200 / rejected | 2.246 / 50 / 643 | 1.516 / 1 / 25 | 0.083 / 0 / 0 |

Mixed miesza OPEN/CLOSED, maxPlayers2/6/10, tiers100/500/1000 i occupancy, stale last_seen w części wierszy. Rejected: wszystkie oprócz ostatniego mają6 seat rows, lecz tylko5 ACTIVE; ostatni ma1 miejsce. Obecny SELECT przepuszcza pełne w rozumieniu pickSeatNo stoły i przy100/200 kończy na50 wierszach. Batch zwraca1 potencjalny cel, eliminując znaną rozbieżność przed dalszą walidacją. Nie dowodzi to legalnego admission: minimalne stakes w fixture nie były kanoniczne dla wszystkich tierów, nie wykonano pełnej ekonomii. Registry fixture celowo pomija IDs podzielne przez5, więc jedyny cel rejected jest poza loaded subset:0 rows nie dowodzi pustki całego inventory. Jest to demonstracja ograniczenia reprezentacji, nie argument za endpointem.

**Ograniczenia i nieukończone przypadki:** wykorzystano cały limit72 sekwencji; nie rozszerzano pomiaru. Nie wykonano osobnego no-match wariantu, pełnych przypadków before/after cutoff, managed rotation, pełnego przebiegu humans→any/recommendSeatAtTable, scenariusza2 równoległych połączeń, in-memory broadcast1/10 widzów ani kontrolowanego live full/DB-free i runtime closed/DB-OPEN. Nie mierzono kompletnych SLOW/class/drain/account proof (brak wdrożonej schema #869). Nie wykonano rzeczywistego renderowania/WS/HTTP. T042 **nie jest w pełni ukończone**; uzyskano tylko powyższe plany i porównanie ograniczonej macierzy. Dalsze pomiary wymagają osobnego zakresu i zgody, nie automatycznego zwiększenia limitu.

Nie zmierzono bajtów rzeczywistych wyników SQL (psql zwracał plany), Supabase egress, per-process CPU/Disk I/O, WAL delta, lock waits/concurrency ani kosztu utrzymywanej projekcji. Shared Hit Blocks to bufory, nie fizyczne I/O ani egress. Łączny czas client includes start psql/połączenie (~37–65ms mediany), nie latencja aplikacji. Nie wykonywano ledger, refill, cash-out lub settlement; nie ma dowodu ich dostępności pod obciążeniem. JSON planów zawierał query execution/rows/buffers, nie ślad pełnego protokołu aplikacji. Liczby nie uzasadniają limitów operacyjnych lub skali>200; T038 nadal wymagane.

**Porównanie do niezależnego review, bez T043:** A SQL/batch w tej próbce redukuje wiersze wymagające dalszych kontroli i hit blocks, lecz przy20 mixed jest wolniejszy; nie dowodzi WS freshness. B registry batch ma mały koszt odczytu IDs, ale inny zakres danych i brak dowodu kompletności/bezpiecznego przekazania — nie porównywać czasów jako równoważnych algorytmów. B1 nowy HTTP nie został zbadany ani wybrany. C utrzymywana projekcja nie została wykonana; brak write/WAL evidence. Q1 otwarte; S1-A i zatwierdzona ekonomia bez zmian.

## Plan uzupełnienia T042 — bez nowych wyników

Właściciel zaakceptował raport częściowej próby HEAD4852cbfe1aa86ab2aab5354e74e7d91ec11b2272. Przyczyna braku miejsca na dodatkowe przypadki: podstawowa macierz6×3×4 już wyczerpała72 sekwencje. Nie proponujemy jej ponowienia ani ogólnego zwiększenia budżetu.

Mapa brak→decyzja Q1→minimalny eksperyment→T038 znajduje się w quickstart.md §T042-U. Priorytet C1 no-match,C2 cel51,C3 live/persisted,C4 incomplete/stale oraz C5 porządek/granice; większość semantyki możliwa do oceny bez DB. Tylko6 nowych sekwencji lokalnych potrzebne do wyniku SQL i planu C1/C2/C5; payload bytes zbierane w tych samych odczytach. Broadcast/concurrency, rzeczywisty egress, CPU/I/O/WAL/locks przy docelowej implementacji odłożone do T038, nie uznane za potwierdzone. HTTP/projekcja bez implementacji pozostają niewycenione; jeśli uniemożliwi to wybór, Q1 nadal otwarte.

To wyłącznie propozycja do niezależnego review i osobnej zgody. Nie wykonano żadnej nowej oceny/harness/SQL/DB ani T043, nie wybrano architektury. T042 pozostaje częściowe, S1-A zamknięte. Po zgodzie zachować w raporcie dokładny kształt odczytu, fixture/expected IDs, wynik i liczniki — kontrprzykład nie jest dowodem gotowego matchera.

## Bieżący dowód przepływu WS

server.mjs lobby_subscribe już używa auth session i registry; sendCommand/commandResult w poker-ws-client.js obsługują promise/requestId. Join dispatch używa enqueueTableCommand/handleJoinCommand/loadAuthoritativeJoinExecutor. createPokerTableWithState ma wyłącznie SQL na przekazanym tx i może być współdzielony bez nowego HTTP. To podstawa nowego projektu, nie twierdzenie o istniejącym lobby_match. Nowy protocol/auth allowlist/replay i scoped proof wymagają przyszłej implementacji. Bez pomiarów w tej korekcie.
