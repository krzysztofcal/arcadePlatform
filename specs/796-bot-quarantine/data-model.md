# Data model — projekt, bez migracji

## 1. chips_accounts: trwała klasa USER

Rozszerzyć istniejący wiersz, bez osobnej tabeli fraud: `poker_bot_access` text NOT NULL DEFAULT NORMAL CHECK IN(NORMAL,RESTRICTED); `poker_restricted_at` timestamptz; `poker_restriction_reason` text; `poker_restriction_threshold_ch` bigint; `poker_restriction_balance_ch` bigint. Dla NORMAL metadane null; dla RESTRICTED wymagane reason BALANCE_THRESHOLD,czas,threshold>0,balance>=threshold. Nie-USER zawsze NORMAL/null. Nie używać ogólnego account status: restriction nie zamraża portfela.

Migracja nie klasyfikuje masowo i nie zmienia balance; domyślne NORMAL przechodzi detektor przy pierwszej decyzji. Nieznany/missing USER nie jest NORMAL. Istniejąca unikalność USER/user_id zapewnia jedną trwałą tożsamość. Brak publicznej aktualizacji tych pól; backend-only i istniejące uprawnienia/RLS należy sprawdzić w T002. Nie dawać klientowi UPDATE nowych pól przez istniejący grant na cały wiersz.

Wiersz USER jest wspólną blokadą klasyfikacji i decyzji funding. NORMAL→RESTRICTED tylko raz, nie zmieniać first detected danych. Balance spadający po detekcji nie usuwa stanu. Metadane nie stanowią drugiego ledgera.

## 2. poker_bot_refill_policy (nowa mała tabela)

`tier` integer PK CHECK IN(100,500); `source_account_id` uuid NOT NULL FK chips_accounts; `cap_ch` bigint>=0; `issued_ch` bigint>=0 AND <=cap_ch; `enabled` boolean NOT NULL DEFAULT false. Lifetime: brak window_start, reset cron lub nowego budget przez zmianę config. Same source dla obu tierów dopuszczalne tylko jawnie, suma caps nadal<=600000 dla proponowanej konfiguracji. Nie zmieniać powiązania z source przy issued_ch>0; odrębny review/cutover bez zerowania licznika.

Cap100=100000,cap500=500000 jako propozycja do review; początkowo disabled. Źródło500 to istniejący POKER_BOT_BANKROLL;100 musi odpowiadać faktycznemu server cfg.bankrollSystemKey (domyślnie TREASURY), nie nowy POKER_BOT_BANKROLL_100. Nieznany source→zero refill. FK/typ/status SYSTEM sprawdzane transakcyjnie. Żadnego GENESIS transferu w migracji.

## 3. poker_bot_refill_receipts (nowa trwała tożsamość)

`operation_id` text PK; `tier` FK policy; `amount_ch` bigint>0; `ledger_transaction_id` uuid UNIQUE NOT NULL; `created_at` timestamptz NOT NULL; `payload_hash` text NOT NULL. Receipt+ledger+issued_ch w jednym tx. Po retention ledger klucz i hash pozostają: FK do transakcji nie może cascade/delete receipt ani blokować istniejącego zatwierdzonego archiwizowania; przechowywać logical UUID/reference, nie wymagający wiecznego hot ledger FK. Brak indeksowania dowolnych metadata; PK i tier/created_at do audytu wystarczą.

Replay tego samego operation_id porównuje hash/kwotę/tier/source; mismatch to error. Counter never decreases, nawet po zwrocie botów/cash-out. Receipt nie jest dowodem straty i nie zawiera EXPOSURE.

## 4. Istniejące dane pozostają

poker_tables/lifecycle_kind/managed_profile_key, poker_state.version, poker_seats.is_bot/status/leave_after_hand i escrow source attribution bez nowych klas/owner/drain. Seated obejmuje ACTIVE/disconnected i pending leave/roszczenie obecnej ręki; rozbieżność state/seat→unknown dla nowych finansów. Przy wyjściu gate uwalnia człowieka dopiero po zatwierdzonym usunięciu claim/membership. Nie dodawać tabelowego sticky NORMAL/RESTRICTED: klasę wyznaczają obecni ludzie.
