# Plan jednorazowego resetu ekonomii CH i monitoringu poker escrow

Status: implementation prepared in PR #717. Runtime guards, manual SQL, runbook and read-only Admin/Ops monitoring are included, but no stage or production operation has been executed.

Plan został ponownie zweryfikowany bezpośrednio względem aktualnego `origin/main` o SHA `176d8b86cbdd5d3b180eff23e944c9bd361a4bdf`. PR #717 zawiera prerequisite domykający aplikacyjny maintenance guard w dwóch aktywnych Netlify Functions; guard musi zostać wdrożony przed użyciem resetu.

## 1. Cel i decyzje produktowe

Cała obecna ekonomia CH na stage i prod jest traktowana jako zbiór przedprodukcyjnych danych testowych. Zamiast selektywnego reconciliation historycznych stołów wykonujemy jednorazowy pełny reset:

1. stage;
2. prod dopiero po poprawnym smoke na stage.

Reset usuwa konta CH, ledger, claimy bonusowe oraz wszystkie dane pokera. Konta Supabase Auth, profile, XP, awatary, ulubione i konfiguracja kampanii bonusowych pozostają. Usunięcie bonus_claims i ponowna możliwość odebrania welcome/promo bonusu są zaakceptowanym zachowaniem.

Monitoring residuali jest osobnym follow-upem wykonywanym po resecie.

## 2. Ustalenia z aktualnego kodu

### 2.1 Schemat ekonomii CH

Najważniejsze migracje:

- supabase/migrations/20251218213520_chips_ledger.sql tworzy chips_accounts, chips_transactions, chips_entries i pierwotny chips_account_snapshot;
- supabase/migrations/20251218230000_chips_ledger_fixups.sql dodaje system_key, konta SYSTEM, aktualny snapshot i triggery append-only;
- supabase/migrations/20251219000500_chips_seed_system_accounts.sql zapewnia TREASURY;
- supabase/migrations/20251219001000_chips_entry_sequence_restore.sql i 20251223000000_chips_entry_trigger_fix.sql definiują aktualne zachowanie sekwencji wpisów;
- supabase/migrations/20251220000000_chips_allow_genesis_overdraft.sql pozwala wyłącznie SYSTEM/GENESIS zejść poniżej zera;
- supabase/migrations/20251221000000_chips_seed_treasury_genesis.sql definiuje początkowy transfer GENESIS -> TREASURY;
- późniejsze migracje dodają typy TABLE_BUY_IN, TABLE_CASH_OUT, HAND_SETTLEMENT, ADMIN_ADJUST, WELCOME_BONUS i PROMO_BONUS.

Zależności:

- chips_entries.transaction_id -> chips_transactions.id ON DELETE CASCADE;
- chips_entries.account_id -> chips_accounts.id;
- chips_account_snapshot.account_id -> chips_accounts.id ON DELETE CASCADE;
- bonus_claims.transaction_id -> chips_transactions.id ON DELETE RESTRICT;
- bonus_claims.campaign_id -> bonus_campaigns.id ON DELETE RESTRICT;
- chips_accounts.user_id -> auth.users.id.

Triggery chips_entries_block_deletes i chips_transactions_block_deletes uniemożliwiają zwykłe usunięcie historii. Reset może tymczasowo wyłączyć wyłącznie te dwa triggery, w tej samej transakcji, i musi włączyć je ponownie przed COMMIT.

Runtime księguje salda jawnie w:

- netlify/functions/_shared/chips-ledger.mjs::postTransaction();
- ws-server/poker/persistence/chips-ledger.mjs::postTransaction().

Usunięcie samych wpisów nie koryguje kont, dlatego reset usuwa również chips_accounts.

### 2.2 Poker

supabase/migrations/20260116120000_poker_tables.sql tworzy poker_tables, poker_seats, poker_state i poker_actions. Kolejne migracje dodają poker_requests, poker_hole_cards, boty i pola lifecycle.

Tabele potomne mają FK do poker_tables z ON DELETE CASCADE. Finalny preflight musi odczytać aktualny katalog FK i przerwać reset, jeżeli pojawiła się nieznana zależność.

### 2.3 Wymagany stan początkowy

| system_key | type | status | balance | next_entry_seq |
| --- | --- | --- | ---: | ---: |
| GENESIS | SYSTEM | active | -1 000 000 | 2 |
| TREASURY | SYSTEM | active | 1 000 000 | 2 |
| HOUSE | SYSTEM | active | 0 | 1 |

Ledger zawiera dokładnie jedną transakcję MINT z idempotency key seed:treasury:v1 oraz dwa zbilansowane wpisy.

Nie odtwarzamy kont USER. Tworzą się leniwie z saldem 0 CH przez:

- netlify/functions/_shared/chips-ledger.mjs::getOrCreateUserAccount();
- ws-server/poker/persistence/chips-ledger.mjs::getOrCreateUserAccount();
- odczyt netlify/functions/chips-balance.mjs.

Bonus jest późniejszą, osobną transakcją. Po resecie kwalifikujący się użytkownik może ponownie odebrać welcome/promo bonus.

## 3. Ocena uproszczeń zabezpieczeń

### 3.1 Fingerprinty i manifesty — SIMPLIFY WITH CONDITION

Nie tworzymy fingerprintów danych ani osobnych manifestów. Repo ma istniejący wzorzec weryfikowania project ref:

- .github/workflows/db-stage-apply-pr.yml;
- .github/workflows/db-stage-prepare.yml;
- netlify/functions/admin-stage-identity.mjs::parseProjectRefFromDbUrl();
- netlify/functions/admin-stage-identity.mjs::parseProjectRefFromSupabaseUrl();
- netlify/functions/admin-stage-identity.mjs::buildStageIdentity().

Runbook wymaga jednorazowych wartości RESET_TARGET=stage|prod i EXPECTED_SUPABASE_PROJECT_REF. Bezpośrednio przed psql project ref jest wyprowadzany z DB URL i musi być zgodny z oczekiwaną wartością. SQL nie potrafi wiarygodnie poznać Supabase project ref od wewnątrz bazy, dlatego walidacja connection stringa jest obowiązkowym zewnętrznym guardem.

Preflight i apply nadal sprawdzają tabele, migracje, FK, triggery oraz liczniki. Brak zgodności kończy operację przed mutacją.

### 3.2 Advisory lock — SAFE TO SIMPLIFY

Nie używamy advisory lock. Nie chroniłby przed aktualnymi writerami, ponieważ nie pobierają one wspólnego klucza. Ochronę zapewniają:

- jeden operator i zakaz równoległego uruchomienia;
- maintenance window;
- zatrzymany WS;
- zablokowane Netlify writery;
- jedna transakcja;
- jawne LOCK TABLE na wszystkich modyfikowanych tabelach.

### 3.3 Fingerprinty danych nietykanych — SAFE TO SIMPLIFY

Przed resetem zapisujemy wyłącznie liczniki:

- auth.users;
- user_profiles;
- bonus_campaigns;
- bonus_campaign_eligible_users.

Reset nie modyfikuje tych tabel, a FK prowadzą od rekordów usuwanych do zachowywanych rodziców. Liczniki muszą pozostać identyczne przed COMMIT. Różnica oznacza failed verification.

### 3.4 Artefakty — SAFE TO SIMPLIFY

Implementacja potrzebuje tylko:

- supabase/manual/chips-economy-test-reset.sql;
- krótkiego runbooka, docelowo tego dokumentu rozszerzonego o zatwierdzone komendy operacyjne.

Nie powstają manifesty, endpoint resetu, UI, scheduler ani framework audytowy. Po wykonaniu obu resetów skrypt należy usunąć z aktywnego drzewa albo oznaczyć jako retired.

Prerequisite jest osobną fazą runtime w tym PR i nie należy do skryptu resetującego. Nie dodaje migracji, nowego ENV ani systemu maintenance.

## 4. Inventory writerów i maintenance

### 4.1 Netlify CH i bonusy

| Writer | Funkcja/handler | Blokada |
| --- | --- | --- |
| netlify/functions/chips-balance.mjs | handler(); GET może utworzyć konto USER | CHIPS_ENABLED=0 i opublikowana konfiguracja |
| netlify/functions/chips-tx.mjs | handler() | CHIPS_ENABLED=0 |
| netlify/functions/welcome-bonus.mjs | createWelcomeBonusHandler() | CHIPS_ENABLED=0 |
| netlify/functions/bonus-campaigns.mjs | createBonusCampaignsHandler() | CHIPS_ENABLED=0 |
| netlify/functions/bonus-campaigns-scheduled.mjs | scheduler kampanii | CHIPS_ENABLED=0 |
| netlify/functions/admin-ledger-adjust.mjs | createAdminLedgerAdjustHandler() | CHIPS_ENABLED=0 |
| netlify/functions/admin-ops-actions.mjs | createAdminOpsActionsHandler() | CHIPS_ENABLED=0 |
| netlify/functions/admin-table-cleanup.mjs | createAdminTableCleanupHandler() | CHIPS_ENABLED=0 |
| netlify/functions/admin-table-force-close.mjs | createAdminTableForceCloseHandler() | CHIPS_ENABLED=0 |

`CHIPS_ENABLED=0` jest warstwą defense-in-depth, a nie samodzielnym maintenance gate. Netlify Functions otrzymują wartości environment variables utrwalone dla danego deployu; zmiana wartości wymaga nowego build/deploy i nie aktualizuje starych deploy previews.

### 4.2 Netlify poker create

netlify/functions/poker-create-table.mjs::handler() oraz netlify/functions/poker-quick-seat.mjs::handler() używają createPokerTableWithState(), ale nie respektują CHIPS_ENABLED.

#### Prerequisite PR

Przed resetem oba handlery muszą otrzymać ten sam fail-closed kontrakt co pozostałe funkcje ekonomii:

- sprawdzenie `CHIPS_ENABLED !== "1"` na początku handlera, przed auth i `beginSql()`;
- odpowiedź `404` z kontrolowanym `not_found`;
- brak połączenia z DB, aktualizacji stołu i powiadomienia WS;
- brak zmian protokołu, schematu i ENV.

Ten prerequisite domyka aplikacyjną lukę i ułatwia przyszłe maintenance, ale nie unieważnia starych deployów zawierających wcześniejszy kod.

#### Twardy maintenance gate

Właściwy reset wymaga wyłączenia całego projektu Netlify przez `Project configuration -> General -> Danger zone -> Disable project`. Jest to najmniejszy istniejący mechanizm blokujący stronę, Functions, deploy previews, branch deploys, historyczne deploy URLs i scheduled Functions bez dodawania maintenance routera.

Przed resetem operator musi negatywnie zweryfikować requesty do:

- poker-create-table;
- poker-quick-seat;
- chips-balance;
- bonus-campaigns.

Jeżeli `Disable project` nie blokuje któregokolwiek bezpośredniego function URL, reset zostaje przerwany. Firewall Traffic Rules są dopuszczalną alternatywą tylko wtedy, gdy mogą jawnie blokować cały ruch published i unpublished deploys, ale nie są preferowaną ścieżką.

Oficjalne odniesienia operacyjne:

- https://docs.netlify.com/manage/projects/disable-project/
- https://docs.netlify.com/build/functions/environment-variables/

### 4.3 WS

Writery WS obejmują między innymi:

- shared/poker-domain/join.mjs;
- shared/poker-domain/table-buy-in.mjs;
- shared/poker-domain/bots.mjs;
- shared/poker-domain/rebuy.mjs;
- shared/poker-domain/leave.mjs;
- shared/poker-domain/inactive-cleanup.mjs;
- shared/poker-domain/terminal-close.mjs;
- ws-server/poker/persistence/persisted-state-writer.mjs;
- ws-server/poker/persistence/chips-ledger.mjs;
- ws-server/server.mjs.

Na stage zatrzymujemy ws-server-preview.service, a na prod ws-server.service. Przed backupem trzeba potwierdzić brak procesu i aktywnych writerów.

Wycofany HTTP poker-sweep nie mutuje danych. W czasie maintenance blokujemy także ręczne admin operations, migracje, SQL Editor i deploymenty.

## 5. Plan resetu stage i prod

### Phase 0 — prerequisite PR

1. Dodać `CHIPS_ENABLED` guard do `poker-create-table.mjs` i `poker-quick-seat.mjs`.
2. Opublikować zmianę najpierw jako Deploy Preview, a następnie na produkcji.
3. Dla deployów utworzonych z `CHIPS_ENABLED=0` potwierdzić `404` oraz brak nowych rekordów `poker_tables` i `chips_accounts`.
4. Nie rozpoczynać resetu przed wdrożeniem tego prerequisite.

Guard jest obroną dodatkową. Twardym warunkiem resetu pozostaje późniejsze `Disable project`, ponieważ stare deploy previews zachowują kod i environment z czasu swojego deploymentu.

### Phase 1 — preflight read-only

1. Ustawić RESET_TARGET, EXPECTED_SUPABASE_PROJECT_REF i DB URL.
2. Zweryfikować project ref z DB URL przed połączeniem mutującym.
3. Wyświetlić konta SYSTEM, salda, liczbę USER/ESCROW, transakcji, wpisów, claimów, stołów i residuali.
4. Sprawdzić wymagane tabele, kolumny, migracje, FK i triggery.
5. Sprawdzić uprawnienia do czasowego wyłączenia i przywrócenia dwóch triggerów DELETE.
6. Zapisać kontrolne liczniki Auth, profili i konfiguracji kampanii.
7. Pokazać operatorowi pełny zakres usunięcia i wymagać jawnego potwierdzenia.

### Phase 2 — maintenance i backup

1. Zamrozić deploymenty, migracje oraz ręczne operacje admin/SQL.
2. Ustawić `CHIPS_ENABLED=0` dla właściwych kontekstów Netlify i opublikować deploy; traktować to jako defense-in-depth.
3. Wyłączyć cały projekt Netlify przez `Disable project`.
4. Potwierdzić niedostępność production URL, znanego Deploy Preview oraz bezpośrednich function URLs.
5. Zatrzymać właściwy WS service.
6. Potwierdzić brak procesu WS i aktywnych writerów DB.
7. Wykonać pełny backup obejmujący public i auth.
8. Zweryfikować backup i zachować jego checksumę poza repo.

Nie przechodzimy dalej, jeżeli target, blokada writerów lub backup nie są jednoznacznie potwierdzone.

### Phase 3 — jedna transakcja fail-closed

Struktura operacji, bez pełnego SQL:

1. BEGIN.
2. LOCK TABLE dla bonus_claims, tabel pokera, snapshotu oraz trzech tabel ledger.
3. Ponowne sprawdzenie schematu, triggerów i liczników.
4. Usunięcie bonus_claims.
5. Usunięcie poker_tables i kaskadowe usunięcie tabel potomnych.
6. Usunięcie chips_account_snapshot.
7. Tymczasowe wyłączenie chips_entries_block_deletes i chips_transactions_block_deletes.
8. Usunięcie kolejno chips_entries, chips_transactions, chips_accounts.
9. Ponowne włączenie obu triggerów DELETE.
10. Odtworzenie GENESIS, TREASURY i HOUSE.
11. Odtworzenie transakcji seed:treasury:v1 zgodnie z 20251221000000_chips_seed_treasury_genesis.sql.
12. Wymuszenie constraintów i wykonanie assertions.
13. COMMIT tylko przy pełnym sukcesie.

Nie używamy TRUNCATE CASCADE i nie resetujemy technicznych sekwencji identity.

### Phase 4 — assertions

Przed i po COMMIT sprawdzamy:

- brak wszystkich tabel i rekordów potomnych pokera;
- bonus_claims = 0;
- brak kont USER, ESCROW i POKER_TABLE:*;
- dokładnie trzy wymagane konta SYSTEM z właściwymi saldami i sekwencjami;
- dokładnie jedną transakcję seed i dwa wpisy;
- sumę wpisów transakcji oraz globalną sumę sald równą 0;
- saldo każdego konta zgodne z sumą jego wpisów;
- pusty snapshot;
- aktywne triggery append-only, sekwencji i ochrony przed ujemnym saldem;
- niezmienione liczniki Auth, profili i konfiguracji kampanii.

Jeżeli transakcja nie została zatwierdzona, rollback jest wystarczający. Jeżeli błąd pojawi się po COMMIT, writery pozostają zatrzymane i przywracamy pełny backup.

### Phase 5 — kolejność rollout

1. Dla stage opublikować znany Deploy Preview z `CHIPS_ENABLED=0`, następnie wyłączyć cały projekt Netlify i zatrzymać `ws-server-preview.service`.
2. Wykonać stage backup, reset i assertions.
3. Po poprawnych assertions przywrócić wartość deploy-preview `CHIPS_ENABLED=1`, włączyć projekt, opublikować świeży Deploy Preview, uruchomić `ws-server-preview.service` i wykonać stage smoke.
4. Po akceptacji stage ustawić produkcyjny `CHIPS_ENABLED=0` i opublikować production maintenance deploy. Następnie ponownie wyłączyć cały projekt Netlify i zatrzymać `ws-server.service`.
5. Wykonać osobny prod backup, uruchomić ten sam skrypt na prod i potwierdzić prod assertions.
6. Ustawić produkcyjny `CHIPS_ENABLED=1`, włączyć projekt, opublikować świeży production deploy, uruchomić `ws-server.service` i wykonać prod smoke.
7. Nie polegać na zmianie samej wartości ENV: każda zmiana `CHIPS_ENABLED` musi zostać utrwalona w nowym deployu właściwego kontekstu.

### Phase 6 — abort i przywrócenie usług

Procedura recovery jest obowiązkowa również wtedy, gdy operator rezygnuje przed uruchomieniem SQL. Sam rollback bazy nie przywraca Netlify ani WS.

#### Reset nie rozpoczął się albo transakcja zrobiła rollback

1. Zatrzymać dalsze kroki resetu i potwierdzić brak aktywnej sesji mutującej.
2. Read-only potwierdzić, że baza zachowała stan sprzed resetu, wymagane triggery są aktywne, a tabele i konta SYSTEM istnieją.
3. Przywrócić `CHIPS_ENABLED=1` dla kontekstu, który został przełączony na maintenance.
4. Utworzyć świeży deploy właściwego kontekstu i potwierdzić, że zawiera `CHIPS_ENABLED=1`; samo przestawienie ENV nie wystarcza.
5. Jeżeli Netlify nie pozwala zbudować deployu przy wyłączonym projekcie, włączyć projekt z ostatnim maintenance deployem nadal mającym `CHIPS_ENABLED=0`, a następnie natychmiast opublikować świeży deploy. WS pozostaje zatrzymany do zakończenia deploymentu.
6. Włączyć projekt Netlify, jeżeli nadal jest wyłączony.
7. Uruchomić odpowiedni `ws-server-preview.service` lub `ws-server.service` dopiero po sukcesie deployu.
8. Potwierdzić podstawowe operacje: odczyt salda, brak nieoczekiwanej mutacji, utworzenie nowego stołu i poprawne połączenie WS.

#### COMMIT przeszedł, ale końcowe assertions lub smoke zawiodły

1. Nie włączać projektu i nie uruchamiać WS.
2. Pozostawić `CHIPS_ENABLED=0` oraz maintenance deploy.
3. Przywrócić pełny backup zgodnie z runbookiem.
4. Read-only potwierdzić integralność przywróconego ledgeru, triggerów, stołów i kont SYSTEM.
5. Dopiero po poprawnym restore wykonać powyższą procedurę przywrócenia `CHIPS_ENABLED=1`, świeżego deployu, Netlify i WS.

Jeżeli nie można jednoznacznie potwierdzić rollbacku albo restore, środowisko pozostaje w maintenance. Nie wolno przywracać writerów do niezweryfikowanego stanu.

### Minimalny smoke

1. Istniejący użytkownik loguje się.
2. Odczyt salda tworzy USER account z 0 CH.
3. Kwalifikujący się użytkownik ponownie odbiera zaakceptowany welcome/promo bonus.
4. Powstaje nowy stół; człowiek i boty startują z bieżącą konfiguracją 100 CH.
5. Krótkie rozdanie kończy się poprawnie.
6. Leave prowadzi do terminal close.
7. Stół ma status CLOSED, escrow wynosi 0, a bot cash-out trafia do udowodnionego SYSTEM.
8. Twarde odświeżenie pokazuje autorytatywne saldo bez starego cache klienta.

## 6. Follow-up: monitoring residuali w Admin/Ops

Monitoring jest przygotowany w PR #717, ale jego operacyjna weryfikacja następuje po resecie. Nie wymaga background joba ani zmian WS.

### Backend

Rozszerzyć netlify/functions/admin-ops-summary.mjs::loadOpsSummary() o lokalny helper loadPokerEscrowResidualSummary() i właściwość pokerEscrowResiduals zawierającą:

- totalAccountCount;
- closedResidualTableCount;
- closedResidualChips;
- largestResidualChips;
- lastResidualAt;
- items.

Każdy element items zawiera tableId, balance, status, tableCreatedAt, tableUpdatedAt, lastActivityAt i escrowUpdatedAt. Lista ma maksymalnie 10 problematycznych pozycji.

Zapytanie łączy chips_accounts dla account_type=ESCROW i system_key LIKE POKER_TABLE:% z poker_tables, agregując zamknięte stoły z dodatnim saldem. Obecna skala nie wymaga migracji, indeksu, cursora ani materializacji.

Endpoint zachowuje istniejący requireAdminUser() z netlify/functions/_shared/admin-auth.mjs.

### UI

Zmienić istniejące:

- admin.html, zakładka Ops;
- js/admin-page.js::selectNodes();
- js/admin-page.js::loadOps();
- js/admin-page.js::renderOps() lub mały helper;
- css/admin.css tylko jeśli istniejące klasy nie wystarczą.

Stan:

- zielony wyłącznie dla kompletnej odpowiedzi z closedResidualTableCount równym 0;
- czerwony dla co najmniej jednego residualu, z liczbą stołów i sumą CH;
- Unavailable przy błędzie, nigdy fałszywie zielony;
- krótka lista największych lub najnowszych residuali.

Nie powstaje nowy plik JavaScript ani inline script, więc nie ma nowego CSP SHA. Istniejący kod pozostaje kompatybilny z JSP. Zmiana wymaga Netlify Deploy Preview, ale nie WS Preview Deploy.

## 7. Breaking impact

Reset celowo i bezpowrotnie bez backupu usuwa:

- wszystkie salda i konta USER;
- wszystkie konta escrow;
- całą historię CH i admin adjustments;
- welcome/promo transaction history oraz bonus_claims;
- wszystkie stoły i historię pokera;
- obecne konta SYSTEM przed odtworzeniem baseline.

Nie usuwa Auth users, profili, awatarów, XP, ulubionych, kampanii ani allowlist. Po resecie użytkownik ma 0 CH do czasu nowej transakcji i może ponownie odebrać aktywny bonus.

Monitoring jest addytywny i tylko do odczytu. Nie wpływa na gameplay ani ledger poza kosztem jednego agregującego zapytania przy odświeżeniu Admin/Ops.

Operacyjny abort nie powinien zmienić danych, jeżeli transakcja zrobi rollback, ale powoduje downtime do czasu jawnego przywrócenia ENV, świeżego deployu, projektu Netlify i WS. Niekompletna procedura recovery może pozostawić aplikację poprawnie zabezpieczoną, lecz niedostępną.

## 8. Świadomie poza zakresem

- selektywne reconciliation i inventory historycznych stołów;
- automatyczna remediation lub transfery;
- reset endpoint/UI/scheduler;
- background monitoring, alerty, wykresy i historia metryk;
- usuwanie Auth, profili lub XP;
- nowe testy;
- zmiany GitHub issues;
- wykonanie resetu w ramach PR-a dokumentacyjnego.
