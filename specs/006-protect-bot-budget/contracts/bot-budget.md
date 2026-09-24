# Kontrakty — admission, funding, drain, refill

Normatywny projekt do review; D1–D3 z spec.md wymagają decyzji. Nazwy nowych pól/kodów są propozycją kontraktu implementacyjnego, nie opisem już istniejącego API. FR-001–032 pozostają autorytetem zakresu.

## 1. Koszt i tożsamość ekspozycji

Jednostka = 10000 podjednostek. Dla tieru T koszt q CH = q*(10000/T), dokładnie. Sumować cały plan udostępnienia, nie sprawdzać tylko pierwszego bota. Fast jest dopuszczalny tylko gdy oba limity mieszczą cały koszt; brak mieszania fast+slow w STANDARD.

**Lineage** oznacza ciąg udowodnionego stacku bota: seed rozpoczyna ciąg; replacement z zachowanym oldStack>0 dziedziczy lineage; replacement od zera i managed top-up dodający nowego bota tworzą nowy ciąg. Identyfikatory wynikają z istniejących seed/replacement transactions i state versions, nie z przysłanego UUID. Ledger provenance nadal wymaga dokładnego źródła; lineage nie jest przypisaniem żetonów gracza do bota.

| Zdarzenie | Autoryzowana ekspozycja per człowiek | Transfer CH |
|---|---|---|
| Pierwsze admission użytkownika do lineage | Pełny aktualny stack tego bota w authoritative snapshot | Zero dla już finansowanych botów |
| Ten sam istniejący seat: retry/reconnect/reload | Zero; odczyt committed result i access watermark | Zero powtórnego buy-in |
| Nowe funding przy obecnych eligible humans | Każdy niezależnie całą fundingDelta, razem z nowym funding sequence | SYSTEM→ESCROW tylko raz |
| Replacement z residual | Tylko fundingDelta; reszta tego samego ciągu nie naliczana ponownie | Tylko nowa delta |
| Bot-only bez humans | Zero user charge; funding fact zachowany na przyszłe admission | Właściwa STANDARD rezerwa, bez MINT |
| Nowe admission powracającego użytkownika do wcześniej autoryzowanej lineage | Jeśli brak nowych funding events od jego watermark: zero. Jeśli są: min(aktualny stack, suma nieautoryzowanych fundingDelta od watermark). Jest to konserwatywne pokrycie nowej dostępnej ekspozycji; nie dolicza utraconego, już nieobecnego stacku ani całego residual ponownie. | Zero nowego mint; własny USER buy-in zgodnie z istniejącym rejoin/leave kontraktem |

Pierwsze admission sumuje bieżące bot stacks i plan nowych seedów. Po COMMIT access watermark obejmuje funding sequence tego snapshotu. Aktualizacja watermark jest atomowa z charge, również gdy min wynosi zero, a cała nowa ekspozycja już zniknęła przed powrotem. Wzrost stacku od normalnych wygranych przy ciągłym uczestnictwie nie jest nowym funding; kolejna ręka nie nalicza ponownie. Nowy człowiek zawsze płaci pełny aktualny stock. Inny stół/nowa lineage nie dziedziczą starego watermark. Przy nieudowodnionym lineage/source odmówić nowego dostępu, nie zgadywać.

EXPOSURE unique: user + stabilna authoritative admission/funding identity; policy_version jest audytowanym atrybutem, **nie częścią klucza pozwalającą naliczyć event ponownie**. Zmiana polityki nie resetuje unikalności/access watermark. Kolizja key z innym payload to conflict. RequestId jest tylko transportowym replay; backend generuje authoritative identity. Przy replay przed każdym reserve debit/credit odczytać trwałą decyzję; ponowiony ledger receipt nie wykonuje ponownie mutacji puli. Nie zwracać limitu po porażce bota, odejściu ani końcu okresu; reset okresu dotyczy used counters, nie historii dostępu.

**Przykłady krytyczne**: 100 CH seed w T100 to 10000 podjednostek; 1 CH delta w T500 to 20; replacement 99→100 w T100 to 100; dwóch ludzi i delta 10 CH kosztuje każdemu 1000 podjednostek, lecz tylko 10 CH transferu. Admission do trzech pre-funded botów po 100 wymaga trzech jednostek, więc slow burst 1 nie wystarcza.

## 2. Macierz dopuszczenia

| Kontekst konta | STANDARD, w tym bot-only | SLOW_PRIVATE właściciela | Cudzy SLOW_PRIVATE | HUMAN_ONLY |
|---|---|---|---|---|
| Wystarczający fast | Tak po pełnej autoryzacji | Tylko odtworzenie istniejącego seat; nowe wybory fast do STANDARD | Nie | Tak |
| Niewystarczający fast, dostępny slow i pula | Nie | Tak, owner-only i jedna otwarta instancja | Nie | Tak |
| Niewystarczający fast, brak slow/puli | Nie | Brak nowego fundingu; poprawne wznowienie seat/wyjście pozostaje | Nie | Tak |
| Istniejący seat w DRAINING | Grace istniejącego uczestnika, bez nowego charge/fundingu | Nie dotyczy standard drain | Nie | Normalne reguły |

Fast eligibility jest dla konkretnego wymaganego kosztu, nie trwałą etykietą użytkownika. Gdy właściciel slow odzyska fast, istniejący slow stół nie zostaje przeklasyfikowany i nie otrzymuje fast funding. Może nadal otrzymywać wyłącznie funding w ramach własnego slow allowance i chronionej slow liquidity; nowe wybory stołów mogą użyć fast na STANDARD. Odnowienie fast nie odbiera istniejącego uprawnionego slow funding. D1 nie resetuje tożsamości slow table.

Serwerowe ścieżki: Netlify Quick Seat/Create tworzą/rekomendują klasę, WS handler join przeprowadza final admission; ws bootstrap/resume/resync odtwarzają wyłącznie dowiedziony seat. Direct URL nie ma innej ścieżki uprawnień. Lobby projection per user jest informacją, nie gwarancją płynności ani rezerwacją. HUMAN_ONLY nie uruchamia seed nawet przy włączonej konfiguracji botów. Guest economy=none nie może wejść do tych ekonomicznych stołów.

## 3. Protokół i błędy

W istniejących payloadach dodać minimalne `botAccessClass`, `botAccessMode` (FAST/SLOW/HUMAN_ONLY), `botDrainingDeadlineAt`, własne `nextEligibleAt` oraz `botBudgetPolicyVersion`. Stół i owner wyznacza serwer. Nie wysyłać foreign user budget ani informacji pozwalających wnioskować o jego CH.

Nowe powody: `bot_budget_insufficient`, `bot_slow_not_ready`, `bot_table_class_incompatible`, `bot_table_owner_mismatch`, `bot_table_draining`, `bot_pool_unavailable`, `bot_funding_proof_missing`, `bot_policy_unavailable`. Adapter mapuje je na istniejącą strukturę `ok:false/code`, bez zmiany normalnych snapshotów/settlement. `nextEligibleAt` tylko gdy znany i policzony według D1/fast cadence; brak dowodu/liquidity nie ma fikcyjnego terminu. Neutralny opis i available alternatives HUMAN_ONLY / własny slow / STANDARD gdy ponownie dostępny. Nie ujawniać wewnętrznego SQL ani sekretów.

Capabilities: rozszerzyć istniejący `checkWsBuyInCapability` i wewnętrzny materialize o zgodną wersję polityki, bez uznania v2 buy-in capability za zgodność #869. Domyślnie brak polityki wyłącza nowe chronione admission/funding; zachować recovery/settlement legacy.

## 4. Atomowe decyzje i drain

Join: table/state/seat locks → użytkownicy w stabilnej kolejności → pool lock → obliczenie i autoryzacja pełnego planu → existing postTransaction/seat/state/access writes → commit → runtime snapshot. Rollover: ten sam lock order i expectedVersion, receipts muszą odpowiadać przygotowanemu batchowi. Odmowa któregokolwiek uczestnika nie może pozostawić częściowego finansowania innych botów.

Drain jest trwałym wynikiem odmowy dalszej ekspozycji istniejącego człowieka albo osiągnięcia dokładnego zera fast. Deadline=first decision time+30 min. Wycofanie niedozwolonego kandydata nie może wycofać samego zapisu drain. Decyzja DENIED/DRAIN może zostać zatwierdzona bez zmiany stacków/budżetu; serwer nie traktuje jej jak committed rollover. Replay pierwszego triggera zachowuje czas.

Przed deadline istniejące funded bots mogą grać. Od deadline blokada start_hand/bootstrap/prepare/commit; żywa ręka zachowuje timery i settle. Terminal close dopiero na bezpiecznej granicy (SETTLED/INIT bez żywej ręki i bez nierozliczonych roszczeń), w tej samej ścieżce zero-escrow i source proof. Brak profilu managed/obecny human nie odracza drain. Brak budżetu/puli nie blokuje istniejącego hand settlement.

## 5. Finanse i refill

MINT wywołuje wyłącznie backend po aktywacji polityki. Contract input: tier, class, durable proof identity; **kwotę, źródło, okres i pozostałe limity wylicza backend pod lockiem**, nie przyjmuje autorytatywnie od klienta. Odrzucić źródła poza zatwierdzonymi pulami, dowolny USER credit, brak GENESIS debit, niezerową sumę, brak dowodu/policy lub powtórny proof allocation.

Netlify ledger potrzebuje wąskiego wewnętrznego kontraktu dla SYSTEM-only MINT oraz zatwierdzonej INITIAL_ALLOCATION/REBALANCE; ogólne `chips-tx` nie przekazuje tej capability i nie może bezpośrednio obciążać chronionych pul. WS TABLE_BUY_IN adapter współdzieli transakcyjną ochronę pool state. Wszystkie transfery chronionych kont muszą aktualizować właściwy stan rezerwy; metadata klienta nie wybierają klasy.

Refill receipt zawiera kind, event_key, timestamp, policy, proof IDs, source/target, amount, ledger transaction/hash i zaktualizowane limity. Powtórzenie zwraca dokładny wcześniejszy wynik. Zyski zamkniętych stołów kompensują straty w signed sum; zgadywana atrybucja indywidualnych winnings jest zakazana. Aktywne commitment pozostaje w kapitalizacji. Headroom używa konserwatywnej górnej granicy max(committed cost, pełne escrow) każdego otwartego stołu, w spójnym serializable odczycie z refill; pełne escrow służy tylko ograniczeniu headroom, nigdy udowodnieniu straty. Brak kompletności = zero; żadnej emisji z samego spadku live liquidity ani obrotu bot-only.

D2 rozstrzyga semantykę 7 dni; wszystkie warianty utrzymują wspólne atomic counters i niezmienny dziennik emisji. D3 dotyczy jednorazowej alokacji, nie samoczynnego refillu do target. Żaden reset allowance nie wywołuje przelewu.

## 6. Minimalny audyt

Klog: user-budget decision (account/table/event/version/mode/cost/reason), drain first/deadline, funding committed/denied (tier/class/source/receipt), close proof (terminal version/net/return/escrow), refill (proof/amount/limits/idempotency), proof unavailable. Bez tokenów, prywatnych kart, sekretów i nadmiarowego logowania ręki. Finansowym dowodem jest trwały ledger/event, nie sam klog. Istniejąca możliwość kopiowania logów pozostaje.
