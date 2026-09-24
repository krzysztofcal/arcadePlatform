# Research — issue #869

Data: 2026-09-24. Badanie wyłącznie kodu i źródeł; nie badano ani nie zmieniano żywego Stage/Production. Źródło polityki: [issue-source.md](issue-source.md). GitHub main `93d0f191c3f87006d56f7afb2fb1c4052a7ecb84`; lokalny HEAD `fc3187187adcab47ff11808d95afe6b90ea9c2c9`. Pobrano aktualne repozytorium do katalogu tymczasowego i porównano główne pliki domeny oraz agents.md/skills.md/konstytucję: zgodne. Nie użyto repomix.

## Decyzje techniczne i istniejące mechanizmy

| Obszar | Decision | Rationale / Alternatives considered |
|---|---|---|
| Budżet | Jeden wiersz na konto, blokowany w transakcji istniejącego join/writera; nowy mały moduł `shared/poker-domain/bot-budget.mjs` | Nie istnieje trwały limit dostępu; portfel USER i cache WS nie zastępują go. Moduł współdzielony zapobiega dwóm algorytmom. |
| Jednostki | Dokładny integer: 10 000 podjednostek na buy-in; delta * (10 000 / tier) | Wszystkie projektowane tiery 100/500/1000/5000/10000 dzielą 10000. 1 CH przy 100 to 100, przy 500 to 20 podjednostek. Bez float, bez zaokrągleń. Inny przyszły tier wymaga jawnej zmiany reprezentacji. |
| Admission | Konserwatywne pełne live bot stacks dla nowego gracza, osobna autoryzacja każdego człowieka przy nowym fundingDelta | `join.mjs` już blokuje table i state i finansuje seat. Nie dzielić fungible escrow na hipotetycznych właścicieli. Znaczniki ekspozycji i powiązanie źródła opisuje kontrakt. |
| Transakcja | Postgres beginSql/tx; commit DB przed commit runtime/broadcast | Join ma transakcję; writer posiada expectedVersion i receipts. Błąd finansowania ma wycofać cały kandydat, nie tylko pojedynczy bot savepoint. |
| Klasy | Oddzielne `bot_access_class` i `slow_owner_user_id` w poker_tables | `lifecycle_kind` oznacza STANDARD/CONTINUOUS_BOT i nie należy mieszać go z dostępem STANDARD/SLOW_PRIVATE/HUMAN_ONLY. |
| Slow | Jeden bot z pełnym buy-in, jeden human; istniejące min/max bot count dla standard pozostają | `computeTargetBotCount` zwykle zakłada min. 2 boty, co nie mieści się w burst 1. Brak nowej mechaniki mikrostawkowych botów. |
| Draining | Oddzielne `bot_draining_started_at` i `bot_draining_deadline_at` | `handleContinuousBotRotationAtSettled` przy human postpones. Samo ustawienie rotation_due_at nie spełnia #869. |
| No funding | Rozszerzyć `allowBotFunding:false` na obydwa tiery i przyczyny odmowy | Obecna ścieżka w server jest ograniczona `buyIn === 500`, writer rozpoznaje tylko HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY. |
| Rezerwa | Rzeczywiście egzekwowane dwa salda klas w nowym `poker_bot_pool_state`, połączone z jednym istniejącym kontem SYSTEM na tier | Zachować POKER_BOT_BANKROLL dla 500 i nie komplikować terminal source. Podkonta odrzucone jako zbędne dla pilota. Sama kontrola dostępnego salda bez blokady/aktualizacji klas byłaby niewystarczająca. |
| Nowe 100 | SYSTEM key `POKER_BOT_BANKROLL_100`; provision zero balance w schema, osobna jednorazowa autoryzowana alokacja | Nie zmieniać historycznego seeda 500 ani source aktywnych stacków. Źródło alokacji jest D3. |
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

## Otwarte decyzje właściciela — nie są domyślną konfiguracją

| ID | Brak rozstrzygnięcia w issue/kodzie | Propozycja do review | Zależne obszary |
|---|---|---|---|
| D1 | Moment pierwszej jednostki slow i proporcjonalne/skokowe odnawianie | Jedna jednostka przy pierwszym wejściu w slow; później skokowo pełna jednostka po 12 h od pierwszego zużycia w cyklu, niewykorzystana reszta znika przy odnowieniu; bez catch-up. Alternatywa: początkowe oczekiwanie lub token bucket. | FR-004; przejścia slow, test granic, retryAt |
| D2 | Dowolne kroczące 7 dni czy stały wspólny okres emisji oraz kotwica | Dla ścisłego „maks. na 7 dni” preferowane kroczące 168 h; jeśli właściciel wybierze stałe, zapisać wspólną UTC kotwicę, półotwarte okna i jawny efekt styku. | FR-020/023; agregacja trwałych receipts, liczniki i test granicy |
| D3 | Dokładny debit jednorazowego miliona dla 100 | GENESIS→POKER_BOT_BANKROLL_100 jako jawny MINT, podział ochrony 900k/100k. Alternatywą tylko świadomie zatwierdzony transfer z istniejących środków, ze sprawdzeniem dostępnego salda. | FR-018; seed preflight i odrębny Production GO |

Przed zależną implementacją wymagana odpowiedź i aktualizacja spec/plan/tasks. Nie należy przyjmować propozycji wskutek milczenia. Na prośbę właściciela pełny plan powstaje mimo otwartych decyzji, jako dokument warunkowy; standardowa bramka `$speckit-plan` o rozwiązanych unknowns nie jest oznaczona PASS. Research techniczny zakończony; research nie zastępuje decyzji ekonomicznych.

## Źródła techniczne

Istniejące blokady wierszy można rozszerzyć dla wspólnych liczników; stała kolejność blokad ogranicza deadlock, a przerwana transakcja wymaga pełnego retry z tym samym kluczem. [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html).
Nowe tabele w public wymagają RLS i ograniczonych grantów; konto klienta nie może modyfikować własnego budżetu ani licznika emisji. [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Uzupełnienie mapy klienta i bieżącego GitHub

`agents.md`/`skills.md` wspominają historyczną ścieżkę poker/poker-realtime.js, której obecnie nie ma. Rzeczywiste pliki to `poker/poker.js` (lobby quickSeat/createTable), `poker/poker-ws-client.js` (transport) i `poker/poker-v2.js` (fetchTableAccess, joinErrorMessage, isRetryableAutoJoinError). HTML `poker/index.html` i `poker/table-v2.html` potwierdza ładowanie tych plików. Lokalny poker-v2 różni się od aktualnego main (m.in. zmiany celebrations), dlatego odniesienia do V2 zweryfikowano w pobranym aktualnym GitHub main; nie kopiować historycznego pliku przy implementacji. Zasady konstytucji dotyczące WS/JSP obowiązują mimo starej nazwy w mapie, nie wymagają zmiany konstytucji.

Preflight direct URL używa `netlify/functions/poker-progression.mjs::readTableAccess`; jest projekcją dostępu, wymaga wspólnego odczytu klasy/budżetu, ostateczny join nadal WS. `netlify/functions/poker-get-table.mjs` jest retired. Transport `poker/poker-ws-client.js` traktuje obecnie błędy join jako resumable pending; nowe końcowe odmowy polityki muszą zakończyć pending i przekazać neutralną alternatywę zamiast zapętlać retry. Potwierdzić tylko krytyczny transportowy kontrakt, bez testów renderowania.
