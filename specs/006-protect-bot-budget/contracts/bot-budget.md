# Kontrakty — admission, funding, drain, refill

Normatywny projekt do review; D1–D3 z spec.md są zatwierdzone. Nazwy nowych pól/kodów są propozycją kontraktu implementacyjnego, nie opisem już istniejącego API. FR-001–032 pozostają autorytetem zakresu.

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

FUNDING jest zdarzeniem stołu/bota dla jednego transferu SYSTEM → ESCROW; user_id=NULL jest dozwolone także przy wielu ludziach. createdBy/inicjator to audyt operacji, nie właściciel finansowania. Trwały funding key/receipt jest wspólny dla wszystkich korzystających graczy; nie wykonywać transferu ponownie dla każdego z nich. EXPOSURE wymaga niepustego user_id oraz trwałej tożsamości finansowania lub udostępnionego stacku, a samo naliczenie nie zapisuje debitu USER.

EXPOSURE unique: user + stabilna authoritative admission/funding identity; policy_version jest audytowanym atrybutem, **nie częścią klucza pozwalającą naliczyć event ponownie**. Zmiana polityki nie resetuje unikalności/access watermark. Kolizja key z innym payload to conflict. RequestId jest tylko transportowym replay; backend generuje authoritative identity. Przy replay przed każdym reserve debit/credit odczytać trwałą decyzję; ponowiony ledger receipt nie wykonuje ponownie mutacji puli. Nie zwracać limitu po porażce bota, odejściu ani końcu okresu; reset okresu dotyczy used counters, nie historii dostępu.

**Przykłady krytyczne**: 100 CH seed w T100 to 10000 podjednostek; 1 CH delta w T500 to 20; replacement 99→100 w T100 to 100; dwóch ludzi i delta 10 CH kosztuje każdemu 1000 podjednostek, lecz tylko 10 CH transferu. Admission do trzech pre-funded botów po 100 wymaga trzech jednostek, więc slow burst 1 nie wystarcza.

### Kroczące slow — D1 i częściowe zużycie P1

D1 zatwierdzone: pierwsza jednostka dostępna od razu przy pierwszym przejściu w slow. Następnie suma COMMITTED kosztów slow w (t−12 h, t] wraz z proponowanym kosztem nie przekracza 10000 podjednostek. Każda część zwalnia się dopiero 12 h po własnym zużyciu; brak stałej granicy odnowienia, ciągłego token bucket i catch-up. Historia wspólna dla tierów, stołów i sesji, zachowana przy fast/slow i nowym okresie fast.

Pod blokadą konta odczytać trwałe EXPOSURE z budget_mode=SLOW, result=COMMITTED, consumed_at i kosztem integer. Dostępność jest wyliczana jako 10000 minus suma w oknie, nie przechowywana jako odnawiany grant. DENIED/replay nie zużywa ponownie. Czas UTC t pobierać z DB po uzyskaniu blokady (nie transaction-start sprzed oczekiwania); kontrola cofnięcia zegara ma blokować nowe zużycie. Retry zachowuje pierwotny receipt/czas. nextEligibleAt oznacza najwcześniejsze wygaśnięcie dostatecznej sumy dla konkretnego żądanego kosztu; wygaśnięcie 0,4 nie obiecuje pełnego bota.

Fundamentalny przykład: 0,4 jednostki w t0 i 0,6 w t0+1 h. Tuż przed t0+12 h dostępne 0; dokładnie w t0+12 h dostępne tylko 0,4; pełne 1 dopiero w t0+13 h, o ile nie było nowego zużycia. Dwa równoczesne żądania o pozostałe 0,4 przy różnych tierach mogą łącznie zużyć najwyżej 0,4. Przełączenia fast/slow i sesji nie usuwają drugiego kosztu.

## 2. Macierz dopuszczenia

| Kontekst konta | STANDARD, w tym bot-only | SLOW_PRIVATE właściciela | Cudzy SLOW_PRIVATE | HUMAN_ONLY |
|---|---|---|---|---|
| Wystarczający fast | Tak po pełnej autoryzacji | Tylko odtworzenie istniejącego seat; nowe wybory fast do STANDARD | Nie | Tak |
| Niewystarczający fast, dostępny slow i pula | Nie | Tak, owner-only i jedna otwarta instancja | Nie | Tak |
| Niewystarczający fast, brak slow/puli | Nie | Brak nowego fundingu; poprawne wznowienie seat/wyjście pozostaje | Nie | Tak |
| Istniejący seat w DRAINING | Grace istniejącego uczestnika, bez nowego charge/fundingu | Nie dotyczy standard drain | Nie | Normalne reguły |

Przed pierwszym FAST_EXHAUSTED eligibility zależy od konkretnego kosztu. Po zdarzeniu konto pozostaje constrained do kolejnego okresu fast; historyczne powiązania drain pozostają niezależnie od odnowienia. Gdy właściciel slow odzyska fast, istniejący slow stół nie zostaje przeklasyfikowany i nie otrzymuje fast funding. Może nadal otrzymywać wyłącznie funding w ramach własnego slow allowance i chronionej slow liquidity; nowe wybory stołów mogą użyć fast na STANDARD. Odnowienie fast nie odbiera istniejącego uprawnionego slow funding. D1 nie resetuje tożsamości slow table.

Serwerowe ścieżki: Netlify Quick Seat/Create tworzą/rekomendują klasę, WS handler join przeprowadza final admission; ws bootstrap/resume/resync odtwarzają wyłącznie dowiedziony seat. Direct URL nie ma innej ścieżki uprawnień. Lobby projection per user jest informacją, nie gwarancją płynności ani rezerwacją. HUMAN_ONLY nie uruchamia seed nawet przy włączonej konfiguracji botów. Guest economy=none nie może wejść do tych ekonomicznych stołów.

### D.1 — projekcja gracza i find-or-create

D.1 oznacza matchmaking, nie decyzję D1 dotyczącą slow. Zatwierdzone polityki ekonomii pozostają bez zmian.

- Projekcja serwera zwraca tylko `JOIN` zgodne w chwili odczytu z kontem/progresją, dokładnym tierem i klasą, owner, całym kosztem ekspozycji, pojemnością oraz stanem stołu (w tym globalnym drain). Wymagany nowy funding sprawdza właściwą płynność, proof i capability; do już finansowanego stocku nie żądać ponownego transferu. Osobne `RESUME` wyłącznie dla własnego udowodnionego seat: także w grace albo dla kończącej się ręki/wypłaty, nigdy jako nowe admission. Nie wysyłać cudzych slow stołów/budżetów ani niedostępnych wierszy `Unavailable`. Brak dowodu projekcji oznacza pominięcie nowych ofert i uczciwy stan oczekiwania.
- STANDARD: najpierw zgodne istniejące stoły z ludźmi, potem pozostałe zgodne STANDARD; jeśli brak, find-or-create w dokładnie żądanym tierze/klasie. SLOW_PRIVATE: własny zgodny stół lub utworzenie jednego przy allowance i slow liquidity; istniejący własny slow przy innym tierze daje jawny wybór/wait, bez złamania unique owner i bez relabel. HUMAN_ONLY: zgodny istniejący lub nowy bez botów, bez obietnicy innych ludzi. Własny seat innego tieru/trybu pokazać jako opcję Resume, nie automatycznie zmieniać wybór.
- Przed create sprawdzić account/tier/class, pełny plan bot count i koszt, właściwą rezerwę, proof i capability również dla 100 CH. Znany brak któregokolwiek warunku daje zero nowych stołów/fundingu/exposure. Utworzenie jest ofertą warunkową; aktualizacja stanu między HTTP a WS nadal może unieważnić ofertę. Finalny WS join autoryzuje atomowo pod istniejącymi lockami. Preflight nie rezerwuje ani nie zużywa limitu/CH i nie uruchamia MINT.
- Zwykły lobby Join i Quick Seat mają jawny kontekst `MATCH`; direct/manual wybór konkretnego stołu ma `DIRECT`, wznowienie `RESUME`. Tylko MATCH automatycznie ponawia dobór po udowodnionej finalnej odmowie starego kandydata (seat_taken/full, closed, drain lub niezgodność ujawniona ponowną walidacją). Powód sam nie uprawnia do nowej próby: odświeżyć eligibility, koszt i liquidity; realny brak środków/proof/capability kończy operację z alternatywą HUMAN_ONLY/wait, bez tworzenia pozornego funded stołu. DIRECT nie przenosi na inny stół; może zaproponować MATCH dopiero po świadomym wyborze. Tryb i tier nie zmieniają się automatycznie.
- Konkretna granica techniczna projektu: najwyżej **2 różne rekomendacje/admission attempts** na operację MATCH (pierwsza + jeden automatyczny rematch), najwyżej **1 utworzony stół**. Dla zwykłego Join wybranego w lobby pierwsza rekomendacja może wskazywać ten tableId po walidacji; nie oznacza to DIRECT. Druga próba omija poprzednio odrzucony tableId. Jeżeli limit został osiągnięty, zwrócić jawny stan końcowy i alternatywy; nie obiecywać sukcesu podczas ciągłych wyścigów lub awarii. Retry transportu odtwarza tę samą próbę i nie zwiększa liczby create ani naliczeń. Maksymalnie 2 automatyczne retransmisje tego samego żądania na przebieg transportu; potem stan recovery/wait z jawnym komunikatem, bez automatycznej pętli. Reconnect nie zeruje trwałego limitu prób/create. Nowe świadome ponowienie odzyskuje najpierw poprzedni nieznany wynik.
- Stabilny operationId związany z kontem, tierem, klasą i maxPlayers; payload mismatch to odmowa. Serwer utrwala rekomendację i wynik każdej próby w istniejącym projektowanym journal (szczegóły w data-model.md), sprawdza następstwo prób i limit; licznik w przeglądarce nie jest autorytetem. Duplikat HTTP/create i utracona odpowiedź odtwarzają ten sam tableId. Timeout WS o nieznanym wyniku oznacza odzyskanie tej samej decyzji/seat, nigdy rematch ani create, dopóki brak trwałego rozstrzygnięcia. Trwały sukces kończy operację; replay po późniejszym leave nie tworzy nowego seat.
- Istniejący advisory guard doboru oraz guard operacji serializują współbieżne retry. Przy create ponownie sprawdzić kandydatów i odzyskiwalny własny pusty INIT tej klasy/tieru, aby kolejne karty nie mnożyły pustych stołów. Opuszczony, rzeczywiście pusty INIT zamyka istniejący bezpieczny lifecycle/sweep po potwierdzeniu braku seat/roszczeń i zerowego escrow; zachować receipt/idempotency także po close. Nie usuwać stołu zajętego przez kogoś w międzyczasie, nie wprowadzać uniwersalnego TTL ani force-close. Utworzony stół, który przegra race, nie uprawnia tej operacji do tworzenia kolejnego.

Stan normalnego MATCH pozostaje „dobieranie” podczas pierwszej przewidywalnej odmowy i dozwolonego rematch, bez błędu wymagającego następnego kliknięcia. Błąd autoryzacji, rzeczywista awaria backendu, nieznany wynik lub wyczerpanie możliwości są stanami końcowymi/odzyskiwaniem zgodnie z dowodem. Alternatywa nie wykonuje się bez wyboru gracza; nextEligibleAt tylko gdy obliczalne. Finanse zachowują jeden FUNDING na transfer i osobne EXPOSURE per gracz.

## 3. Protokół i błędy

W istniejących payloadach dodać minimalne `botAccessClass`, `botAccessMode` (FAST/SLOW/HUMAN_ONLY), `botDrainingDeadlineAt`, własne `nextEligibleAt` oraz `botBudgetPolicyVersion`. Stół i owner wyznacza serwer. Nie wysyłać foreign user budget ani informacji pozwalających wnioskować o jego CH.

Nowe powody: `bot_budget_insufficient`, `bot_slow_not_ready`, `bot_table_class_incompatible`, `bot_table_owner_mismatch`, `bot_table_draining`, `bot_pool_unavailable`, `bot_funding_proof_missing`, `bot_policy_unavailable`. Adapter mapuje je na istniejącą strukturę `ok:false/code` i trwały wynik próby MATCH (odmowa kandydata nie jest jeszcze końcem całej operacji), bez zmiany normalnych snapshotów/settlement. `nextEligibleAt` tylko gdy znany i policzony według D1/fast cadence; brak dowodu/liquidity nie ma fikcyjnego terminu. Neutralny opis i available alternatives HUMAN_ONLY / własny slow / STANDARD gdy ponownie dostępny. Nie ujawniać wewnętrznego SQL ani sekretów.

Capabilities: rozszerzyć istniejący `checkWsBuyInCapability` i wewnętrzny materialize o zgodną wersję polityki, bez uznania v2 buy-in capability za zgodność #869. Domyślnie brak polityki wyłącza nowe chronione admission/funding; zachować recovery/settlement legacy.

## 4. Atomowe decyzje i drain

Join: table/state/seat locks → użytkownicy w stabilnej kolejności → pool lock → obliczenie i autoryzacja pełnego planu → existing postTransaction/seat/state/access writes → commit → runtime snapshot. Rollover: ten sam lock order i expectedVersion, receipts muszą odpowiadać przygotowanemu batchowi. Odmowa któregokolwiek uczestnika nie może pozostawić częściowego finansowania innych botów.

Drain jest trwałym wynikiem odmowy dalszej ekspozycji istniejącego człowieka albo osiągnięcia dokładnego zera fast. Deadline=first decision time+30 min. Wycofanie niedozwolonego kandydata nie może wycofać samego zapisu drain. Decyzja DENIED/DRAIN może zostać zatwierdzona bez zmiany stacków/budżetu; serwer nie traktuje jej jak committed rollover. Replay pierwszego triggera zachowuje czas.

Przed deadline istniejące funded bots mogą grać. Od deadline blokada start_hand/bootstrap/prepare/commit; żywa ręka zachowuje timery i settle. Terminal close dopiero na bezpiecznej granicy (SETTLED/INIT bez żywej ręki i bez nierozliczonych roszczeń), w tej samej ścieżce zero-escrow i source proof. Brak profilu managed/obecny human nie odracza drain. Brak budżetu/puli nie blokuje istniejącego hand settlement.

### Globalne wyczerpanie fast — P1

Pierwszy zatwierdzony FAST_EXHAUSTED jest faktem konta, unikalnym dla (user_id, fast_period_start), z exhausted_at. Powstaje przy dokładnym wyczerpaniu któregokolwiek limitu fast po ostatniej legalnej ekspozycji lub pierwszej odmowie wymaganej ekspozycji z powodu niewystarczającego fast. Nie tworzyć go z powodu braku płynności ani arbitralnego progu pełnego buy-in. Pozostaje constrained do kolejnego okresu fast; nowy okres nie usuwa historycznego zdarzenia ani drenujących stołów.

W tej samej transakcji zapisać trwałe powiązania zdarzenia ze wszystkimi już zajętymi przez konto stołami STANDARD z botami, także pre-funded B bez żądania fundingu; uwzględnić nowy seat, jeśli ostatnia legalna ekspozycja go zatwierdza. Snapshot obejmuje leave_after_hand aż do rzeczywistego opuszczenia. HUMAN_ONLY i istniejące SLOW_PRIVATE są wyłączone. W audycie pozostają table_id i admission identity; późniejsze leave, usunięcie seat lub reset fast nie gubią obowiązku wygaszenia.

Zmiany członkostwa w `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `leave.mjs::executePokerLeave` i deferred leave finalizer oraz cleanup/writer muszą użyć tego samego guard konta: table → state/seats → posortowane konta → pool → ledger. Snapshot innych członkostw czytać po uzyskaniu guard w świeżym odczycie READ COMMITTED; nigdy blokować B podczas trzymania A/konta. Każdy zapis/usunięcie członkostwa musi być zinwentaryzowany, także terminal cleanup. Serializacja na guard zapewnia kompletną listę w chwili zdarzenia bez blokad wielu stołów naraz.

Po commit uruchomić istniejące `ws-server/server.mjs::enqueueTableCommand` dla powiązanych stołów, po jednym stole/transakcji. Restart/sweep ponawia nieprzeniesione powiązania. Fanout jest projekcją: autorytatywny DRAINING obowiązuje od exhausted_at nawet przed zapisem lokalnej meta. Każde admission (także przed seated rejoin early return), nowe finansowanie i każdy start_hand/bootstrap/prepare/commit rollover odczytuje trwałe powiązania dla stołu i konta. Recheck w `persisted-state-writer.mjs::writeViaDb` obejmuje również pusty funding plan; sama kolejka per-table ani cache WS nie wystarczą. Final gate blokuje posortowane konta wszystkich obecnych ludzi i utrzymuje guard do commit nowej ręki nawet przy zerowym funding; odczyt po guard widzi konkurencyjny COMMIT FAST_EXHAUSTED. Powiązania historyczne sprawdza również po odejściu konta. Serializacja rozstrzyga race A-exhaustion/B-start: zatwierdzona wcześniej ręka pozostaje żywa, późniejsza podlega oryginalnemu deadline. Brak dowodu blokuje nową rękę/dostęp/funding, zachowując settlement.

Deadline to najwcześniejsze właściwe exhausted_at + 30 min, nigdy czas lokalnego wykrycia. Projekcja może zostać skorygowana wyłącznie do wcześniejszego udowodnionego zdarzenia, nigdy wydłużona; identyfikator źródłowego zdarzenia pozostaje w audycie. A wyczerpane w t0, B wykryte w t0+20 min: B ma deadline t0+30 min; wykryte po nim nie zacznie ręki. Trwająca ręka kończy się normalnie, bez automatycznego kicka, z poprawną wypłatą. Już sfinansowane boty mogą grać tylko w grace, bez dalszego finansowania.

## 5. Finanse i refill

MINT wywołuje wyłącznie backend po aktywacji polityki. Contract input: tier, class, durable proof identity; **kwotę, źródło, okres i pozostałe limity wylicza backend pod lockiem**, nie przyjmuje autorytatywnie od klienta. Odrzucić źródła poza zatwierdzonymi pulami, dowolny USER credit, brak GENESIS debit, niezerową sumę, brak dowodu/policy lub powtórny proof allocation.

Netlify ledger potrzebuje wąskiego wewnętrznego kontraktu dla SYSTEM-only MINT oraz zatwierdzonej INITIAL_ALLOCATION/REBALANCE; ogólne `chips-tx` nie przekazuje tej capability i nie może bezpośrednio obciążać chronionych pul. WS TABLE_BUY_IN adapter współdzieli transakcyjną ochronę pool state. Wszystkie transfery chronionych kont muszą aktualizować właściwy stan rezerwy; metadata klienta nie wybierają klasy.

Refill receipt zawiera kind, event_key, timestamp, policy, proof IDs, source/target, amount, ledger transaction/hash i zaktualizowane limity. Powtórzenie zwraca dokładny wcześniejszy wynik. Zyski zamkniętych stołów kompensują straty w signed sum; zgadywana atrybucja indywidualnych winnings jest zakazana. Aktywne commitment pozostaje w kapitalizacji. Headroom używa konserwatywnej górnej granicy max(committed cost, pełne escrow) każdego otwartego stołu, w spójnym serializable odczycie z refill; pełne escrow służy tylko ograniczeniu headroom, nigdy udowodnieniu straty. Brak kompletności = zero; żadnej emisji z samego spadku live liquidity ani obrotu bot-only.

### Krocząca emisja i pierwsza alokacja — D2–D3

D2 zatwierdzone: limity REFILL liczone w kroczącym (t−168 h, t], z tym samym t dla obu tierów, klas i globalnego cap. Lewa granica wyłączona, prawa włączona. Trwałe receipts i globalna blokada obejmują sumę już zatwierdzonych emisji oraz proponowaną kwotę; brak resetu kalendarzowego.

D3 zatwierdzone: jednorazowy idempotentny MINT 1 000 000 CH GENESIS → POKER_BOT_BANKROLL_100, z ochroną 900 000 CH STANDARD i 100 000 CH SLOW. Trwały unikalny purpose INITIAL_ALLOCATION niezależny od czasu, retry i policy_version. Operacja oddzielna od REFILL i schema provisioning; wykonanie na Production wymaga osobnego GO.

Global emission guard → pool → receipts/accounts; wszystkie klasy i tiery uczestniczą w tej samej serializacji. Czas UTC t pobierać po blokadzie, przy niekompletnym dowodzie lub cofnięciu zegara odmowa emisji. Serializable snapshot sprzed oczekiwania na guard nie może pominąć konkurencyjnego receipt: zapisywać version globalnego guard w każdej emisji i ponawiać całą transakcję po serialization conflict. Autoryzacja, kompensacja proof, receipt i double-entry MINT commitują razem. Liczniki są projekcją as-of t; suma trwałych REFILL receipts jest źródłem prawdy. Granica issued_at=t−168 h uwalnia dokładnie tę emisję; młodsze pozostają. INITIAL_ALLOCATION ma osobny audyt podaży, nie konsumuje ani nie odnawia cap REFILL. Schema tworzy konto z zerem; alokacja przy jednym kredycie 1 000 000 CH ustawia obie rezerwy atomowo. Powtórzenie lub równoczesne wywołanie zwraca istniejący rezultat bez drugiego kredytu.

Fundamentalne testy: tuż przed/na/po 168 h; równoczesne 100/500 i STANDARD/SLOW przy ostatnim headroom klasy/tieru/global; restart i utracona odpowiedź; proof/receipt retention; brak podwójnej emisji na granicy kalendarzowego tygodnia; INITIAL_ALLOCATION retry i race dają jeden milion oraz dokładne 900000/100000, osobno od REFILL. Żaden test nie wykonuje Production GO.

Żaden reset allowance nie wywołuje przelewu.

## 6. Minimalny audyt

Klog: user-budget decision (account/table/event/version/mode/cost/reason), drain first/deadline, funding committed/denied (tier/class/source/receipt), close proof (terminal version/net/return/escrow), refill (proof/amount/limits/idempotency), proof unavailable. Bez tokenów, prywatnych kart, sekretów i nadmiarowego logowania ręki. Finansowym dowodem jest trwały ledger/event, nie sam klog. Istniejąca możliwość kopiowania logów pozostaje.
