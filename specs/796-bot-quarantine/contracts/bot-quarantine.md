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

Proponowany shared helper w bot-access.mjs: locked table/state membership + wszystkie USER rows + server config→ALLOW / DENY_RESTRICTED / UNKNOWN. Nie query per bot/stack. Wszyscy ludzie i joining candidate pod tym samym transaction snapshot/locks; disconnected i pending leave nie znikają. Gate dopuszcza pusty human set bez omijania source/cap.

Wyłącznie ALLOW może doprowadzić do nowych bot seats/stack deltas/transferów. DENY_RESTRICTED daje zero seed, a rollover nie zapisuje funded candidate. UNKNOWN daje zero nowych funduszy; fallback no-funding może działać bez nowego gate, bo nie zwiększa ekspozycji CH. Stan po COMMIT/receipt jest jedyną podstawą runtime; unknown commit wymaga existing restore/version/idempotency przed powtórzeniem. Zwykły JOIN RESTRICTED nie wymaga botów, więc jest dozwolony z pominiętym seed.

Gate przed seed musi działać nawet dla standalone managed create. Writer weryfikuje przed CAS. Nie nadpisywać funded planu pustymi array przy zachowaniu inflated nextState. Wykorzystać istniejący server no-funding restore/prepare/persist/restore flow opisany w research. Nie zmieniać completed-hand payouts.

## Refill

Wewnętrzny operationId generowany serwerowo, trwale odtwarzalny z policy tier i numeru kolejnej jednostki emisji (`issued_ch` przed operacją, cap źródła nie resetowane). Replay sprawdzić przed ponownym capacity test; mismatch payload error. Jedna tx blokuje policy row, następnie GENESIS i source konta w ustalonej kolejności. Fresh source balance<buyIn, enabled, source zgodny, amount=buyIn−balance i remaining>=amount. Ledger MINT GENESIS→source,receipt i issued_ch+=amount atomowo. Brak żadnego USER/ESCROW transferu w refill tx. Nie zwracać succeeded przed COMMIT.

Nowy operationId wolno wyznaczyć dopiero po rozstrzygnięciu nieznanego wyniku poprzedniego przez policy/receipt. Brak auto reset/lifetime cap increase/env bypass. Równoczesne procesy serializuje policy row; restart nie potrzebuje in-memory counters. Jeśli source wspólne, account lock serializuje jego liquidity check; nie blokować poker table ani USER. Refill zatrzymany nie zatrzymuje settlement; brak DB nie daje obietnicy payout availability.

Nowy kształt SYSTEM→SYSTEM musi być dostępny wyłącznie przez planowaną dedykowaną metodę ledger `postPokerBotRefill`, która sama wykonuje/wywołuje cap check i atomic counter/receipt. Ogólne `postTransaction` wywołane z endpointu/metadata nadal odrzuca ten kształt; nie polegać na client-controlled reason ani flagach. Wewnętrzna wspólna funkcja zapisu wpisów może być użyta przez obie metody bez duplikowania ledgera.
