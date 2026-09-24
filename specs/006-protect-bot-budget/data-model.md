# Data Model — #869

Projekt, nie migracja. Nowe pola/tabele poniżej oznaczają planowane zmiany; istniejące nazwy z kodu mają jawny prefiks „istniejące”. D1–D3 nie są wypełniane domyślnymi wartościami. Zmiany schema tworzone dopiero po osobnym zleceniu implementacji.

## Wspólne ograniczenia

CH i podjednostki są całkowite; wszystkie kwoty nieujemne poza jawnie podpisaną stratą netto. 1 jednostka = 10 000 podjednostek; aktywne tiery 100/500; projektowe przyszłe 1000/5000/10000 dzielą mianownik, ale nie są włączone. Kwoty DB bigint; przed konwersją do JS Number sprawdzić safe integer, bez cichego overflow. Czas UTC timestamptz z jednego czasu transakcji; testy przyjmują kontrolowany zegar. Identyfikatory konta i stołu z sesji/DB, nigdy z niezaufanego owner payload.

RLS na wszystkich nowych tabelach w public; brak SELECT/INSERT/UPDATE/DELETE dla anon/authenticated. Backend ma tylko niezbędne uprawnienia; nie tworzyć publicznego SECURITY DEFINER RPC. Nowe rejestry audytu nie są kasowane kaskadowo ze stołem/użytkownikiem — istniejący retention może usunąć operacyjne poker_tables. Identyfikator UUID pozostaje w audycie, brak FK powodującego utratę historii. Dane prezentowane graczowi przez istniejący autoryzowany WS/Netlify.

## 1. Nowe `poker_bot_user_budget`

| Pole | Ograniczenie / znaczenie |
|---|---|
| user_id | UUID PRIMARY KEY, trwałe konto |
| fast_anchor_at | NOT NULL po pierwszej zatwierdzonej ekspozycji; niezmienna kotwica |
| fast_period_start | NOT NULL; anchor + n * 7 dni, n ≥ 0 |
| fast_used_subunits | bigint NOT NULL; 0..1 000 000 |
| fast_exposure_ch | bigint NOT NULL; 0..1 000 000 w okresie |
| slow_available_subunits | bigint NOT NULL; 0..10 000 |
| slow_clock_at / slow_next_at | D1 ustala znaczenie startu/odnowienia; bez przyjętej D1 nie aktywować slow |
| version | bigint NOT NULL, rosnąca wersja decyzji |
| policy_version | NOT NULL; zgodna z aktywną polityką |

Przejścia fast: uninitialized → pierwszy COMMIT → okres anchor; granica → nowy start z tej samej kadencji i wyzerowanie dwóch used counters. Wiele miniętych okresów daje jeden dostępny limit. Slow cap niezależny od fast; zmiana tieru/stołu nie tworzy wiersza. Brak refundu za wynik gry.

## 2. Istniejące `poker_tables` — nowe pola

| Pole | Ograniczenie |
|---|---|
| bot_access_class | STANDARD / SLOW_PRIVATE / HUMAN_ONLY; NULL wyłącznie jawne legacy przed klasyfikacją |
| slow_owner_user_id | UUID wymagany wyłącznie dla SLOW_PRIVATE, NULL dla innych |
| bot_policy_version | wersja protokołu; brak/nieznana = brak nowych chronionych operacji |
| bot_draining_started_at | nullable; po ustawieniu niezmienne |
| bot_draining_deadline_at | nullable razem ze started_at; zawsze started_at + 30 min; sticky |
| bot_funding_paused_reason | nullable albo jawne LEGACY_CUTOVER / POLICY_UNAVAILABLE; nie udaje wyczerpania allowance |

`lifecycle_kind`, `managed_profile_key`, `rotation_due_at`, `status`, `buy_in` pozostają odrębne. `status` nadal OPEN/CLOSED; DRAINING nie jest nową fazą ręki. Partial unique index na slow_owner_user_id dla OPEN SLOW_PRIVATE zapewnia maksymalnie jeden otwarty slow stół właściciela. Partial index na deadline dla OPEN/DRAINING wspiera sweep; nie skanować całej historii.

Przejścia: STANDARD active → DRAINING → CLOSED; nigdy z DRAINING z powrotem do active. SLOW_PRIVATE/HUMAN_ONLY nie są relabelowanym STANDARD. Legacy jest markerem przejścia, nie nową docelową klasą dostępu. Stary stół wymaga udowodnionej klasy i sources, a nowa polityka nie zmienia jego historycznych entries.

## 3. Nowe `poker_bot_exposure_events` — wspólny append-only dziennik decyzji

Przechowuje typy FUNDING, ADMISSION, EXPOSURE, DRAIN oraz CLOSE_PROOF; nie jest drugim ledgerem CH. Kwoty rzeczywistych CH pochodzą wyłącznie z chips_entries. Status decyzji COMMITTED/DENIED jest końcowy; brak wiecznych rezerwacji.

| Pola | Ograniczenia |
|---|---|
| event_id, event_key, event_kind, payload_hash | trwała unikalna event_key; konflikt payload przy replay oznacza odmowę |
| table_id, user_id | UUID; user NULL tylko dla funding bot-only, drain tabeli i close proof |
| policy_version, source_account_id, tier, access_class | obowiązkowe dla ekonomicznego dowodu, źródło to istniejące chips_accounts.id |
| lineage_id, funding_seq, from_state_version, to_state_version | lineage dziedziczona przy replacement z oldStack > 0; przy oldStack=0 lub nowym seed nowa; wersje potwierdzone stanem |
| exposure_ch, exposure_subunits | bigint ≥0; subunits = CH * (10000/tier); brak losowego zaokrąglenia |
| funding_transaction_id, receipt_hash | obowiązkowe dla rzeczywistego transferu; admission do istniejących botów referencjonuje dowody, nie udaje nowego transferu |
| occurred_at, result, details | trwały czas, wynik i minimalne dane rekonsyliacji/replay |

Unique dla EXPOSURE: user_id + authoritative exposure identity; nie tylko requestId i nie policy_version. Zmiana policy_version nie pozwala na ponowne naliczenie tego samego faktu. FUNDING unique z istniejącego funding idempotency/version/seat. DRAIN unique table_id dla pierwszego triggera. CLOSE_PROOF unique table_id + terminal version; zawiera funding/return transaction IDs, aggregate signed result, class, escrow=0 oraz dowód obecności/braku ludzi. Indeksy (table_id,lineage_id,funding_seq), (user_id,table_id), unikalne event_key. Zmiana nazwy/usunięcie konta nie pozwala resetować historii przez samą nową sesję.

## 4. Nowe `poker_bot_exposure_access` — projekcja idempotentnego dostępu

Klucz PRIMARY KEY (user_id, table_id, lineage_id). Pola: `last_funding_seq` (bigint ≥0), `first_admission_event_id`, `last_exposure_event_id`, `version`, `policy_version`. Projekcja aktualizowana tylko wraz z COMMITTED exposure; wydarzenia pozostają audytem. Zawiera dowód, że dany użytkownik już uzyskał dostęp do stocku lineage, nawet gdy zmienił requestId/seat/reconnect.

Nie używać FK ON DELETE CASCADE do poker_tables, nie resetować dostępu przy końcu tygodnia. Reconnect to samo seat nie nalicza nic. Nowe dopuszczenie tego samego konta po odejściu rozlicza wyłącznie nieautoryzowaną nową ekspozycję według contracts/bot-budget.md. Brak projection z istniejącym audytem oznacza rekonstrukcję pod lockiem, nigdy darmowy join.

## 5. Nowe `poker_bot_pool_state`

Jeden wiersz PRIMARY KEY tier (100 albo 500), unique system_account_id. Źródła: 100→nowe POKER_BOT_BANKROLL_100, 500→istniejące POKER_BOT_BANKROLL. Pola poniżej dla dwóch klas STANDARD/SLOW (dwie grupy kolumn w jednym blokowanym wierszu, nie nowa tabela per klasę):

- `liquid_*_ch`, `committed_*_ch`, `refilled_*_ch`: bigint ≥0.
- `realized_net_loss_*_ch`: bigint signed; zyski mają znak ujemny.
- `target_*_ch`: 900000 / 100000; suma target_tier_ch = 1000000.
- `legacy_committed_ch`, `quarantined_liquid_ch`: bigint ≥0, jawnie poza dostępną nową płynnością klas; legacy outstanding wchodzi do tier capitalization.
- `policy_version`, `activation_evidence_id`, `version`; nowe funding/refill dopiero po aktywacji z dowodem.

Inwariant: liquid_STANDARD + liquid_SLOW + quarantined_liquid = zweryfikowane saldo SYSTEM. Finansowanie: liquid klasy -= delta; committed klasy += delta, z ledger w jednym tx. Zamknięcie: committed -= udowodniony nierozliczony cost basis; liquid += wszystkie udowodnione zwroty; signed net loss += funding − returns. Profit nie jest nowym mint. Wcześniejszy zwrot uwzględniony dokładnie raz. Zero/nieznany drift blokuje nowe operacje; terminal zwrot nadal księguje prawidłowe źródło, a przy niespójnej projekcji trafia do quarantined do naprawy.

Headroom nie wynika wyłącznie z tych counters: przy refill serializable odczyt pełnego zbioru aktywnych escrow daje górną granicę kapitalizacji według plan.md §5. Dla każdego aktywnego stołu max(committed cost, pełne saldo ESCROW); brak dowodu/kompletności daje zero. Chroni także przed pominięciem aktualnych zysków botów, bez przypisywania escrow ludziom.

Podział początkowo dostępnych CH: standard = floor(0,9 * liquid), slow = pozostałe CH (ochrona najmniejszej jednostki); target i limity tygodniowe dzielą się dokładnie. Nowe zwroty i refille nie powodują automatycznego ponownego rozdzielenia całego salda. Klasa zawsze wynika z zatwierdzonego stołu/decision. Legacy return bez starej klasy jest jednorazową alokacją odzyskanej płynności 90/10, a nie emisją.

## 6. Nowe `poker_bot_issuance_state` i `poker_bot_issuance_receipts`

`issuance_state`: wiersze scope GLOBAL / TIER_100 / TIER_500, klucz scope; policy_version, window_mode, window_anchor, used_standard_ch, used_slow_ch, version. D2 określa window_mode i kotwicę. Global lock zawsze pierwszy przy refill. Część krocząca, jeżeli wybrana: pod lockiem wyliczenie z receipts w (now−168 h, now], counter jako transakcyjna projekcja, nie jedyne źródło. Stała: jeden wspólny UTC anchor, półotwarty okres [start,end), bez catch-up.

`issuance_receipts`: event_key UNIQUE, ledger_transaction_id UNIQUE, payload_hash, tier, class, amount_ch >0, issued_at NOT NULL, policy_version, proof_event_ids, compensated_amounts, kind REFILL / INITIAL_ALLOCATION / REBALANCE, approval/evidence reference. INITIAL_ALLOCATION ma dodatkowy unikalny klucz celu/purpose niezależny od czasu. Do limitów emisji tygodniowej wchodzi wyłącznie REFILL; każda alokacja początkowa nadal ma osobny audyt wpływu na podaż. Rebalance nie zwiększa żadnego mint counter. Indeks (kind,issued_at,tier,class).

Wszystkie counters i receipts zapisywane razem z ledger credit. Refund/cancel z powodu rollback nie pozostawia receipt; ponowienie po commit zwraca ten sam wynik. Zmiana week/retention nie kasuje unikalności klucza. Same metadata klienta nie przyznają uprawnienia do issuance.

## 7. Retention i etapowanie schema

Nowe audit events/issuance receipts i access watermark pozostają trwałe poza prune operacyjnych tabel. CLOSE_PROOF zawiera minimalne nieusuwalne agregaty i identyfikatory/hash oryginalnych dowodów; starsze pełne entries można archiwizować istniejącym mechanizmem dopiero po potwierdzeniu kompletności manifestu i możliwości rekonsyliacji. Brak dowodu nie resetuje limitu ani nie tworzy nowej straty.

Przyszły podział migracji: addytywne tabele/pola/indeksy/ACL i konto 100 bez CH; osobny kontrolowany activation/backfill class/legacy proof; osobna jednorazowa alokacja po D3. Nazwy timestampów generuje CLI dopiero w implementacji. Nie uruchamiać migracji ani seeda podczas planowania. PR migracyjny ma zamierzony automatyczny wpływ na shared Stage, opisany przed publikacją; Production oddzielne GO.
