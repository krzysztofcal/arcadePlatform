# Data model — projekt, bez migracji

## 1. chips_accounts: trwała klasa USER

Rozszerzyć istniejący wiersz, bez osobnej tabeli fraud: `poker_bot_access` text NOT NULL DEFAULT NORMAL CHECK IN(NORMAL,RESTRICTED); `poker_restricted_at` timestamptz; `poker_restriction_reason` text; `poker_restriction_threshold_ch` bigint; `poker_restriction_balance_ch` bigint. Dla NORMAL metadane null; dla RESTRICTED wymagane reason BALANCE_THRESHOLD,czas,threshold>0,balance>=threshold. Nie-USER zawsze NORMAL/null. Nie używać ogólnego account status: restriction nie zamraża portfela.

Migracja nie klasyfikuje masowo i nie zmienia balance; domyślne NORMAL przechodzi detektor przy pierwszej decyzji. Nieznany/missing USER nie jest NORMAL. Istniejąca unikalność USER/user_id zapewnia jedną trwałą tożsamość. Brak publicznej aktualizacji tych pól; backend-only i istniejące uprawnienia/RLS należy sprawdzić w T002. Nie dawać klientowi UPDATE nowych pól przez istniejący grant na cały wiersz.

Wiersz USER jest wspólną blokadą klasyfikacji i decyzji funding. NORMAL→RESTRICTED tylko raz, nie zmieniać first detected danych. Balance spadający po detekcji nie usuwa stanu. Metadane nie stanowią drugiego ledgera.

## 2. poker_bot_refill_receipts (jedna nowa tabela)

`funding_key` text PRIMARY KEY — trwała tożsamość istniejącego bot buy-in, nie losowe żądanie klienta; `table_id` uuid NOT NULL; `tier` integer CHECK IN(100,500); `source_account_id` uuid NOT NULL; `funding_amount_ch` bigint>0; `mint_amount_ch` bigint>=0 AND <=funding_amount_ch; `funding_transaction_id` uuid UNIQUE NOT NULL; `mint_transaction_id` uuid UNIQUE nullable (null iff mint_amount_ch=0); `payload_hash` text NOT NULL; `created_at` timestamptz NOT NULL. To receipt operacji finansowania, bez EXPOSURE.

Receipt powstaje także przy zerowym mint, bo replay finansowania nie może później uznać obecnego niedoboru za powód do nowej emisji. Receipt, opcjonalny MINT i TABLE_BUY_IN są w jednym tx/savepoint. UUID transakcji to trwałe logical references, bez FK/cascade wymagającego hot ledger po retention. Istniejący registry/hash nadal obowiązuje; nie usuwać receipt wraz ze stołem/ledger.

Brak tabeli policy/cap_ch/issued_ch, lifetime counter/window/reset i blokady dostępności NORMAL po historycznej emisji. Źródło100 z istniejącego server cfg.bankrollSystemKey/default TREASURY;500 POKER_BOT_BANKROLL. Nieznane lub niedozwolone SYSTEM source fail-closed. source nie może być GENESIS,USER ani ESCROW; actual source zgodny z table-economy i locked plan, metadata nie autoryzuje. Zmiana source nie zmienia funding_key i nie pozwala ponownie sfinansować starego stacku.

## 3. Walidacja planu i retention

Plan pochodzi z istniejącego seed/replacement/topup oraz locked table/state/membership. Kwota pojedynczego bot funding to buy-in100 albo500; liczba deltas nie przekracza wolnych/wymienianych miejsc według existing maxPlayers. Brak sztucznego funding bez realnej zmiany seat/stack/state. Sumę dodatnich deltas walidować przed pierwszą emisją. Receipt replay porównuje original hash/params, nie aktualne saldo source; mismatch error. Prune nie kasuje funding_key/ledger idempotency; backfill nie emituje CH. Legacy replay bez nowego receipt korzysta z istniejącego registry i zwraca oryginalny wynik bez refillu; brak wiarygodnego wyniku→unknown.

## 4. Istniejące dane pozostają

poker_tables/lifecycle_kind/managed_profile_key, poker_state.version, poker_seats.is_bot/status/leave_after_hand i escrow source attribution bez nowych klas/owner/drain. has_human_participant pozostaje one-way: zapis dopiero przy zaakceptowanym human admission/rejoin; commit samej detekcji po odmowie nie ustawia false→true. Seated obejmuje ACTIVE/disconnected i pending leave/roszczenie obecnej ręki; rozbieżność state/seat→unknown dla nowych finansów. Przy wyjściu gate uwalnia człowieka dopiero po zatwierdzonym usunięciu claim/membership. Dodać poker_tables.is_farmer_only boolean NOT NULL DEFAULT false. Marker backend-only, false→true dozwolone, true→false zabronione DB one-way triggerem (rozszerzyć istniejący guard tabeli, nie przebudowywać retention). Nie inferować go z braku ludzi. Zachować przy leave/restart/close; nie reuse/relabel farmer-only do normalnego stołu. Lifecycle STANDARD/CONTINUOUS_BOT pozostaje odrębny: istniejący mixed managed może otrzymać true bez zmiany lifecycle. Nowo utworzony farmer-only ma zwykły lifecycle STANDARD, bez managed_profile/seed. Default false dla legacy; przed nowym admission/funding sprawdzić członkostwo i utrwalić true jeśli już seated human jest RESTRICTED. Kandydat RESTRICTED na normalnym stole nie jest takim seated human: odmowa, bez przejęcia stołu i bez zmiany markera. Brak nowego indeksu bez potrzeby: marker odczytywany po table PK.
