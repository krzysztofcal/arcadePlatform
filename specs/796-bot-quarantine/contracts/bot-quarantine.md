# Contract — access, funding, refill

## JOIN / RESUME

Istniejący authenticated transport/requestId/tableId, bez nowego endpointu. Klient nie podaje wiążącej klasy. Serwer pod table/state lock odczytuje wszystkich seated humans i candidate, ich USER rows oraz próg. Rejoin finansowanego aktywnego miejsca pozostaje rejoin bez buy-in; nowy JOIN musi spełnić istniejące tier/capacity/stakes i klasy.

| Ludzie teraz | Kandydat | Nowe admission |
|---|---|---|
| zwykły is_farmer_only=false, brak ludzi / wszyscy NORMAL | NORMAL | tak, z istniejącymi warunkami |
| zwykły is_farmer_only=false, także prefunded/CONTINUOUS_BOT | RESTRICTED | zawsze odmowa, bez claim/relabel |
| farmer-only=true, brak ludzi / wszyscy RESTRICTED | RESTRICTED | tak, zero bot funding |
| farmer-only=true | NORMAL | odmowa nowego admission |
| jednorodni przeciwnej klasy / mixed | dowolny niezgodny / każdy w mixed | odmowa |
| unknown | dowolny | unavailable |

Planowane neutralne kody `poker_access_incompatible`, `poker_access_unavailable`; nie ujawniać salda/powodu innych ludzi. Odpowiedź odmowy policy jest wynikiem committed tx, nie wyjątkiem cofającym detection. Runtime nie publikuje miejsca bez sukcesu COMMIT. Stale Quick Seat może odmówić z tym samym kodem; bez automatycznej pętli i nowego tworzenia stołów. Aktualny ws-server/poker/handlers/join.mjs i authoritative-join-adapter mapują wynik bez success na deny; browser zachowuje dotychczasowy błąd/ponowną próbę.

## Funding gate

Proponowany shared helper w bot-access.mjs: locked table.is_farmer_only + table/state membership + wszystkie USER rows + server config→ALLOW / DENY_RESTRICTED / UNKNOWN. Nie query per bot/stack. Wszyscy ludzie i joining candidate pod tym samym transaction snapshot/locks; disconnected i pending leave nie znikają. is_farmer_only=true zawsze daje DENY_RESTRICTED, także bez ludzi i po leave/restart. Gate dopuszcza pusty human set na zwykłym stole wyłącznie zgodnie z istniejącym managed lifecycle i rzeczywistym planem, bez omijania source/demand.

Wyłącznie ALLOW może doprowadzić do nowych bot seats/stack deltas/transferów. DENY_RESTRICTED daje zero seed, a rollover nie zapisuje funded candidate. UNKNOWN daje zero nowych funduszy; fallback no-funding może działać bez nowego gate, bo nie zwiększa ekspozycji CH. Stan po COMMIT/receipt jest jedyną podstawą runtime; unknown commit wymaga existing restore/version/idempotency przed powtórzeniem. JOIN RESTRICTED wyłącznie na farmer-only, z pominiętym seed; zwykły stół odmawia niezależnie od jego aktualnych stacków.

Gate przed seed musi działać nawet dla standalone managed create. Writer weryfikuje przed CAS. Nie nadpisywać funded planu pustymi array przy zachowaniu inflated nextState. Wykorzystać istniejący server no-funding restore/prepare/persist/restore flow opisany w research. Nie zmieniać completed-hand payouts.

## Refill / composite funding

Nie ma lifetime cap/counter ani samodzielnego background mint. `postBotFundingWithRefill` to planowany wspólny helper wywoływany w istniejącym tx seed/replacement/topup. Tożsamość z existing bot funding idempotencyKey (seed table/seat, replacement/topup table/state-version/bot), a nie świeży request klienta. Replay odczytuje original funding/registry przed badaniem nowego niedoboru; już zatwierdzony funding nie emituje ponownie nawet po zmianie klasy/źródła. Legacy replay bez osobnego receipt korzysta z istniejącego registry/hash; unknown nie emituje.

Nowa operacja: config FOR SHARE→table/state/membership locks→zwalidowany plan i pełny zestaw kont→uporządkowane account locks (USER/source/ESCROW/GENESIS)→USER classification + gate→fresh source balance B→D=max(0,F−B). is_farmer_only=true lub RESTRICTED/unknown daje zero D i zero nowego fundingu. D>0: istniejący ledger MINT GENESIS→source; zawsze TABLE_BUY_IN source→ESCROW; existing registry i seat/state mutation w tym samym tx/savepoint. Kwota F pochodzi z realnego seed/replacement/managed planu, nie metadata; D<=F<=buyIn, suma deltas ograniczona maxPlayers. Nie można commitować samotnego refillu. Źródło100 shared TREASURY/configured source i500 POKER_BOT_BANKROLL pozostają.

Błąd funding po MINT cofa oba transfery i ich registry; seed per-bot savepoint obejmuje całość. Błąd writer CAS lub dalszego obowiązkowego zapisu cofa całą tx. Unknown COMMIT rozstrzyga istniejący ledger registry/state version, bez nowej tożsamości ani ponownego mint. Replay z innym payload to error. Brak powiązanego prawidłowego table/state planu uniemożliwia finansowanie niezależnie od środowiskowej wartości source/flag.

General `postTransaction` z dowolnym metadata nie dostaje publicznego SYSTEM→SYSTEM MINT bypass. Dedykowana wewnętrzna metoda ledger jest dostępna wyłącznie przez composite flow weryfikujący gate/demand i atomowy funding; współdzieli istniejący zapis entries, nie tworzy drugiego ledgera. WS TABLE_BUY_IN adapter nadal służy finansowaniu; narrow general-adapter mint użyty przez wspólny helper w tym samym przekazanym tx.

Założenia pracy: brak refill pollera; jedna decyzja seed/rollover i skończona liczba rzeczywistych deltas; jedna próba plus najwyżej jeden retry po pewnym rollback, unknown→recovery. Krótki deadline/lock timeout według research. Nie ma await zewnętrznego job ani globalnego licznika pod table queue. Timeout kończy funding tx; no-funding fallback i payout mogą następnie działać. FIFO nie gwarantuje wyprzedzania trwającego krótkiego funding; żadna legalna wypłata nie zależy logicznie od refillu.

## Participation marker

has_human_participant=false pozostaje false przy denied JOIN commitującym detection. Ustawiać true tylko wraz z faktycznie accepted human seat/buy-in/state lub accepted rejoin istniejącego miejsca; pokryć wszystkie rejoin return branches. True pozostaje sticky dla retention. Jeden test opisany w research R4a, bez nowych testów UI.

## Minimalny Create i trwałość kwarantanny

netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState już atomowo tworzy table,INIT i pusty ESCROW,nie finansuje botów. Dla authenticated userId w tej samej tx odczytać wspólną konfigurację,lock USER,uruchomić wspólny classifier z authoritative balance,utrwalić NORMAL→RESTRICTED i dopiero INSERT table.is_farmer_only według wyniku. Unknown USER/class/config→zero create,bez ordinary fallback. Klient nie podaje markera ani progu. userId=null wyłącznie dla istniejącego trusted managed CONTINUOUS_BOT flow pozostaje ordinary i nie wymaga human classification; publiczny endpoint nie może przekazać null zamiast authenticated identity. Classification+table/state/empty escrow COMMIT atomowo,failed create rollback całości/unknown recovery. Final JOIN nadal wykonuje własny recheck; nie wymaga ponownego Create z powodu niewykrytego wcześniej progu.

Wspólny helper obejmuje poker-create-table.mjs::handler i istniejące Quick Seat create fallback. Existing Create UI wystarcza, brak nowego endpointu/find-or-create. Pierwszy farmer wchodzi i czeka na drugiego; nie obiecywać samotnej gry bez botów. Final WS join ponownie czyta marker z locked table row; create nie rezerwuje miejsca ani nie pomija tier/buy-in. Retry create może pozostawić kolejny pusty farmer-only jak w istniejącym flow, nigdy zwykły stół z bot CH; nie dodawać osobnego systemu rezerwacji.

Wykrycie już seated RESTRICTED przy authoritative JOIN/funding check ustawia marker true wraz z classification przed savepointem nowych finansów. Znana odmowa commit zachowuje obie zmiany. Replay starego finansowania nie emituje ponownie i nie cofa markera. Cash-out nie wymaga sukcesu nowego gate. Aby leave nie wyprzedził utrwalenia markera, shared/poker-domain/leave.mjs (także deferred finalization) zapisuje is_farmer_only=true dla już trwale RESTRICTED odchodzącego/seated człowieka razem z istniejącą aktualizacją table/seat i wypłatą, przed usunięciem membership. Odczyt istniejącej trwałej klasy, bez threshold detektora/refill/policy-denial w cash-out; marker nie jest warunkiem uprawnienia do wypłaty. Tylko known durable RESTRICTED ustawia false→true. Known NORMAL i UNKNOWN (missing/invalid/nieczytelna klasa) przy otherwise legal leave/cash-out pozostawiają marker bez zmian i nie odmawiają payout. Wcześniejsze true pozostaje sticky. UNKNOWN nie uprawnia nowego fundingu w tej operacji. Po successful removal membership przyszłe admission/funding stosują zwykły authoritative classifier/gate; powracający user przez Create/JOIN jest ponownie oceniany na authoritative balance i dopiero known RESTRICTED może ustawić farmer-only. Unknown nowych admission/funding nadal fail-closed. Zapis markera i zwykła wypłata podlegają normalnej atomowości/recovery DB. Terminal close zachowuje marker; CLOSED nie jest reuse. Brak fanout/skanowania innych stołów.

## Lifecycle exactly-once / archive

Brak nowej tabeli receipts. Funding registry/hash jest dowodem całego atomic COMMIT; deterministic MINT key `bot-refill:`+funding key istnieje tylko przy D>0. Oba rekordy mają zweryfikowany table binding i zamknięty kształt zgodny z data-model §2–3. Archived replay używa istniejącego registry aż do zatwierdzonego lifecycle retirement. Po jego cleanup closed/deleted/retired/stale plan daje zero mint,nie nowe wykonanie. Nie odtwarzać brakującego table ani nie przekształcać starego planu w nowy przez zmianę key/version.

Nowy typed MINT objąć bot-only7d i closed-human30d oraz missing-table cleanup w istniejącym export/manifest/prune/registry lifecycle. Warunki closure/age/holds/complete proof nadal obowiązują. MINT pair nie może pozostać na zawsze out-of-scope; jeśli parę podzielono na batches, ukończenie table lifecycle czeka na dowód obu istniejących manifests. General MINT nie jest automatycznie prune eligible. Nie budować drugiego archiwizatora. Zero dodatkowego rekordu przy mint_amount=0.

## Wspólny threshold/config WS i Netlify

Jeden shared parser/classifier w planowanym shared/poker-domain/bot-access.mjs,nie dwie implementacje. Sam identyczny parser process.env nie zapewnia identycznej wartości na dwóch runtime. Najmniejszy wspólny autorytatywny storage: jedna singleton row public.poker_bot_access_config(id=1,threshold_ch,revision),start threshold1 000 000 000,positive safe integer,revision>0; backend-only. Brak ogólnego config service i brak per-user records. Zastępuje niezależne POKER_RESTRICTED_BALANCE_THRESHOLD_CH overrides. Oba runtime czytają dokładnie ten sam wiersz w tx przez ten sam helper i FOR SHARE; brak/invalid/schema unknown→fail closed nowych human Create/JOIN/funding. Lokalna env nie może override ani cicho przywrócić default. Default ustawiany jawnie w addytywnej migracji singletonu,nie per-process przy błędzie odczytu. To config row,nie mint/seed CH.

Jedna kolejność: config FOR SHARE→existing table/state (JOIN/funding)→uporządkowane USER/account locks; human Create config→USER→INSERT własnych nowych table/state (nie przejmuje istniejącego stołu). Konfiguracyjny update ma tylko lock config,nie USER/table; nie dokładać reverse order. Utrzymać share lock do COMMIT,aby pojedyncza decyzja nie mieszała wersji. Oba runtime walidują ten sam threshold/revision; zmiana config serializuje się względem decyzji,nie tworzy równoległych lokalnych polityk. Legalny późniejszy config update może wpłynąć na kolejny JOIN,sticky restriction nigdy nie znika. Brak threshold check na settlement/cash-out. Parser wspólny waliduje integer bez precision loss. Wdrożenie obu consumers przed aktywacją,missing config fail-closed.
