# Contract — access, funding, refill

## JOIN / RESUME

Istniejący authenticated transport/requestId/tableId, bez nowego endpointu. Klient nie podaje wiążącej klasy. Serwer pod table/state lock odczytuje wszystkich seated humans i candidate, ich USER rows oraz próg. Rejoin finansowanego aktywnego miejsca pozostaje rejoin bez buy-in; nowy JOIN musi spełnić istniejące tier/capacity/stakes i klasy.

| Ludzie teraz | Kandydat | Nowe admission |
|---|---|---|
| brak | NORMAL albo RESTRICTED | tak, z istniejącymi warunkami finansowymi |
| wszyscy NORMAL | NORMAL | tak |
| wszyscy RESTRICTED | RESTRICTED | tak, seed pominięty |
| jednorodni przeciwnej klasy / mixed | dowolny niezgodny / każdy w mixed | odmowa |
| unknown | dowolny | unavailable |

Planowane neutralne kody `poker_access_incompatible`, `poker_access_unavailable`; nie ujawniać salda/powodu innych ludzi. Odpowiedź odmowy policy jest wynikiem committed tx, nie wyjątkiem cofającym detection. Runtime nie publikuje miejsca bez sukcesu COMMIT. Stale Quick Seat może odmówić z tym samym kodem; bez automatycznej pętli i nowego tworzenia stołów. Aktualny ws-server/poker/handlers/join.mjs i authoritative-join-adapter mapują wynik bez success na deny; browser zachowuje dotychczasowy błąd/ponowną próbę.

## Funding gate

Proponowany shared helper w bot-access.mjs: locked table/state membership + wszystkie USER rows + server config→ALLOW / DENY_RESTRICTED / UNKNOWN. Nie query per bot/stack. Wszyscy ludzie i joining candidate pod tym samym transaction snapshot/locks; disconnected i pending leave nie znikają. Gate dopuszcza pusty human set wyłącznie zgodnie z istniejącym managed lifecycle i rzeczywistym planem, bez omijania source/demand.

Wyłącznie ALLOW może doprowadzić do nowych bot seats/stack deltas/transferów. DENY_RESTRICTED daje zero seed, a rollover nie zapisuje funded candidate. UNKNOWN daje zero nowych funduszy; fallback no-funding może działać bez nowego gate, bo nie zwiększa ekspozycji CH. Stan po COMMIT/receipt jest jedyną podstawą runtime; unknown commit wymaga existing restore/version/idempotency przed powtórzeniem. Zwykły JOIN RESTRICTED nie wymaga botów, więc jest dozwolony z pominiętym seed.

Gate przed seed musi działać nawet dla standalone managed create. Writer weryfikuje przed CAS. Nie nadpisywać funded planu pustymi array przy zachowaniu inflated nextState. Wykorzystać istniejący server no-funding restore/prepare/persist/restore flow opisany w research. Nie zmieniać completed-hand payouts.

## Refill / composite funding

Nie ma lifetime cap/counter ani samodzielnego background mint. `postBotFundingWithRefill` to planowany wspólny helper wywoływany w istniejącym tx seed/replacement/topup. Tożsamość z existing bot funding idempotencyKey (seed table/seat, replacement/topup table/state-version/bot), a nie świeży request klienta. Replay odczytuje original funding/receipt przed badaniem nowego niedoboru; już zatwierdzony funding nie emituje ponownie nawet po zmianie klasy/źródła. Legacy replay bez receipt korzysta z istniejącego registry/hash; unknown nie emituje.

Nowa operacja: table/state/membership locks→zwalidowany plan i pełny zestaw kont→uporządkowane account locks (USER/source/ESCROW/GENESIS)→USER classification + gate→fresh source balance B→D=max(0,F−B). RESTRICTED/unknown daje zero D i zero nowego fundingu. D>0: istniejący ledger MINT GENESIS→source; zawsze TABLE_BUY_IN source→ESCROW; receipt i seat/state mutation w tym samym tx/savepoint. Kwota F pochodzi z realnego seed/replacement/managed planu, nie metadata; D<=F<=buyIn, suma deltas ograniczona maxPlayers. Nie można commitować samotnego refillu. Źródło100 shared TREASURY/configured source i500 POKER_BOT_BANKROLL pozostają.

Błąd funding po MINT cofa oba transfery i receipt; seed per-bot savepoint obejmuje całość. Błąd writer CAS lub dalszego obowiązkowego zapisu cofa całą tx. Unknown COMMIT rozstrzyga istniejący ledger registry/receipt/state version, bez nowej tożsamości ani ponownego mint. Replay z innym payload to error. Brak powiązanego prawidłowego table/state planu uniemożliwia finansowanie niezależnie od środowiskowej wartości source/flag.

General `postTransaction` z dowolnym metadata nie dostaje publicznego SYSTEM→SYSTEM MINT bypass. Dedykowana wewnętrzna metoda ledger jest dostępna wyłącznie przez composite flow weryfikujący gate/demand i atomowy funding; współdzieli istniejący zapis entries, nie tworzy drugiego ledgera. WS TABLE_BUY_IN adapter nadal służy finansowaniu; narrow general-adapter mint użyty przez wspólny helper w tym samym przekazanym tx.

Założenia pracy: brak refill pollera; jedna decyzja seed/rollover i skończona liczba rzeczywistych deltas; jedna próba plus najwyżej jeden retry po pewnym rollback, unknown→recovery. Krótki deadline/lock timeout według research. Nie ma await zewnętrznego job ani globalnego licznika pod table queue. Timeout kończy funding tx; no-funding fallback i payout mogą następnie działać. FIFO nie gwarantuje wyprzedzania trwającego krótkiego funding; żadna legalna wypłata nie zależy logicznie od refillu.

## Participation marker

has_human_participant=false pozostaje false przy denied JOIN commitującym detection. Ustawiać true tylko wraz z faktycznie accepted human seat/buy-in/state lub accepted rejoin istniejącego miejsca; pokryć wszystkie rejoin return branches. True pozostaje sticky dla retention. Jeden test opisany w research R4a, bez nowych testów UI.
