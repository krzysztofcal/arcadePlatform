# Data Model — #869

Projekt, nie migracja. Nowe pola/tabele poniżej oznaczają planowane zmiany; istniejące nazwy z kodu mają jawny prefiks „istniejące”. D1–D3 są zatwierdzone w issue i spec.md. Zmiany schema tworzone dopiero po osobnym zleceniu implementacji.

## Wspólne ograniczenia

CH i podjednostki są całkowite; wszystkie kwoty nieujemne poza jawnie podpisaną stratą netto. 1 jednostka = 10 000 podjednostek; aktywne tiery 100/500; projektowe przyszłe 1000/5000/10000 dzielą mianownik, ale nie są włączone. Kwoty DB bigint; przed konwersją do JS Number sprawdzić safe integer, bez cichego overflow. Czas UTC timestamptz z jednego czasu decyzji t pobranego po guard lock, nie sprzed oczekiwania; testy przyjmują kontrolowany zegar. Identyfikatory konta i stołu z sesji/DB, nigdy z niezaufanego owner payload.

RLS na wszystkich nowych tabelach w public; brak SELECT/INSERT/UPDATE/DELETE dla anon/authenticated. Backend ma tylko niezbędne uprawnienia; nie tworzyć publicznego SECURITY DEFINER RPC. Nowe rejestry audytu nie są kasowane kaskadowo ze stołem/użytkownikiem — istniejący retention może usunąć operacyjne poker_tables. Identyfikator UUID pozostaje w audycie, brak FK powodującego utratę historii. Dane prezentowane graczowi przez istniejący autoryzowany WS/Netlify.

## 1. Nowe `poker_bot_user_budget`

| Pole | Ograniczenie / znaczenie |
|---|---|
| user_id | UUID PRIMARY KEY, trwałe konto |
| fast_anchor_at | NOT NULL po pierwszej zatwierdzonej ekspozycji; niezmienna kotwica |
| fast_period_start | NOT NULL; anchor + n * 7 dni, n ≥ 0 |
| fast_used_subunits | bigint NOT NULL; 0..1 000 000 |
| fast_exposure_ch | bigint NOT NULL; 0..1 000 000 w okresie |
| first_slow_at | nullable do pierwszego przejścia slow, potem niezmienny audit; nie jest kotwicą odnawiania |
| fast_exhausted_event_id, fast_exhausted_at | nullable razem; projekcja pierwszego zdarzenia bieżącego okresu; historia nieusuwalna |
| last_decision_at | UTC czas ostatniej decyzji pod guard; cofnięcie zegara blokuje nowe zużycie |
| version | bigint NOT NULL, rosnąca wersja decyzji |
| policy_version | NOT NULL; zgodna z aktywną polityką |

Przejścia fast: uninitialized → pierwszy COMMIT → okres anchor; granica → nowy start z tej samej kadencji i wyzerowanie dwóch used counters. Wiele miniętych okresów daje jeden dostępny limit. Slow cap niezależny od fast; zmiana tieru/stołu nie tworzy wiersza. Brak refundu za wynik gry.

## 2. Istniejące `poker_tables` — nowe pola

| Pole | Ograniczenie |
|---|---|
| bot_access_class | STANDARD / SLOW_PRIVATE / HUMAN_ONLY; NULL wyłącznie jawne legacy przed klasyfikacją |
| slow_owner_user_id | UUID wymagany wyłącznie dla SLOW_PRIVATE, NULL dla innych |
| bot_policy_version | wersja protokołu; brak/nieznana = brak nowych chronionych operacji |
| bot_draining_started_at | nullable; najwcześniejsze powiązane exhausted_at; może tylko zmaleć po odkryciu wcześniejszego dowodu |
| bot_draining_source_event_id | identyfikator zdarzenia wyznaczającego najwcześniejszy deadline |
| bot_draining_deadline_at | nullable razem ze started_at; zawsze started_at + 30 min; sticky |
| bot_funding_paused_reason | nullable albo jawne LEGACY_CUTOVER / POLICY_UNAVAILABLE; nie udaje wyczerpania allowance |

`lifecycle_kind`, `managed_profile_key`, `rotation_due_at`, `status`, `buy_in` pozostają odrębne. `status` nadal OPEN/CLOSED; DRAINING nie jest nową fazą ręki. Partial unique index na slow_owner_user_id dla OPEN SLOW_PRIVATE zapewnia maksymalnie jeden otwarty slow stół właściciela. Partial index na deadline dla OPEN/DRAINING wspiera sweep; nie skanować całej historii.

Przejścia: STANDARD active → DRAINING → CLOSED; nigdy z DRAINING z powrotem do active. SLOW_PRIVATE/HUMAN_ONLY nie są relabelowanym STANDARD. Legacy jest markerem przejścia, nie nową docelową klasą dostępu. Stary stół wymaga udowodnionej klasy i sources, a nowa polityka nie zmienia jego historycznych entries.

## 3. Nowe `poker_bot_exposure_events` — wspólny append-only dziennik decyzji

Przechowuje typy FUNDING, ADMISSION, EXPOSURE, FAST_EXHAUSTED, DRAIN, CLOSE_PROOF_PENDING, CLOSE_PROOF oraz typy MATCHMAKING i SEARCH_PROGRESS opisane niżej; nie jest drugim ledgerem CH. Kwoty rzeczywistych CH pochodzą wyłącznie z chips_entries. Status decyzji COMMITTED/DENIED jest końcowy; brak wiecznych rezerwacji.

| Pola | Ograniczenia |
|---|---|
| event_id, event_key, event_kind, payload_hash | trwała unikalna event_key; konflikt payload przy replay oznacza odmowę |
| table_id, user_id | UUID; user NULL dozwolone dla FUNDING niezależnie od liczby ludzi, DRAIN tabeli i CLOSE_PROOF_PENDING/CLOSE_PROOF; dla EXPOSURE user_id zawsze NOT NULL; table NULL tylko dla account FAST_EXHAUSTED, SEARCH_PROGRESS oraz terminalnego no-offer MATCHMAKING_RECOMMENDATION |
| policy_version, source_account_id, tier, access_class | obowiązkowe dla ekonomicznego dowodu funding/exposure/close; FAST_EXHAUSTED ma konto/okres/czas zamiast jednego tier/source; źródło to istniejące chips_accounts.id |
| lineage_id, funding_seq, from_state_version, to_state_version | nullable dla account FAST_EXHAUSTED/DRAIN; dla funding/exposure lineage dziedziczona przy replacement z oldStack > 0; przy oldStack=0 lub nowym seed nowa; wersje potwierdzone stanem |
| exposure_ch, exposure_subunits | dla EXPOSURE bigint ≥0; subunits = CH * (10000/tier); FAST_EXHAUSTED/DRAIN bez kosztu; brak losowego zaokrąglenia |
| funding_transaction_id, receipt_hash | obowiązkowe dla rzeczywistego transferu; admission do istniejących botów referencjonuje dowody, nie udaje nowego transferu |
| occurred_at, result, details | trwały czas, wynik i minimalne dane rekonsyliacji/replay |

Unique dla EXPOSURE: user_id + authoritative exposure identity; nie tylko requestId i nie policy_version. Zmiana policy_version nie pozwala na ponowne naliczenie tego samego faktu. FUNDING dokumentuje jeden rzeczywisty transfer SYSTEM → ESCROW na poziomie stołu/bota; unique z istniejącego funding idempotency/version/bot seat, niezależnie od odbiorców ekspozycji. createdBy/inicjator nie oznacza właściciela finansowania. Każde EXPOSURE wymaga user_id oraz trwałej tożsamości tego finansowania lub udostępnionego stacku (lineage/snapshot admission). Jeden FUNDING może zasilać wiele niezależnych EXPOSURE; liczba ludzi nie powiela transferu ani debitu rezerwy. FAST_EXHAUSTED unique (user_id,fast_period_start), exhausted_at i reason; DRAIN unique (table_id,source_exhaustion_event_id), bez utraty wcześniejszego źródła. CLOSE_PROOF unique event_kind + table_id + to_state_version; zawiera funding/return transaction IDs, aggregate signed result, class, escrow=0 oraz dowód obecności/braku ludzi. Indeksy (table_id,lineage_id,funding_seq), (user_id,table_id), unikalne event_key. Zmiana nazwy/usunięcie konta nie pozwala resetować historii przez samą nową sesję.

EXPOSURE dodaje budget_mode FAST/SLOW oraz consumed_at NOT NULL dla COMMITTED kosztu; indeks (user_id,budget_mode,consumed_at) z filtrem COMMITTED. Slow availability i nextEligibleAt są wyliczane z trwałej sumy (t−12 h,t], nigdy jako odnawiany saldo/grant. first_slow_at nie resetuje historii. Dowody aktywnego okna pozostają dostępne pod lockiem.

Nowe `poker_bot_exhaustion_tables`: PRIMARY KEY (exhaustion_event_id,table_id), account/admission identity snapshot, projection_applied_at nullable, bez cascade; indeks (table_id,exhaustion_event_id) oraz pending projection. Powiązania zapisane atomowo z FAST_EXHAUSTED, lista wszystkich zajętych STANDARD z botami pod guard konta. Deferred leave nie usuwa powiązania. Fanout/sweep zapisuje projekcję po jednej tabeli; final gate czyta powiązania niezależnie od znacznika applied. Ta mała relacja służy indeksowanemu trwałemu fanout, nie nowemu silnikowi.

### Kroczące slow — D1 i częściowe zużycie P1

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

Pod blokadą konta odczytać trwałe EXPOSURE z budget_mode=SLOW, result=COMMITTED, consumed_at i kosztem integer. Dostępność jest wyliczana jako 10000 minus suma w oknie, nie przechowywana jako odnawiany grant. DENIED/replay nie zużywa ponownie. Czas UTC t pobierać z DB po uzyskaniu blokady (nie transaction-start sprzed oczekiwania); kontrola cofnięcia zegara ma blokować nowe zużycie. Retry zachowuje pierwotny receipt/czas. nextEligibleAt oznacza najwcześniejsze wygaśnięcie dostatecznej sumy dla konkretnego żądanego kosztu; wygaśnięcie 0,4 nie obiecuje pełnego bota.

Fundamentalny przykład: 0,4 jednostki w t0 i 0,6 w t0+1 h. Tuż przed t0+12 h dostępne 0; dokładnie w t0+12 h dostępne tylko 0,4; pełne 1 dopiero w t0+13 h, o ile nie było nowego zużycia. Dwa równoczesne żądania o pozostałe 0,4 przy różnych tierach mogą łącznie zużyć najwyżej 0,4. Przełączenia fast/slow i sesji nie usuwają drugiego kosztu.

### Trwały receipt matchmakingu D.1 (bez rezerwacji)

W tym samym projektowanym journal dodać `MATCHMAKING_RECOMMENDATION` i `MATCHMAKING_RESULT`. Oba wymagają user_id; recommendation może mieć table_id=NULL wyłącznie dla terminalnego no-offer (bez create). Istniejące ograniczenia FUNDING/EXPOSURE bez zmiany; pola source/tier-funding/lineage/cost nie dotyczą tych faktów, nie tworzą allowance ani transferów. `details`: operation_id, request_hash (stałe user/class/tier/maxPlayers/intent), attempt_no 1..2, requested_class/tier/maxPlayers, candidate_table_id, created_table_id nullable, outcome i reason; matched identity wyznacza serwer. UNIQUE (user_id,operation_id,event_kind,attempt_no), indeks odczytu po user/operation. Dla recommendation result COMMITTED oznacza utrwaloną ofertę, nie przyjęcie gracza; no-offer jest DENIED. MATCHMAKING_RESULT COMMITTED/DENIED oznacza ostateczny wynik admission danej próby, zapisywany atomowo z efektem join/odmową; brak wyniku to pending/unknown, nie pozwolenie na rematch. Dane rekomendacji i wyniku append-only, payload mismatch/replay nie zmieniają faktu.

Pod advisory guard konta/operacji: próba 2 dopiero po trwałym DENIED pierwszej i odświeżeniu uprawnień; najwyżej jeden created_table_id w całej operacji. Sukces, no-offer albo druga odmowa kończą operację; replay odtwarza wynik nawet po zamknięciu/usunięciu stołu. Nie kasować receipt wraz ze stołem, aby retry nie utworzył nowego. Reuse własnego pustego INIT po created_by/class/tier/maxPlayers/canonical stakes oraz pozostałych warunkach P2 kontraktu przed create, pod istniejącym guard doboru, obejmuje różne operationId w kilku kartach. Stan nie rezerwuje miejsca, nie zatrzymuje rezerwy SYSTEM i nie daje klientowi prawa do admission. Oczyszczanie pustego INIT przez istniejący lifecycle nie kasuje mapowania operacji.

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

`issuance_state`: scope GLOBAL / TIER_100 / TIER_500 PRIMARY KEY; policy_version, last_decision_at, used_standard_ch, used_slow_ch, as_of_at, version. Wyłącznie kroczące 168 h: brak window_anchor/window_mode. GLOBAL guard pierwszy, version aktualizowana przez każdą emisję; serializable retry nie może korzystać ze snapshotu sprzed konkurencyjnego COMMIT. Pod lockiem suma REFILL receipts w (t−168 h,t] plus proposed; counters tylko projekcją. Wspólny t i wszystkie global/class/tier caps.

`issuance_receipts`: event_key UNIQUE, ledger_transaction_id UNIQUE, payload_hash, tier, class, amount_ch >0, issued_at NOT NULL, policy_version, proof_event_ids, compensated_amounts, kind REFILL / INITIAL_ALLOCATION / REBALANCE, approval/evidence reference. INITIAL_ALLOCATION ma dodatkowy unikalny klucz celu/purpose niezależny od czasu. Do limitów emisji tygodniowej wchodzi wyłącznie REFILL; każda alokacja początkowa nadal ma osobny audyt wpływu na podaż. Rebalance nie zwiększa żadnego mint counter. Indeks (kind,issued_at,tier,class).

Wszystkie counters i receipts zapisywane razem z ledger credit. Refund/cancel z powodu rollback nie pozostawia receipt; ponowienie po commit zwraca ten sam wynik. Zmiana week/retention nie kasuje unikalności klucza. Same metadata klienta nie przyznają uprawnienia do issuance.

## 7. Retention i etapowanie schema

Nowe audit events/issuance receipts i access watermark pozostają trwałe poza prune operacyjnych tabel. CLOSE_PROOF zawiera minimalne nieusuwalne agregaty i identyfikatory/hash oryginalnych dowodów; starsze pełne entries można archiwizować istniejącym mechanizmem dopiero po potwierdzeniu kompletności manifestu i możliwości rekonsyliacji. Brak dowodu nie resetuje limitu ani nie tworzy nowej straty.

Przyszły podział migracji: addytywne tabele/pola/indeksy/ACL i konto 100 bez CH; osobny kontrolowany activation/backfill class/legacy proof; osobna jednorazowa alokacja zgodna z zatwierdzonym D3. Nazwy timestampów generuje CLI dopiero w implementacji. Nie uruchamiać migracji ani seeda podczas planowania. PR migracyjny ma zamierzony automatyczny wpływ na shared Stage, opisany przed publikacją; Production oddzielne GO.

### Krocząca emisja i pierwsza alokacja — D2–D3

D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.

D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Global emission guard → pool → receipts/accounts; wszystkie klasy i tiery uczestniczą w tej samej serializacji. Czas UTC t pobierać po blokadzie, przy niekompletnym dowodzie lub cofnięciu zegara odmowa emisji. Serializable snapshot sprzed oczekiwania na guard nie może pominąć konkurencyjnego receipt: zapisywać version globalnego guard w każdej emisji i ponawiać całą transakcję po serialization conflict. Autoryzacja, kompensacja proof, receipt i double-entry MINT commitują razem. Liczniki są projekcją as-of t; suma trwałych REFILL receipts jest źródłem prawdy. Granica issued_at=t−168 h uwalnia dokładnie tę emisję; młodsze pozostają. INITIAL_ALLOCATION ma osobny audyt podaży, nie konsumuje ani nie odnawia cap REFILL. Schema tworzy konto z zerem; alokacja przy jednym kredycie 1 000 000 CH ustawia obie rezerwy atomowo. Powtórzenie lub równoczesne wywołanie zwraca istniejący rezultat bez drugiego kredytu.

Fundamentalne testy: tuż przed/na/po 168 h; równoczesne 100/500 i STANDARD/SLOW przy ostatnim headroom klasy/tieru/global; restart i utracona odpowiedź; proof/receipt retention; brak podwójnej emisji na granicy kalendarzowego tygodnia; INITIAL_ALLOCATION retry i race dają jeden milion oraz dokładne 900000/100000, osobno od REFILL. Żaden test nie wykonuje Production GO.

Retencja zachowuje aktywne 12 h/168 h w indeksowanej dostępnej historii oraz trwałe identity/exhaustion targets i certyfikaty audytu po tych oknach. Archiwizacja nie może zerować licznika ani usuwać możliwości wykrycia wcześniejszego drain; brak kompletnego dowodu blokuje nową operację.

## D.3 — ograniczone odczyty i trwałe wznowienie

Bez nowych tabel. MATCHMAKING_RECOMMENDATION.details rozszerzyć o configRevision/protocolVersion/policyVersion potwierdzone z WS; limitowany descriptor bez sekretów. Payload request pozostaje związany z kontem/parametrami; revision to serwerowy dowód oferty, nie nowa tożsamość allowance. Incomplete search zapisuje nieterminalny SEARCH_PROGRESS bez create; nie kończy MATCH jako no-offer. Cursory lobby/scalone dirty flags projekcji są ulotne; cursor kontynuacji MATCH jest trwały w SEARCH_PROGRESS i nie autoryzuje finansów. CLOSE_PROOF_PENDING to osobny append-only fakt COMMITTED, UNIQUE(event_kind,table_id,to_state_version), bez prawa do kompensacji; details zawiera terminal/return identity i źródłowe referencje potrzebne do rekonsyliacji. Zamykający tx zapisuje albo pełny CLOSE_PROOF, albo ten pending. Późniejszy CLOSE_PROOF referencjonuje pending i istniejącą unique close identity; nie nadpisuje faktu pending. W poker_bot_pool_state dodać per-class pending_close_count oraz refill_pending, next_attempt_at, attempt_count i cursor jako odtwarzalną projekcję pracy; indeksowany backlog pending minus final proof, bez nowej tabeli. Licznik pending zwiększany atomowo z pending close, zmniejszany dokładnie raz wraz z final proof pod pool lock. Dopóki licznik jest dodatni lub jego kompletność nie jest pewna, zero REFILL całego tieru: nie wolno pominąć nieudowodnionych zysków przy signed net loss. Zwroty nadal aktualizują liquid/quarantine z ledger w close tx; committed cost i signed loss rozlicza dopiero kompletny proof, bez powtórnego liquid credit. Retention zachowuje źródła pending do final proof. Cooldown/cursor nie są dowodem ekonomicznym. Unikalna close/compensation identity nadal uniemożliwia double mint.

Nowe/istniejące indeksy ocenić przed dodaniem: seats(user_id,table_id) ACTIVE dla snapshot membership; OPEN poker_tables(bot_access_class,buy_in,max_players,sort_key,id) według faktycznego query; targets(table_id,event_id), pending targets; EXPOSURE(user_id,budget_mode,consumed_at) COMMITTED z dodatnim kosztem; access PK; MATCHMAKING(user,operation,kind,attempt); issuance(kind,issued_at,tier,class). Aktywna kapitalizacja wymaga indeksowanych funding source/tier/table i stanu OPEN, zamiast pełnej historii ledger; close pending/compensation indeks po status,next_attempt_at,identity. Nie dodawać wszystkich indeksów mechanicznie ani fikcyjnej kolumny sort_key — wybrać faktyczne istniejące kolumny po EXPLAIN. Pozostawić unique/retention wszystkich finansowych tożsamości.

Limit+1/timeout nad wymaganym pełnym zakresem → incomplete i odmowa nowej operacji, nigdy sumowanie obciętych wyników. Rolling12h i168h wymagają całego swojego okna; kompletnej kapitalizacji nie zastępuje mały cache/licznik. Bounded mint proof: do1000 active escrow i1000 wymaganych receipt/proof rows w spójnym SERIALIZABLE snapshot; większy zbiór → zero i pending, bez długiego global lock. Admin earliest drain: jedna indeksowana agregacja po tableIds bieżącej strony, nie query na każdy wiersz. Prywatne pola nie trafiają do projection. Limity/wielkości odpowiedzi i semantyka overload są w plan.md §D.3; nie są limitami ekonomii.

### Uściślenie MATCH continuation i terminal identity

SEARCH_PROGRESS w tym samym journal wymaga user_id, table_id=NULL, result=COMMITTED (tylko postęp wyszukiwania), details: operation_id/request_hash/attempt_no/search_step/phase/last_checked_table_id. SEARCH_PROGRESS i MATCHMAKING_RECOMMENDATION (także terminal no-offer) mają wspólne nullable pole search_step, NOT NULL dla odpowiedzi HTTP wyszukiwania; partial UNIQUE(user_id,operation_id,attempt_no,search_step) dla tych odpowiedzi. MATCHMAKING_RESULT nie bierze udziału w tym indeksie. search_step=0 to pierwsza odpowiedź; token kroku n żąda dokładnie odpowiedzi n+1. Jedna następna odpowiedź per krok przez account guard i deterministyczny event_key; lookup po tym kluczu zwraca progress/recommendation/no-offer bez modyfikacji starego receipt. Opaque token to event_id progress; następnik może być kolejnym progress lub dotychczasową recommendation/no-offer. Serwer wylicza następstwo z operation/attempt/search_step; duplicate nie wykonuje ponownego skanu. Parametry obejmują canonical stakes obok tier/class/maxPlayers/intent. Źródło/lineage/cost/to_state_version nie dotyczą progress; wyjątek table_id=NULL i user_id NOT NULL jawny. Indeks lookup konta/operation/kroku; candidate keyset id ASC, istniejący PK oraz predykaty OPEN/class/buy_in/max_players ocenić przez EXPLAIN. Limit 2 stron/100 kandydatów i 2 admission/1 create bez zmian; szczegóły zmian listy i fresh-check przed create w kontrakcie.

### Terminal identity i atomowość

CLOSE_PROOF_PENDING i CLOSE_PROOF wymagają istniejącej kolumny to_state_version NOT NULL: docelowej zatwierdzonej wersji poker_state po terminal CAS w executeTerminalPokerCloseInTx, zgodnej z kluczami terminal cash-out. Nie ma osobnej kolumny terminal_version. Close identity to (table_id,to_state_version); UNIQUE(event_kind,table_id,to_state_version) pozwala na jeden pending i jeden final. details.pending_event_id finalnego proof jest wymagany przy finalizacji pending, a NULL przy full-direct close. Kompensacja referencjonuje tylko final event_id/close identity; restart nie generuje nowej wersji dla CLOSED.

Wybór full/pending przed opcjonalnym SQL; wszystkie returns, liquid/quarantine, terminal CAS/CLOSED i proof lub pending+pending_close_count muszą commitować atomowo. SQL failure dowolnej części cofa cały outer tx; dalszy zapis pending dopiero w nowej tx istniejącego recovery, nigdy w aborted transaction. Final proof, decrement pending i rozliczenie committed/signed loss są atomowe pod pool lock; istniejący final oznacza replay bez ponownego credit/decrement. Unknown COMMIT wymaga odczytu oryginalnej identity przed retry. Szczegółowy przebieg i testy: plan.md „transakcja terminal close i odzyskiwanie dowodu”, T028/T033.
